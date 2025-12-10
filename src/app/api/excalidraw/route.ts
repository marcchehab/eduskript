import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { saveFile } from '@/lib/file-storage'

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { name, excalidrawData, lightSvg, darkSvg, skriptId } = body

    if (!name || !excalidrawData || !lightSvg || !darkSvg || !skriptId) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // Verify skript ownership
    const skript = await prisma.skript.findFirst({
      where: {
        id: skriptId,
        authors: {
          some: {
            userId: session.user.id
          }
        }
      }
    })

    if (!skript) {
      return NextResponse.json({ error: 'Skript not found or access denied' }, { status: 403 })
    }

    // Ensure name doesn't already include .excalidraw extension
    const baseName = name.replace(/\.excalidraw$/, '')

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
      // Save light theme SVG
      saveFile({
        buffer: Buffer.from(lightSvg),
        filename: `${baseName}.excalidraw.light.svg`,
        skriptId,
        userId: session.user.id,
        parentId: null,
        contentType: 'image/svg+xml',
        overwrite: true
      }),
      // Save dark theme SVG
      saveFile({
        buffer: Buffer.from(darkSvg),
        filename: `${baseName}.excalidraw.dark.svg`,
        skriptId,
        userId: session.user.id,
        parentId: null,
        contentType: 'image/svg+xml',
        overwrite: true
      })
    ])

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

    // Verify access to the file
    const file = await prisma.file.findFirst({
      where: {
        id: fileId,
        skriptId: skriptId,
        skript: {
          authors: {
            some: {
              userId: session.user.id
            }
          }
        }
      }
    })

    if (!file) {
      return NextResponse.json({ error: 'File not found or access denied' }, { status: 403 })
    }

    // Read the file content from disk
    const { readFile } = await import('fs/promises')
    const { join } = await import('path')

    const filePath = join(process.cwd(), 'uploads', 'skripts', skriptId, file.name)
    const fileContent = await readFile(filePath, 'utf-8')

    // Parse the Excalidraw JSON
    const excalidrawData = JSON.parse(fileContent)

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
