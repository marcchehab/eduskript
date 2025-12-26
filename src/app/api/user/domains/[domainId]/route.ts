import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// DELETE - Remove a custom domain
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ domainId: string }> }
) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { domainId } = await params

    // Verify the domain belongs to this user
    const domain = await prisma.teacherCustomDomain.findFirst({
      where: {
        id: domainId,
        userId: session.user.id,
      },
    })

    if (!domain) {
      return NextResponse.json({ error: 'Domain not found' }, { status: 404 })
    }

    // Delete the domain
    await prisma.teacherCustomDomain.delete({
      where: { id: domainId },
    })

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
  { params }: { params: Promise<{ domainId: string }> }
) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { domainId } = await params
    const body = await request.json()
    const { isPrimary } = body

    // Verify the domain belongs to this user
    const domain = await prisma.teacherCustomDomain.findFirst({
      where: {
        id: domainId,
        userId: session.user.id,
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
      await prisma.teacherCustomDomain.updateMany({
        where: {
          userId: session.user.id,
          isPrimary: true,
          id: { not: domainId },
        },
        data: { isPrimary: false },
      })
    }

    // Update the domain
    const updatedDomain = await prisma.teacherCustomDomain.update({
      where: { id: domainId },
      data: { isPrimary: isPrimary ?? domain.isPrimary },
    })

    return NextResponse.json({ domain: updatedDomain })
  } catch (error) {
    console.error('Error updating custom domain:', error)
    return NextResponse.json(
      { error: 'Failed to update custom domain' },
      { status: 500 }
    )
  }
}
