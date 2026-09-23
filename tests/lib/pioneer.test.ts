/**
 * Pioneer programme (src/lib/pioneer.ts): admin-granted, open-ended free
 * access, stored as an active subscription without end date on the hidden
 * 'pioneer' plan. Prisma is mocked; the tests pin the grant/revoke writes, the
 * paid-gate outcome and that neither expiry path nor the renewal charge can
 * touch a pioneer row.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const db = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  plan: { upsert: vi.fn() },
  subscription: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  metricPoint: { deleteMany: vi.fn(async () => ({ count: 0 })) },
  dbActivityHour: { deleteMany: vi.fn(async () => ({ count: 0 })) },
  $transaction: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/seed-demo-content', () => ({ resetDemoUser: vi.fn(async () => ({ pageCount: 0 })) }))
vi.mock('@/lib/trial-emails', () => ({ sendDueTrialEmails: vi.fn(async () => ({})) }))
vi.mock('@/lib/billing-revalidate', () => ({ revalidateUserSites: vi.fn() }))

import {
  grantPioneer,
  revokePioneer,
  PioneerGrantError,
  PIONEER_PLAN_SLUG,
} from '@/lib/pioneer'
import { isPaidUser, isFreeTeacher } from '@/lib/billing'
import { expireSubscriptionIfNeeded } from '@/lib/trial'

const NOW = new Date('2026-09-23T10:00:00Z')
const PLAN = { id: 'plan-pioneer', slug: PIONEER_PLAN_SLUG }

beforeEach(() => {
  vi.clearAllMocks()
  db.$transaction.mockImplementation(async (fn: (tx: typeof db) => unknown) => fn(db))
  db.user.findUnique.mockResolvedValue({ accountType: 'teacher' })
  db.plan.upsert.mockResolvedValue(PLAN)
  db.subscription.findMany.mockResolvedValue([])
  db.subscription.updateMany.mockResolvedValue({ count: 0 })
})

describe('grantPioneer', () => {
  it('creates a hidden, free plan on first use', async () => {
    await grantPioneer('u1', NOW)
    const arg = db.plan.upsert.mock.calls[0][0]
    expect(arg.where).toEqual({ slug: 'pioneer' })
    expect(arg.create).toMatchObject({ priceChf: 0, isActive: false })
  })

  it('starts an open-ended active subscription without Payrexx and sets billingPlan', async () => {
    expect(await grantPioneer('u1', NOW)).toEqual({ alreadyPioneer: false })
    const data = db.subscription.create.mock.calls[0][0].data
    expect(data).toMatchObject({ userId: 'u1', planId: PLAN.id, status: 'active', currentPeriodStart: NOW })
    expect(data.currentPeriodEnd).toBeUndefined()
    expect(data.payrexxSubId).toBeUndefined()
    expect(db.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { billingPlan: 'pioneer' } })
  })

  it('cancels a running trial before granting', async () => {
    db.subscription.findMany.mockResolvedValue([
      { id: 'trial1', planId: 'plan-classroom', status: 'trialing', payrexxSubId: null, currentPeriodEnd: NOW },
    ])
    await grantPioneer('u1', NOW)
    expect(db.subscription.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['trial1'] } },
      data: { status: 'cancelled', cancelledAt: NOW },
    })
    expect(db.subscription.create).toHaveBeenCalled()
  })

  it('is a no-op for an existing pioneer', async () => {
    db.subscription.findMany.mockResolvedValue([
      { id: 's1', planId: PLAN.id, status: 'active', payrexxSubId: null },
    ])
    expect(await grantPioneer('u1', NOW)).toEqual({ alreadyPioneer: true })
    expect(db.subscription.create).not.toHaveBeenCalled()
    expect(db.subscription.updateMany).not.toHaveBeenCalled()
  })

  it('refuses while a paid Payrexx subscription is running', async () => {
    db.subscription.findMany.mockResolvedValue([
      { id: 'paid', planId: 'plan-classroom', status: 'active', payrexxSubId: '123', currentPeriodEnd: NOW },
    ])
    await expect(grantPioneer('u1', NOW)).rejects.toBeInstanceOf(PioneerGrantError)
    expect(db.subscription.create).not.toHaveBeenCalled()
    expect(db.user.update).not.toHaveBeenCalled()
  })

  it('refuses students and unknown users', async () => {
    db.user.findUnique.mockResolvedValueOnce({ accountType: 'student' })
    await expect(grantPioneer('s', NOW)).rejects.toBeInstanceOf(PioneerGrantError)
    db.user.findUnique.mockResolvedValueOnce(null)
    await expect(grantPioneer('x', NOW)).rejects.toBeInstanceOf(PioneerGrantError)
  })
})

describe('revokePioneer', () => {
  it('cancels the pioneer subscription and resets billingPlan', async () => {
    db.subscription.updateMany.mockResolvedValue({ count: 1 })
    expect(await revokePioneer('u1', NOW)).toBe(true)
    expect(db.subscription.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', status: 'active', plan: { slug: 'pioneer' } },
      data: { status: 'cancelled', cancelledAt: NOW },
    })
    expect(db.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { billingPlan: 'free' } })
  })

  it('is a no-op for non-pioneers', async () => {
    expect(await revokePioneer('u1', NOW)).toBe(false)
    expect(db.user.update).not.toHaveBeenCalled()
  })
})

describe('paid gates', () => {
  it('treat a pioneer teacher as paid', () => {
    const pioneer = { billingPlan: 'pioneer', accountType: 'teacher' }
    expect(isPaidUser(pioneer)).toBe(true)
    expect(isFreeTeacher(pioneer)).toBe(false)
  })
})

describe('no automatic expiry', () => {
  it('session refresh only matches rows with a past end date', async () => {
    db.subscription.findFirst.mockResolvedValue(null)
    expect(await expireSubscriptionIfNeeded('u1')).toBe(false)
    const where = db.subscription.findFirst.mock.calls[0][0].where
    // A pioneer row has currentPeriodEnd = null, which `lt` never matches.
    expect(where.currentPeriodEnd).toEqual({ lt: expect.any(Date) })
    expect(JSON.stringify(where)).not.toContain('pioneer')
  })

  it('cron neither charges nor expires rows without an end date', async () => {
    vi.stubEnv('CRON_SECRET', 'test-secret')
    db.subscription.findMany.mockResolvedValue([])
    const { POST } = await import('@/app/api/cron/route')
    const res = await POST(
      new NextRequest('http://localhost/api/cron', {
        method: 'POST',
        headers: { authorization: 'Bearer test-secret' },
      })
    )
    expect(res.status).toBe(200)
    const [renewalQuery, expiryQuery] = db.subscription.findMany.mock.calls.map((c) => c[0].where)
    expect(renewalQuery.payrexxSubId).toEqual({ not: null })
    expect(renewalQuery.currentPeriodEnd).toEqual({ lt: expect.any(Date) })
    expect(expiryQuery.currentPeriodEnd).toEqual({ lt: expect.any(Date) })
  })
})
