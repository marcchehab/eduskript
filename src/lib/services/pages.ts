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
 *   - 3 static revalidateTag (pageBySlug, skriptBySlug, teacherContent)
 *   - 1 revalidateTag(orgContent) per org membership
 *   - 2 revalidatePath (public page route, /dashboard)
 *   - All gated on the author having a pageSlug — null pageSlug = no revalidation
 *
 * The contract is enforced by tests/api/pages-cache.test.ts. Don't bypass it.
 */

import { revalidatePath, revalidateTag } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { CACHE_TAGS } from '@/lib/cached-queries'
import { invalidateSitemaps } from '@/lib/sitemap-cache'
import { checkPagePermissions } from '@/lib/permissions'
import { generateSlug } from '@/lib/markdown'
import { createLogger } from '@/lib/logger'
import { PRIMARY_SITE_ORDER } from '@/lib/sites'

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
  // Optional teacher-authored summary used as the og:description on the
  // public page. Pass `null` (or empty string, normalised below) to clear.
  description?: string | null
  content?: string
  isPublished?: boolean
  isUnlisted?: boolean
  pageType?: string
  examSettings?: unknown
  presentationPublic?: boolean
}

export interface CreatePageInput {
  skriptId: string
  title: string
  slug: string
  description?: string | null
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
  /**
   * Opt-in escape hatch for the destructive-write guard in updatePageForUser.
   * When true, an empty/whitespace-only `content` string is accepted even if
   * the page currently has content. Default false — the guard exists because
   * partial-update tools that treat `content: ""` as "set content to empty"
   * silently wipe pages, and the recovery path (restorePageVersionForUser)
   * shouldn't be the default workflow.
   */
  allowEmptyContent?: boolean
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
 * Resolve the slug of the Site that actually owns this page's skript, for
 * cache-invalidation purposes. A teacher can own multiple Sites (schema
 * comment on Site: "extra sites are provisioned by a superadmin only"), so
 * falling back to the caller's PRIMARY site — the old behavior — silently
 * revalidates the wrong site's cache tags/paths whenever the edited page
 * lives on a non-primary site (e.g. a secondary site carrying a custom
 * domain). The real public page then stays stale until something else
 * happens to bust it.
 *
 * Preference order: the skript's collection's site (most skripts have
 * exactly one collection membership) → the site whose PageLayout pins this
 * skript as a root item → the caller's primary site as a last-resort
 * fallback (orphaned skripts not yet placed anywhere).
 */
async function resolveOwningSiteSlug(
  existingPage: NonNullable<Awaited<ReturnType<typeof loadPageForActor>>>,
  userId: string
): Promise<string | null> {
  const collectionSiteId = existingPage.skript.collectionSkripts[0]?.collection?.siteId
  if (collectionSiteId) {
    const site = await prisma.site.findUnique({
      where: { id: collectionSiteId },
      select: { slug: true },
    })
    if (site) return site.slug
  }

  const layoutItem = await prisma.pageLayoutItem.findFirst({
    where: { type: 'skript', contentId: existingPage.skriptId },
    select: { pageLayout: { select: { site: { select: { slug: true } } } } },
  })
  if (layoutItem?.pageLayout.site?.slug) return layoutItem.pageLayout.site.slug

  const primarySite = await prisma.site.findFirst({
    where: { userId },
    orderBy: PRIMARY_SITE_ORDER,
    select: { slug: true },
  })
  return primarySite?.slug ?? null
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
        },
      },
    },
  })

  if (!page) throw new NotFoundError('Page not found')

  const perms = checkPagePermissions(
    userId,
    page.authors,
    page.skript.authors,
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
  const { skriptId, title, slug, description, content = '' } = input

  if (!title || !slug || !skriptId) {
    throw new ValidationError('Title, slug, and skript ID are required')
  }

  // Empty string normalises to null so DB stays clean and og:description
  // falls through to the auto-derived excerpt instead of rendering "".
  const normalizedDescription = description !== undefined && description !== null
    ? description.trim() || null
    : null

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
      description: normalizedDescription,
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
  const rawPatch = patch
  const { content, isPublished, isUnlisted, pageType, examSettings, presentationPublic } = rawPatch

  // Empty-string-as-no-change normalisation. Partial-update tools (REST
  // PATCH, MCP update_page_metadata, MCP update_page) often receive
  // `title: ""` / `slug: ""` / `description: ""` from clients that
  // "pass everything to be safe" — the LLM-friendly interpretation is
  // that an empty value means "leave alone", not "set to empty". Title
  // and slug can never legitimately be empty (DB-non-null), so this
  // collapses cleanly. Description is a tristate: undefined / "" → no
  // change, `null` → clear, non-empty string → set. `content` keeps
  // its own destructive-write guard semantics (see further down) and
  // is intentionally NOT normalised here.
  const title =
    typeof rawPatch.title === 'string' && rawPatch.title.trim().length === 0
      ? undefined
      : rawPatch.title
  const slug =
    typeof rawPatch.slug === 'string' && rawPatch.slug.trim().length === 0
      ? undefined
      : rawPatch.slug
  const description =
    typeof rawPatch.description === 'string' &&
    rawPatch.description.trim().length === 0
      ? undefined
      : rawPatch.description

  // Post-normalisation: any title / slug we kept must be a real value.
  // (The empty-string case is already gone; this only fires if a caller
  // somehow lands a non-string here, which Zod should have prevented.)
  if (title !== undefined && !title.trim()) {
    throw new ValidationError('Title cannot be whitespace only')
  }
  if (slug !== undefined && !slug.trim()) {
    throw new ValidationError('Slug cannot be whitespace only')
  }

  const existingPage = await loadPageForActor(pageId, userId, isAdmin)
  if (!existingPage) {
    throw new NotFoundError('Page not found')
  }

  if (slug) {
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

  // Destructive-write guard: a partial-update tool that treats `content: ""`
  // as "set content to empty" silently wipes pages. We require an explicit
  // `allowEmptyContent` opt-in when an empty/whitespace-only content would
  // overwrite a non-trivial existing page.
  if (
    content !== undefined &&
    content.trim().length === 0 &&
    (currentVersion?.content?.trim().length ?? 0) > 0 &&
    !ctx.allowEmptyContent
  ) {
    throw new ValidationError(
      'Refusing to overwrite non-empty page content with an empty string. ' +
        'If you wanted to update only metadata (title, slug, description, ' +
        'isPublished, isUnlisted), omit the `content` field entirely. ' +
        'If wiping the page is intentional, set confirm_destructive=true. ' +
        'To recover an accidentally wiped page, use list_page_versions + ' +
        'restore_page_version.',
    )
  }

  const updateData: Record<string, unknown> = { updatedAt: new Date() }
  if (title !== undefined) updateData.title = title.trim()
  if (slug !== undefined) updateData.slug = slug.trim()
  if (description !== undefined) {
    // After empty-string normalisation above, `description` is one of:
    //   - null         → clear the column (caller's explicit intent)
    //   - non-empty    → store trimmed value
    // Empty string was collapsed to undefined and is already filtered out.
    updateData.description = description === null ? null : description.trim()
  }
  if (content !== undefined) updateData.content = content
  if (isPublished !== undefined) updateData.isPublished = isPublished
  if (isUnlisted !== undefined) updateData.isUnlisted = isUnlisted
  if (pageType !== undefined) updateData.pageType = pageType
  if (examSettings !== undefined) updateData.examSettings = examSettings
  if (presentationPublic !== undefined) updateData.presentationPublic = presentationPublic

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

  // Revalidate the public page cache using tags. The whole block is gated
  // on the page's owning site existing (URL slug lives on Site now); pages
  // with no resolvable site have nothing to invalidate.
  const pageSlug = await resolveOwningSiteSlug(existingPage, userId)

  if (pageSlug) {
    log('Invalidating cache tags', {
      pageSlug,
      skriptSlug: existingPage.skript.slug,
      page: updatedPage.slug,
    })
    revalidateTag(
      CACHE_TAGS.pageBySlug(pageSlug, existingPage.skript.slug, updatedPage.slug),
      { expire: 0 }
    )
    revalidateTag(
      CACHE_TAGS.skriptBySlug(pageSlug, existingPage.skript.slug),
      { expire: 0 }
    )

    revalidatePath(
      `/${pageSlug}/${existingPage.skript.slug}/${updatedPage.slug}`
    )

    revalidateTag(CACHE_TAGS.teacherContent(pageSlug), { expire: 0 })

    // Keyed on the page id rather than its slugs: the /p/{id} stable-link
    // redirect caches this page's canonical URL, and publishing, unpublishing
    // or renaming it all change what that redirect should do (or whether it
    // should 404 at all). See resolveStableLink in page-stable-link.server.ts.
    revalidateTag(CACHE_TAGS.page(updatedPage.id), { expire: 0 })

    // Publishing, unpublishing or renaming changes what the sitemaps list.
    invalidateSitemaps()

    revalidatePath('/dashboard')

    const orgMemberships = await prisma.organizationMember.findMany({
      where: { userId },
      select: { organization: { select: { site: { select: { slug: true } } } } },
    })
    for (const membership of orgMemberships) {
      const orgSlug = membership.organization.site?.slug
      if (orgSlug) {
        revalidateTag(CACHE_TAGS.orgContent(orgSlug), { expire: 0 })
      }
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
                collection: { site: { userId } },
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

/**
 * Extract {skriptSlug, pageSlug} from a pasted Eduskript URL. Every URL shape
 * a teacher actually pastes ends in that slug pair:
 *   - dashboard editor:  /dashboard/skripts/{skriptSlug}/pages/{pageSlug}[/edit]
 *   - public custom domain: https://host/{skriptSlug}/{pageSlug}
 *   - public org shorthand: https://eduskript.org/c/{skriptSlug}/{pageSlug}
 *   - public org full path: https://eduskript.org/{teacherPageSlug}/{skriptSlug}/{pageSlug}
 * A bare "/path" (no scheme) is accepted too. Returns null if no pair can be
 * found (e.g. a frontpage URL, which has no page slug).
 */
export function parseSkriptAndPageSlugs(
  url: string
): { skriptSlug: string; pageSlug: string } | null {
  let pathname: string
  try {
    pathname = new URL(url).pathname
  } catch {
    pathname = url
  }

  const segments = pathname.split('/').filter(Boolean).map(decodeURIComponent)

  if (segments[0] === 'dashboard' && segments[1] === 'skripts') {
    const skriptSlug = segments[2]
    const pagesIdx = segments.indexOf('pages', 3)
    const pageSlug = pagesIdx !== -1 ? segments[pagesIdx + 1] : undefined
    if (!skriptSlug || !pageSlug) return null
    return { skriptSlug, pageSlug }
  }

  if (segments.length < 2) return null
  const skriptSlug = segments[segments.length - 2]
  const pageSlug = segments[segments.length - 1]
  return { skriptSlug, pageSlug }
}

/**
 * Resolve a pasted Eduskript URL (dashboard editor, public page, or the /c/
 * org shorthand) to the page it points at, scoped to the same authorship
 * check as searchPagesForUser (direct, skript-level, or collection/site
 * authorship). Unpublished pages resolve fine — only the dashboard editor
 * URL is expected to point at drafts, and it carries no publish filter.
 */
export async function resolvePageUrlForUser(
  userId: string,
  url: string,
  ctx: ActorContext = {}
) {
  const parsed = parseSkriptAndPageSlugs(url)
  if (!parsed) {
    throw new ValidationError(
      'Could not find a skript/page slug pair in this URL. Expected a dashboard editor URL ' +
        '(/dashboard/skripts/{skript}/pages/{page}), a public page URL, or an eduskript.org/c/... URL.'
    )
  }

  const skript = await prisma.skript.findFirst({
    where: {
      slug: parsed.skriptSlug,
      ...(ctx.isAdmin
        ? {}
        : {
            OR: [
              { authors: { some: { userId } } },
              { collectionSkripts: { some: { collection: { site: { userId } } } } },
            ],
          }),
    },
    select: { id: true },
  })
  if (!skript) {
    throw new NotFoundError(`No skript with slug "${parsed.skriptSlug}" found for this account`)
  }

  const page = await prisma.page.findFirst({
    where: { slug: parsed.pageSlug, skriptId: skript.id },
    select: { id: true },
  })
  if (!page) {
    throw new NotFoundError(
      `No page with slug "${parsed.pageSlug}" in skript "${parsed.skriptSlug}"`
    )
  }

  return getPageForUser(userId, page.id, ctx)
}

/**
 * List PageVersion rows for a page the actor authors. Newest first.
 * Returned shape mirrors the GET /api/pages/[id]/versions REST route, plus a
 * `contentLength` field so MCP callers can spot a wipe without fetching every
 * version's content.
 */
export async function listPageVersionsForUser(
  userId: string,
  pageId: string,
  ctx: ActorContext = {},
) {
  const isAdmin = !!ctx.isAdmin
  const page = await prisma.page.findFirst({
    where: {
      id: pageId,
      ...(isAdmin ? {} : { authors: { some: { userId } } }),
    },
    select: { id: true },
  })
  if (!page) throw new NotFoundError('Page not found')

  const versions = await prisma.pageVersion.findMany({
    where: { pageId },
    include: {
      author: { select: { name: true, email: true } },
    },
    orderBy: { version: 'desc' },
  })

  return versions.map(v => ({
    id: v.id,
    version: v.version,
    changeLog: v.changeLog,
    createdAt: v.createdAt,
    editSource: v.editSource,
    editClient: v.editClient,
    contentLength: v.content.length,
    author: v.author,
  }))
}

/**
 * Restore a page to a prior PageVersion. Mirrors the side effects of
 * src/app/api/pages/[id]/versions/[versionId]/restore/route.ts (which now
 * delegates to this function): updates Page.content, appends a new
 * PageVersion row with `Restored from version N` changeLog, and fires the
 * same cache invalidations as a content-update.
 */
export async function restorePageVersionForUser(
  userId: string,
  pageId: string,
  versionId: string,
  ctx: ActorContext = {},
) {
  const isAdmin = !!ctx.isAdmin

  // Permission gate via loadPageForActor (same shape as updatePageForUser).
  const existingPage = await loadPageForActor(pageId, userId, isAdmin)
  if (!existingPage) throw new NotFoundError('Page not found')

  const versionToRestore = await prisma.pageVersion.findFirst({
    where: { id: versionId, pageId },
  })
  if (!versionToRestore) throw new NotFoundError('Version not found')

  const latestVersion = await prisma.pageVersion.findFirst({
    where: { pageId },
    orderBy: { version: 'desc' },
    select: { version: true },
  })
  const newVersionNumber = (latestVersion?.version || 0) + 1

  const updatedPage = await prisma.page.update({
    where: { id: pageId },
    data: {
      content: versionToRestore.content,
      updatedAt: new Date(),
    },
  })

  await prisma.pageVersion.create({
    data: {
      pageId,
      content: versionToRestore.content,
      version: newVersionNumber,
      changeLog: `Restored from version ${versionToRestore.version}`,
      authorId: userId,
      editSource: ctx.editSource ?? null,
      editClient: ctx.editSource === 'mcp' ? ctx.editClient ?? null : null,
    },
  })

  // Same cache fan-out as updatePageForUser. Gated on the page's owning site
  // existing (URL slug lives on Site); pages with no resolvable site have
  // nothing to invalidate.
  const pageSlug = await resolveOwningSiteSlug(existingPage, userId)

  if (pageSlug) {
    revalidateTag(
      CACHE_TAGS.pageBySlug(pageSlug, existingPage.skript.slug, updatedPage.slug),
      { expire: 0 },
    )
    revalidateTag(
      CACHE_TAGS.skriptBySlug(pageSlug, existingPage.skript.slug),
      { expire: 0 },
    )
    revalidatePath(
      `/${pageSlug}/${existingPage.skript.slug}/${updatedPage.slug}`,
    )
    revalidateTag(CACHE_TAGS.teacherContent(pageSlug), { expire: 0 })
    revalidatePath('/dashboard')

    const orgMemberships = await prisma.organizationMember.findMany({
      where: { userId },
      select: { organization: { select: { site: { select: { slug: true } } } } },
    })
    for (const membership of orgMemberships) {
      const orgSlug = membership.organization.site?.slug
      if (orgSlug) {
        revalidateTag(CACHE_TAGS.orgContent(orgSlug), { expire: 0 })
      }
    }
  }

  return {
    page: updatedPage,
    restoredFromVersion: versionToRestore.version,
  }
}
