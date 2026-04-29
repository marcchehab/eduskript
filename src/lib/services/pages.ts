/**
 * Pages service — single source of truth for page reads/writes.
 *
 * Both the REST API handlers (under src/app/api/pages/) and the MCP tools
 * (under src/lib/mcp/tools/) call into this module. Going through one service
 * guarantees that page-write side effects — PageVersion creation and the
 * revalidateTag/revalidatePath fan-out — fire identically regardless of caller.
 *
 * Side effects on update (mirrors the original PATCH at src/app/api/pages/[id]/route.ts):
 *   - PageVersion.create when content changes
 *   - 4 static revalidateTag (pageBySlug, skriptBySlug, collectionBySlug, teacherContent)
 *   - 1 revalidateTag(orgContent) per org membership
 *   - 2 revalidatePath (public page route, /dashboard)
 *   - All gated on the author having a pageSlug — null pageSlug = no revalidation
 *
 * The contract is enforced by tests/api/pages-cache.test.ts. Don't bypass it.
 */

import { revalidatePath, revalidateTag } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { CACHE_TAGS } from '@/lib/cached-queries'
import { checkPagePermissions } from '@/lib/permissions'
import { generateSlug } from '@/lib/markdown'
import { createLogger } from '@/lib/logger'

const log = createLogger('cache:invalidate')

export class PermissionDeniedError extends Error {
  constructor(message = 'Permission denied') {
    super(message)
    this.name = 'PermissionDeniedError'
  }
}

export class NotFoundError extends Error {
  constructor(message = 'Not found') {
    super(message)
    this.name = 'NotFoundError'
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}

export class ConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConflictError'
  }
}

export interface UpdatePagePatch {
  title?: string
  slug?: string
  content?: string
  isPublished?: boolean
  isUnlisted?: boolean
  pageType?: string
  examSettings?: unknown
}

export interface CreatePageInput {
  skriptId: string
  title: string
  slug: string
  content?: string
}

interface ActorContext {
  isAdmin?: boolean
  /**
   * Attribution for the version row this write produces. `null`/undefined →
   * direct dashboard edit. `"mcp"` → set by the MCP transport on tool calls.
   * `"ai-edit"` → set by the dashboard AI Edit "Apply" flow.
   */
  editSource?: 'mcp' | 'ai-edit'
  /** Snapshot of OAuthClient.name; only meaningful when editSource === 'mcp'. */
  editClient?: string
}

/**
 * Page with all relations needed for permission checks + cache invalidation.
 */
async function loadPageForActor(pageId: string, userId: string, isAdmin: boolean) {
  return prisma.page.findFirst({
    where: {
      id: pageId,
      ...(isAdmin ? {} : { authors: { some: { userId } } }),
    },
    include: {
      skript: {
        include: {
          collectionSkripts: { include: { collection: true } },
        },
      },
      versions: { orderBy: { version: 'desc' }, take: 1 },
    },
  })
}

/**
 * Read a page if the user has view permission. Throws on miss / denial.
 */
export async function getPageForUser(
  userId: string,
  pageId: string,
  ctx: ActorContext = {}
) {
  const page = await prisma.page.findUnique({
    where: { id: pageId },
    include: {
      authors: { include: { user: { select: { id: true, name: true } } } },
      skript: {
        include: {
          authors: { include: { user: { select: { id: true, name: true } } } },
          collectionSkripts: {
            include: {
              collection: {
                include: {
                  authors: {
                    include: { user: { select: { id: true, name: true } } },
                  },
                },
              },
            },
          },
        },
      },
    },
  })

  if (!page) throw new NotFoundError('Page not found')

  const collectionAuthors = page.skript.collectionSkripts.flatMap(
    (cs) => cs.collection?.authors ?? []
  )
  const perms = checkPagePermissions(
    userId,
    page.authors,
    page.skript.authors,
    collectionAuthors,
    ctx.isAdmin
  )
  if (!perms.canView) throw new PermissionDeniedError('Cannot view this page')

  return page
}

/**
 * Create a page within a skript the user authors. Mirrors POST /api/pages exactly:
 * one PageVersion.create with version=1; one revalidatePath('/dashboard').
 */
export async function createPageForUser(
  userId: string,
  input: CreatePageInput,
  ctx: ActorContext = {}
) {
  const { skriptId, title, slug, content = '' } = input

  if (!title || !slug || !skriptId) {
    throw new ValidationError('Title, slug, and skript ID are required')
  }

  const skript = await prisma.skript.findFirst({
    where: { id: skriptId, authors: { some: { userId } } },
  })
  if (!skript) throw new NotFoundError('Skript not found or access denied')

  const normalizedSlug = generateSlug(slug)
  const existing = await prisma.page.findFirst({
    where: { skriptId, slug: normalizedSlug },
  })
  if (existing) {
    throw new ConflictError('A page with this slug already exists in this skript')
  }

  const lastPage = await prisma.page.findFirst({
    where: { skriptId },
    orderBy: { order: 'desc' },
  })
  const nextOrder = (lastPage?.order ?? 0) + 1

  const page = await prisma.page.create({
    data: {
      title,
      slug: normalizedSlug,
      content,
      order: nextOrder,
      skriptId,
      authors: { create: { userId, permission: 'author' } },
    },
    include: { authors: { include: { user: true } } },
  })

  await prisma.pageVersion.create({
    data: {
      content,
      version: 1,
      authorId: userId,
      pageId: page.id,
      editSource: ctx.editSource ?? null,
      editClient: ctx.editSource === 'mcp' ? ctx.editClient ?? null : null,
    },
  })

  revalidatePath('/dashboard')
  return page
}

