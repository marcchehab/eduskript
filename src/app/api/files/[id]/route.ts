import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getFileById, getFileExtension, getS3Key, sanitizeFilename } from '@/lib/file-storage'
import { prisma } from '@/lib/prisma'
import { getTeacherFileUrl } from '@/lib/s3'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    const { searchParams } = new URL(request.url)
    const proxyContent = searchParams.get('proxy') === 'true'

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
    // If no session, try to get file for public access (will check if skript is published)
    const file = await getFileById(fileId, session?.user?.id)
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

      // Get S3 URL for the SVG file
      const extension = getFileExtension(svgFile.name)!
      const s3Key = getS3Key(svgFile.hash, extension)
      const s3Url = getTeacherFileUrl(s3Key)

      // Redirect to S3 URL (public bucket, so direct access works)
      return NextResponse.redirect(s3Url, {
        status: 302,
        headers: {
          'Cache-Control': 'public, max-age=31536000, immutable',
        }
      })
    }

    // Directories can't be served directly
    if (!file.s3Url) {
      return NextResponse.json({ error: 'Cannot serve directory' }, { status: 400 })
    }

    // If proxy mode is requested, fetch content from S3 and return it directly
    // This is useful for avoiding CORS issues when fetching from client-side JS
    if (proxyContent) {
      try {
        const s3Response = await fetch(file.s3Url)
        if (!s3Response.ok) {
          return NextResponse.json({ error: 'Failed to fetch from storage' }, { status: 502 })
        }

        const contentType = file.contentType || s3Response.headers.get('content-type') || 'application/octet-stream'
        const body = await s3Response.arrayBuffer()

        return new NextResponse(body, {
          status: 200,
          headers: {
            'Content-Type': contentType,
            'Cache-Control': 'public, max-age=31536000, immutable',
          }
        })
      } catch (fetchError) {
        console.error('Failed to proxy file from S3:', fetchError)
        return NextResponse.json({ error: 'Storage fetch failed' }, { status: 502 })
      }
    }

    // Redirect to S3 URL (public bucket, so direct access works)
    // This is more efficient than proxying the file through the server
    return NextResponse.redirect(file.s3Url, {
      status: 302,
      headers: {
        'Cache-Control': 'public, max-age=31536000, immutable',
      }
    })
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

    // Sanitize filename to prevent path traversal and other attacks
    const sanitizedFilename = sanitizeFilename(newFilename.trim())

    // Ensure sanitization didn't result in an empty or generic filename
    if (sanitizedFilename === 'unnamed_file' && newFilename.trim() !== 'unnamed_file') {
      return NextResponse.json({ error: 'Invalid filename - contains only invalid characters' }, { status: 400 })
    }

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
        name: sanitizedFilename,
        skriptId: fileRecord.skriptId,
        parentId: fileRecord.parentId,
        id: { not: fileId } // Exclude the current file
      }
    })

    if (existingFile) {
      return NextResponse.json({
        error: `A file named "${sanitizedFilename}" already exists in this location`
      }, { status: 409 })
    }

    // Update the file name in the database
    const updatedFile = await prisma.file.update({
      where: { id: fileId },
      data: {
        name: sanitizedFilename,
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