import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { revalidatePath, revalidateTag } from 'next/cache'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { CACHE_TAGS } from '@/lib/cached-queries'
import { checkSkriptPermissions } from '@/lib/permissions'

// GET - Get skript's frontpage
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ skriptId: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { skriptId } = await params

    // Check if user has access to skript
    const skript = await prisma.skript.findFirst({
      where: { id: skriptId },
      include: {
        authors: {
          include: { user: true }
        },
        collectionSkripts: {
          include: {
            collection: {
              include: {
                authors: {
                  include: { user: true }
                }
              }
            }
          }
        }
      }
    })

    if (!skript) {
      return NextResponse.json({ error: 'Skript not found' }, { status: 404 })
    }

    // Check permissions
    const collectionAuthors = skript.collectionSkripts
      .filter(cs => cs.collection !== null)
      .flatMap(cs => cs.collection!.authors)
    const permissions = checkSkriptPermissions(
      session.user.id,
      skript.authors,
      collectionAuthors
    )

    if (!permissions.canView) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const frontPage = await prisma.frontPage.findUnique({
      where: { skriptId },
      include: {
        versions: {
          orderBy: { version: 'desc' },
          take: 1
        }
      }
    })

    return NextResponse.json({
      frontPage: frontPage || null,
      currentVersion: frontPage?.versions[0]?.version || 0,
      canEdit: permissions.canEdit
    })
  } catch (error) {
    console.error('Error fetching skript frontpage:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// PATCH - Create or update skript's frontpage
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ skriptId: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { skriptId } = await params
    const body = await request.json()
    const { content, isPublished } = body

    // Check if user has edit access to skript
    const skript = await prisma.skript.findFirst({
      where: { id: skriptId },
      include: {
        authors: {
          include: { user: true }
        },
        collectionSkripts: {
          include: {
            collection: {
              include: {
                authors: {
                  include: { user: true }
                }
              }
            }
          }
        }
      }
    })

    if (!skript) {
      return NextResponse.json({ error: 'Skript not found' }, { status: 404 })
    }

    // Check permissions
    const collectionAuthors = skript.collectionSkripts
      .filter(cs => cs.collection !== null)
      .flatMap(cs => cs.collection!.authors)
    const permissions = checkSkriptPermissions(
      session.user.id,
      skript.authors,
      collectionAuthors
    )

    if (!permissions.canEdit) {
      return NextResponse.json(
        { error: 'You do not have permission to edit this skript' },
        { status: 403 }
      )
    }

    // Get existing frontpage
    const existingFrontPage = await prisma.frontPage.findUnique({
      where: { skriptId },
      include: {
        versions: {
          orderBy: { version: 'desc' },
          take: 1
        }
      }
    })

    let frontPage
    let contentChanged = false

    if (existingFrontPage) {
      // Check if content changed
      const currentVersion = existingFrontPage.versions[0]
      contentChanged = content !== undefined && currentVersion?.content !== content

      // Update existing frontpage
      const updateData: {
        updatedAt: Date
        content?: string
        isPublished?: boolean
      } = {
        updatedAt: new Date()
      }

      if (content !== undefined) updateData.content = content
      if (isPublished !== undefined) updateData.isPublished = isPublished

      frontPage = await prisma.frontPage.update({
        where: { id: existingFrontPage.id },
        data: updateData
      })

      // Create new version if content changed
      if (contentChanged) {
        await prisma.frontPageVersion.create({
          data: {
            frontPageId: existingFrontPage.id,
            content: content || '',
            version: (currentVersion?.version || 0) + 1,
            authorId: session.user.id
          }
        })
      }
    } else {
      // Create new frontpage
      frontPage = await prisma.frontPage.create({
        data: {
          skriptId,
          content: content || '',
          isPublished: isPublished || false
        }
      })

      // Create initial version
      await prisma.frontPageVersion.create({
        data: {
          frontPageId: frontPage.id,
          content: content || '',
          version: 1,
          authorId: session.user.id
        }
      })
      contentChanged = true
    }

    // Revalidate caches
    // Find the username of the skript owner for cache invalidation
    const skriptOwner = skript.authors[0]?.user
    if (skriptOwner) {
      const ownerUser = await prisma.user.findUnique({
        where: { id: skriptOwner.id },
        select: { pageSlug: true }
      })

      if (ownerUser?.pageSlug) {
        revalidateTag(CACHE_TAGS.skriptBySlug(ownerUser.pageSlug, skript.slug), { expire: 0 })
        revalidateTag(CACHE_TAGS.teacherContent(ownerUser.pageSlug), { expire: 0 })
      }
    }

    revalidatePath('/dashboard')

    return NextResponse.json({
      frontPage,
      versionCreated: contentChanged
    })
  } catch (error) {
    console.error('Error updating skript frontpage:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
