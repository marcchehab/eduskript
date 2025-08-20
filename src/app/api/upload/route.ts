import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { saveFile, listFiles } from '@/lib/file-storage'

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const formData = await request.formData()
    const file = formData.get('file') as File
    const chapterId = formData.get('chapterId') as string
    const parentId = formData.get('parentId') as string | null
    const overwrite = formData.get('overwrite') === 'true'

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    if (!chapterId) {
      return NextResponse.json({ error: 'Chapter ID is required for file upload' }, { status: 400 })
    }

    // Verify chapter ownership
    const chapter = await prisma.chapter.findFirst({
      where: {
        id: chapterId,
        authors: {
          some: {
            userId: session.user.id
          }
        }
      }
    })

    if (!chapter) {
      return NextResponse.json({ error: 'Chapter not found or access denied' }, { status: 403 })
    }

    // Convert file to buffer
    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)

    // Save file using new file storage system
    const savedFile = await saveFile({
      buffer,
      filename: file.name,
      chapterId,
      userId: session.user.id,
      parentId: parentId || null,
      contentType: file.type,
      overwrite
    })

    // Return file info
    const fileInfo = {
      id: savedFile.id,
      filename: file.name,
      originalName: file.name,
      size: savedFile.size,
      type: file.type,
      hash: savedFile.hash,
      url: savedFile.url,
      uploadType: 'chapter',
      chapterId: chapterId,
      parentId: parentId || null,
      uploadedAt: new Date().toISOString()
    }

    return NextResponse.json(fileInfo)
  } catch (error) {
    console.error('File upload error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Upload failed' },
      { status: 500 }
    )
  }
}

// Get files for a chapter
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const chapterId = searchParams.get('chapterId')
    const parentId = searchParams.get('parentId') // null for root directory

    if (!chapterId) {
      return NextResponse.json({ error: 'Chapter ID is required for file listing' }, { status: 400 })
    }

    // List files using new file storage system
    const files = await listFiles({
      chapterId,
      parentId: parentId || null,
      userId: session.user.id
    })

    return NextResponse.json({ files })
  } catch (error) {
    console.error('File listing error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to list files' },
      { status: 500 }
    )
  }
}
