/**
 * Payrexx Webhook Handler
 *
 * Receives payment event notifications from Payrexx and updates subscription status.
 * Payrexx sends POST requests with form-encoded body containing transaction data.
 *
 * Events handled:
 * - transaction.confirmed: Payment succeeded → activate subscription
 * - transaction.declined: Payment failed → mark as past_due
 * - transaction.refunded: Refund processed
 * - subscription.cancelled: Subscription cancelled by user or Payrexx
 *
 * Webhook URL to configure in Payrexx dashboard:
 *   https://eduskript.org/api/webhooks/payrexx
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyWebhookSignature } from '@/lib/payrexx'

interface PayrexxWebhookTransaction {
  id: number
  status: string // "confirmed", "declined", "refunded", "waiting", etc.
  referenceId: string // Our subscription ID passed when creating gateway
  subscription?: {
    id: number
    status: string
  }
  contact?: {
    email?: string
  }
  amount: number
  currency: string
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.text()
    const signature = request.headers.get('payrexx-signature') ?? ''

    // Verify webhook authenticity
    if (process.env.PAYREXX_WEBHOOK_SECRET && signature) {
      const isValid = verifyWebhookSignature(body, signature)
      if (!isValid) {
        console.error('[payrexx-webhook] Invalid signature')
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
      }
    }

    // Parse the webhook payload
    const params = new URLSearchParams(body)
    const transactionJson = params.get('transaction')

    if (!transactionJson) {
      console.error('[payrexx-webhook] No transaction data in webhook')
      return NextResponse.json({ error: 'Missing transaction data' }, { status: 400 })
    }

    const transaction: PayrexxWebhookTransaction = JSON.parse(transactionJson)
    const { status, referenceId, subscription: payrexxSub } = transaction

    console.log(`[payrexx-webhook] Event: status=${status}, referenceId=${referenceId}, subscriptionId=${payrexxSub?.id}`)

    if (!referenceId) {
      console.warn('[payrexx-webhook] No referenceId — ignoring')
      return NextResponse.json({ received: true })
    }

    // Find our subscription by the referenceId we sent when creating the gateway
    const subscription = await prisma.subscription.findUnique({
      where: { id: referenceId },
      include: { user: { select: { id: true, billingPlan: true } }, plan: true },
    })

    if (!subscription) {
      console.warn(`[payrexx-webhook] Subscription not found: ${referenceId}`)
      return NextResponse.json({ received: true })
    }

    switch (status) {
      case 'confirmed': {
        // Payment succeeded — activate subscription
        const now = new Date()
        const periodEnd = new Date(now)
        if (subscription.plan.interval === 'monthly') {
          periodEnd.setMonth(periodEnd.getMonth() + 1)
        } else {
          periodEnd.setFullYear(periodEnd.getFullYear() + 1)
        }

        await prisma.$transaction([
          prisma.subscription.update({
            where: { id: subscription.id },
            data: {
              status: 'active',
              payrexxSubId: payrexxSub?.id?.toString() ?? subscription.payrexxSubId,
              currentPeriodStart: now,
              currentPeriodEnd: periodEnd,
            },
          }),
          // Sync the user's billingPlan field
          prisma.user.update({
            where: { id: subscription.userId },
            data: { billingPlan: subscription.plan.slug },
          }),
        ])

        console.log(`[payrexx-webhook] Subscription ${subscription.id} activated until ${periodEnd.toISOString()}`)
        break
      }

      case 'declined':
      case 'failed': {
        await prisma.subscription.update({
          where: { id: subscription.id },
          data: { status: 'past_due' },
        })
        console.log(`[payrexx-webhook] Subscription ${subscription.id} marked as past_due`)
        break
      }

      case 'refunded': {
        await prisma.$transaction([
          prisma.subscription.update({
            where: { id: subscription.id },
            data: { status: 'cancelled', cancelledAt: new Date() },
          }),
          prisma.user.update({
            where: { id: subscription.userId },
            data: { billingPlan: 'free' },
          }),
        ])
        console.log(`[payrexx-webhook] Subscription ${subscription.id} refunded and cancelled`)
        break
      }

      case 'cancelled': {
        await prisma.$transaction([
          prisma.subscription.update({
            where: { id: subscription.id },
            data: { status: 'cancelled', cancelledAt: new Date() },
          }),
          prisma.user.update({
            where: { id: subscription.userId },
            data: { billingPlan: 'free' },
          }),
        ])
        console.log(`[payrexx-webhook] Subscription ${subscription.id} cancelled`)
        break
      }

      default: {
        console.log(`[payrexx-webhook] Unhandled status: ${status}`)
      }
    }

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error('[payrexx-webhook] Error processing webhook:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
