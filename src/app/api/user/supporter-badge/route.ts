/**
 * Supporter badge settings — per-site, stored in Site.extraSettings
 * (supporterBadgeHidden, supporterBadgeMessage). Follows the shape of
 * sidebar-preference/route.ts, including the cache flushing it needs.
 * Not gated on billingPlan: the settings are inert unless the owner is on a
 * supporter plan (the public layout checks that), so a lapsed supporter keeps
 * their message for when they return.
 */

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { revalidateTag } from 'next/cache'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolveOwnedSite } from '@/lib/sites'
import { CACHE_TAGS } from '@/lib/cached-queries'
import { readExtraSettings, mergeExtraSettings, DEFAULT_SUPPORTER_MESSAGE } from '@/lib/settings'

export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const siteId = new URL(request.url).searchParams.get('siteId')
    const { site, forbidden } = await resolveOwnedSite(session.user.id, siteId)
    if (forbidden) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const row = site
      ? await prisma.site.findUnique({ where: { id: site.id }, select: { extraSettings: true } })
      : null
    const extra = readExtraSettings(row)

    return NextResponse.json({
      hidden: extra.supporterBadgeHidden ?? false,
      message: extra.supporterBadgeMessage ?? '',
      defaultMessage: DEFAULT_SUPPORTER_MESSAGE,
    })
  } catch (error) {
    console.error('[supporter-badge] GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch badge settings' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { siteId, hidden, message } = await request.json()

    if (hidden !== undefined && typeof hidden !== 'boolean') {
      return NextResponse.json({ error: 'hidden must be a boolean' }, { status: 400 })
    }
    if (message !== undefined && typeof message !== 'string') {
      return NextResponse.json({ error: 'message must be a string' }, { status: 400 })
    }

    const { site, forbidden } = await resolveOwnedSite(session.user.id, siteId)
    if (forbidden) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (!site) throw new Error('No site found for user')

    const row = await prisma.site.findUnique({
      where: { id: site.id },
      select: { extraSettings: true },
    })

    const trimmed = message?.trim().slice(0, 60)
    await prisma.site.update({
      where: { id: site.id },
      data: {
        extraSettings: mergeExtraSettings(row?.extraSettings, {
          // undefined deletes the key = back to default
          supporterBadgeHidden: hidden === true ? true : undefined,
          supporterBadgeMessage: trimmed || undefined,
        }),
      },
    })

    // Same staleness trap as sidebar-preference: the public sidebar reads
    // these off unstable_cache with revalidate:false.
    revalidateTag(CACHE_TAGS.user(site.slug), { expire: 0 })
    revalidateTag(CACHE_TAGS.teacherContent(site.slug), { expire: 0 })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[supporter-badge] POST error:', error)
    return NextResponse.json({ error: 'Failed to update badge settings' }, { status: 500 })
  }
}
