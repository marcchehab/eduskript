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
import { checkCollectionPermissions, checkSkriptPermissions } from '@/lib/permissions'
import { generateExcerpt, generateSlug, isReservedSlug } from '@/lib/markdown'
import { PRIMARY_SITE_ORDER } from '@/lib/sites'
import { ensurePageLayoutItem, revalidateSiteContent } from '@/lib/page-layout'
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
        select: { id: true, title: true },
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
                collection: { site: { userId } },
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

  const perms = checkSkriptPermissions(userId, skript.authors, ctx.isAdmin)
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
    },
  })
  if (!existing) throw new NotFoundError('Skript not found')

  const perms = checkSkriptPermissions(userId, existing.authors, ctx.isAdmin)
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

  const userSite = await prisma.site.findFirst({
    where: { userId },
    orderBy: PRIMARY_SITE_ORDER,
    select: { slug: true },
  })
  if (userSite?.slug) {
    const pageSlug = userSite.slug
    revalidateTag(CACHE_TAGS.skriptBySlug(pageSlug, updated.slug), { expire: 0 })
    if (normalizedSlug && normalizedSlug !== existing.slug) {
      // Old slug's tag also needs flushing so stale pages stop responding.
      revalidateTag(CACHE_TAGS.skriptBySlug(pageSlug, existing.slug), { expire: 0 })
    }
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

  return updated
}

async function loadOrgRoles(userId: string, organizationId: string | null | undefined) {
  if (!organizationId) return []
  return prisma.organizationMember.findMany({
    where: { userId, organizationId },
    select: { organizationId: true, role: true },
  })
}

export interface CreateSkriptInput {
  title: string
  /** URL slug; defaults to a slug derived from the title. Normalized. */
  slug?: string
  description?: string | null
  /** Place the new skript inside this collection. Omit → a root skript on the
   *  user's primary site. Either way the container is added to the sidebar. */
  collectionId?: string
  /** Publish immediately (default true) so it shows in the sidebar right away. */
  publish?: boolean
}

/**
 * Create a skript AND place it in the sidebar in one call — the MCP counterpart
 * to the dashboard's "create skript" flow. Unlike POST /api/skripts (which
 * creates a detached skript the teacher drags in later), this auto-adds the
 * container (collection, or the skript as a root item) to the site's PageLayout
 * and publishes by default, so it appears on the live site immediately.
 *
 * Reuses the same slug normalize/reserve/per-user-dedupe + nested SkriptAuthor
 * write as the REST route; kept separate because the placement semantics differ.
 */
export async function createSkriptForUser(
  userId: string,
  input: CreateSkriptInput,
  ctx: ActorContext = {}
) {
  const { title, description, collectionId, publish = true } = input
  if (!title || !title.trim()) throw new ValidationError('Title is required')

  // Resolve the target site + verify the caller may place content there.
  let siteId: string
  let siteSlug: string | null
  if (collectionId) {
    const collection = await prisma.collection.findUnique({
      where: { id: collectionId },
      include: { site: { select: { id: true, slug: true, userId: true, organizationId: true } } },
    })
    if (!collection) throw new NotFoundError('Collection not found')
    const orgRoles = await loadOrgRoles(userId, collection.site?.organizationId)
    if (!checkCollectionPermissions(userId, collection, orgRoles, ctx.isAdmin).canEdit) {
      throw new PermissionDeniedError('Cannot create skripts in this collection')
    }
    siteId = collection.site!.id
    siteSlug = collection.site!.slug
  } else {
    const site = await prisma.site.findFirst({
      where: { userId },
      orderBy: PRIMARY_SITE_ORDER,
      select: { id: true, slug: true },
    })
    if (!site) {
      throw new ValidationError('You need to set up your public page before creating skripts')
    }
    siteId = site.id
    siteSlug = site.slug
  }

  const normalizedSlug = generateSlug(input.slug?.trim() || title)
  if (isReservedSlug(normalizedSlug)) {
    throw new ValidationError(`The slug "${normalizedSlug}" is reserved and cannot be used`)
  }
  // Slugs are unique per user across owned + authored skripts.
  const existing = await prisma.skript.findFirst({
    where: {
      slug: normalizedSlug,
      OR: [
        { authors: { some: { userId } } },
        { collectionSkripts: { some: { collection: { site: { userId } } } } },
      ],
    },
  })
  if (existing) throw new ConflictError(`You already have a skript with the slug "${normalizedSlug}"`)

  const nextOrder = collectionId
    ? ((await prisma.collectionSkript.findFirst({
        where: { collectionId },
        orderBy: { order: 'desc' },
      }))?.order ?? -1) + 1
    : 0

  const skript = await prisma.$transaction(async (tx) => {
    const created = await tx.skript.create({
      data: {
        title: title.trim(),
        description: description?.toString() ?? null,
        slug: normalizedSlug,
        isPublished: publish,
        authors: { create: { userId, permission: 'author' } },
      },
    })
    if (collectionId) {
      await tx.collectionSkript.create({
        data: { collectionId, skriptId: created.id, order: nextOrder },
      })
    }
    return created
  })

  // Make it visible in the sidebar: the collection (or the skript, as a root
  // item) must be present in the site's PageLayout.
  await ensurePageLayoutItem(siteId, collectionId ? 'collection' : 'skript', collectionId ?? skript.id)
  revalidateSiteContent(siteSlug)
  void ctx.editSource
  void ctx.editClient
  return skript
}

