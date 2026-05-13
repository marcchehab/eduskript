import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { NextResponse } from 'next/server'

export type OrgRole = 'owner' | 'admin' | 'member'

export interface OrgMembership {
  organizationId: string
  userId: string
  role: OrgRole
  organization: {
    id: string
    name: string
    slug: string
  }
}

/**
 * Get the user's membership in a specific organization.
 * Returns null if the user is not a member.
 */
export async function getOrgMembership(
  userId: string,
  orgId: string
): Promise<OrgMembership | null> {
  const membership = await prisma.organizationMember.findUnique({
    where: {
      organizationId_userId: {
        organizationId: orgId,
        userId,
      },
    },
    include: {
      organization: {
        select: {
          id: true,
          name: true,
          site: { select: { slug: true } },
        },
      },
    },
  })

  if (!membership) return null

  return {
    organizationId: membership.organizationId,
    userId: membership.userId,
    role: membership.role as OrgRole,
    organization: {
      id: membership.organization.id,
      name: membership.organization.name,
      slug: membership.organization.site?.slug ?? '',
    },
  }
}

/**
 * Get all organizations the user is a member of.
 */
export async function getUserOrganizations(userId: string) {
  const memberships = await prisma.organizationMember.findMany({
    where: { userId },
    include: {
      organization: {
        select: {
          id: true,
          name: true,
          billingPlan: true,
          site: { select: { slug: true } },
        },
      },
    },
  })

  return memberships.map((m) => ({
    id: m.organization.id,
    name: m.organization.name,
    slug: m.organization.site?.slug ?? '',
    billingPlan: m.organization.billingPlan,
    role: m.role as OrgRole,
  }))
}

/**
 * Check if the current user is an admin or owner of the specified organization.
 * Also allows platform admins (isAdmin=true) to access any org.
 */
export async function requireOrgAdmin(orgId: string) {
  const session = await getServerSession(authOptions)

  if (!session?.user?.id) {
    return {
      error: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }),
      session: null,
      membership: null,
    }
  }

  // Platform admins can access any org
  if (session.user.isAdmin) {
    return {
      error: null,
      session,
      membership: null, // Platform admin, not necessarily a member
    }
  }

  // Check org membership
  const membership = await getOrgMembership(session.user.id, orgId)

  if (!membership) {
    return {
      error: NextResponse.json(
        { error: 'Not a member of this organization' },
        { status: 403 }
      ),
      session: null,
      membership: null,
    }
  }

  // Only owners and admins can perform admin actions
  if (membership.role !== 'owner' && membership.role !== 'admin') {
    return {
      error: NextResponse.json(
        { error: 'Organization admin access required' },
        { status: 403 }
      ),
      session: null,
      membership: null,
    }
  }

  // Org admins must be teachers (not students)
  if (session.user.accountType !== 'teacher') {
    return {
      error: NextResponse.json(
        { error: 'Only teachers can be organization admins' },
        { status: 403 }
      ),
      session: null,
      membership: null,
    }
  }

  return {
    error: null,
    session,
    membership,
  }
}

/**
 * Check if the current user is a member of the specified organization.
 * Allows any role (owner, admin, member).
 */
export async function requireOrgMember(orgId: string) {
  const session = await getServerSession(authOptions)

  if (!session?.user?.id) {
    return {
      error: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }),
      session: null,
      membership: null,
    }
  }

  // Platform admins can access any org
  if (session.user.isAdmin) {
    return {
      error: null,
      session,
      membership: null,
    }
  }

  const membership = await getOrgMembership(session.user.id, orgId)

  if (!membership) {
    return {
      error: NextResponse.json(
        { error: 'Not a member of this organization' },
        { status: 403 }
      ),
      session: null,
      membership: null,
    }
  }

  return {
    error: null,
    session,
    membership,
  }
}

/**
 * Check if user can modify the role of another member.
 * - Owners can change anyone's role
 * - Admins can only change member roles (not other admins or owners)
 */
export function canModifyMemberRole(
  actorRole: OrgRole,
  targetCurrentRole: OrgRole,
  targetNewRole: OrgRole
): boolean {
  // Owners can do anything
  if (actorRole === 'owner') {
    return true
  }

  // Admins can only modify members
  if (actorRole === 'admin') {
    // Can't touch owners or other admins
    if (targetCurrentRole === 'owner' || targetCurrentRole === 'admin') {
      return false
    }
    // Can't promote to owner or admin
    if (targetNewRole === 'owner' || targetNewRole === 'admin') {
      return false
    }
    return true
  }

  // Members can't modify roles
  return false
}

/**
 * Check if user can remove a member from the organization.
 * - Owners can remove anyone except the last owner
 * - Admins can only remove members (not other admins or owners)
 */
export function canRemoveMember(
  actorRole: OrgRole,
  targetRole: OrgRole
): boolean {
  if (actorRole === 'owner') {
    return true // Owner can remove anyone (we check for last owner separately)
  }

  if (actorRole === 'admin') {
    // Admins can only remove members
    return targetRole === 'member'
  }

  return false
}
