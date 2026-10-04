import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { isSiteSlugTaken } from '@/lib/site-slugs'

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
    // owned by anyone other than the current user, as its current slug or one
    // it used before a rename (src/lib/site-slugs.ts).
    const available = !(await isSiteSlugTaken(slug, { userId: session.user.id }))

    return NextResponse.json({ available })
  } catch (error) {
    console.error('Error checking slug:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