export interface PlaceSkriptInput {
  skriptId: string
  /** Collection to place the skript in. Omit → place as a root sidebar item. */
  collectionId?: string
  /** 0-based insert index within the collection; defaults to the end. */
  position?: number
}

/**
 * Place an EXISTING skript into a collection (or as a root sidebar item) and
 * ensure the container is in the site's PageLayout. Idempotent: re-placing a
 * skript already in the target collection is a no-op on membership. Requires
 * author on the skript, plus edit on the collection (or site ownership for root).
 *
 * Note: this does not REMOVE the skript from other collections or the root
 * layout; hydratePageLayoutItems already hides a skript that is both a root
 * item and a collection member (shown only inside the collection).
 */
export async function placeSkriptForUser(
  userId: string,
  input: PlaceSkriptInput,
  ctx: ActorContext = {}
) {
  const { skriptId, collectionId, position } = input

  const skript = await prisma.skript.findUnique({
    where: { id: skriptId },
    include: { authors: { include: { user: { select: { id: true } } } } },
  })
  if (!skript) throw new NotFoundError('Skript not found')
  if (!checkSkriptPermissions(userId, skript.authors, ctx.isAdmin).canEdit) {
    throw new PermissionDeniedError('Cannot edit this skript')
  }

  if (collectionId) {
    const collection = await prisma.collection.findUnique({
      where: { id: collectionId },
      include: {
        site: { select: { id: true, slug: true, userId: true, organizationId: true } },
        collectionSkripts: { orderBy: { order: 'asc' }, select: { skriptId: true } },
      },
    })
    if (!collection) throw new NotFoundError('Collection not found')
    const orgRoles = await loadOrgRoles(userId, collection.site?.organizationId)
    if (!checkCollectionPermissions(userId, collection, orgRoles, ctx.isAdmin).canEdit) {
      throw new PermissionDeniedError('Cannot edit this collection')
    }

    const alreadyMember = collection.collectionSkripts.some(cs => cs.skriptId === skriptId)
    if (!alreadyMember) {
      const insertAt = Math.max(
        0,
        Math.min(position ?? collection.collectionSkripts.length, collection.collectionSkripts.length)
      )
      await prisma.$transaction([
        prisma.collectionSkript.updateMany({
          where: { collectionId, order: { gte: insertAt } },
          data: { order: { increment: 1 } },
        }),
        prisma.collectionSkript.create({
          data: { collectionId, skriptId, order: insertAt },
        }),
      ])
    }

    await ensurePageLayoutItem(collection.site!.id, 'collection', collectionId)
    revalidateSiteContent(collection.site!.slug)
    return { skriptId, collectionId, alreadyMember }
  }

  // Root placement on the user's primary site.
  const site = await prisma.site.findFirst({
    where: { userId },
    orderBy: PRIMARY_SITE_ORDER,
    select: { id: true, slug: true },
  })
  if (!site) throw new ValidationError('You need to set up your public page first')
  await ensurePageLayoutItem(site.id, 'skript', skriptId)
  revalidateSiteContent(site.slug)
  return { skriptId, root: true }
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
      description: true,
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
    // Only flag a thin excerpt as an issue when the teacher hasn't supplied
    // their own page.description — that field overrides the auto-derived
    // excerpt for og:description, so a short excerpt no longer hurts SEO.
    if (excerpt.length < 50 && !p.description) issues.push('excerpt-too-short')
    if (!p.isPublished) issues.push('unpublished')
    return {
      id: p.id,
      title: p.title,
      slug: p.slug,
      description: p.description,
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
