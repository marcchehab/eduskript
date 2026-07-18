import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolveOwnedSite } from '@/lib/sites'

export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // sidebarBehavior is per-site. `?siteId=` targets one of the caller's sites
    // (multi-site); omitted falls back to the primary site.
    const siteId = new URL(request.url).searchParams.get('siteId')
    const { site, forbidden } = await resolveOwnedSite(session.user.id, siteId)
    if (forbidden) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const row = site
      ? await prisma.site.findUnique({ where: { id: site.id }, select: { sidebarBehavior: true } })
      : null

    return NextResponse.json({
      sidebarBehavior: row?.sidebarBehavior || 'full'
    })
  } catch (error) {
    console.error('Error fetching sidebar preference:', error)
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
    const { sidebarBehavior, siteId } = body

    // Validate the value
    if (!['contextual', 'full'].includes(sidebarBehavior)) {
      return NextResponse.json(
        { error: 'Invalid sidebar behavior value' },
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
      data: { sidebarBehavior }
    })

    return NextResponse.json({ 
      success: true,
      sidebarBehavior 
    })
  } catch (error) {
    console.error('Error updating sidebar preference:', error)
    return NextResponse.json(
      { error: 'Failed to update preference' },
      { status: 500 }
    )
  }
}