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

    // Check if the slug is already taken by any Site (user OR organization)
    // owned by anyone other than the current user.
    const existingSite = await prisma.site.findUnique({
      where: { slug },
      select: { userId: true }
    })

    const available = !existingSite || existingSite.userId === session.user.id

    return NextResponse.json({ available })
  } catch (error) {
    console.error('Error checking slug:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
