/**
 * Collections service — reads and metadata writes scoped by author.
 *
 * Mirrors the pattern in skripts.ts: collection-author edit gate, throws
 * typed errors that the MCP `safe()` wrapper translates to structured
 * tool errors.
 *
 * Cache invalidation on update: teacherContent for the editing user's
 * pageSlug surface, plus per-org membership.
 */

import { revalidatePath, revalidateTag } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { CACHE_TAGS } from '@/lib/cached-queries'
import { checkCollectionPermissions } from '@/lib/permissions'
import { PRIMARY_SITE_ORDER } from '@/lib/sites'
import { ensurePageLayoutItem, revalidateSiteContent } from '@/lib/page-layout'
import {
  NotFoundError,
  PermissionDeniedError,
  ValidationError,
} from '@/lib/services/pages'

interface ActorContext {
  isAdmin?: boolean
  editSource?: 'mcp' | 'ai-edit'
  editClient?: string
}

const collectionInclude = {
  site: { select: { userId: true, organizationId: true } },
  collectionSkripts: {
    include: {
      skript: {
        select: {
          id: true,
          title: true,
          slug: true,
          description: true,
          isPublished: true,
          isUnlisted: true,
        },
      },
    },
    orderBy: { order: 'asc' as const },
  },
} as const

async function loadOrgRoles(userId: string, organizationId: string | null | undefined) {
  if (!organizationId) return []
  return prisma.organizationMember.findMany({
    where: { userId, organizationId },
    select: { organizationId: true, role: true },
  })
}

export async function getCollectionForUser(
  userId: string,
  collectionId: string,
  ctx: ActorContext = {}
) {
  const collection = await prisma.collection.findUnique({
    where: { id: collectionId },
    include: collectionInclude,
  })
  if (!collection) throw new NotFoundError('Collection not found')

  const orgRoles = await loadOrgRoles(userId, collection.site?.organizationId)
  const perms = checkCollectionPermissions(userId, collection, orgRoles, ctx.isAdmin)
  if (!perms.canView) {
    throw new PermissionDeniedError('Cannot view this collection')
  }

  return { collection, perms }
}

export interface CreateCollectionInput {
  title: string
  /** Target site (must be owned by the user). Omit → the user's primary site. */
  siteId?: string
  accentColor?: string | null
}

/**
 * Create a collection on the user's site and add it to the sidebar layout. The
 * MCP counterpart to POST /api/collections — but that route stops at creating
 * the row; this also puts the collection in the site's PageLayout so it shows.
 */
export async function createCollectionForUser(
  userId: string,
  input: CreateCollectionInput,
  ctx: ActorContext = {}
) {
  const { title, siteId, accentColor } = input
  if (!title || !title.trim()) throw new ValidationError('Title is required')

  const site = siteId
    ? await prisma.site.findFirst({ where: { id: siteId, userId }, select: { id: true, slug: true } })
    : await prisma.site.findFirst({
        where: { userId },
        orderBy: PRIMARY_SITE_ORDER,
        select: { id: true, slug: true },
      })
  if (!site) {
    if (siteId) throw new PermissionDeniedError('Cannot create collections on this site')
    throw new ValidationError('You need to set up your public page before creating collections')
  }

  const collection = await prisma.collection.create({
    data: {
      title: title.trim(),
      siteId: site.id,
      ...(accentColor !== undefined ? { accentColor: accentColor?.toString() ?? null } : {}),
    },
  })

  await ensurePageLayoutItem(site.id, 'collection', collection.id)
  revalidateSiteContent(site.slug)
  void ctx.editSource
  void ctx.editClient
  return collection
}

/**
 * Reorder the skripts within a collection. `skriptIds` must be exactly the set
 * of skripts currently in the collection, in the desired order (mirrors the
 * PATCH /api/collections/[id]/reorder-skripts contract). Sets CollectionSkript
 * .order = index. Requires collection edit permission.
 */
export async function reorderCollectionSkriptsForUser(
  userId: string,
  collectionId: string,
  skriptIds: string[],
  ctx: ActorContext = {}
) {
  if (!Array.isArray(skriptIds) || skriptIds.length === 0) {
    throw new ValidationError('skriptIds must be a non-empty array')
  }

  const collection = await prisma.collection.findUnique({
    where: { id: collectionId },
    include: {
      site: { select: { userId: true, organizationId: true, slug: true } },
      collectionSkripts: { select: { skriptId: true } },
    },
  })
  if (!collection) throw new NotFoundError('Collection not found')

  const orgRoles = await loadOrgRoles(userId, collection.site?.organizationId)
  if (!checkCollectionPermissions(userId, collection, orgRoles, ctx.isAdmin).canEdit) {
    throw new PermissionDeniedError('Cannot edit this collection')
  }

  const memberIds = collection.collectionSkripts.map(cs => cs.skriptId)
  const sameSet =
    skriptIds.length === memberIds.length &&
    skriptIds.every(id => memberIds.includes(id)) &&
    new Set(skriptIds).size === skriptIds.length
  if (!sameSet) {
    throw new ValidationError('skriptIds must list exactly the skripts in this collection, once each')
  }

  await prisma.$transaction(
    skriptIds.map((skriptId, index) =>
      prisma.collectionSkript.update({
        where: { collectionId_skriptId: { collectionId, skriptId } },
        data: { order: index },
      })
    )
  )

  revalidateSiteContent(collection.site?.slug)
  void ctx.editSource
  void ctx.editClient
  return { collectionId, order: skriptIds }
}

export interface UpdateCollectionPatch {
  title?: string
  accentColor?: string | null
}

export async function updateCollectionForUser(
  userId: string,
  collectionId: string,
  patch: UpdateCollectionPatch,
  ctx: ActorContext = {}
) {
  if (
    patch.title === undefined &&
    patch.accentColor === undefined
  ) {
    throw new ValidationError(
      'At least one of {title, accentColor} must be provided'
    )
  }
  if (patch.title !== undefined && !patch.title.trim()) {
    throw new ValidationError('Title cannot be empty')
  }

  const existing = await prisma.collection.findUnique({
    where: { id: collectionId },
    include: { site: { select: { userId: true, organizationId: true } } },
  })
  if (!existing) throw new NotFoundError('Collection not found')

  const orgRoles = await loadOrgRoles(userId, existing.site?.organizationId)
  const perms = checkCollectionPermissions(userId, existing, orgRoles, ctx.isAdmin)
  if (!perms.canEdit) {
    throw new PermissionDeniedError('Cannot edit this collection')
  }

  const updateData: Record<string, unknown> = { updatedAt: new Date() }
  if (patch.title !== undefined) updateData.title = patch.title.trim()
  if (patch.accentColor !== undefined)
    updateData.accentColor = patch.accentColor?.toString() ?? null

  const updated = await prisma.collection.update({
    where: { id: collectionId },
    data: updateData,
  })

  void ctx.editSource
  void ctx.editClient

  const userSite = await prisma.site.findFirst({
    where: { userId },
    orderBy: PRIMARY_SITE_ORDER,
    select: { slug: true },
  })
  if (userSite?.slug) {
    revalidateTag(CACHE_TAGS.teacherContent(userSite.slug), { expire: 0 })
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
