/**
 * Site-frontpage service — read/upsert the FrontPage row tied to a Site.
 *
 * The FrontPage table backs three surfaces via mutually-exclusive owner FKs;
 * this service handles the two site-tied ones:
 *   - the teacher's own landing page (Site.userId === caller), and
 *   - an organization's landing page (Site.organizationId), editable only by
 *     org owner/admin.
 * The skript-tied rows have their own service (skript-frontpages.ts).
 *
 * Target selection: pass no organizationId → the caller's own site; pass an
 * organizationId → that org's site.
 *
 * Permission model: reuses canEditSite() — own site, or org owner/admin.
 * Reading an org frontpage additionally allows any org member (view-only),
 * mirroring the organization frontpage API route.
 *
 * Versioning: every content-changing upsert appends a FrontPageVersion row
 * (version + 1, author = caller) — same shape as the API routes it mirrors.
 */

import { revalidatePath, revalidateTag } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { CACHE_TAGS } from '@/lib/cached-queries'
import { canEditSite, type OrgRole } from '@/lib/permissions'
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

export interface SiteFrontPageTarget {
  /** Omit for the caller's own landing page; set for an org landing page. */
  organizationId?: string
}

/**
 * Resolve the target Site plus the caller's org roles, then classify what the
 * caller may do with it. `orgRoles` is loaded regardless of target so
 * canEditSite() can evaluate org membership.
 */
async function resolveSiteForFrontPageAccess(
  userId: string,
  target: SiteFrontPageTarget,
  isAdmin: boolean
) {
  const site = target.organizationId
    ? await prisma.site.findUnique({
        where: { organizationId: target.organizationId },
        select: { id: true, slug: true, userId: true, organizationId: true },
      })
    : await prisma.site.findUnique({
        where: { userId },
        select: { id: true, slug: true, userId: true, organizationId: true },
      })

  if (!site) {
    throw new NotFoundError(
      target.organizationId
        ? 'Organization has no site'
        : 'You have no public page yet — set one up before editing a frontpage'
    )
  }

  const memberships = await prisma.organizationMember.findMany({
    where: { userId },
    select: { organizationId: true, role: true },
  })
  const orgRoles: OrgRole[] = memberships
  const canEdit = canEditSite(userId, site, orgRoles, isAdmin)
  // Any org member may read an org frontpage; own-site reads are covered by canEdit.
  const isOrgMember = site.organizationId
    ? orgRoles.some(r => r.organizationId === site.organizationId)
    : false
  const canView = canEdit || isOrgMember

  return { site, canEdit, canView }
}

export async function getSiteFrontPageForUser(
  userId: string,
  target: SiteFrontPageTarget = {},
  ctx: ActorContext = {}
) {
  const { site, canView } = await resolveSiteForFrontPageAccess(
    userId,
    target,
    !!ctx.isAdmin
  )
  if (!canView) {
    throw new PermissionDeniedError('Cannot view this frontpage')
  }

  const frontPage = await prisma.frontPage.findUnique({
    where: { siteId: site.id },
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

export interface UpsertSiteFrontPagePatch {
  content?: string
  isPublished?: boolean
}

export async function upsertSiteFrontPageForUser(
  userId: string,
  target: SiteFrontPageTarget,
  patch: UpsertSiteFrontPagePatch,
  ctx: ActorContext = {}
) {
  if (patch.content === undefined && patch.isPublished === undefined) {
    throw new ValidationError(
      'At least one of {content, isPublished} must be provided'
    )
  }

  const { site, canEdit } = await resolveSiteForFrontPageAccess(
    userId,
    target,
    !!ctx.isAdmin
  )
  if (!canEdit) {
    throw new PermissionDeniedError('Cannot edit this frontpage')
  }

  const existing = await prisma.frontPage.findUnique({
    where: { siteId: site.id },
    include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
  })

  let frontPage
  let contentChanged = false

  if (!existing) {
    // Create. Initial version=1 only when content is supplied; an isPublished
    // flip with no content shouldn't manufacture an empty initial version.
    const initialContent = patch.content ?? ''
    frontPage = await prisma.frontPage.create({
      data: {
        siteId: site.id,
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
  // has no such columns yet. Plumbed through so a future schema add-on doesn't
  // break the MCP tool surface.
  void ctx.editSource
  void ctx.editClient

  // Cache invalidation mirrors the frontpage API routes.
  if (site.organizationId) {
    revalidateTag(CACHE_TAGS.organization(site.slug), { expire: 0 })
    revalidateTag(CACHE_TAGS.orgContent(site.slug), { expire: 0 })
    revalidatePath(`/org/${site.slug}`)
  } else {
    revalidateTag(CACHE_TAGS.teacherContent(site.slug), { expire: 0 })
    revalidatePath(`/${site.slug}`)
  }
  revalidatePath('/dashboard')

  return { frontPage, contentChanged }
}
