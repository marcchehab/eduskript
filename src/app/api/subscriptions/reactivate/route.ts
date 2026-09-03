/**
 * Reactivate Auto-Renewal API
 *
 * POST - Undo a "stop auto-renewal" by clearing cancelledAt. Free of charge
 * and always possible while the paid period runs: billing is
 * tokenization-based, so stopping auto-renewal never touched Payrexx — the
 * cron just skips charging while cancelledAt is set
 * (src/app/api/cron/route.ts). Only a subscription whose payment token is
 * gone (payrexxSubId null) cannot resume; the user subscribes again instead.
 */

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function POST() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const subscription = await prisma.subscription.findFirst({
      where: {
        userId: session.user.id,
        status: 'active',
        cancelledAt: { not: null },
      },
    })

    if (!subscription) {
      return NextResponse.json({ error: 'No subscription with stopped auto-renewal found' }, { status: 404 })
    }

    if (!subscription.payrexxSubId) {
      return NextResponse.json(
        { error: 'Auto-renewal can no longer be re-enabled. Please subscribe again once your access ends.' },
        { status: 409 }
      )
    }

    await prisma.subscription.update({
      where: { id: subscription.id },
      data: { cancelledAt: null },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[subscriptions/reactivate] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
