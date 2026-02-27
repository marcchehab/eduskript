import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { revalidatePath } from 'next/cache'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { extractReferencedFilenames } from '@/lib/extract-file-references'

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { pageId, targetSkriptId } = await request.json()

    if (!pageId || !targetSkriptId) {
      return NextResponse.json(
        { error: 'pageId and targetSkriptId are required' },
        { status: 400 }
      )
    }

    // Fetch page with its source skript
    const page = await prisma.page.findUnique({
      where: { id: pageId },
      include: {
        skript: {
          include: {
            authors: true,
          },
        },
      },
    })

    if (!page) {
      return NextResponse.json({ error: 'Page not found' }, { status: 404 })
    }

    if (page.skriptId === targetSkriptId) {
      return NextResponse.json(
        { error: 'Page is already in this skript' },
        { status: 400 }
      )
    }

    // Verify user has author permission on source skript
    const hasSourcePermission = page.skript.authors.some(
      (a) => a.userId === session.user.id && a.permission === 'author'
    )
    if (!hasSourcePermission) {
      return NextResponse.json(
        { error: 'You need edit permissions on the source skript' },
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

    // Extract referenced filenames from page content
    const referencedFilenames = extractReferencedFilenames(page.content)

    // Find matching files in source skript (root-level files only, parentId null)
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

    // Find existing files in target to avoid duplicates
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

    // Check for slug conflict in target skript
    const slugConflict = await prisma.page.findFirst({
      where: { skriptId: targetSkriptId, slug: page.slug },
    })

    let finalSlug = page.slug
    await prisma.$transaction(async (tx) => {
      // Copy files that don't already exist in target
      // Content-addressed storage: same hash → same S3 object, no S3 ops needed
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

      // Resolve slug: append "-2", "-3", etc. if conflict exists
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

      // Get max order in target skript
      const maxOrder = await tx.page.aggregate({
        where: { skriptId: targetSkriptId },
        _max: { order: true },
      })
      const newOrder = (maxOrder._max.order ?? -1) + 1

      // Move the page
      await tx.page.update({
        where: { id: pageId },
        data: {
          skriptId: targetSkriptId,
          slug: finalSlug,
          order: newOrder,
        },
      })

      // Re-index order in source skript to close the gap
      const remainingPages = await tx.page.findMany({
        where: { skriptId: page.skriptId },
        orderBy: { order: 'asc' },
        select: { id: true },
      })
      for (let i = 0; i < remainingPages.length; i++) {
        await tx.page.update({
          where: { id: remainingPages[i].id },
          data: { order: i },
        })
      }
    })

    // Revalidate paths
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { pageSlug: true },
    })

    if (user?.pageSlug) {
      revalidatePath(`/${user.pageSlug}`)
      revalidatePath('/dashboard')
    }

    return NextResponse.json({
      success: true,
      targetSkriptSlug: targetSkript.slug,
      pageSlug: finalSlug,
    })
  } catch (error) {
    console.error('Error moving page:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
