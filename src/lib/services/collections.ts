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
