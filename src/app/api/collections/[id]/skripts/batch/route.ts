import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { revalidateTag } from 'next/cache'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkCollectionPermissions } from '@/lib/permissions'
import { placeableSkriptIds } from '@/lib/site-access'
import { invalidateStableLinks } from '@/lib/page-stable-link.server'
import { CACHE_TAGS } from '@/lib/cached-queries'

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { id: collectionId } = await params
    const { skripts } = await request.json()

    const collection = await prisma.collection.findUnique({
      where: { id: collectionId },
      include: { site: { select: { userId: true, organizationId: true, slug: true } } }
    })

    if (!collection) {
      return NextResponse.json(
        { error: 'Collection not found' },
        { status: 404 }
      )
    }

    const orgRoles = collection.site?.organizationId
      ? await prisma.organizationMember.findMany({
          where: { userId: session.user.id, organizationId: collection.site.organizationId },
          select: { organizationId: true, role: true },
        })
      : []
    const permissions = checkCollectionPermissions(session.user.id, collection, orgRoles)

    if (!permissions.canEdit) {
      return NextResponse.json(
        { error: 'Permission denied' },
        { status: 403 }
      )
    }

    // Rule 3 (site scoping): skripts already in the collection may stay; newly
    // added ones need read access (author OR viewer, or a page share). Others
    // are dropped from the payload rather than failing the whole save.
    const existingIds = new Set(
      (await prisma.collectionSkript.findMany({ where: { collectionId }, select: { skriptId: true } }))
        .map((r) => r.skriptId)
    )
    const requested: Array<{ id: string; order: number }> = Array.isArray(skripts) ? skripts : []
    const newIds = requested.map((s) => s.id).filter((id) => !existingIds.has(id))
    const allowedNew = await placeableSkriptIds(session.user.id, newIds)
    const allowedSkripts = requested.filter((s) => existingIds.has(s.id) || allowedNew.has(s.id))
    if (allowedSkripts.length !== requested.length) {
      console.warn(`[collections/batch] dropped ${requested.length - allowedSkripts.length} skript(s) without access`)
    }

    // Start a transaction to update all skripts atomically
    await prisma.$transaction(async (tx) => {
      // First, remove all existing CollectionSkript entries for this collection
      await tx.collectionSkript.deleteMany({
        where: {
          collectionId: collectionId
        }
      })

      // Then create new entries with the correct order. skipDuplicates
      // guards against a client payload that lists the same skript twice —
      // without it createMany throws P2002 on the (collectionId, skriptId)
      // unique constraint and the whole save 500s.
      if (allowedSkripts.length > 0) {
        await tx.collectionSkript.createMany({
          data: allowedSkripts.map((skript) => ({
            collectionId: collectionId,
            skriptId: skript.id,
            order: skript.order
          })),
          skipDuplicates: true,
        })
      }
    })

    // Placement decides where pages render (site scoping), so invalidate the
    // collection's OWN site (not the editor's primary site).
    const siteSlug = collection.site?.slug
    if (siteSlug) {
      revalidateTag(CACHE_TAGS.teacherContent(siteSlug), { expire: 0 })
      revalidateTag(CACHE_TAGS.orgContent(siteSlug), { expire: 0 })
    }
    // Placement decides which site /p/{id} redirects to (bughunt #7/#15).
    invalidateStableLinks()

    return NextResponse.json({
      success: true,
      message: `Updated ${allowedSkripts.length} skripts in collection`
    })
  } catch (error) {
    console.error('Error updating collection skripts:', error)
    return NextResponse.json(
      { error: 'Failed to update collection skripts' },
      { status: 500 }
    )
  }
}