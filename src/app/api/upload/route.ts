import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { writeFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import crypto from 'crypto'

const UPLOAD_DIR = process.env.UPLOAD_DIR || './public/uploads'
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE || '10485760') // 10MB
const ALLOWED_TYPES = (process.env.ALLOWED_FILE_TYPES || 'jpg,jpeg,png,gif,webp,svg,pdf,doc,docx,txt,md,zip,mp4,mp3,wav').split(',')

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const formData = await request.formData()
    const file = formData.get('file') as File
    const chapterId = formData.get('chapterId') as string
    const uploadType = formData.get('uploadType') as 'chapter' | 'global' // 'chapter' or 'global'

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ 
        error: `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB` 
      }, { status: 400 })
    }

    // Validate file type
    const fileExtension = file.name.split('.').pop()?.toLowerCase()
    if (!fileExtension || !ALLOWED_TYPES.includes(fileExtension)) {
      return NextResponse.json({ 
        error: `File type not allowed. Allowed types: ${ALLOWED_TYPES.join(', ')}` 
      }, { status: 400 })
    }

    // Get user info
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { subdomain: true }
    })

    if (!user?.subdomain) {
      return NextResponse.json({ error: 'User subdomain not found' }, { status: 400 })
    }

    let uploadPath: string
    let relativePath: string

    if (uploadType === 'global') {
      // Global upload directory: /uploads/{subdomain}/global/
      uploadPath = path.join(UPLOAD_DIR, user.subdomain, 'global')
      relativePath = `/uploads/${user.subdomain}/global`
    } else {
      // Chapter-specific upload: verify chapter ownership
      const chapter = await prisma.chapter.findFirst({
        where: {
          id: chapterId,
          authorId: session.user.id
        }
      })

      if (!chapter) {
        return NextResponse.json({ error: 'Chapter not found or access denied' }, { status: 403 })
      }

      // Chapter upload directory: /uploads/{subdomain}/chapters/{chapterId}/
      uploadPath = path.join(UPLOAD_DIR, user.subdomain, 'chapters', chapterId)
      relativePath = `/uploads/${user.subdomain}/chapters/${chapterId}`
    }

    // Create directory if it doesn't exist
    if (!existsSync(uploadPath)) {
      await mkdir(uploadPath, { recursive: true })
    }

    // Generate unique filename to prevent conflicts
    const timestamp = Date.now()
    const randomString = crypto.randomBytes(6).toString('hex')
    const sanitizedName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_')
    const uniqueFilename = `${timestamp}_${randomString}_${sanitizedName}`

    // Save file
    const fullPath = path.join(uploadPath, uniqueFilename)
    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)
    
    await writeFile(fullPath, buffer)

    // Return file info
    const fileInfo = {
      filename: uniqueFilename,
      originalName: file.name,
      size: file.size,
      type: file.type,
      extension: fileExtension,
      url: `${relativePath}/${uniqueFilename}`,
      uploadType,
      chapterId: uploadType === 'chapter' ? chapterId : null,
      uploadedAt: new Date().toISOString()
    }

    return NextResponse.json(fileInfo)
  } catch (error) {
    console.error('File upload error:', error)
    return NextResponse.json(
      { error: 'Upload failed' },
      { status: 500 }
    )
  }
}

// Get files for a teacher (global + chapter specific)
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const chapterId = searchParams.get('chapterId')

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { subdomain: true }
    })

    if (!user?.subdomain) {
      return NextResponse.json({ error: 'User subdomain not found' }, { status: 400 })
    }

    const files = await getDirectoryFiles(user.subdomain, chapterId)
    
    return NextResponse.json({ files })
  } catch (error) {
    console.error('File listing error:', error)
    return NextResponse.json(
      { error: 'Failed to list files' },
      { status: 500 }
    )
  }
}

async function getDirectoryFiles(subdomain: string, chapterId?: string | null) {
  const { readdir, stat } = await import('fs/promises')
  const files: {
    filename: string
    size: number
    url: string
    uploadType: string
    uploadedAt: string
    isDirectory: boolean
    chapterId?: string
  }[] = []

  // Get global files
  const globalPath = path.join(UPLOAD_DIR, subdomain, 'global')
  if (existsSync(globalPath)) {
    try {
      const globalFiles = await readdir(globalPath)
      for (const filename of globalFiles) {
        const filePath = path.join(globalPath, filename)
        const stats = await stat(filePath)
        files.push({
          filename,
          size: stats.size,
          url: `/uploads/${subdomain}/global/${filename}`,
          uploadType: 'global',
          uploadedAt: stats.birthtime.toISOString(),
          isDirectory: false
        })
      }
    } catch {
      // Directory doesn't exist or is empty
    }
  }

  // Get chapter-specific files if chapterId provided
  if (chapterId) {
    const chapterPath = path.join(UPLOAD_DIR, subdomain, 'chapters', chapterId)
    if (existsSync(chapterPath)) {
      try {
        const chapterFiles = await readdir(chapterPath)
        for (const filename of chapterFiles) {
          const filePath = path.join(chapterPath, filename)
          const stats = await stat(filePath)
          files.push({
            filename,
            size: stats.size,
            url: `/uploads/${subdomain}/chapters/${chapterId}/${filename}`,
            uploadType: 'chapter',
            chapterId,
            uploadedAt: stats.birthtime.toISOString(),
            isDirectory: false
          })
        }
      } catch {
        // Directory doesn't exist or is empty
      }
    }
  }

  return files.sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime())
}
