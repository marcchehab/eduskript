import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireOrgAdmin } from '@/lib/org-auth'

// DELETE - Remove a teacher's custom domain (org admin only)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string; domainId: string }> }
) {
  try {
    const { orgId, domainId } = await params

    // Only admins can delete teacher domains
    const { error } = await requireOrgAdmin(orgId)
    if (error) return error

    // Verify the domain exists and belongs to a teacher in this organization
    const domain = await prisma.teacherCustomDomain.findFirst({
      where: {
        id: domainId,
        user: {
          organizationMemberships: {
            some: {
              organizationId: orgId,
            },
          },
        },
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    })

    if (!domain) {
      return NextResponse.json(
        { error: 'Domain not found or teacher is not a member of this organization' },
        { status: 404 }
      )
    }

    // Delete the domain
    await prisma.teacherCustomDomain.delete({
      where: { id: domainId },
    })

    return NextResponse.json({
      success: true,
      message: `Domain "${domain.domain}" has been removed from ${domain.user.name || domain.user.email}`,
    })
  } catch (error) {
    console.error('Error deleting teacher domain:', error)
    return NextResponse.json(
      { error: 'Failed to delete teacher domain' },
      { status: 500 }
    )
  }
}
