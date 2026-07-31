/**
 * Cancel Subscription API
 *
 * POST - Cancel the user's active subscription.
 * The subscription remains active until the end of the current billing period.
 */

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { cancelSubscription } from '@/lib/payrexx'

export async function POST() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const subscription = await prisma.subscription.findFirst({
      where: {
        userId: session.user.id,
        status: { in: ['active', 'trialing', 'past_due'] },
      },
    })

    if (!subscription) {
      return NextResponse.json({ error: 'No active subscription found' }, { status: 404 })
    }

    // Trials are not cancellable — they cost nothing and expire on their own.
    // The UI has no cancel button during a trial; this guards direct POSTs.
    if (subscription.status === 'trialing') {
      return NextResponse.json(
        { error: 'A trial cannot be cancelled. It ends automatically on its end date.' },
        { status: 400 }
      )
    }

    // Cancel in Payrexx if we have a subscription ID
    if (subscription.payrexxSubId) {
      try {
        await cancelSubscription(subscription.payrexxSubId)
      } catch (error) {
        console.error('[subscriptions/cancel] Payrexx cancel error:', error)
        // Continue with local cancellation even if Payrexx call fails
      }
    }

    const now = new Date()

    // A subscription with no period end has nothing to run out — cancel it
    // immediately. Everything else stays active until the period end.
    if (!subscription.currentPeriodEnd) {
      await prisma.subscription.update({
        where: { id: subscription.id },
        data: { status: 'cancelled', cancelledAt: now },
      })
      await prisma.user.update({
        where: { id: session.user.id },
        data: { billingPlan: 'free' },
      })
      return NextResponse.json({ success: true, immediate: true })
    }

    // Mark as cancelled but keep plan active until period end
    await prisma.subscription.update({
      where: { id: subscription.id },
      data: { cancelledAt: now },
    })

    return NextResponse.json({
      success: true,
      activeUntil: subscription.currentPeriodEnd,
    })
  } catch (error) {
    console.error('[subscriptions/cancel] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
