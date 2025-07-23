import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getS3Client } from '@/lib/utils'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { ListObjectsV2Command } from '@aws-sdk/client-s3'
import { HeadObjectCommand } from '@aws-sdk/client-s3'

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
    const overwrite = formData.get('overwrite') === 'true'

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) { // 10MB
      return NextResponse.json({ 
        error: `File too large. Maximum size is ${MAX_FILE_SIZE / 1048576}MB` 
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

    // In POST handler, require chapterId and only allow uploadType 'chapter'
    if (!chapterId) {
      return NextResponse.json({ error: 'Chapter ID is required for file upload' }, { status: 400 })
    }

    // Verify chapter ownership
    const chapter = await prisma.chapter.findFirst({
      where: {
        id: chapterId,
        authorId: session.user.id
      }
    })

    if (!chapter) {
      return NextResponse.json({ error: 'Chapter not found or access denied' }, { status: 403 })
    }

    // Chapter upload directory: uploads/{subdomain}/chapters/{chapterId}/
    const s3KeyPrefix = `${user.subdomain}/chapters/${chapterId}`
    const bucket = process.env.CELLAR_ADDON_BUCKET!
    const s3 = getS3Client()
    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)

    const s3Key = `${s3KeyPrefix}/${file.name}`

    // Check if file already exists if not overwriting
    if (!overwrite) {
      try {
        await s3.send(new HeadObjectCommand({
          Bucket: bucket,
          Key: s3Key
        }))
        // File exists and we're not overwriting
        return NextResponse.json({ 
          error: 'File already exists. Use overwrite option or rename the file.' 
        }, { status: 409 })
      } catch {
        // File doesn't exist, which is what we want for new uploads
      }
    }

    // Upload to S3/Cellar
    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: s3Key, // Use original filename as S3 key
      Body: buffer,
      ContentType: file.type,
      ACL: 'public-read',
    }))

    // Construct S3 URL (Cellar public URL format)
    const s3Url = `https://${bucket}.${process.env.CELLAR_ADDON_HOST}/${s3Key}`

    // Return file info
    const fileInfo = {
      filename: file.name,
      originalName: file.name,
      size: file.size,
      type: file.type,
      extension: fileExtension,
      url: s3Url,
      uploadType,
      chapterId: chapterId,
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

    // In GET handler, require chapterId and only list chapter files
    if (!chapterId) {
      return NextResponse.json({ error: 'Chapter ID is required for file listing' }, { status: 400 })
    }

    // Verify chapter ownership
    const chapter = await prisma.chapter.findFirst({
      where: {
        id: chapterId,
        authorId: session.user.id
      }
    })

    if (!chapter) {
      return NextResponse.json({ error: 'Chapter not found or access denied' }, { status: 403 })
    }

    const bucket = process.env.CELLAR_ADDON_BUCKET!
    const s3 = getS3Client()
    const prefix = `${user.subdomain}/chapters/${chapterId}/`

    // List objects in S3/Cellar
    const listRes = await s3.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
    }))

    interface S3Object {
      Key?: string
      Size?: number
      LastModified?: Date
    }

    const files = (listRes.Contents || [])
      .filter((obj: S3Object) => obj.Key && !obj.Key.endsWith('/'))
      .map((obj: S3Object) => {
        const key = obj.Key!
        const filename = key.split('/').pop()!
        const url = `https://${bucket}.${process.env.CELLAR_ADDON_HOST}/${key}`
        const uploadedAt = obj.LastModified ? obj.LastModified.toISOString() : ''
        return {
          filename,
          size: obj.Size || 0,
          url,
          uploadType: 'chapter' as const,
          chapterId: chapterId,
          uploadedAt,
          isDirectory: false,
        }
      })
      .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime())

    return NextResponse.json({ files })
  } catch (error) {
    console.error('File listing error:', error)
    return NextResponse.json(
      { error: 'Failed to list files' },
      { status: 500 }
    )
  }
}
