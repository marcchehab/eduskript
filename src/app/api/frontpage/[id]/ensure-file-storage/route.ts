import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// POST - Ensure a file storage skript exists for user/org FrontPages
// Creates a hidden skript if fileSkriptId is null
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: frontPageId } = await params

    // Get the front page
    const frontPage = await prisma.frontPage.findUnique({
      where: { id: frontPageId },
      select: {
        id: true,
        userId: true,
        skriptId: true,
        organizationId: true,
        fileSkriptId: true,
      }
    })

    if (!frontPage) {
      return NextResponse.json({ error: 'Front page not found' }, { status: 404 })
    }

    // Verify ownership
    const isOwner = frontPage.userId === session.user.id
    let isOrgAdmin = false

    if (frontPage.organizationId) {
      const membership = await prisma.organizationMember.findFirst({
        where: {
          organizationId: frontPage.organizationId,
          userId: session.user.id,
          role: { in: ['owner', 'admin'] }
        }
      })
      isOrgAdmin = !!membership
    }

    if (!isOwner && !isOrgAdmin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    // If it's a skript FrontPage, use the skript's files directly
    if (frontPage.skriptId) {
      return NextResponse.json({
        fileSkriptId: frontPage.skriptId,
        created: false,
        message: 'Skript FrontPages use their skript\'s file storage'
      })
    }

    // If fileSkriptId already exists, return it
    if (frontPage.fileSkriptId) {
      return NextResponse.json({
        fileSkriptId: frontPage.fileSkriptId,
        created: false
      })
    }

    // Create a new hidden skript for file storage
    const slug = `__frontpage_files_${frontPageId}`
    const title = frontPage.organizationId
      ? 'Organization Front Page Files'
      : 'User Front Page Files'

    const fileSkript = await prisma.skript.create({
      data: {
        title,
        slug,
        description: 'Hidden skript for front page file storage',
        isPublished: false, // Keep hidden
        authors: {
          create: {
            userId: session.user.id,
            permission: 'author'
          }
        }
      }
    })

    // Update the front page with the new fileSkriptId
    await prisma.frontPage.update({
      where: { id: frontPageId },
      data: { fileSkriptId: fileSkript.id }
    })

    return NextResponse.json({
      fileSkriptId: fileSkript.id,
      created: true
    })
  } catch (error) {
    console.error('Error ensuring file storage:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json(
      { error: `Failed to ensure file storage: ${errorMessage}` },
      { status: 500 }
    )
  }
}
