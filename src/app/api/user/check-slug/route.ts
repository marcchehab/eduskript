import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const slug = searchParams.get('slug')

    if (!slug) {
      return NextResponse.json({ error: 'Slug is required' }, { status: 400 })
    }

    // Check if the slug is already taken by another user (check both pageSlug and username)
    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [
          { pageSlug: slug },
          { username: slug }
        ],
        NOT: { id: session.user.id }
      },
      select: { id: true }
    })

    // Available if no other user has this slug as pageSlug or username
    const available = !existingUser

    return NextResponse.json({ available })
  } catch (error) {
    console.error('Error checking slug:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
