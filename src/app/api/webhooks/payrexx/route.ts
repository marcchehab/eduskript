/**
 * Payrexx Webhook Handler
 *
 * Receives transaction event notifications from Payrexx and updates
 * subscription status. Billing model: tokenization — checkout stores the
 * payment method and charges the first period (chargeOnAuthorization); the
 * cron charges renewals via the token (src/app/api/cron/route.ts). There are
 * no Payrexx-scheduled subscriptions, so no subscription lifecycle events are
 * expected here.
 *
 * Events handled:
 * - transaction authorized: the tokenization — store its id as the charge
 *   token for renewals.
 * - transaction confirmed: initial payment succeeded → activate subscription.
 *   Renewal confirmations are no-ops (the cron already extended the period
 *   synchronously).
 * - transaction declined/failed: checkout payment failed → mark past_due
 * - transaction refunded: refund processed → cancel + downgrade
 *
 * Signature: HMAC-SHA256 of the raw body, lowercase hex, in the
 * X-Webhook-Signature header. Webhook URL + format (JSON) are configured in
 * the Payrexx merchant admin: https://eduskript.org/api/webhooks/payrexx
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyWebhookSignature } from '@/lib/payrexx'
import { revalidateUserSites } from '@/lib/billing-revalidate'

interface PayrexxWebhookTransaction {
  id: number
  status: string // "confirmed", "declined", "refunded", "waiting", etc.
  referenceId: string // Our subscription ID passed when creating gateway
  contact?: {
    email?: string
  }
  amount: number
  currency: string
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.text()
    const signature = request.headers.get('x-webhook-signature') ?? ''

    // Verify webhook authenticity
    if (process.env.PAYREXX_WEBHOOK_SECRET && signature) {
      const isValid = verifyWebhookSignature(body, signature)
      if (!isValid) {
        console.error('[payrexx-webhook] Invalid signature')
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
      }
    }

    // Parse the webhook payload — Payrexx sends JSON (preferred) or form-encoded
    const contentType = request.headers.get('content-type') ?? ''
    let payload: Record<string, unknown>

    if (contentType.includes('application/json')) {
      payload = JSON.parse(body)
    } else {
      // Legacy form-encoded: transaction=<json>
      const params = new URLSearchParams(body)
      const transactionJson = params.get('transaction')
      if (!transactionJson) {
        console.error('[payrexx-webhook] No transaction data in webhook')
        return NextResponse.json({ error: 'Missing transaction data' }, { status: 400 })
      }
      payload = { transaction: JSON.parse(transactionJson) }
    }

    const transaction = payload.transaction as PayrexxWebhookTransaction | undefined
    if (!transaction) {
      // Subscription lifecycle events can still arrive from legacy
      // Payrexx-scheduled subscriptions; we no longer create those.
      console.warn('[payrexx-webhook] No transaction data — ignoring')
      return NextResponse.json({ received: true })
    }

    const status = transaction.status
    const referenceId = transaction.referenceId

    console.log(`[payrexx-webhook] Transaction ${transaction.id}: status=${status}, referenceId=${referenceId}`)

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
      case 'authorized': {
        // Tokenization: checkout produces TWO transactions — this one
        // (status authorized, the chargeable token) and a confirmed one (the
        // first charge, chargeOnAuthorization). Renewals must charge the
        // authorized transaction; charging the confirmed one fails. Arrival
        // order of the two webhooks is not guaranteed, so this only stores
        // the token and 'confirmed' only activates.
        await prisma.subscription.update({
          where: { id: subscription.id },
          data: { payrexxSubId: transaction.id.toString() },
        })
        console.log(`[payrexx-webhook] Subscription ${subscription.id} token stored: ${transaction.id}`)
        break
      }

      case 'confirmed': {
        // Cron-charged renewals also produce a confirmed webhook (same
        // referenceId); the cron already extended the period, so an active
        // subscription needs nothing here. Also makes duplicate webhook
        // deliveries harmless.
        if (subscription.status === 'active') {
          console.log(`[payrexx-webhook] Subscription ${subscription.id} already active, skipping`)
          break
        }

        // Initial payment (or past_due recovery) succeeded — activate. The
        // token id is stored by the 'authorized' case above, not here. The
        // new period starts where the remaining paid time ends, or now if
        // none is left. Trial remainder is not paid time and is replaced,
        // not appended.
        const now = new Date()
        const base = subscription.status !== 'trialing' &&
          subscription.currentPeriodEnd && subscription.currentPeriodEnd > now
          ? subscription.currentPeriodEnd
          : now
        const periodEnd = new Date(base)
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
              currentPeriodStart: base,
              currentPeriodEnd: periodEnd,
              cancelledAt: null,
            },
          }),
          // Sync the user's billingPlan field
          prisma.user.update({
            where: { id: subscription.userId },
            data: { billingPlan: subscription.plan.slug },
          }),
        ])

        console.log(`[payrexx-webhook] Subscription ${subscription.id} activated until ${periodEnd.toISOString()}`)
        await revalidateUserSites(subscription.userId)
        break
      }

      case 'declined':
      case 'failed': {
        // Only checkout payments run through the gateway, so this can only be
        // a failed initial payment — never a renewal (those are charged
        // synchronously by the cron).
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
            data: { status: 'cancelled', cancelledAt: new Date(), payrexxSubId: null },
          }),
          prisma.user.update({
            where: { id: subscription.userId },
            data: { billingPlan: 'free' },
          }),
        ])
        console.log(`[payrexx-webhook] Subscription ${subscription.id} refunded and cancelled`)
        await revalidateUserSites(subscription.userId)
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
