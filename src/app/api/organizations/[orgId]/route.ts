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
          allowMemberPages: true,
          allowTeacherCustomDomains: true,
          requireEmailDomain: true,
          billingPlan: true,
          createdAt: true,
          updatedAt: true,
          // Page-display fields live on Site now.
          site: {
            select: {
              slug: true,
              pageDescription: true,
              showIcon: true,
              pageIcon: true,
              sidebarBehavior: true,
              aiSystemPrompt: true,
            },
          },
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

    // Surface slug + page-display fields at their legacy User/Org field
    // names so the dashboard UI doesn't need to be touched.
    const orgWithSlug = {
      ...organization,
      slug: organization.site?.slug ?? '',
      description: organization.site?.pageDescription ?? null,
      showIcon: organization.site?.showIcon ?? true,
      iconUrl: organization.site?.pageIcon ?? null,
      sidebarBehavior: organization.site?.sidebarBehavior ?? 'contextual',
      aiSystemPrompt: organization.site?.aiSystemPrompt ?? null,
      site: undefined,
    }
    return NextResponse.json({ organization: orgWithSlug, teacherCount, studentCount })
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
    const { name, description, showIcon, iconUrl, allowMemberPages, allowTeacherCustomDomains, requireEmailDomain, sidebarBehavior, aiSystemPrompt } = body

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

    // Split fields between Organization (entity-level settings) and Site
    // (page-display fields).
    const orgUpdate: Record<string, unknown> = {}
    if (name !== undefined) orgUpdate.name = name.trim()
    if (allowMemberPages !== undefined) orgUpdate.allowMemberPages = Boolean(allowMemberPages)
    if (allowTeacherCustomDomains !== undefined) orgUpdate.allowTeacherCustomDomains = Boolean(allowTeacherCustomDomains)
    if (requireEmailDomain !== undefined) {
      orgUpdate.requireEmailDomain = requireEmailDomain || null
    }

    const siteUpdate: Record<string, unknown> = {}
    if (description !== undefined) siteUpdate.pageDescription = description || null
    if (showIcon !== undefined) siteUpdate.showIcon = Boolean(showIcon)
    if (iconUrl !== undefined) siteUpdate.pageIcon = iconUrl || null
    if (sidebarBehavior !== undefined) {
      if (sidebarBehavior && !['contextual', 'full'].includes(sidebarBehavior)) {
        return NextResponse.json({ error: 'Invalid sidebar behavior' }, { status: 400 })
      }
      siteUpdate.sidebarBehavior = sidebarBehavior || 'contextual'
    }
    if (aiSystemPrompt !== undefined) {
      siteUpdate.aiSystemPrompt = aiSystemPrompt || null
    }

    if (Object.keys(siteUpdate).length > 0) {
      await prisma.site.update({
        where: { organizationId: orgId },
        data: siteUpdate,
      })
    }

    const organization = await prisma.organization.update({
      where: { id: orgId },
      data: orgUpdate,
      select: {
        id: true,
        name: true,
        allowMemberPages: true,
        allowTeacherCustomDomains: true,
        requireEmailDomain: true,
        billingPlan: true,
        createdAt: true,
        updatedAt: true,
        site: {
          select: {
            slug: true,
            pageDescription: true,
            showIcon: true,
            pageIcon: true,
            sidebarBehavior: true,
            aiSystemPrompt: true,
          },
        },
        _count: {
          select: { members: true },
        },
      },
    })

    const orgWithSlug = {
      ...organization,
      slug: organization.site?.slug ?? '',
      description: organization.site?.pageDescription ?? null,
      showIcon: organization.site?.showIcon ?? true,
      iconUrl: organization.site?.pageIcon ?? null,
      sidebarBehavior: organization.site?.sidebarBehavior ?? 'contextual',
      aiSystemPrompt: organization.site?.aiSystemPrompt ?? null,
      site: undefined,
    }
    return NextResponse.json({ organization: orgWithSlug })
  } catch (error) {
    console.error('Error updating organization:', error)
    return NextResponse.json({ error: 'Failed to update organization' }, { status: 500 })
  }
}
