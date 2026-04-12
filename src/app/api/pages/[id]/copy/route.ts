import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { revalidatePath } from 'next/cache'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import {
  extractReferencedFilenames,
  extractReferencedVideoFilenames,
} from '@/lib/extract-file-references'

interface RouteParams {
  params: Promise<{ id: string }>
}

/**
 * POST /api/pages/[id]/copy — Copy a published page into the caller's skript.
 * Creates a draft copy with provenance tracking (forkedFromPageId, forkedFromAuthorId).
 * Referenced files are duplicated as DB rows pointing to the same S3 objects (content-addressed).
 * Referenced videos are duplicated as Video rows pointing to the same Mux asset
 * (same playbackId, null muxAssetId to avoid @unique collision).
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: sourcePageId } = await params
    const { targetSkriptId } = await request.json()

    if (!targetSkriptId) {
      return NextResponse.json(
        { error: 'targetSkriptId is required' },
        { status: 400 }
      )
    }

    // Fetch source page with its first author (for provenance)
    const page = await prisma.page.findUnique({
      where: { id: sourcePageId },
      include: {
        authors: {
          where: { permission: 'author' },
          orderBy: { createdAt: 'asc' },
          take: 1,
          include: { user: { select: { id: true, pageSlug: true, name: true } } },
        },
      },
    })

    if (!page) {
      return NextResponse.json({ error: 'Page not found' }, { status: 404 })
    }

    if (!page.isPublished) {
      return NextResponse.json(
        { error: 'Only published pages can be copied' },
        { status: 403 }
      )
    }

    if (page.pageType === 'exam') {
      return NextResponse.json(
        { error: 'Exam pages cannot be copied' },
        { status: 403 }
      )
    }

    // Verify target skript exists and user has author permission
    const targetSkript = await prisma.skript.findUnique({
      where: { id: targetSkriptId },
      include: { authors: true },
    })

    if (!targetSkript) {
      return NextResponse.json(
        { error: 'Target skript not found' },
        { status: 404 }
      )
    }

    const hasTargetPermission = targetSkript.authors.some(
      (a) => a.userId === session.user.id && a.permission === 'author'
    )
    if (!hasTargetPermission) {
      return NextResponse.json(
        { error: 'You need edit permissions on the target skript' },
        { status: 403 }
      )
    }

    // Copy referenced files (content-addressed: same hash = same S3 object)
    const referencedFilenames = extractReferencedFilenames(page.content)

    const sourceFiles =
      referencedFilenames.length > 0
        ? await prisma.file.findMany({
            where: {
              skriptId: page.skriptId,
              name: { in: referencedFilenames },
              parentId: null,
            },
          })
        : []

    const existingTargetFiles =
      sourceFiles.length > 0
        ? await prisma.file.findMany({
            where: {
              skriptId: targetSkriptId,
              name: { in: sourceFiles.map((f) => f.name) },
              parentId: null,
            },
            select: { name: true },
          })
        : []
    const existingNames = new Set(existingTargetFiles.map((f) => f.name))

    // Collect referenced videos from the source skript. Videos live in the
    // Video table (not File), so we duplicate a DB row pointing to the same
    // Mux asset — mirrors how files are content-addressed and shared.
    const referencedVideoFilenames = extractReferencedVideoFilenames(page.content)

    const sourceVideos =
      referencedVideoFilenames.length > 0
        ? await prisma.video.findMany({
            where: {
              filename: { in: referencedVideoFilenames },
              skripts: { some: { id: page.skriptId } },
            },
            select: {
              id: true,
              filename: true,
              provider: true,
              metadata: true,
            },
          })
        : []

    // Determine original author for provenance
    const originalAuthorId = page.authors[0]?.user.id ?? null

    // Generate unique slug in target skript
    let finalSlug = page.slug
    const slugConflict = await prisma.page.findFirst({
      where: { skriptId: targetSkriptId, slug: page.slug },
    })

    const newPage = await prisma.$transaction(async (tx) => {
      // Copy files that don't already exist in target
      const filesToCopy = sourceFiles.filter((f) => !existingNames.has(f.name))
      if (filesToCopy.length > 0) {
        await tx.file.createMany({
          data: filesToCopy.map((f) => ({
            name: f.name,
            parentId: null,
            isDirectory: f.isDirectory,
            skriptId: targetSkriptId,
            hash: f.hash,
            contentType: f.contentType,
            size: f.size,
            width: f.width,
            height: f.height,
            createdBy: session.user.id,
          })),
        })
      }

      // Copy/connect videos referenced by the page.
      // If the caller already owns a Video with the same filename (per the
      // @@unique([filename, provider, uploadedById]) constraint), connect
      // their existing row to the target skript. Otherwise create a new row
      // pointing at the same Mux asset via the shared playbackId in metadata.
      // muxAssetId / muxUploadId are NOT copied — they're globally unique
      // webhook-lookup handles, not content references.
      for (const src of sourceVideos) {
        const existing = await tx.video.findFirst({
          where: {
            filename: src.filename,
            provider: src.provider,
            uploadedById: session.user.id,
          },
          select: { id: true },
        })

        if (existing) {
          await tx.video.update({
            where: { id: existing.id },
            data: { skripts: { connect: { id: targetSkriptId } } },
          })
        } else {
          await tx.video.create({
            data: {
              filename: src.filename,
              provider: src.provider,
              metadata: src.metadata ?? {},
              uploadedById: session.user.id,
              skripts: { connect: { id: targetSkriptId } },
            },
          })
        }
      }

      // Resolve slug conflict
      if (slugConflict) {
        let suffix = 2
        while (true) {
          const candidate = `${page.slug}-${suffix}`
          const exists = await tx.page.findFirst({
            where: { skriptId: targetSkriptId, slug: candidate },
          })
          if (!exists) {
            finalSlug = candidate
            break
          }
          suffix++
        }
      }

      // Get next order in target skript
      const maxOrder = await tx.page.aggregate({
        where: { skriptId: targetSkriptId },
        _max: { order: true },
      })
      const newOrder = (maxOrder._max.order ?? -1) + 1

      // Create the copied page as a draft with provenance
      const created = await tx.page.create({
        data: {
          title: page.title,
          slug: finalSlug,
          content: page.content,
          order: newOrder,
          isPublished: false,
          pageType: 'normal',
          skriptId: targetSkriptId,
          forkedFromPageId: page.id,
          forkedFromAuthorId: originalAuthorId,
          forkedAt: new Date(),
          authors: {
            create: {
              userId: session.user.id,
              permission: 'author',
            },
          },
        },
      })

      // Create initial version
      await tx.pageVersion.create({
        data: {
          content: page.content,
          version: 1,
          authorId: session.user.id,
          pageId: created.id,
        },
      })

      return created
    })

    revalidatePath('/dashboard')

    return NextResponse.json(
      {
        success: true,
        page: {
          id: newPage.id,
          slug: newPage.slug,
          title: newPage.title,
        },
        targetSkriptSlug: targetSkript.slug,
      },
      { status: 201 }
    )
  } catch (error) {
    console.error('Error copying page:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
