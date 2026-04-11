import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkPagePermissions } from '@/lib/permissions'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ canEdit: false })
    }

    // Students can't edit
    if (session.user.accountType === 'student') {
      return NextResponse.json({ canEdit: false })
    }

    const { id } = await params

    // Fetch page with permission info
    const page = await prisma.page.findUnique({
      where: { id },
      include: {
        authors: { include: { user: true } },
        skript: {
          include: {
            authors: { include: { user: true } },
            collectionSkripts: {
              include: {
                collection: {
                  include: {
                    authors: { include: { user: true } }
                  }
                }
              }
            }
          }
        }
      }
    })

    if (!page) {
      return NextResponse.json({ canEdit: false })
    }

    // Check permissions
    const collectionAuthors = page.skript.collectionSkripts
      .filter(cs => cs.collection !== null)
      .flatMap(cs => cs.collection!.authors)

    const permissions = checkPagePermissions(
      session.user.id,
      page.authors,
      page.skript.authors,
      collectionAuthors
    )

    if (!permissions.canEdit) {
      // Can't edit — check if the page is copyable (published, non-exam)
      const canCopy = page.isPublished && page.pageType !== 'exam'
      return NextResponse.json({ canEdit: false, canCopy })
    }

    const editUrl = `/dashboard/skripts/${page.skript.slug}/pages/${page.slug}/edit`

    return NextResponse.json({ canEdit: true, editUrl })
  } catch (error) {
    console.error('Error checking edit permissions:', error)
    return NextResponse.json({ canEdit: false })
  }
}
