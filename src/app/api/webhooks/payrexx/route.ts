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

    // Payrexx sends both transaction and subscription webhooks
    const transaction = payload.transaction as PayrexxWebhookTransaction | undefined
    const subscriptionEvent = payload.subscription as Record<string, unknown> | undefined

    // Extract status and referenceId from whichever event type we received
    let status: string | undefined
    let referenceId: string | undefined
    let payrexxSubId: string | undefined

    if (transaction) {
      status = transaction.status
      referenceId = transaction.referenceId
      payrexxSubId = transaction.subscription?.id?.toString()
    } else if (subscriptionEvent) {
      // Subscription lifecycle events (active, cancelled, etc.)
      status = subscriptionEvent.status as string
      payrexxSubId = subscriptionEvent.id?.toString()
      const invoice = subscriptionEvent.invoice as Record<string, unknown> | undefined
      referenceId = invoice?.referenceId as string
    } else {
      console.error('[payrexx-webhook] No transaction or subscription data')
      return NextResponse.json({ error: 'Missing data' }, { status: 400 })
    }

    console.log(`[payrexx-webhook] Event: type=${transaction ? 'transaction' : 'subscription'}, status=${status}, referenceId=${referenceId}, payrexxSubId=${payrexxSubId}`)

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
              payrexxSubId: payrexxSubId ?? subscription.payrexxSubId,
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

      case 'active': {
        // Subscription lifecycle event — activate if not already done by transaction webhook
        if (subscription.status !== 'active') {
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
                payrexxSubId: payrexxSubId ?? subscription.payrexxSubId,
                currentPeriodStart: now,
                currentPeriodEnd: periodEnd,
              },
            }),
            prisma.user.update({
              where: { id: subscription.userId },
              data: { billingPlan: subscription.plan.slug },
            }),
          ])
          console.log(`[payrexx-webhook] Subscription ${subscription.id} activated via subscription event`)
        } else {
          console.log(`[payrexx-webhook] Subscription ${subscription.id} already active, skipping`)
        }
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
