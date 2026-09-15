import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import type { PublicPlan } from '@/lib/plan-copy'

/**
 * GET /api/plans — active plans with their prices, public (no auth).
 *
 * Feeds the `<pricing>` markdown component on public pages. Deliberately
 * exposes only what a pricing table shows; the `features` JSON (internal
 * gating flags) and ids stay behind /api/subscriptions.
 */
export async function GET() {
  try {
    const plans = await prisma.plan.findMany({
      where: { isActive: true },
      orderBy: [{ priceChf: 'asc' }],
      select: { slug: true, name: true, priceChf: true, interval: true, trialDays: true, isDefaultTrial: true },
    })
    const body: { plans: PublicPlan[] } = { plans }
    return NextResponse.json(body, { headers: { 'Cache-Control': 'public, max-age=300' } })
  } catch (error) {
    console.error('[plans] GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
