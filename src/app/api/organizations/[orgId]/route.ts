import { NextResponse } from 'next/server'
import { requireOrgAdmin, requireOrgMember } from '@/lib/org-auth'
import { prisma } from '@/lib/prisma'

// GET /api/organizations/[orgId] - Get organization details
export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const { orgId } = await params
  const { error } = await requireOrgMember(orgId)
  if (error) return error

  try {
    const [organization, teacherCount, studentCount] = await Promise.all([
      prisma.organization.findUnique({
        where: { id: orgId },
        select: {
          id: true,
          name: true,
          slug: true,
          description: true,
          showIcon: true,
          iconUrl: true,
          allowMemberPages: true,
          allowTeacherCustomDomains: true,
          requireEmailDomain: true,
          sidebarBehavior: true,
          billingPlan: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: { members: true },
          },
        },
      }),
      prisma.organizationMember.count({
        where: {
          organizationId: orgId,
          user: { accountType: 'teacher' },
        },
      }),
      prisma.organizationMember.count({
        where: {
          organizationId: orgId,
          user: { accountType: 'student' },
        },
      }),
    ])

    if (!organization) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
    }

    return NextResponse.json({ organization, teacherCount, studentCount })
  } catch (error) {
    console.error('Error fetching organization:', error)
    return NextResponse.json({ error: 'Failed to fetch organization' }, { status: 500 })
  }
}

// PATCH /api/organizations/[orgId] - Update organization settings
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const { orgId } = await params
  const { error } = await requireOrgAdmin(orgId)
  if (error) return error

  try {
    const body = await request.json()
    const { name, description, showIcon, iconUrl, allowMemberPages, allowTeacherCustomDomains, requireEmailDomain, sidebarBehavior } = body

    // Validate name if provided
    if (name !== undefined && (!name || typeof name !== 'string' || name.trim().length === 0)) {
      return NextResponse.json({ error: 'Organization name is required' }, { status: 400 })
    }

    // Validate email domain format if provided
    if (requireEmailDomain !== undefined && requireEmailDomain !== null) {
      if (typeof requireEmailDomain !== 'string') {
        return NextResponse.json({ error: 'Invalid email domain format' }, { status: 400 })
      }
      // Should start with @ or be empty
      if (requireEmailDomain && !requireEmailDomain.startsWith('@')) {
        return NextResponse.json(
          { error: 'Email domain should start with @ (e.g., @school.edu)' },
          { status: 400 }
        )
      }
    }

    const updateData: Record<string, unknown> = {}
    if (name !== undefined) updateData.name = name.trim()
    if (description !== undefined) updateData.description = description || null
    if (showIcon !== undefined) updateData.showIcon = Boolean(showIcon)
    if (iconUrl !== undefined) updateData.iconUrl = iconUrl || null
    if (allowMemberPages !== undefined) updateData.allowMemberPages = Boolean(allowMemberPages)
    if (allowTeacherCustomDomains !== undefined) updateData.allowTeacherCustomDomains = Boolean(allowTeacherCustomDomains)
    if (requireEmailDomain !== undefined) {
      updateData.requireEmailDomain = requireEmailDomain || null
    }
    if (sidebarBehavior !== undefined) {
      if (sidebarBehavior && !['contextual', 'full'].includes(sidebarBehavior)) {
        return NextResponse.json({ error: 'Invalid sidebar behavior' }, { status: 400 })
      }
      updateData.sidebarBehavior = sidebarBehavior || 'contextual'
    }

    const organization = await prisma.organization.update({
      where: { id: orgId },
      data: updateData,
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        showIcon: true,
        iconUrl: true,
        allowMemberPages: true,
        allowTeacherCustomDomains: true,
        requireEmailDomain: true,
        sidebarBehavior: true,
        billingPlan: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: { members: true },
        },
      },
    })

    return NextResponse.json({ organization })
  } catch (error) {
    console.error('Error updating organization:', error)
    return NextResponse.json({ error: 'Failed to update organization' }, { status: 500 })
  }
}
