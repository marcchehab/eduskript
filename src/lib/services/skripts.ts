/**
 * Skripts service — author-scoped reads + writes.
 *
 * Mirrors the GET /api/skripts handler so REST and MCP go through the same path.
 * The "includeShared" flag is preserved for the REST handler; MCP defaults to
 * the broader OR query so teachers see both directly-authored skripts and ones
 * inherited via collection authorship.
 *
 * Write side-effects on update mirror updatePageForUser (skript-level subset):
 *   - revalidateTag(skriptBySlug, teacherContent) per editing user
 *   - revalidateTag(orgContent) per org membership
 *   - revalidatePath('/dashboard')
 */

import { revalidatePath, revalidateTag } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { CACHE_TAGS } from '@/lib/cached-queries'
import { checkSkriptPermissions } from '@/lib/permissions'
import { generateExcerpt, generateSlug } from '@/lib/markdown'
import {
  ConflictError,
  NotFoundError,
  PermissionDeniedError,
  ValidationError,
} from '@/lib/services/pages'

interface ListOptions {
  includeShared?: boolean
}

const skriptInclude = {
  pages: {
    select: { id: true, title: true, slug: true, isPublished: true, order: true },
    orderBy: { order: 'asc' as const },
  },
  authors: {
    include: {
      user: { select: { id: true, name: true, email: true } },
    },
  },
  collectionSkripts: {
    include: {
      collection: {
        include: {
          authors: {
            include: {
              user: { select: { id: true, name: true, email: true } },
            },
          },
        },
      },
    },
  },
} as const

export async function listSkriptsForUser(
  userId: string,
  options: ListOptions = {}
) {
  const { includeShared = true } = options

  const whereClause = includeShared
    ? {
        OR: [
          { authors: { some: { userId } } },
          {
            collectionSkripts: {
              some: {
                collection: { authors: { some: { userId } } },
              },
            },
          },
        ],
      }
    : { authors: { some: { userId } } }

  return prisma.skript.findMany({
    where: whereClause,
    include: skriptInclude,
    orderBy: { updatedAt: 'desc' },
  })
}

/**
 * Fetch a single skript with permission check. Used by `create_page` MCP tool
 * and any other path that needs author-or-better authorization.
 */
export async function getSkriptForUser(
  userId: string,
  skriptId: string,
  ctx: { isAdmin?: boolean } = {}
) {
  const skript = await prisma.skript.findUnique({
    where: { id: skriptId },
    include: skriptInclude,
  })

  if (!skript) throw new NotFoundError('Skript not found')

  const collectionAuthors = skript.collectionSkripts.flatMap(
    (cs) => cs.collection?.authors ?? []
  )
  const perms = checkSkriptPermissions(
    userId,
    skript.authors,
    collectionAuthors,
    ctx.isAdmin
  )
  if (!perms.canView) {
    throw new PermissionDeniedError('Cannot view this skript')
  }

  return { skript, perms }
}

export interface UpdateSkriptPatch {
  title?: string
  description?: string | null
  slug?: string
  isPublished?: boolean
  isUnlisted?: boolean
}

interface ActorContext {
  isAdmin?: boolean
  editSource?: 'mcp' | 'ai-edit'
  editClient?: string
}

/**
 * Update a skript's metadata. Requires direct skript-author permission
 * (collection-author inheritance is view-only by design).
 *
 * Cache invalidation mirrors the page-update path's skript-level invalidation:
 * the editing user's pageSlug surface is refreshed, plus any org content
 * surfaces the skript appears in.
 */
