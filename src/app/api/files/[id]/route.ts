import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getFileById } from '@/lib/file-storage'
import { prisma } from '@/lib/prisma'
import * as fs from 'fs/promises'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    let { id: fileId } = await params

    // Check if this is requesting an Excalidraw SVG variant
    let svgVariant: 'light' | 'dark' | null = null
    if (fileId.endsWith('.light.svg')) {
      svgVariant = 'light'
      fileId = fileId.replace('.light.svg', '')
    } else if (fileId.endsWith('.dark.svg')) {
      svgVariant = 'dark'
      fileId = fileId.replace('.dark.svg', '')
    }

    // Get file info with permission check
    const file = await getFileById(fileId, session.user.id)
    if (!file) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }

    // If requesting an SVG variant, find the corresponding SVG file
    if (svgVariant) {
      const svgFileName = `${file.name}.${svgVariant}.svg`

      const svgFile = await prisma.file.findFirst({
        where: {
          name: svgFileName,
          skriptId: file.skriptId,
          parentId: file.parentId
        }
      })

      if (!svgFile || !svgFile.hash) {
        return NextResponse.json({ error: 'SVG variant not found' }, { status: 404 })
      }

      // Construct physical path from hash (same logic as in file-storage.ts)
      const { getPhysicalPath, getFileExtension } = await import('@/lib/file-storage')
      const extension = getFileExtension(svgFile.name)!
      const physicalPath = getPhysicalPath(svgFile.hash, extension)

      // Read and serve the SVG file
      const svgBuffer = await fs.readFile(physicalPath)
      return new NextResponse(svgBuffer, {
        status: 200,
        headers: {
          'Content-Type': 'image/svg+xml',
          'Content-Length': svgBuffer.length.toString(),
          'Content-Disposition': `inline; filename="${encodeURIComponent(svgFile.name)}"`,
          'Cache-Control': 'public, max-age=31536000, immutable',
          'ETag': `"${svgFile.hash}"`
        }
      })
    }

    // Directories can't be served directly
    if (!file.physicalPath) {
      return NextResponse.json({ error: 'Cannot serve directory' }, { status: 400 })
    }

    // Read file from disk
    let fileBuffer: Buffer
    try {
      fileBuffer = await fs.readFile(file.physicalPath)
    } catch (error) {
      console.error('Failed to read physical file:', file.physicalPath, error)
      return NextResponse.json({ error: 'File not found on disk' }, { status: 404 })
    }

    // Determine content type
    const contentType = file.contentType || 'application/octet-stream'

    // Create response with appropriate headers
    const response = new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': fileBuffer.length.toString(),
        'Content-Disposition': `inline; filename="${encodeURIComponent(file.name)}"`,
        'Cache-Control': 'public, max-age=31536000, immutable', // Cache for 1 year since content-addressed
        'ETag': `"${file.hash}"` // Use hash as ETag for efficient caching
      }
    })

    return response
  } catch (error) {
    console.error('File serving error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to serve file' },
      { status: 500 }
    )
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

    const { id: fileId } = await params

    // Import deleteFile function dynamically to avoid circular imports
    const { deleteFile } = await import('@/lib/file-storage')
    
    await deleteFile(fileId, session.user.id)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('File deletion error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete file' },
      { status: 500 }
    )
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

    const { id: fileId } = await params
    const body = await request.json()
    const { newFilename } = body

    if (!newFilename || typeof newFilename !== 'string' || !newFilename.trim()) {
      return NextResponse.json({ error: 'New filename is required' }, { status: 400 })
    }

    const trimmedFilename = newFilename.trim()

    // Get file info with permission check
    const file = await getFileById(fileId, session.user.id)
    if (!file) {
      return NextResponse.json({ error: 'File not found or permission denied' }, { status: 404 })
    }

    // Get the file's skript info for permission verification and conflict checking
    const fileRecord = await prisma.file.findUnique({
      where: { id: fileId },
      include: {
        skript: {
          include: {
            authors: true
          }
        }
      }
    })

    if (!fileRecord) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }

    // Double-check permissions (redundant but safer)
    const hasPermission = fileRecord.skript.authors.some(author => author.userId === session.user.id)
    if (!hasPermission) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 })
    }

    // Check if a file with the new name already exists in the same skript/parent directory
    const existingFile = await prisma.file.findFirst({
      where: {
        name: trimmedFilename,
        skriptId: fileRecord.skriptId,
        parentId: fileRecord.parentId,
        id: { not: fileId } // Exclude the current file
      }
    })

    if (existingFile) {
      return NextResponse.json({ 
        error: `A file named "${trimmedFilename}" already exists in this location` 
      }, { status: 409 })
    }

    // Update the file name in the database
    const updatedFile = await prisma.file.update({
      where: { id: fileId },
      data: {
        name: trimmedFilename,
        updatedAt: new Date()
      }
    })

    return NextResponse.json({
      success: true,
      file: {
        id: updatedFile.id,
        name: updatedFile.name,
        oldName: fileRecord.name,
        updatedAt: updatedFile.updatedAt
      }
    })

  } catch (error) {
    console.error('File rename error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to rename file' },
      { status: 500 }
    )
  }
}