/**
 * Update a page. The hard part: replicating every side-effect from the original
 * PATCH so the regression test in tests/api/pages-cache.test.ts stays green.
 */
export async function updatePageForUser(
  userId: string,
  pageId: string,
  patch: UpdatePagePatch,
  ctx: ActorContext = {}
) {
  const isAdmin = !!ctx.isAdmin
  const { title, slug, content, isPublished, isUnlisted, pageType, examSettings } = patch

  const isContentOnlyUpdate =
    content !== undefined &&
    title === undefined &&
    slug === undefined &&
    isPublished === undefined
  const isPublishOnlyUpdate =
    isPublished !== undefined &&
    title === undefined &&
    slug === undefined &&
    content === undefined

  if (
    !isContentOnlyUpdate &&
    !isPublishOnlyUpdate &&
    (!title?.trim() || !slug?.trim())
  ) {
    throw new ValidationError('Title and slug are required')
  }

  const existingPage = await loadPageForActor(pageId, userId, isAdmin)
  if (!existingPage) {
    throw new NotFoundError('Page not found')
  }

  if (!isContentOnlyUpdate && !isPublishOnlyUpdate && slug) {
    const slugExists = await prisma.page.findFirst({
      where: {
        slug: slug.trim(),
        skriptId: existingPage.skriptId,
        id: { not: pageId },
      },
    })
    if (slugExists) {
      throw new ConflictError('Slug already exists in this skript')
    }
  }

  const currentVersion = existingPage.versions[0]
  const contentChanged =
    content !== undefined && currentVersion?.content !== content

  const updateData: Record<string, unknown> = { updatedAt: new Date() }
  if (title !== undefined) updateData.title = title.trim()
  if (slug !== undefined) updateData.slug = slug.trim()
  if (content !== undefined) updateData.content = content
  if (isPublished !== undefined) updateData.isPublished = isPublished
  if (isUnlisted !== undefined) updateData.isUnlisted = isUnlisted
  if (pageType !== undefined) updateData.pageType = pageType
  if (examSettings !== undefined) updateData.examSettings = examSettings

  const updatedPage = await prisma.page.update({
    where: { id: pageId },
    data: updateData,
  })

  if (contentChanged) {
    await prisma.pageVersion.create({
      data: {
        pageId,
        content: content || '',
        version: (currentVersion?.version || 0) + 1,
        authorId: userId,
        editSource: ctx.editSource ?? null,
        editClient: ctx.editSource === 'mcp' ? ctx.editClient ?? null : null,
      },
    })
  }

  // Revalidate the public page cache using tags.
  // The whole block is gated on the author having a pageSlug — users without
  // a public page have nothing to invalidate.
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { pageSlug: true },
  })

  if (user?.pageSlug) {
    log('Invalidating cache tags', {
      pageSlug: user.pageSlug,
      skriptSlug: existingPage.skript.slug,
      page: updatedPage.slug,
    })
    revalidateTag(
      CACHE_TAGS.pageBySlug(user.pageSlug, existingPage.skript.slug, updatedPage.slug),
      { expire: 0 }
    )
    revalidateTag(
      CACHE_TAGS.skriptBySlug(user.pageSlug, existingPage.skript.slug),
      { expire: 0 }
    )

    const collectionSlug = existingPage.skript.collectionSkripts[0]?.collection?.slug
    if (collectionSlug) {
      revalidateTag(CACHE_TAGS.collectionBySlug(user.pageSlug, collectionSlug), {
        expire: 0,
      })
    }

    revalidatePath(
      `/${user.pageSlug}/${existingPage.skript.slug}/${updatedPage.slug}`
    )

    revalidateTag(CACHE_TAGS.teacherContent(user.pageSlug), { expire: 0 })

    revalidatePath('/dashboard')

    const orgMemberships = await prisma.organizationMember.findMany({
      where: { userId },
      select: { organization: { select: { slug: true } } },
    })
    for (const membership of orgMemberships) {
      revalidateTag(CACHE_TAGS.orgContent(membership.organization.slug), {
        expire: 0,
      })
    }
  }

  return updatedPage
}

/**
 * Full-text-ish search across title + content for content the user authors
 * (directly or inherited via skript/collection authorship). Capped at 20.
 *
 * Uses ILIKE via Prisma's case-insensitive contains. Acceptable for v1 — the
 * underlying Postgres trigram/FTS path can be added later if relevance matters.
 */
export async function searchPagesForUser(
  userId: string,
  query: string,
  limit = 20
) {
  if (!query.trim()) return []

  const q = query.trim()

  return prisma.page.findMany({
    where: {
      OR: [
        { authors: { some: { userId } } },
        { skript: { authors: { some: { userId } } } },
        {
          skript: {
            collectionSkripts: {
              some: {
                collection: { authors: { some: { userId } } },
              },
            },
          },
        },
      ],
      AND: {
        OR: [
          { title: { contains: q, mode: 'insensitive' } },
          { content: { contains: q, mode: 'insensitive' } },
        ],
      },
    },
    include: {
      skript: { select: { id: true, title: true, slug: true } },
    },
    orderBy: { updatedAt: 'desc' },
    take: limit,
  })
}
