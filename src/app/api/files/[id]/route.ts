import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getFileById } from '@/lib/file-storage'
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

    const { id: fileId } = await params

    // Get file info with permission check
    const file = await getFileById(fileId, session.user.id)
    if (!file) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
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