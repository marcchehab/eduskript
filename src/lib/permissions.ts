/**
 * Permission System
 *
 * Eduskript uses a "no-access-by-default" permission model. Skripts and pages
 * are explicitly shared via SkriptAuthor / PageAuthor. Collections no longer
 * have their own author table — they're owned by a Site (a user's page or an
 * org's page), and editing a collection means editing the site.
 *
 * ## Permission Hierarchy
 *
 * - **Site**: owned by exactly one User or one Organization. Site owners can
 *   edit anything that belongs to the site (collections, page layout,
 *   frontpage). Org admins/owners can edit the org's site.
 * - **Collection**: belongs to a site. No separate authors. Editing a
 *   collection requires edit rights on its site.
 * - **Skript**: editorial content, co-authored across users via SkriptAuthor.
 *   Skripts get permissions ONLY from their own SkriptAuthor rows — there's
 *   no inheritance from collections. A site's collections may contain
 *   skripts the site owner doesn't author; those just render to visitors
 *   if isPublished.
 * - **Page**: inherits from skript or has its own PageAuthor row.
 *
 * ## Permission Types
 *
 * - `author`: full edit rights
 * - `viewer`: read-only access (skripts/pages only)
 *
 * @see CLAUDE.md for the full permission model documentation
 */

import { SkriptAuthor, PageAuthor, User } from '@prisma/client'
import { Permission, UserPermissions } from '@/types'

/** Minimal shape of a Site for ownership checks. */
export interface SiteOwner {
  userId?: string | null
  organizationId?: string | null
}

/** Minimal shape of an OrganizationMember row for org-admin checks. */
export interface OrgRole {
  organizationId: string
  role: string // "owner" | "admin" | "member"
}

/**
 * True when the user can edit the given site — they own it directly, or
 * they're an owner/admin of the organization that owns it. Used as the
 * primitive behind every Collection/PageLayout/FrontPage edit check.
 */
export function canEditSite(
  userId: string,
  site: SiteOwner | null | undefined,
  orgRoles: OrgRole[] = [],
  isAdmin?: boolean
): boolean {
  if (isAdmin) return true
  if (!site) return false
  if (site.userId && site.userId === userId) return true
  if (site.organizationId) {
    const membership = orgRoles.find(m => m.organizationId === site.organizationId)
    return membership?.role === 'owner' || membership?.role === 'admin'
  }
  return false
}

/**
 * Check permissions for a collection. Collections are owned by a site;
 * everyone with edit rights on the site can edit the collection. No
 * per-collection author rows anymore.
 */
export function checkCollectionPermissions(
  userId: string,
  collection: { site?: SiteOwner | null },
  orgRoles: OrgRole[] = [],
  isAdmin?: boolean
): UserPermissions {
  const canEdit = canEditSite(userId, collection.site, orgRoles, isAdmin)
  return {
    canEdit,
    canView: canEdit,
    canManageAuthors: false, // collections have no authors to manage
  }
}

/**
 * Check permissions for a skript. Skripts grant access strictly through
 * their own SkriptAuthor rows — no inheritance from collections.
 */
export function checkSkriptPermissions(
  userId: string,
  skriptAuthors: (SkriptAuthor & { user: Partial<User> })[],
  isAdmin?: boolean
): UserPermissions {
  if (isAdmin) {
    return { canEdit: true, canView: true, canManageAuthors: true }
  }

  const userSkriptAuthor = skriptAuthors.find(author => author.userId === userId)

  if (userSkriptAuthor) {
    const isAuthor = userSkriptAuthor.permission === 'author'
    return {
      canEdit: isAuthor,
      canView: true,
      canManageAuthors: isAuthor,
      permission: userSkriptAuthor.permission as Permission
    }
  }

  return {
    canEdit: false,
    canView: false,
    canManageAuthors: false
  }
}

/**
 * Check permissions for a page. Resolution:
 * 1. Direct PageAuthor row.
 * 2. Otherwise inherits from the skript's SkriptAuthor row.
 */
export function checkPagePermissions(
  userId: string,
  pageAuthors: (PageAuthor & { user: Partial<User> })[],
  skriptAuthors: (SkriptAuthor & { user: Partial<User> })[],
  isAdmin?: boolean
): UserPermissions {
  if (isAdmin) {
    return { canEdit: true, canView: true, canManageAuthors: true }
  }

  const userPageAuthor = pageAuthors.find(author => author.userId === userId)

  if (userPageAuthor) {
    const isAuthor = userPageAuthor.permission === 'author'
    return {
      canEdit: isAuthor,
      canView: true,
      canManageAuthors: isAuthor,
      permission: userPageAuthor.permission as Permission
    }
  }

  const userSkriptAuthor = skriptAuthors.find(author => author.userId === userId)

  if (userSkriptAuthor) {
    const isSkriptAuthor = userSkriptAuthor.permission === 'author'
    return {
      canEdit: isSkriptAuthor,
      canView: true,
      canManageAuthors: isSkriptAuthor,
      permission: isSkriptAuthor ? 'author' : 'viewer'
    }
  }

  return {
    canEdit: false,
    canView: false,
    canManageAuthors: false
  }
}

/**
 * Whether the user can remove themselves as an author. Prevents content
 * from being orphaned — the last author cannot remove themselves.
 */
export function canRemoveSelfAsAuthor(
  userId: string,
  authors: (SkriptAuthor | PageAuthor)[]
): boolean {
  const authorCount = authors.filter(author => author.permission === 'author').length
  const userIsAuthor = authors.find(author =>
    author.userId === userId && author.permission === 'author'
  )
  return Boolean(userIsAuthor && authorCount > 1)
}

/**
 * Get all users who can view a skript — just the direct SkriptAuthor rows.
 */
export function getSkriptViewers(
  skriptAuthors: (SkriptAuthor & { user: Partial<User> })[]
): Partial<User>[] {
  return skriptAuthors.map(author => author.user)
}