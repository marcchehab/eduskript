import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { revalidatePath } from 'next/cache'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkSkriptPermissions, checkCollectionPermissions } from '@/lib/permissions'
import { PRIMARY_SITE_ORDER } from '@/lib/sites'
import { canPlaceSkript } from '@/lib/site-access'
import { getPlacingSites, revalidateSkriptOnPlacingSites } from '@/lib/site-revalidate'
import { invalidateStableLinks } from '@/lib/page-stable-link.server'

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { skriptId, targetCollectionId, order } = await request.json()

    if (!skriptId) {
      return NextResponse.json(
        { error: 'skriptId is required' },
        { status: 400 }
      )
    }

    // Get the skript with its current collection relationships and authors
    const skript = await prisma.skript.findUnique({
      where: { id: skriptId },
      include: {
        collectionSkripts: {
          include: {
            collection: {
              include: {
                site: { select: { userId: true, organizationId: true } }
              }
            }
          }
        },
        authors: {
          include: { user: true }
        }
      }
    })

    if (!skript) {
      return NextResponse.json(
        { error: 'Skript not found' },
        { status: 404 }
      )
    }

    // Check if user has edit permission (author) on the skript directly
    const skriptPermissions = checkSkriptPermissions(
      session.user.id, 
      skript.authors
    )

    // Check which of the current collection(s) the user can edit via their
    // owning site (or org-admin membership). Bughunt #13: a move only ever
    // touches THOSE memberships — other teachers' collections that also
    // contain (place) this skript are left alone.
    let hasSourceCollectionEditPermission = false
    const editableSourceIds: string[] = []

    for (const collectionSkript of skript.collectionSkripts) {
      if (!collectionSkript.collection) continue

      const orgRoles = collectionSkript.collection.site?.organizationId
        ? await prisma.organizationMember.findMany({
            where: {
              userId: session.user.id,
              organizationId: collectionSkript.collection.site.organizationId,
            },
            select: { organizationId: true, role: true },
          })
        : []
      const collectionPermissions = checkCollectionPermissions(
        session.user.id,
        collectionSkript.collection,
        orgRoles,
      )

      if (collectionPermissions.canEdit) {
        hasSourceCollectionEditPermission = true
        editableSourceIds.push(collectionSkript.collection.id)
      }
    }

    // A move is a placement change: the user needs edit rights on a source
    // collection, or read access to the skript (rule 3) to place it anew.
    // It never grants content rights (the old code upgraded/created a
    // SkriptAuthor 'author' row here — bughunt #13).
    const canMoveSkript =
      hasSourceCollectionEditPermission ||
      skriptPermissions.canView ||
      (await canPlaceSkript(session.user.id, skriptId))

    if (!canMoveSkript) {
      return NextResponse.json(
        { 
          error: 'You need edit permissions on this skript or its collection to move it',
          details: {
            hasSkriptEditPermission: skriptPermissions.canEdit,
            hasCollectionEditPermission: hasSourceCollectionEditPermission
          }
        },
        { status: 403 }
      )
    }

    // If moving to a specific collection, check permissions on target collection
    if (targetCollectionId) {
      const targetCollection = await prisma.collection.findUnique({
        where: { id: targetCollectionId },
        include: { site: { select: { userId: true, organizationId: true } } }
      })

      if (!targetCollection) {
        return NextResponse.json(
          { error: 'Target collection not found' },
          { status: 404 }
        )
      }

      const targetOrgRoles = targetCollection.site?.organizationId
        ? await prisma.organizationMember.findMany({
            where: { userId: session.user.id, organizationId: targetCollection.site.organizationId },
            select: { organizationId: true, role: true },
          })
        : []
      const targetPermissions = checkCollectionPermissions(
        session.user.id,
        targetCollection,
        targetOrgRoles,
      )

      if (!targetPermissions.canEdit) {
        return NextResponse.json(
          { 
            error: 'You need edit permissions on the target collection to add skripts to it',
            details: {
              targetCollectionId,
              hasEditPermission: false
            }
          },
          { status: 403 }
        )
      }
    }

    // Sites placing the skript BEFORE the move (they may lose it).
    const placingBefore = await getPlacingSites(skriptId)

    // Handle the move operation with junction table management
    const result = await prisma.$transaction(async (tx) => {
      const newOrder = order ?? 0

      // Get current collection relationships
      const currentCollectionSkripts = await tx.collectionSkript.findMany({
        where: { skriptId: skriptId },
        include: { collection: true }
      })

      if (targetCollectionId) {
        // Moving to a specific collection

        // Check if skript is already in the target collection
        const existingInTarget = currentCollectionSkripts.find(cs => cs.collectionId === targetCollectionId)

        if (existingInTarget) {
          // Already in target collection, just reorder within it
          const currentOrder = existingInTarget.order

          if (currentOrder !== newOrder) {
            // Make room at new position
            await tx.collectionSkript.updateMany({
              where: {
                collectionId: targetCollectionId,
                order: { gte: newOrder }
              },
              data: {
                order: { increment: 1 }
              }
            })

            // Update the specific record
            await tx.collectionSkript.update({
              where: { id: existingInTarget.id },
              data: { order: newOrder }
            })
          }
        } else {
          // Moving to new collection

          // Remove from the current collections THIS user can edit only
          await tx.collectionSkript.deleteMany({
            where: { skriptId: skriptId, collectionId: { in: editableSourceIds } }
          })

          // Make room in target collection
          await tx.collectionSkript.updateMany({
            where: {
              collectionId: targetCollectionId,
              order: { gte: newOrder }
            },
            data: {
              order: { increment: 1 }
            }
          })

          // Add to target collection
          await tx.collectionSkript.create({
            data: {
              collectionId: targetCollectionId,
              skriptId: skriptId,
              order: newOrder
            }
          })
        }
      } else {
        // Moving to root level — just detach from any collection. Root
        // placement now lives in PageLayout.items (added separately by the
        // site builder), not via a CollectionSkript row.
        await tx.collectionSkript.deleteMany({
          where: { skriptId: skriptId, collectionId: { in: editableSourceIds } }
        })
      }

      // Return the updated skript with its new relationships
      const updatedSkript = await tx.skript.findUnique({
        where: { id: skriptId },
        include: {
          collectionSkripts: {
            include: {
              collection: true
            }
          }
        }
      })

      return updatedSkript
    })

    // Old and new placing sites (bughunt #13/#4).
    await revalidateSkriptOnPlacingSites(skriptId, [skript.slug], [], placingBefore)
    await revalidateSkriptOnPlacingSites(skriptId, [skript.slug])
    invalidateStableLinks()

    // Get the user's URL slug for revalidation (lives on Site now).
    const userSite = await prisma.site.findFirst({
      where: { userId: session.user.id },
      orderBy: PRIMARY_SITE_ORDER,
      select: { slug: true }
    })

    if (userSite?.slug) {
      revalidatePath(`/${userSite.slug}`)
      revalidatePath('/dashboard')
    }

    return NextResponse.json({ 
      success: true, 
      data: result 
    })
  } catch (error) {
    console.error('Error moving skript:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}