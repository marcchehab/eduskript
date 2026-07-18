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

    // aiSystemPrompt is per-site. `?siteId=` targets one of the caller's sites
    // (multi-site); omitted falls back to the primary site.
    const siteId = new URL(request.url).searchParams.get('siteId')
    const { site, forbidden } = await resolveOwnedSite(session.user.id, siteId)
    if (forbidden) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const row = site
      ? await prisma.site.findUnique({ where: { id: site.id }, select: { aiSystemPrompt: true } })
      : null

    return NextResponse.json({
      aiSystemPrompt: row?.aiSystemPrompt || ''
    })
  } catch (error) {
    console.error('Error fetching AI prompt:', error)
    return NextResponse.json(
      { error: 'Failed to fetch AI prompt' },
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
    const { aiSystemPrompt, siteId } = body

    // Update the targeted site (`siteId` from the body) or the primary site.
    // Teachers always have a Site by this point; a missing Site means a
    // misconfigured account so we surface a 404.
    const { site, forbidden } = await resolveOwnedSite(session.user.id, siteId)
    if (forbidden) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (!site) {
      return NextResponse.json(
        { error: 'No public page found for this account' },
        { status: 404 },
      )
    }

    const updated = await prisma.site.update({
      where: { id: site.id },
      data: { aiSystemPrompt: aiSystemPrompt || null },
      select: { aiSystemPrompt: true },
    }).catch(() => null)

    if (!updated) {
      return NextResponse.json(
        { error: 'No public page found for this account' },
        { status: 404 },
      )
    }

    return NextResponse.json({
      success: true,
      aiSystemPrompt: updated.aiSystemPrompt || ''
    })
  } catch (error) {
    console.error('Error updating AI prompt:', error)
    return NextResponse.json(
      { error: 'Failed to update AI prompt' },
      { status: 500 }
    )
  }
}
