import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { revalidatePath } from 'next/cache'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { generateSlug, isReservedSlug } from '@/lib/markdown'
import { checkCollectionPermissions } from '@/lib/permissions'
import { listSkriptsForUser } from '@/lib/services/skripts'

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { title, description, slug, collectionId } = await request.json()

    // Validate input. collectionId is OPTIONAL — a skript can live at the root
    // of a page (no collection); the teacher drags it onto the page builder
    // afterwards. When a collection IS given we still verify edit permission.
    if (!title || !slug) {
      return NextResponse.json(
        { error: 'Title and slug are required' },
        { status: 400 }
      )
    }

    if (collectionId) {
      // Verify the user can edit the collection (via its site's ownership)
      const collection = await prisma.collection.findUnique({
        where: { id: collectionId },
        include: { site: { select: { userId: true, organizationId: true } } }
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
          { error: 'You do not have permission to create skripts in this collection' },
          { status: 403 }
        )
      }
    }

    // Normalize slug
    const normalizedSlug = generateSlug(slug)

    // Check for reserved slugs that conflict with system routes
    if (isReservedSlug(normalizedSlug)) {
      return NextResponse.json(
        { error: `The slug "${normalizedSlug}" is reserved and cannot be used` },
        { status: 400 }
      )
    }

    // Check slug uniqueness scoped to this user's skripts
    const existingSkript = await prisma.skript.findFirst({
      where: {
        slug: normalizedSlug,
        OR: [
          { authors: { some: { userId: session.user.id } } },
          { collectionSkripts: { some: { collection: { site: { userId: session.user.id } } } } }
        ]
      }
    })

    if (existingSkript) {
      return NextResponse.json(
        { error: `You already have a skript with the slug "${normalizedSlug}"` },
        { status: 409 }
      )
    }

    // Next order within the collection (only relevant when linking to one).
    const nextOrder = collectionId
      ? ((await prisma.collectionSkript.findFirst({
          where: { collectionId },
          orderBy: { order: 'desc' },
        }))?.order ?? -1) + 1
      : 0

    // Create the skript; link it to the collection only when one was given.
    const skript = await prisma.$transaction(async (tx) => {
      const newSkript = await tx.skript.create({
        data: {
          title,
          description,
          slug: normalizedSlug,
          authors: {
            create: {
              userId: session.user.id,
              permission: "author"
            }
          }
        }
      })

      if (collectionId) {
        await tx.collectionSkript.create({
          data: {
            collectionId,
            skriptId: newSkript.id,
            order: nextOrder
          }
        })
      }

      return newSkript
    })

    // Fetch the created skript with all relations
    const createdSkriptWithRelations = await prisma.skript.findUnique({
      where: { id: skript.id },
      include: {
        authors: {
          include: {
            user: true
          }
        },
        collectionSkripts: {
          include: {
            collection: true
          }
        }
      }
    })

    revalidatePath('/dashboard')
    return NextResponse.json(createdSkriptWithRelations)
  } catch (error) {
    console.error('Error creating skript:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
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

    const { searchParams } = new URL(request.url)
    const includeShared = searchParams.get('includeShared') === 'true'

    const skripts = await listSkriptsForUser(session.user.id, { includeShared })

    return NextResponse.json({ success: true, data: skripts })
  } catch (error) {
    console.error('Error fetching skripts:', error)
    return NextResponse.json(
      { error: 'Failed to fetch skripts' },
      { status: 500 }
    )
  }
}
