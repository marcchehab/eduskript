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

    // Cancel in Payrexx if we have a subscription ID
    if (subscription.payrexxSubId) {
      try {
        await cancelSubscription(subscription.payrexxSubId)
      } catch (error) {
        console.error('[subscriptions/cancel] Payrexx cancel error:', error)
        // Continue with local cancellation even if Payrexx call fails
      }
    }

    // Mark as cancelled locally — keep active until period end
    await prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        status: 'cancelled',
        cancelledAt: new Date(),
      },
    })

    // Reset user billing plan
    await prisma.user.update({
      where: { id: session.user.id },
      data: { billingPlan: 'free' },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[subscriptions/cancel] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
