import { NextResponse } from 'next/server'
import { requireOrgAdmin, canRemoveMember, canModifyMemberRole, OrgRole } from '@/lib/org-auth'
import { prisma } from '@/lib/prisma'

// GET /api/organizations/[orgId]/members - List organization members
export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const { orgId } = await params
  const { error } = await requireOrgAdmin(orgId)
  if (error) return error

  try {
    const members = await prisma.organizationMember.findMany({
      where: { organizationId: orgId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            pageSlug: true,
            image: true,
            accountType: true,
            studentPseudonym: true,
            createdAt: true,
          },
        },
      },
      orderBy: [
        { role: 'asc' }, // owners first, then admins, then members
        { createdAt: 'asc' },
      ],
    })

    return NextResponse.json({ members })
  } catch (error) {
    console.error('Error fetching organization members:', error)
    return NextResponse.json(
      { error: 'Failed to fetch members' },
      { status: 500 }
    )
  }
}

// POST /api/organizations/[orgId]/members - Add member to organization
export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const { orgId } = await params
  const { error, membership: actorMembership } = await requireOrgAdmin(orgId)
  if (error) return error

  try {
    const { userId, email, role = 'member' } = await request.json()

    // Validate role
    if (!['owner', 'admin', 'member'].includes(role)) {
      return NextResponse.json(
        { error: 'Invalid role. Must be owner, admin, or member' },
        { status: 400 }
      )
    }

    // Find user by ID or email
    let user
    if (userId) {
      user = await prisma.user.findUnique({ where: { id: userId } })
    } else if (email) {
      user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } })
    } else {
      return NextResponse.json(
        { error: 'Either userId or email is required' },
        { status: 400 }
      )
    }

    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      )
    }

    // Check if user is already a member
    const existingMembership = await prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId: orgId,
          userId: user.id,
        },
      },
    })

    if (existingMembership) {
      return NextResponse.json(
        { error: 'User is already a member of this organization' },
        { status: 409 }
      )
    }

    // Teachers can only belong to one organization
    if (user.accountType === 'teacher') {
      const existingOrgMembership = await prisma.organizationMember.findFirst({
        where: { userId: user.id },
        include: { organization: { select: { name: true } } },
      })

      if (existingOrgMembership) {
        return NextResponse.json(
          { error: `Teachers can only belong to one organization. This teacher is already a member of "${existingOrgMembership.organization.name}".` },
          { status: 400 }
        )
      }
    }

    // Only owners can add admins/owners
    if (actorMembership && role !== 'member' && actorMembership.role !== 'owner') {
      return NextResponse.json(
        { error: 'Only owners can add admins or owners' },
        { status: 403 }
      )
    }

    // Students can only be members, not admins or owners
    if (user.accountType === 'student' && role !== 'member') {
      return NextResponse.json(
        { error: 'Students can only be added as members, not admins or owners' },
        { status: 400 }
      )
    }

    // Create membership
    const membership = await prisma.organizationMember.create({
      data: {
        organizationId: orgId,
        userId: user.id,
        role,
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            pageSlug: true,
            image: true,
            accountType: true,
          },
        },
      },
    })

    return NextResponse.json({ membership }, { status: 201 })
  } catch (error) {
    console.error('Error adding organization member:', error)
    return NextResponse.json(
      { error: 'Failed to add member' },
      { status: 500 }
    )
  }
}

// PATCH /api/organizations/[orgId]/members - Update member role
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const { orgId } = await params
  const { error, membership: actorMembership, session } = await requireOrgAdmin(orgId)
  if (error) return error

  try {
    const { userId, role } = await request.json()

    if (!userId || !role) {
      return NextResponse.json(
        { error: 'userId and role are required' },
        { status: 400 }
      )
    }

    // Validate role
    if (!['owner', 'admin', 'member'].includes(role)) {
      return NextResponse.json(
        { error: 'Invalid role. Must be owner, admin, or member' },
        { status: 400 }
      )
    }

    // Get target membership
    const targetMembership = await prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId: orgId,
          userId,
        },
      },
      include: {
        user: true,
      },
    })

    if (!targetMembership) {
      return NextResponse.json(
        { error: 'User is not a member of this organization' },
        { status: 404 }
      )
    }

    // Can't change your own role
    if (session?.user?.id === userId) {
      return NextResponse.json(
        { error: 'Cannot change your own role' },
        { status: 400 }
      )
    }

    // Students can only be members
    if (targetMembership.user.accountType === 'student' && role !== 'member') {
      return NextResponse.json(
        { error: 'Students can only have member role' },
        { status: 400 }
      )
    }

    // Check permission to modify role (platform admin or org owner/admin with sufficient privileges)
    const actorRole = actorMembership?.role || (session?.user?.isAdmin ? 'owner' : 'member')
    if (!canModifyMemberRole(actorRole as OrgRole, targetMembership.role as OrgRole, role as OrgRole)) {
      return NextResponse.json(
        { error: 'Insufficient permissions to modify this member\'s role' },
        { status: 403 }
      )
    }

    // Update role
    const updated = await prisma.organizationMember.update({
      where: {
        organizationId_userId: {
          organizationId: orgId,
          userId,
        },
      },
      data: { role },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            pageSlug: true,
            image: true,
            accountType: true,
          },
        },
      },
    })

    return NextResponse.json({ membership: updated })
  } catch (error) {
    console.error('Error updating organization member:', error)
    return NextResponse.json(
      { error: 'Failed to update member' },
      { status: 500 }
    )
  }
}

// DELETE /api/organizations/[orgId]/members - Remove member from organization
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const { orgId } = await params
  const { error, membership: actorMembership, session } = await requireOrgAdmin(orgId)
  if (error) return error

  try {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')

    if (!userId) {
      return NextResponse.json(
        { error: 'userId is required' },
        { status: 400 }
      )
    }

    // Get target membership
    const targetMembership = await prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId: orgId,
          userId,
        },
      },
    })

    if (!targetMembership) {
      return NextResponse.json(
        { error: 'User is not a member of this organization' },
        { status: 404 }
      )
    }

    // Can't remove yourself
    if (session?.user?.id === userId) {
      return NextResponse.json(
        { error: 'Cannot remove yourself from the organization' },
        { status: 400 }
      )
    }

    // Check permission to remove member
    const actorRole = actorMembership?.role || (session?.user?.isAdmin ? 'owner' : 'member')
    if (!canRemoveMember(actorRole as OrgRole, targetMembership.role as OrgRole)) {
      return NextResponse.json(
        { error: 'Insufficient permissions to remove this member' },
        { status: 403 }
      )
    }

    // If removing an owner, ensure at least one owner remains
    if (targetMembership.role === 'owner') {
      const ownerCount = await prisma.organizationMember.count({
        where: {
          organizationId: orgId,
          role: 'owner',
        },
      })

      if (ownerCount <= 1) {
        return NextResponse.json(
          { error: 'Cannot remove the last owner of the organization' },
          { status: 400 }
        )
      }
    }

    // Remove membership
    await prisma.organizationMember.delete({
      where: {
        organizationId_userId: {
          organizationId: orgId,
          userId,
        },
      },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error removing organization member:', error)
    return NextResponse.json(
      { error: 'Failed to remove member' },
      { status: 500 }
    )
  }
}
