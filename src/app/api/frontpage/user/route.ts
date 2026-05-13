import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { revalidatePath, revalidateTag } from 'next/cache'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { CACHE_TAGS } from '@/lib/cached-queries'

// GET - Get current user's frontpage
export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Only teachers can have frontpages; we look up the user via their Site
    // so the same query shape works once User.pageSlug is dropped later.
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { accountType: true, site: { select: { id: true } } }
    })

    if (user?.accountType !== 'teacher') {
      return NextResponse.json(
        { error: 'Only teachers can have frontpages' },
        { status: 403 }
      )
    }
    if (!user.site) {
      return NextResponse.json({ frontPage: null, currentVersion: 0 })
    }

    const frontPage = await prisma.frontPage.findUnique({
      where: { siteId: user.site.id },
      include: {
        versions: {
          orderBy: { version: 'desc' },
          take: 1
        }
      }
    })

    return NextResponse.json({
      frontPage: frontPage || null,
      currentVersion: frontPage?.versions[0]?.version || 0
    })
  } catch (error) {
    console.error('Error fetching user frontpage:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// PATCH - Create or update current user's frontpage
export async function PATCH(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Only teachers can have frontpages; we need the user's Site to scope
    // the lookup/upsert.
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        accountType: true,
        pageSlug: true,
        site: { select: { id: true } },
      }
    })

    if (user?.accountType !== 'teacher') {
      return NextResponse.json(
        { error: 'Only teachers can have frontpages' },
        { status: 403 }
      )
    }
    if (!user.site) {
      return NextResponse.json(
        { error: 'You need to set up your public page before editing a frontpage' },
        { status: 400 }
      )
    }

    const body = await request.json()
    const { content, isPublished } = body

    // Get existing frontpage
    const existingFrontPage = await prisma.frontPage.findUnique({
      where: { siteId: user.site.id },
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
      // Create new frontpage scoped to the site
      frontPage = await prisma.frontPage.create({
        data: {
          siteId: user.site.id,
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
    if (user?.pageSlug) {
      revalidateTag(CACHE_TAGS.teacherContent(user.pageSlug), { expire: 0 })
      revalidatePath(`/${user.pageSlug}`)
      revalidatePath('/dashboard')
    }

    return NextResponse.json({
      frontPage,
      versionCreated: contentChanged
    })
  } catch (error) {
    console.error('Error updating user frontpage:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
