import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { revalidateTag } from 'next/cache'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolveOwnedSite } from '@/lib/sites'
import { CACHE_TAGS } from '@/lib/cached-queries'

export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // typographyPreference is per-site. `?siteId=` targets one of the caller's
    // sites (multi-site); omitted falls back to the primary site.
    const siteId = new URL(request.url).searchParams.get('siteId')
    const { site, forbidden } = await resolveOwnedSite(session.user.id, siteId)
    if (forbidden) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const row = site
      ? await prisma.site.findUnique({ where: { id: site.id }, select: { typographyPreference: true } })
      : null

    return NextResponse.json({
      typographyPreference: row?.typographyPreference || 'modern'
    })
  } catch (error) {
    console.error('Error fetching typography preference:', error)
    return NextResponse.json(
      { error: 'Failed to fetch preference' },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { typographyPreference, siteId } = body

    // Validate the value
    if (!['modern', 'classic'].includes(typographyPreference)) {
      return NextResponse.json(
        { error: 'Invalid typography preference value' },
        { status: 400 }
      )
    }

    // Update the targeted site (`siteId` from the body) or the primary site.
    // A missing Site throws below and surfaces as a 500, matching prior behavior.
    const { site, forbidden } = await resolveOwnedSite(session.user.id, siteId)
    if (forbidden) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (!site) throw new Error('No site found for user')

    await prisma.site.update({
      where: { id: site.id },
      data: { typographyPreference }
    })

    // Same stale-cache flush as sidebar-preference: the public layout caches
    // this site's typographyPreference with revalidate:false, keyed by slug.
    revalidateTag(CACHE_TAGS.user(site.slug), { expire: 0 })
    revalidateTag(CACHE_TAGS.teacherContent(site.slug), { expire: 0 })

    return NextResponse.json({
      success: true,
      typographyPreference
    })
  } catch (error) {
    console.error('Error updating typography preference:', error)
    return NextResponse.json(
      { error: 'Failed to update preference' },
      { status: 500 }
    )
  }
}