export async function updateSkriptForUser(
  userId: string,
  skriptId: string,
  patch: UpdateSkriptPatch,
  ctx: ActorContext = {}
) {
  if (
    patch.title === undefined &&
    patch.description === undefined &&
    patch.slug === undefined &&
    patch.isPublished === undefined &&
    patch.isUnlisted === undefined
  ) {
    throw new ValidationError(
      'At least one of {title, description, slug, isPublished, isUnlisted} must be provided'
    )
  }

  if (patch.title !== undefined && !patch.title.trim()) {
    throw new ValidationError('Title cannot be empty')
  }
  if (patch.slug !== undefined && !patch.slug.trim()) {
    throw new ValidationError('Slug cannot be empty')
  }

  const existing = await prisma.skript.findUnique({
    where: { id: skriptId },
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
  })
  if (!existing) throw new NotFoundError('Skript not found')

  const collectionAuthors = existing.collectionSkripts.flatMap(
    (cs) => cs.collection?.authors ?? []
  )
  const perms = checkSkriptPermissions(
    userId,
    existing.authors,
    collectionAuthors,
    ctx.isAdmin
  )
  if (!perms.canEdit) {
    throw new PermissionDeniedError('Cannot edit this skript')
  }

  const normalizedSlug = patch.slug ? generateSlug(patch.slug) : undefined
  if (normalizedSlug && normalizedSlug !== existing.slug) {
    // Slugs are unique per author across their own skripts.
    const conflict = await prisma.skript.findFirst({
      where: {
        slug: normalizedSlug,
        authors: { some: { userId } },
        id: { not: skriptId },
      },
    })
    if (conflict) {
      throw new ConflictError('Slug already exists in your skripts')
    }
  }

  const updateData: Record<string, unknown> = { updatedAt: new Date() }
  if (patch.title !== undefined) updateData.title = patch.title.trim()
  if (patch.description !== undefined)
    updateData.description = patch.description?.toString() ?? null
  if (normalizedSlug !== undefined) updateData.slug = normalizedSlug
  if (patch.isPublished !== undefined) updateData.isPublished = patch.isPublished
  if (patch.isUnlisted !== undefined) updateData.isUnlisted = patch.isUnlisted

  const updated = await prisma.skript.update({
    where: { id: skriptId },
    data: updateData,
  })

  // editSource/editClient currently has no skript-level version table to land
  // in; the args are accepted for parity with updatePageForUser so future
  // SkriptVersion work can plug in without changing the MCP tool surface.
  void ctx.editSource
  void ctx.editClient

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { pageSlug: true },
  })
  if (user?.pageSlug) {
    revalidateTag(CACHE_TAGS.skriptBySlug(user.pageSlug, updated.slug), {
      expire: 0,
    })
    if (normalizedSlug && normalizedSlug !== existing.slug) {
      // Old slug's tag also needs flushing so stale pages stop responding.
      revalidateTag(CACHE_TAGS.skriptBySlug(user.pageSlug, existing.slug), {
        expire: 0,
      })
    }
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

  return updated
}

/**
 * Bulk SEO snapshot for a skript: skript metadata, frontpage status, and a
 * per-page row with content excerpt + flagged issues. Read-only.
 *
 * The MCP `audit_skript_seo` tool wraps this so an AI can scan a whole skript
 * with one call instead of N round-trips.
 */
export async function auditSkriptSeoForUser(userId: string, skriptId: string) {
  const { skript, perms } = await getSkriptForUser(userId, skriptId)
  if (!perms.canView) {
    throw new PermissionDeniedError('Cannot view this skript')
  }

  const frontPage = await prisma.frontPage.findFirst({
    where: { skriptId },
    select: { id: true, content: true, isPublished: true, updatedAt: true },
  })

  const fullPages = await prisma.page.findMany({
    where: { skriptId },
    orderBy: { order: 'asc' },
    select: {
      id: true,
      title: true,
      slug: true,
      content: true,
      order: true,
      isPublished: true,
      isUnlisted: true,
      updatedAt: true,
    },
  })

  const pageRows = fullPages.map((p) => {
    const excerpt = generateExcerpt(p.content, 160)
    const issues: string[] = []
    if (!p.title || p.title.trim().length < 3) issues.push('title-too-short')
    if (p.content.trim().length < 200) issues.push('content-too-short')
    if (excerpt.length < 50) issues.push('excerpt-too-short')
    if (!p.isPublished) issues.push('unpublished')
    return {
      id: p.id,
      title: p.title,
      slug: p.slug,
      order: p.order,
      isPublished: p.isPublished,
      isUnlisted: p.isUnlisted,
      contentLength: p.content.length,
      excerpt,
      updatedAt: p.updatedAt,
      hasIssues: issues.length > 0,
      issues,
    }
  })

  return {
    skript: {
      id: skript.id,
      title: skript.title,
      slug: skript.slug,
      description: skript.description,
      isPublished: skript.isPublished,
      isUnlisted: skript.isUnlisted,
    },
    frontPage: frontPage
      ? {
          id: frontPage.id,
          isPublished: frontPage.isPublished,
          excerpt: generateExcerpt(frontPage.content, 160),
          contentLength: frontPage.content.length,
          updatedAt: frontPage.updatedAt,
        }
      : null,
    pages: pageRows,
    totals: {
      pages: pageRows.length,
      published: pageRows.filter((r) => r.isPublished).length,
      withIssues: pageRows.filter((r) => r.hasIssues).length,
    },
  }
}
