import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { canEditSite } from '@/lib/permissions'
import { CACHE_TAGS } from '@/lib/cached-queries'

/**
 * Bust the cached public-page queries for every site that pins this
 * collection in its page layout. Collection title + accentColor surface in
 * the public sidebar, but those pages read through unstable_cache
 * (`revalidate: false`), so without an explicit bust an edit only shows up
 * once the cache happens to drop. A collection can appear on more than one
 * site's page (e.g. a teacher collection pinned onto an org page), hence the
 * findMany rather than just touching the owning site.
 */
async function revalidateCollectionPages(collectionId: string) {
  const layouts = await prisma.pageLayout.findMany({
    where: { items: { some: { type: 'collection', contentId: collectionId } } },
    select: {
      site: { select: { slug: true, userId: true, organizationId: true } },
    },
  })
  for (const { site } of layouts) {
    if (site.organizationId) {
      revalidateTag(CACHE_TAGS.organization(site.slug), { expire: 0 })
      revalidateTag(CACHE_TAGS.orgContent(site.slug), { expire: 0 })
    } else if (site.userId) {
      revalidateTag(CACHE_TAGS.user(site.slug), { expire: 0 })
      revalidateTag(CACHE_TAGS.teacherContent(site.slug), { expire: 0 })
    }
  }
}

async function loadCollectionWithOwner(collectionId: string) {
  return prisma.collection.findUnique({
    where: { id: collectionId },
    include: {
      site: { select: { userId: true, organizationId: true } },
    },
  })
}

async function loadOrgRoles(userId: string, organizationId: string | null | undefined) {
  if (!organizationId) return []
  return prisma.organizationMember.findMany({
    where: { userId, organizationId },
    select: { organizationId: true, role: true },
  })
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params

    const collection = await prisma.collection.findUnique({
      where: { id },
      include: {
        site: { select: { userId: true, organizationId: true } },
        collectionSkripts: {
          include: {
            skript: {
              include: {
                pages: {
                  orderBy: { order: 'asc' }
                }
              }
            }
          },
          orderBy: { order: 'asc' }
        }
      }
    })

    if (!collection) {
      return NextResponse.json({ error: 'Collection not found' }, { status: 404 })
    }

    const orgRoles = await loadOrgRoles(session.user.id, collection.site?.organizationId)
    if (!canEditSite(session.user.id, collection.site, orgRoles, session.user.isAdmin)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    return NextResponse.json({
      success: true,
      data: collection,
      permissions: { canEdit: true, canView: true },
      title: collection.title,
    })
  } catch (error) {
    console.error('Error fetching collection:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params
    const { title, accentColor } = await request.json()

    const existingCollection = await loadCollectionWithOwner(id)
    if (!existingCollection) {
      return NextResponse.json({ error: 'Collection not found' }, { status: 404 })
    }

    const orgRoles = await loadOrgRoles(session.user.id, existingCollection.site?.organizationId)
    if (!canEditSite(session.user.id, existingCollection.site, orgRoles, session.user.isAdmin)) {
      return NextResponse.json({ error: 'You do not have permission to edit this collection' }, { status: 403 })
    }

    const collection = await prisma.collection.update({
      where: { id },
      data: {
        ...(title && { title }),
        ...(accentColor !== undefined && { accentColor })
      },
    })

    await revalidateCollectionPages(id)

    return NextResponse.json(collection)
  } catch (error) {
    console.error('Error updating collection:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params

    const existingCollection = await loadCollectionWithOwner(id)
    if (!existingCollection) {
      return NextResponse.json({ error: 'Collection not found' }, { status: 404 })
    }

    const orgRoles = await loadOrgRoles(session.user.id, existingCollection.site?.organizationId)
    if (!canEditSite(session.user.id, existingCollection.site, orgRoles, session.user.isAdmin)) {
      return NextResponse.json({ error: 'You do not have permission to delete this collection' }, { status: 403 })
    }

    await prisma.collection.delete({
      where: { id }
    })

    return NextResponse.json({ message: 'Collection deleted successfully' })
  } catch (error) {
    console.error('Error deleting collection:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
