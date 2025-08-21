import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { saveFile, listFiles } from '@/lib/file-storage'

export async function POST(request: NextRequest) {
  console.log('[UPLOAD] Starting file upload request')
  try {
    const session = await getServerSession(authOptions)
    console.log('[UPLOAD] Session check:', { hasSession: !!session, userId: session?.user?.id })
    if (!session?.user?.id) {
      console.log('[UPLOAD] Unauthorized - no session or user ID')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    console.log('[UPLOAD] Parsing form data...')
    const formData = await request.formData()
    const file = formData.get('file') as File
    const chapterId = formData.get('chapterId') as string
    const parentId = formData.get('parentId') as string | null
    const overwrite = formData.get('overwrite') === 'true'

    console.log('[UPLOAD] Form data parsed:', {
      hasFile: !!file,
      fileName: file?.name,
      fileSize: file?.size,
      fileType: file?.type,
      chapterId,
      parentId,
      overwrite
    })

    if (!file) {
      console.log('[UPLOAD] Error: No file provided in form data')
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    if (!chapterId) {
      console.log('[UPLOAD] Error: No chapter ID provided')
      return NextResponse.json({ error: 'Chapter ID is required for file upload' }, { status: 400 })
    }

    // Verify chapter ownership
    console.log('[UPLOAD] Checking chapter ownership for chapterId:', chapterId)
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
    console.log('[UPLOAD] Chapter ownership check result:', { hasChapter: !!chapter })

    if (!chapter) {
      console.log('[UPLOAD] Error: Chapter not found or access denied')
      return NextResponse.json({ error: 'Chapter not found or access denied' }, { status: 403 })
    }

    // Convert file to buffer
    console.log('[UPLOAD] Converting file to buffer...')
    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)
    console.log('[UPLOAD] File converted to buffer:', { bufferLength: buffer.length })

    // Save file using new file storage system
    console.log('[UPLOAD] Calling saveFile with params:', {
      bufferLength: buffer.length,
      filename: file.name,
      chapterId,
      userId: session.user.id,
      parentId: parentId || null,
      contentType: file.type,
      overwrite
    })
    const savedFile = await saveFile({
      buffer,
      filename: file.name,
      chapterId,
      userId: session.user.id,
      parentId: parentId || null,
      contentType: file.type,
      overwrite
    })
    console.log('[UPLOAD] File saved successfully:', savedFile)

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

    console.log('[UPLOAD] Returning file info:', fileInfo)
    return NextResponse.json(fileInfo)
  } catch (error) {
    console.error('[UPLOAD] File upload error:', error)
    console.error('[UPLOAD] Error stack:', error instanceof Error ? error.stack : 'No stack trace')
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Upload failed' },
      { status: 500 }
    )
  }
}

// Get files for a chapter
export async function GET(request: NextRequest) {
  console.log('[UPLOAD_GET] Starting file list request')
  try {
    const session = await getServerSession(authOptions)
    console.log('[UPLOAD_GET] Session check:', { hasSession: !!session, userId: session?.user?.id })
    if (!session?.user?.id) {
      console.log('[UPLOAD_GET] Unauthorized - no session or user ID')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const chapterId = searchParams.get('chapterId')
    const parentId = searchParams.get('parentId') // null for root directory
    console.log('[UPLOAD_GET] Request params:', { chapterId, parentId })

    if (!chapterId) {
      console.log('[UPLOAD_GET] Error: No chapter ID provided')
      return NextResponse.json({ error: 'Chapter ID is required for file listing' }, { status: 400 })
    }

    // List files using new file storage system
    console.log('[UPLOAD_GET] Calling listFiles...')
    const files = await listFiles({
      chapterId,
      parentId: parentId || null,
      userId: session.user.id
    })
    console.log('[UPLOAD_GET] Files retrieved:', { count: files.length, files: files.map(f => ({ id: f.id, name: f.name, isDirectory: f.isDirectory })) })

    return NextResponse.json({ files })
  } catch (error) {
    console.error('[UPLOAD_GET] File listing error:', error)
    console.error('[UPLOAD_GET] Error stack:', error instanceof Error ? error.stack : 'No stack trace')
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to list files' },
      { status: 500 }
    )
  }
}
