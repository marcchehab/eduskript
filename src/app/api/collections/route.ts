import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { PRIMARY_SITE_ORDER } from '@/lib/sites'

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { title, siteId } = await request.json()

    if (!title || !title.trim()) {
      return NextResponse.json(
        { error: 'Title is required' },
        { status: 400 }
      )
    }

    // Collections belong to the creator's Site. When a specific siteId is
    // provided, target that site (ownership-checked so a user can't create
    // collections on another user's site). Otherwise fall back to the user's
    // primary site. Every teacher with a pageSlug gets a Site at signup; if
    // there's none, the user hasn't claimed their page yet and can't own
    // collections.
    const site = siteId
      ? await prisma.site.findFirst({
          where: { id: siteId, userId: session.user.id },
          select: { id: true },
        })
      : await prisma.site.findFirst({
          where: { userId: session.user.id },
          orderBy: PRIMARY_SITE_ORDER,
          select: { id: true },
        })
    if (!site) {
      if (siteId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
      return NextResponse.json(
        { error: 'You need to set up your public page before creating collections' },
        { status: 400 }
      )
    }

    const collection = await prisma.collection.create({
      data: {
        title: title.trim(),
        siteId: site.id,
      },
    })

    return NextResponse.json({ success: true, data: collection })
  } catch (error) {
    console.error('Error creating collection:', error)
    return NextResponse.json(
      { error: 'Failed to create collection' },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // The `includeShared` flag used to widen the query to collections shared
    // via CollectionAuthor. With the slim model, collections are 1:1 with a
    // site, so "yours" = "owned by your user site" plus any org sites you're
    // a member of. Both branches collapse to the same query.
    void new URL(request.url).searchParams.get('includeShared')

    const memberships = await prisma.organizationMember.findMany({
      where: { userId: session.user.id },
      select: { organizationId: true },
    })
    const orgIds = memberships.map(m => m.organizationId)

    const collections = await prisma.collection.findMany({
      where: {
        OR: [
          { site: { userId: session.user.id } },
          ...(orgIds.length > 0 ? [{ site: { organizationId: { in: orgIds } } }] : []),
        ],
      },
      include: {
        collectionSkripts: {
          include: {
            skript: {
              include: {
                pages: true,
                authors: {
                  include: {
                    user: {
                      select: {
                        id: true,
                        name: true,
                        email: true
                      }
                    }
                  }
                }
              }
            }
          }
        }
      },
      orderBy: { updatedAt: 'desc' }
    })

    return NextResponse.json({ success: true, data: collections })
  } catch (error) {
    console.error('Error fetching collections:', error)
    return NextResponse.json(
      { error: 'Failed to fetch collections' },
      { status: 500 }
    )
  }
}
