/**
 * Skript-frontpage service — read/upsert the FrontPage row tied to a skript.
 *
 * The FrontPage table backs three different surfaces (user landing,
 * organization landing, skript intro) via mutually-exclusive owner FKs.
 * This service only touches the skript-tied rows; user/org frontpages have
 * separate access patterns and would warrant their own service if exposed
 * via MCP later.
 *
 * Permission model: skript-author edit gate. Collection-author inheritance
 * is view-only by design (mirrors checkSkriptPermissions).
 *
 * Versioning: every content-changing upsert appends a FrontPageVersion row
 * (version + 1, author = caller) — same shape as PageVersion.
 */

import { revalidatePath, revalidateTag } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { CACHE_TAGS } from '@/lib/cached-queries'
import { checkSkriptPermissions } from '@/lib/permissions'
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

async function loadSkriptForFrontPageAccess(
  skriptId: string,
  userId: string,
  isAdmin: boolean
) {
  const skript = await prisma.skript.findUnique({
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
  if (!skript) throw new NotFoundError('Skript not found')

  const collectionAuthors = skript.collectionSkripts.flatMap(
    (cs) => cs.collection?.authors ?? []
  )
  const perms = checkSkriptPermissions(
    userId,
    skript.authors,
    collectionAuthors,
    isAdmin
  )
  return { skript, perms }
}

export async function getSkriptFrontPageForUser(
  userId: string,
  skriptId: string,
  ctx: ActorContext = {}
) {
  const { perms } = await loadSkriptForFrontPageAccess(
    skriptId,
    userId,
    !!ctx.isAdmin
  )
  if (!perms.canView) {
    throw new PermissionDeniedError('Cannot view this skript')
  }

  const frontPage = await prisma.frontPage.findFirst({
    where: { skriptId },
    select: {
      id: true,
      content: true,
      isPublished: true,
      createdAt: true,
      updatedAt: true,
    },
  })

  return frontPage
}

export interface UpsertSkriptFrontPagePatch {
  content?: string
  isPublished?: boolean
}

export async function upsertSkriptFrontPageForUser(
  userId: string,
  skriptId: string,
  patch: UpsertSkriptFrontPagePatch,
  ctx: ActorContext = {}
) {
  if (patch.content === undefined && patch.isPublished === undefined) {
    throw new ValidationError(
      'At least one of {content, isPublished} must be provided'
    )
  }

  const { skript, perms } = await loadSkriptForFrontPageAccess(
    skriptId,
    userId,
    !!ctx.isAdmin
  )
  if (!perms.canEdit) {
    throw new PermissionDeniedError('Cannot edit this skript')
  }

  const existing = await prisma.frontPage.findFirst({
    where: { skriptId },
    include: {
      versions: { orderBy: { version: 'desc' }, take: 1 },
    },
  })

  let frontPage
  let contentChanged = false

  if (!existing) {
    // Create. Initial version=1 only when content is supplied; an isPublished
    // flip with no content shouldn't manufacture an empty initial version.
    const initialContent = patch.content ?? ''
    frontPage = await prisma.frontPage.create({
      data: {
        skriptId,
        content: initialContent,
        isPublished: patch.isPublished ?? false,
      },
    })
    if (patch.content !== undefined && initialContent.length > 0) {
      await prisma.frontPageVersion.create({
        data: {
          frontPageId: frontPage.id,
          content: initialContent,
          version: 1,
          authorId: userId,
        },
      })
      contentChanged = true
    }
  } else {
    const currentVersion = existing.versions[0]
    contentChanged =
      patch.content !== undefined && currentVersion?.content !== patch.content

    const updateData: Record<string, unknown> = { updatedAt: new Date() }
    if (patch.content !== undefined) updateData.content = patch.content
    if (patch.isPublished !== undefined) updateData.isPublished = patch.isPublished

    frontPage = await prisma.frontPage.update({
      where: { id: existing.id },
      data: updateData,
    })

    if (contentChanged) {
      await prisma.frontPageVersion.create({
        data: {
          frontPageId: frontPage.id,
          content: patch.content ?? '',
          version: (currentVersion?.version ?? 0) + 1,
          authorId: userId,
        },
      })
    }
  }

  // editSource/editClient — accepted for parity with page tools; FrontPageVersion
  // does not have these columns yet. Plumbed through so future schema add-on
  // doesn't break the MCP tool surface.
  void ctx.editSource
  void ctx.editClient

  // Cache invalidation: a skript frontpage rendering surface lives in the
  // skript-preview route plus any teacher home that surfaces it. Invalidate
  // skriptBySlug + teacherContent to be safe; org content if member.
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { pageSlug: true },
  })
  if (user?.pageSlug) {
    revalidateTag(CACHE_TAGS.skriptBySlug(user.pageSlug, skript.slug), {
      expire: 0,
    })
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

  return { frontPage, contentChanged }
}
