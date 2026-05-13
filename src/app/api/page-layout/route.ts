import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { revalidateTag } from 'next/cache'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { CACHE_TAGS } from '@/lib/cached-queries'

/** Look up the user's Site id (1:1 with the user). Page layouts now key on
 *  site, not user, since orgs share the same table. */
async function getUserSiteId(userId: string) {
  const site = await prisma.site.findUnique({
    where: { userId },
    select: { id: true, slug: true },
  })
  return site
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const site = await getUserSiteId(session.user.id)
    if (!site) {
      return NextResponse.json({ success: true, data: { items: [] } })
    }

    const pageLayout = await prisma.pageLayout.findUnique({
      where: { siteId: site.id },
      include: {
        items: {
          orderBy: { order: 'asc' }
        }
      }
    })

    return NextResponse.json({
      success: true,
      data: pageLayout || { items: [] }
    })
  } catch (error) {
    console.error('Error fetching page layout:', error)
    return NextResponse.json(
      { error: 'Failed to fetch page layout' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { items } = await request.json()

    if (!Array.isArray(items)) {
      return NextResponse.json(
        { error: 'Items must be an array' },
        { status: 400 }
      )
    }

    const site = await getUserSiteId(session.user.id)
    if (!site) {
      return NextResponse.json(
        { error: 'You need to set up your public page before editing the layout' },
        { status: 400 }
      )
    }

    // SECURITY: Validate that the user can place each item on their site.
    // Collections must belong to the user's site; skripts must be authored
    // by the user.
    const validatedItems: Array<{ id: string; type: string }> = []

    for (const item of items) {
      if (!item.id || !item.type) {
        continue
      }

      if (item.type === 'collection') {
        const collection = await prisma.collection.findFirst({
          where: {
            id: item.id,
            siteId: site.id,
          }
        })
        if (collection) {
          validatedItems.push(item)
        } else {
          console.warn(`[Page Layout] User ${session.user.email} attempted to add collection ${item.id} without permission`)
        }
      } else if (item.type === 'skript') {
        const skript = await prisma.skript.findFirst({
          where: {
            id: item.id,
            authors: {
              some: { userId: session.user.id }
            }
          }
        })
        if (skript) {
          validatedItems.push(item)
        } else {
          console.warn(`[Page Layout] User ${session.user.email} attempted to add skript ${item.id} without permission`)
        }
      }
    }

    const pageLayout = await prisma.pageLayout.upsert({
      where: { siteId: site.id },
      update: {
        items: {
          deleteMany: {},
          create: validatedItems.map((item, index) => ({
            type: item.type,
            contentId: item.id,
            order: index
          }))
        }
      },
      create: {
        siteId: site.id,
        items: {
          create: validatedItems.map((item, index) => ({
            type: item.type,
            contentId: item.id,
            order: index
          }))
        }
      },
      include: {
        items: {
          orderBy: { order: 'asc' }
        }
      }
    })

    // The public sidebar reads page-layout items through two cached queries
    // (getTeacherWithLayout + getTeacherHomepageContent). Both are tagged with
    // teacherContent and user; without these invalidations a root-promoted
    // skript stays invisible on the live site until the tag is bumped elsewhere.
    if (site.slug) {
      revalidateTag(CACHE_TAGS.teacherContent(site.slug), { expire: 0 })
      revalidateTag(CACHE_TAGS.user(site.slug), { expire: 0 })
    }

    return NextResponse.json({ success: true, data: pageLayout })
  } catch (error) {
    console.error('Error saving page layout:', error)
    return NextResponse.json(
      { error: 'Failed to save page layout' },
      { status: 500 }
    )
  }
}
