import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { revalidateTag } from 'next/cache'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { CACHE_TAGS } from '@/lib/cached-queries'
import { saveFile, getS3Key, getFileExtension } from '@/lib/file-storage'
import { downloadTeacherFile } from '@/lib/s3'

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    // `originalName` is the filename the drawing was loaded as. Editing the
    // same drawing keeps `name === originalName` and overwrites freely.
    // Renaming or creating a new drawing → `name !== originalName`, and we
    // refuse to overwrite an existing file (returns 409 below).
    const { name, excalidrawData, lightSvg, darkSvg, skriptId, originalName } = body

    if (!name || !excalidrawData || !lightSvg || !darkSvg || !skriptId) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // Verify skript ownership (super admins can edit all skripts)
    const skript = await prisma.skript.findFirst({
      where: {
        id: skriptId,
        ...(session.user.isAdmin ? {} : {
          authors: {
            some: {
              userId: session.user.id
            }
          }
        })
      }
    })

    if (!skript) {
      return NextResponse.json({ error: 'Skript not found or access denied' }, { status: 403 })
    }

    // Ensure name doesn't already include .excalidraw extension
    const baseName = name.replace(/\.excalidraw$/, '')
    const originalBaseName = typeof originalName === 'string'
      ? originalName.replace(/\.excalidraw$/, '')
      : null

    // Reject if the chosen filename collides with an existing file in this
    // skript (unless we're re-saving the same drawing under its current name).
    if (baseName !== originalBaseName) {
      const existing = await prisma.file.findFirst({
        where: { skriptId, name: `${baseName}.excalidraw` },
        select: { id: true }
      })
      if (existing) {
        return NextResponse.json(
          { error: `A drawing named "${baseName}" already exists. Please choose a different name.` },
          { status: 409 }
        )
      }
    }

    // Extract dimensions from SVG markup to prevent layout shift on load
    const parseSvgDimensions = (svg: string): { width?: number; height?: number } => {
      const widthMatch = svg.match(/<svg[^>]*\bwidth="(\d+(?:\.\d+)?)/)
      const heightMatch = svg.match(/<svg[^>]*\bheight="(\d+(?:\.\d+)?)/)
      const w = widthMatch ? Math.round(parseFloat(widthMatch[1])) : undefined
      const h = heightMatch ? Math.round(parseFloat(heightMatch[1])) : undefined
      return { width: w, height: h }
    }
    const lightDims = parseSvgDimensions(lightSvg)
    const darkDims = parseSvgDimensions(darkSvg)

    // Save the three files: .excalidraw (JSON), .excalidraw.light.svg, .excalidraw.dark.svg
    const [jsonFile, lightSvgFile, darkSvgFile] = await Promise.all([
      // Save Excalidraw JSON data
      saveFile({
        buffer: Buffer.from(excalidrawData),
        filename: `${baseName}.excalidraw`,
        skriptId,
        userId: session.user.id,
        parentId: null,
        contentType: 'application/json',
        overwrite: true // Allow overwriting for editing
      }),
      // Save light theme SVG (with dimensions for layout stability)
      saveFile({
        buffer: Buffer.from(lightSvg),
        filename: `${baseName}.excalidraw.light.svg`,
        skriptId,
        userId: session.user.id,
        parentId: null,
        contentType: 'image/svg+xml',
        overwrite: true,
        width: lightDims.width,
        height: lightDims.height,
      }),
      // Save dark theme SVG (with dimensions for layout stability)
      saveFile({
        buffer: Buffer.from(darkSvg),
        filename: `${baseName}.excalidraw.dark.svg`,
        skriptId,
        userId: session.user.id,
        parentId: null,
        contentType: 'image/svg+xml',
        overwrite: true,
        width: darkDims.width,
        height: darkDims.height,
      })
    ])

    // Invalidate ISR cache for every page that references this drawing.
    // Pages reference Excalidraw files by basename — `.excalidraw`,
    // `.excalidraw.light.svg`, and `.excalidraw.dark.svg` all begin with
    // `${baseName}.excalidraw`, so a single substring check catches every form.
    const fileRef = `${baseName}.excalidraw`
    const candidatePages = await prisma.page.findMany({
      where: { skriptId },
      select: { slug: true, content: true }
    })
    const editor = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { pageSlug: true }
    })
    if (editor?.pageSlug) {
      for (const page of candidatePages) {
        if (page.content.includes(fileRef)) {
          revalidateTag(
            CACHE_TAGS.pageBySlug(editor.pageSlug, skript.slug, page.slug),
            { expire: 0 }
          )
        }
      }
    }

    return NextResponse.json({
      success: true,
      files: {
        json: jsonFile,
        lightSvg: lightSvgFile,
        darkSvg: darkSvgFile
      }
    })
  } catch (error) {
    console.error('[EXCALIDRAW] Error saving drawing:', error)
    console.error('[EXCALIDRAW] Error stack:', error instanceof Error ? error.stack : 'No stack trace')
    console.error('[EXCALIDRAW] Error message:', error instanceof Error ? error.message : String(error))
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to save drawing' },
      { status: 500 }
    )
  }
}

// GET endpoint to fetch Excalidraw data for editing
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const fileId = searchParams.get('fileId')
    const skriptId = searchParams.get('skriptId')

    if (!fileId || !skriptId) {
      return NextResponse.json({ error: 'Missing fileId or skriptId' }, { status: 400 })
    }

    // Verify access to the file (super admins can access all skripts)
    const file = await prisma.file.findFirst({
      where: {
        id: fileId,
        skriptId: skriptId,
        ...(session.user.isAdmin ? {} : {
          skript: {
            authors: {
              some: {
                userId: session.user.id
              }
            }
          }
        })
      }
    })

    if (!file) {
      return NextResponse.json({ error: 'File not found or access denied' }, { status: 403 })
    }

    if (!file.hash) {
      return NextResponse.json({ error: 'File has no content hash' }, { status: 500 })
    }

    // Download from S3 using the content-addressed storage
    const extension = getFileExtension(file.name)
    if (!extension) {
      return NextResponse.json({ error: 'File has no extension' }, { status: 500 })
    }

    const s3Key = getS3Key(file.hash, extension)
    const fileBuffer = await downloadTeacherFile(s3Key)
    const fileContent = fileBuffer.toString('utf-8')

    // Parse the Excalidraw data
    // Handle both pure JSON and Obsidian Excalidraw format (markdown with embedded JSON)
    let excalidrawData
    try {
      excalidrawData = JSON.parse(fileContent)
    } catch {
      // Try extracting from Obsidian Excalidraw format: ```json { ... } ```
      const jsonMatch = fileContent.match(/```json\s*([\s\S]*?)\s*```/)
      if (jsonMatch) {
        excalidrawData = JSON.parse(jsonMatch[1])
      } else {
        throw new Error('Could not parse Excalidraw data')
      }
    }

    return NextResponse.json({
      success: true,
      name: file.name.replace('.excalidraw', ''),
      data: excalidrawData
    })
  } catch (error) {
    console.error('[EXCALIDRAW] Error fetching drawing:', error)
    return NextResponse.json(
      { error: 'Failed to fetch drawing' },
      { status: 500 }
    )
  }
}
