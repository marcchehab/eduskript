import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { unlink } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'

const UPLOAD_DIR = process.env.UPLOAD_DIR || './public/uploads'

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
    const uploadType = searchParams.get('uploadType') as 'global' | 'chapter'
    const chapterId = searchParams.get('chapterId')

    // Get user info
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { subdomain: true }
    })

    if (!user?.subdomain) {
      return NextResponse.json({ error: 'User subdomain not found' }, { status: 400 })
    }

    let filePath: string

    if (uploadType === 'global') {
      filePath = path.join(UPLOAD_DIR, user.subdomain, 'global', filename)
    } else if (uploadType === 'chapter' && chapterId) {
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

      filePath = path.join(UPLOAD_DIR, user.subdomain, 'chapters', chapterId, filename)
    } else {
      return NextResponse.json({ error: 'Invalid upload type or missing chapter ID' }, { status: 400 })
    }

    // Check if file exists and delete it
    if (existsSync(filePath)) {
      await unlink(filePath)
      return NextResponse.json({ success: true })
    } else {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }
  } catch (error) {
    console.error('File deletion error:', error)
    return NextResponse.json(
      { error: 'Deletion failed' },
      { status: 500 }
    )
  }
}
