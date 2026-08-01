import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { invalidateDomainCache } from '@/lib/domain-cache'
import { requireOrgAdmin } from '@/lib/org-auth'

// DELETE - Remove a custom domain
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string; domainId: string }> }
) {
  try {
    const { orgId, domainId } = await params

    // Only admins can delete domains
    const { error } = await requireOrgAdmin(orgId)
    if (error) return error

    // Verify the domain belongs to this organization
    const domain = await prisma.customDomain.findFirst({
      where: {
        id: domainId,
        organizationId: orgId,
      },
    })

    if (!domain) {
      return NextResponse.json({ error: 'Domain not found' }, { status: 404 })
    }

    // Delete the domain
    await prisma.customDomain.delete({
      where: { id: domainId },
    })
    invalidateDomainCache(domain.domain)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting custom domain:', error)
    return NextResponse.json(
      { error: 'Failed to delete custom domain' },
      { status: 500 }
    )
  }
}

// PATCH - Update domain (e.g., set as primary)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string; domainId: string }> }
) {
  try {
    const { orgId, domainId } = await params

    // Only admins can update domains
    const { error } = await requireOrgAdmin(orgId)
    if (error) return error

    const body = await request.json()
    const { isPrimary } = body

    // Verify the domain belongs to this organization
    const domain = await prisma.customDomain.findFirst({
      where: {
        id: domainId,
        organizationId: orgId,
      },
    })

    if (!domain) {
      return NextResponse.json({ error: 'Domain not found' }, { status: 404 })
    }

    // If setting as primary, domain must be verified
    if (isPrimary && !domain.isVerified) {
      return NextResponse.json(
        { error: 'Domain must be verified before it can be set as primary' },
        { status: 400 }
      )
    }

    // If setting as primary, unset other primary domains first
    if (isPrimary) {
      await prisma.customDomain.updateMany({
        where: {
          organizationId: orgId,
          isPrimary: true,
          id: { not: domainId },
        },
        data: { isPrimary: false },
      })
    }

    // Update the domain
    const updatedDomain = await prisma.customDomain.update({
      where: { id: domainId },
      data: { isPrimary: isPrimary ?? domain.isPrimary },
    })
    invalidateDomainCache(domain.domain)

    return NextResponse.json({ domain: updatedDomain })
  } catch (error) {
    console.error('Error updating custom domain:', error)
    return NextResponse.json(
      { error: 'Failed to update custom domain' },
      { status: 500 }
    )
  }
}
