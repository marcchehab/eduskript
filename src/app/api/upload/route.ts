import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { saveFile, MAX_FILE_SIZE, validateFile, sanitizeFilename, getFileExtension, getS3Key } from '@/lib/file-storage'
import { getTeacherFileUrl } from '@/lib/s3'
import sharp from 'sharp'

// Increase function timeout for large uploads
export const maxDuration = 120 // 2 minutes

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const formData = await request.formData()
    const file = formData.get('file') as File
    const skriptId = formData.get('skriptId') as string
    const parentId = formData.get('parentId') as string | null
    const overwrite = formData.get('overwrite') === 'true'

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    if (!skriptId) {
      return NextResponse.json({ error: 'Skript ID is required for file upload' }, { status: 400 })
    }

    // Pre-validate file size BEFORE loading into memory (prevents DoS)
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File too large. Maximum size is ${MAX_FILE_SIZE / 1048576}MB` },
        { status: 400 }
      )
    }

    // Sanitize and validate filename
    const sanitizedFilename = sanitizeFilename(file.name)
    const validation = validateFile(sanitizedFilename, file.size)
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 })
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

    // Convert file to buffer (after validation to prevent memory exhaustion)
    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)

    // Extract image dimensions if this is an image file
    let imageWidth: number | undefined
    let imageHeight: number | undefined
    if (file.type === 'image/svg+xml') {
      // SVGs: parse width/height or viewBox from XML (sharp doesn't handle SVGs)
      try {
        const svgStr = buffer.toString('utf-8').slice(0, 2000)
        const wMatch = svgStr.match(/\bwidth=["']([.\d]+)/)
        const hMatch = svgStr.match(/\bheight=["']([.\d]+)/)
        if (wMatch && hMatch) {
          imageWidth = Math.round(parseFloat(wMatch[1]))
          imageHeight = Math.round(parseFloat(hMatch[1]))
        } else {
          const viewBox = svgStr.match(/viewBox=["']([^"']+)["']/)
          if (viewBox) {
            const parts = viewBox[1].split(/[\s,]+/)
            imageWidth = Math.round(parseFloat(parts[2]))
            imageHeight = Math.round(parseFloat(parts[3]))
          }
        }
      } catch {
        // Non-fatal: dimensions are optional
      }
    } else if (file.type.startsWith('image/')) {
      try {
        const metadata = await sharp(buffer).metadata()
        if (metadata.width && metadata.height) {
          imageWidth = metadata.width
          imageHeight = metadata.height
        }
      } catch {
        // Non-fatal: dimensions are optional, proceed without them
      }
    }

    // Save file using new file storage system (with sanitized filename)
    const savedFile = await saveFile({
      buffer,
      filename: sanitizedFilename,
      skriptId,
      userId: session.user.id,
      parentId: parentId || null,
      contentType: file.type,
      overwrite,
      width: imageWidth,
      height: imageHeight,
    })

    // Return file info
    const fileInfo = {
      id: savedFile.id,
      name: sanitizedFilename, // Sanitized filename for storage
      filename: sanitizedFilename,
      originalName: file.name, // Keep original for reference
      size: savedFile.size,
      type: file.type,
      hash: savedFile.hash,
      url: savedFile.url,
      uploadType: 'skript',
      skriptId: skriptId,
      parentId: parentId || null,
      uploadedAt: new Date().toISOString()
    }

    return NextResponse.json(fileInfo)
  } catch (error) {
    console.error('File upload error:', error instanceof Error ? error.message : error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Upload failed' },
      { status: 500 }
    )
  }
}

// Get files for a skript
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    const userId = session?.user?.id

    const { searchParams } = new URL(request.url)
    const skriptId = searchParams.get('skriptId')
    const parentId = searchParams.get('parentId') // null for root directory
    const recursive = searchParams.get('recursive') === 'true' // optional flag for recursive listing

    if (!skriptId) {
      return NextResponse.json({ error: 'Skript ID is required for file listing' }, { status: 400 })
    }

    // Check if user has access: either they're an author OR the skript has published content
    const skript = await prisma.skript.findUnique({
      where: { id: skriptId },
      include: {
        authors: true,
        pages: {
          select: { isPublished: true }
        },
        // Include FrontPages that use this skript for file storage
        frontPageFileStorage: {
          select: { isPublished: true }
        }
      }
    })

    if (!skript) {
      return NextResponse.json({ error: 'Skript not found' }, { status: 404 })
    }

    const isAuthor = userId && skript.authors.some(a => a.userId === userId)
    const hasPublishedPage = skript.pages.some(p => p.isPublished)
    const hasPublishedFrontPage = skript.frontPageFileStorage?.isPublished ?? false
    const hasPublicAccess = hasPublishedPage || hasPublishedFrontPage

    // Allow access if user is author OR skript has published content (pages or FrontPages)
    if (!isAuthor && !hasPublicAccess) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get all files for this skript (public access needs all files for image resolution)
    const files = await prisma.file.findMany({
      where: { skriptId },
      orderBy: [
        { isDirectory: 'desc' },
        { name: 'asc' }
      ]
    })

    const mappedFiles = files.map(file => {
      // Compute direct S3 URL from hash (no proxy needed, bucket is public)
      let url: string | undefined
      if (!file.isDirectory && file.hash) {
        const ext = getFileExtension(file.name)
        if (ext) {
          url = getTeacherFileUrl(getS3Key(file.hash, ext))
        }
      }

      return {
        id: file.id,
        name: file.name,
        isDirectory: file.isDirectory,
        size: file.size ? Number(file.size) : undefined,
        contentType: file.contentType || undefined,
        width: file.width ?? undefined,
        height: file.height ?? undefined,
        createdAt: file.createdAt,
        updatedAt: file.updatedAt,
        url,
      }
    })

    // Also fetch all videos (they're global, not per-skript)
    const videos = await prisma.video.findMany({
      select: {
        id: true,
        filename: true,
        provider: true,
        metadata: true,
      },
    })

    const mappedVideos = videos.map(video => {
      const metadata = video.metadata as Record<string, unknown>
      return {
        id: video.id,
        filename: video.filename,
        provider: video.provider,
        metadata: {
          playbackId: metadata?.playbackId as string | undefined,
          poster: metadata?.poster as string | undefined,
          blurDataURL: metadata?.blurDataURL as string | undefined,
          aspectRatio: typeof metadata?.aspectRatio === 'number' ? metadata.aspectRatio : undefined,
          status: (metadata?.status as string | undefined) ?? 'ready',
        },
      }
    })

    return NextResponse.json({ files: mappedFiles, videos: mappedVideos })
  } catch (error) {
    console.error('File listing error:', error instanceof Error ? error.message : error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to list files' },
      { status: 500 }
    )
  }
}
