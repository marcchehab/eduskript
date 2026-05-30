/**
 * Subscriptions API
 *
 * GET  - Get current user's subscription status and available plans
 * POST - Create a checkout session for a plan (returns Payrexx gateway URL)
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { createGateway, intervalToDuration } from '@/lib/payrexx'

export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const [subscription, plans] = await Promise.all([
      prisma.subscription.findFirst({
        where: {
          userId: session.user.id,
          status: { in: ['active', 'trialing', 'past_due'] },
        },
        include: { plan: true },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.plan.findMany({
        where: { isActive: true },
        orderBy: [{ priceChf: 'asc' }],
      }),
    ])

    return NextResponse.json({
      subscription: subscription
        ? {
            id: subscription.id,
            status: subscription.status,
            plan: {
              id: subscription.plan.id,
              name: subscription.plan.name,
              slug: subscription.plan.slug,
              priceChf: subscription.plan.priceChf,
              interval: subscription.plan.interval,
              features: subscription.plan.features,
            },
            currentPeriodEnd: subscription.currentPeriodEnd,
            cancelledAt: subscription.cancelledAt,
            ...(subscription.status === 'trialing' && subscription.currentPeriodEnd
              ? { trialEndsAt: subscription.currentPeriodEnd }
              : {}),
          }
        : null,
      plans: plans.map((p) => ({
        id: p.id,
        name: p.name,
        slug: p.slug,
        priceChf: p.priceChf,
        interval: p.interval,
        features: p.features,
      })),
    })
  } catch (error) {
    console.error('[subscriptions] GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { planId } = await request.json()
    if (!planId) {
      return NextResponse.json({ error: 'planId is required' }, { status: 400 })
    }

    // Check for an existing subscription. Trialing and past_due are reusable —
    // we restart checkout on the same row (keeps referenceId stable, avoids
    // orphan rows). Only a genuinely active subscription blocks re-checkout.
    const existing = await prisma.subscription.findFirst({
      where: {
        userId: session.user.id,
        status: { in: ['active', 'trialing', 'past_due'] },
      },
      orderBy: { createdAt: 'desc' },
    })

    if (existing && existing.status === 'active') {
      return NextResponse.json(
        { error: 'You already have an active subscription. Please cancel it first.' },
        { status: 409 }
      )
    }

    // Fetch the plan
    const plan = await prisma.plan.findUnique({ where: { id: planId } })
    if (!plan || !plan.isActive) {
      return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
    }

    // Reuse a trialing/past_due subscription or create a new incomplete one
    let subscription: { id: string }
    if (existing && (existing.status === 'trialing' || existing.status === 'past_due')) {
      subscription = await prisma.subscription.update({
        where: { id: existing.id },
        data: { planId: plan.id, status: 'incomplete' },
      })
    } else {
      subscription = await prisma.subscription.create({
        data: {
          userId: session.user.id,
          planId: plan.id,
          status: 'incomplete',
        },
      })
    }

    const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000'

    // Create Payrexx gateway (checkout page)
    const gateway = await createGateway({
      amount: plan.priceChf,
      currency: 'CHF',
      successRedirectUrl: `${baseUrl}/dashboard/billing?status=success`,
      failedRedirectUrl: `${baseUrl}/dashboard/billing?status=failed`,
      cancelRedirectUrl: `${baseUrl}/dashboard/billing?status=cancelled`,
      referenceId: subscription.id,
      purpose: `${plan.name} Subscription (${plan.interval})`,
      subscriptionInterval: intervalToDuration(plan.interval),
      contactEmail: session.user.email ?? undefined,
      contactForename: session.user.name?.split(' ')[0],
      contactSurname: session.user.name?.split(' ').slice(1).join(' ') || undefined,
    })

    return NextResponse.json({
      checkoutUrl: gateway.link,
      subscriptionId: subscription.id,
    })
  } catch (error) {
    console.error('[subscriptions] POST error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
