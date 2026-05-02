/**
 * Collections service — reads and metadata writes scoped by author.
 *
 * Mirrors the pattern in skripts.ts: collection-author edit gate, throws
 * typed errors that the MCP `safe()` wrapper translates to structured
 * tool errors.
 *
 * Cache invalidation on update: collectionBySlug for the editing user's
 * pageSlug surface, plus teacherContent + per-org membership.
 */

import { revalidatePath, revalidateTag } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { CACHE_TAGS } from '@/lib/cached-queries'
import { checkCollectionPermissions } from '@/lib/permissions'
import { generateSlug } from '@/lib/markdown'
import {
  ConflictError,
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
  authors: {
    include: { user: { select: { id: true, name: true, email: true } } },
  },
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

  const perms = checkCollectionPermissions(userId, collection.authors, ctx.isAdmin)
  if (!perms.canView) {
    throw new PermissionDeniedError('Cannot view this collection')
  }

  return { collection, perms }
}

export interface UpdateCollectionPatch {
  title?: string
  description?: string | null
  slug?: string
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
    patch.description === undefined &&
    patch.slug === undefined &&
    patch.accentColor === undefined
  ) {
    throw new ValidationError(
      'At least one of {title, description, slug, accentColor} must be provided'
    )
  }
  if (patch.title !== undefined && !patch.title.trim()) {
    throw new ValidationError('Title cannot be empty')
  }
  if (patch.slug !== undefined && !patch.slug.trim()) {
    throw new ValidationError('Slug cannot be empty')
  }

  const existing = await prisma.collection.findUnique({
    where: { id: collectionId },
    include: { authors: true },
  })
  if (!existing) throw new NotFoundError('Collection not found')

  const perms = checkCollectionPermissions(
    userId,
    existing.authors as Parameters<typeof checkCollectionPermissions>[1],
    ctx.isAdmin
  )
  if (!perms.canEdit) {
    throw new PermissionDeniedError('Cannot edit this collection')
  }

  const normalizedSlug = patch.slug ? generateSlug(patch.slug) : undefined
  if (normalizedSlug && normalizedSlug !== existing.slug) {
    const conflict = await prisma.collection.findFirst({
      where: {
        slug: normalizedSlug,
        authors: { some: { userId } },
        id: { not: collectionId },
      },
    })
    if (conflict) {
      throw new ConflictError('Slug already exists in your collections')
    }
  }

  const updateData: Record<string, unknown> = { updatedAt: new Date() }
  if (patch.title !== undefined) updateData.title = patch.title.trim()
  if (patch.description !== undefined)
    updateData.description = patch.description?.toString() ?? null
  if (normalizedSlug !== undefined) updateData.slug = normalizedSlug
  if (patch.accentColor !== undefined)
    updateData.accentColor = patch.accentColor?.toString() ?? null

  const updated = await prisma.collection.update({
    where: { id: collectionId },
    data: updateData,
  })

  void ctx.editSource
  void ctx.editClient

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { pageSlug: true },
  })
  if (user?.pageSlug) {
    revalidateTag(CACHE_TAGS.collectionBySlug(user.pageSlug, updated.slug), {
      expire: 0,
    })
    if (normalizedSlug && normalizedSlug !== existing.slug) {
      revalidateTag(
        CACHE_TAGS.collectionBySlug(user.pageSlug, existing.slug),
        { expire: 0 }
      )
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
