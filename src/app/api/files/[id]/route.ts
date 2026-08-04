import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getFileById, sanitizeFilename } from '@/lib/file-storage'
import { prisma } from '@/lib/prisma'
import { invalidateSkriptFiles } from '@/lib/skript-files.server'

function getPlaceholderUrl(request: NextRequest): string {
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || 'localhost'
  const proto = request.headers.get('x-forwarded-proto') || 'https'
  return `${proto}://${host}/no-image.svg`
}

/**
 * Thin redirect to S3 for backward compatibility.
 * All consumers should use direct S3 URLs; this exists only for
 * any hardcoded /api/files/{id} links that may still be in the wild.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    const { id: fileId } = await params

    const file = await getFileById(fileId, session?.user?.id)
    if (!file?.s3Url) {
      const placeholderUrl = getPlaceholderUrl(request)
      return NextResponse.redirect(placeholderUrl, { status: 302 })
    }

    return NextResponse.redirect(file.s3Url, {
      status: 302,
      headers: {
        'Cache-Control': 'public, max-age=31536000, immutable',
      }
    })
  } catch {
    const placeholderUrl = getPlaceholderUrl(request)
    return NextResponse.redirect(placeholderUrl, { status: 302 })
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

    // Renaming changes the key markdown looks the file up by.
    invalidateSkriptFiles(fileRecord.skriptId)

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
