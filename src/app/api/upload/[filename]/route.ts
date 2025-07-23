import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getS3Client } from '@/lib/utils'
import { DeleteObjectCommand } from '@aws-sdk/client-s3'

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { filename } = await params
    const { searchParams } = new URL(request.url)
    const chapterId = searchParams.get('chapterId')

    if (!chapterId) {
      return NextResponse.json({ error: 'Chapter ID is required' }, { status: 400 })
    }

    // Get user info
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { subdomain: true }
    })

    if (!user?.subdomain) {
      return NextResponse.json({ error: 'User subdomain not found' }, { status: 400 })
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

    const s3Key = `${user.subdomain}/chapters/${chapterId}/${filename}`

    // Delete from S3/Cellar
    const bucket = process.env.CELLAR_ADDON_BUCKET!
    const s3 = getS3Client()
    await s3.send(new DeleteObjectCommand({
      Bucket: bucket,
      Key: s3Key,
    }))

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting file:', error)
    return NextResponse.json({ error: 'Failed to delete file' }, { status: 500 })
  }
}
