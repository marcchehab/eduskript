import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { revalidatePath, revalidateTag } from 'next/cache'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { CACHE_TAGS } from '@/lib/cached-queries'
import { checkSkriptPermissions } from '@/lib/permissions'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; versionId: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id, versionId } = await params

    // Get frontpage and check permissions
    const frontPage = await prisma.frontPage.findUnique({
      where: { id },
      include: {
        user: true,
        skript: {
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
        }
      }
    })

    if (!frontPage) {
      return NextResponse.json({ error: 'Frontpage not found' }, { status: 404 })
    }

    // Check permissions based on owner type
    let canEdit = false
    if (frontPage.userId) {
      // User frontpage - only the owner can restore
      canEdit = frontPage.userId === session.user.id
    } else if (frontPage.skript) {
      // Skript frontpage - check skript permissions
      const collectionAuthors = frontPage.skript.collectionSkripts
        .filter(cs => cs.collection !== null)
        .flatMap(cs => cs.collection!.authors)
      const permissions = checkSkriptPermissions(
        session.user.id,
        frontPage.skript.authors,
        collectionAuthors
      )
      canEdit = permissions.canEdit
    }

    if (!canEdit) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Get the version to restore
    const versionToRestore = await prisma.frontPageVersion.findFirst({
      where: {
        id: versionId,
        frontPageId: id
      }
    })

    if (!versionToRestore) {
      return NextResponse.json({ error: 'Version not found' }, { status: 404 })
    }

    // Get the latest version number
    const latestVersion = await prisma.frontPageVersion.findFirst({
      where: { frontPageId: id },
      orderBy: { version: 'desc' },
      select: { version: true }
    })
    const newVersionNumber = (latestVersion?.version || 0) + 1

    // Update the frontpage content
    const updatedFrontPage = await prisma.frontPage.update({
      where: { id },
      data: {
        content: versionToRestore.content,
        updatedAt: new Date()
      }
    })

    // Create a new version entry for the restoration
    await prisma.frontPageVersion.create({
      data: {
        frontPageId: id,
        content: versionToRestore.content,
        version: newVersionNumber,
        changeLog: `Restored from version ${versionToRestore.version}`,
        authorId: session.user.id
      }
    })

    // Revalidate caches
    if (frontPage.userId) {
      // User frontpage
      const user = await prisma.user.findUnique({
        where: { id: frontPage.userId },
        select: { pageSlug: true }
      })
      if (user?.pageSlug) {
        revalidateTag(CACHE_TAGS.teacherContent(user.pageSlug), { expire: 0 })
        revalidatePath(`/${user.pageSlug}`)
      }
    } else if (frontPage.skript) {
      // Skript frontpage
      const skriptOwner = frontPage.skript.authors[0]?.user
      if (skriptOwner) {
        const ownerUser = await prisma.user.findUnique({
          where: { id: skriptOwner.id },
          select: { pageSlug: true }
        })
        if (ownerUser?.pageSlug) {
          revalidateTag(CACHE_TAGS.skriptBySlug(ownerUser.pageSlug, frontPage.skript.slug), { expire: 0 })
          revalidatePath(`/${ownerUser.pageSlug}/${frontPage.skript.slug}`)
        }
      }
    }

    revalidatePath('/dashboard')

    return NextResponse.json({
      success: true,
      frontPage: updatedFrontPage,
      restoredFromVersion: versionToRestore.version
    })
  } catch (error) {
    console.error('Error restoring frontpage version:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
