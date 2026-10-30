import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/admin-auth', () => ({ requireAdmin: vi.fn() }))
vi.mock('@/lib/product-updates/service', () => ({
  approveAndClaim: vi.fn(),
  discardDraft: vi.fn(),
  sendClaimedDraft: vi.fn(),
  setProductUpdates: vi.fn(async () => true),
}))
vi.mock('next/server', async (orig) => ({
  ...(await orig<typeof import('next/server')>()),
  after: vi.fn(),
}))

import { after } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import { approveAndClaim, setProductUpdates } from '@/lib/product-updates/service'
import { signUserToken } from '@/lib/product-updates/tokens'
import { POST as approvePOST } from '@/app/api/admin/product-updates/[id]/route'
import { POST as unsubscribePOST } from '@/app/api/product-updates/unsubscribe/route'
import { POST as subscribePOST } from '@/app/api/product-updates/subscribe/route'

const params = { params: Promise.resolve({ id: 'd1' }) }
const approveReq = (body: object) =>
  new NextRequest('http://localhost:3000/api/admin/product-updates/d1', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

describe('POST /api/admin/product-updates/[id]', () => {
  beforeEach(() => vi.clearAllMocks())

  it('refuses non-admins even with a valid token', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({
      error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
      session: null,
    } as never)
    const res = await approvePOST(approveReq({ action: 'send', token: 't' }), params)
    expect(res.status).toBe(403)
    expect(approveAndClaim).not.toHaveBeenCalled()
  })

  it('claims and schedules the send for an admin', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ error: null, session: { user: { id: 'admin1' } } } as never)
    vi.mocked(approveAndClaim).mockResolvedValue({ ok: true, recipients: [{ id: 'u1', email: 'a@x.ch', name: null, lang: 'de' }] })
    const res = await approvePOST(approveReq({ action: 'send', token: 't' }), params)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'sending', recipients: 1 })
    expect(approveAndClaim).toHaveBeenCalledWith('d1', 't', 'admin1')
    expect(after).toHaveBeenCalledTimes(1)
  })

  it('answers 409 and sends nothing on a second approve', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ error: null, session: { user: { id: 'admin1' } } } as never)
    vi.mocked(approveAndClaim).mockResolvedValue({ ok: false, reason: 'not-pending' })
    const res = await approvePOST(approveReq({ action: 'send', token: 't' }), params)
    expect(res.status).toBe(409)
    expect(after).not.toHaveBeenCalled()
  })
})

describe('one-click (un)subscribe', () => {
  beforeEach(() => vi.clearAllMocks())

  it('unsubscribes with a valid token (RFC 8058 one-click body)', async () => {
    const token = signUserToken('unsubscribe', 'u1')
    const res = await unsubscribePOST(
      new NextRequest(`http://localhost:3000/api/product-updates/unsubscribe?token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'List-Unsubscribe=One-Click',
      })
    )
    expect(res.status).toBe(200)
    expect(setProductUpdates).toHaveBeenCalledWith('u1', false)
  })

  it('rejects a forged token', async () => {
    const res = await unsubscribePOST(
      new NextRequest('http://localhost:3000/api/product-updates/unsubscribe?token=u1.forged', { method: 'POST' })
    )
    expect(res.status).toBe(400)
    expect(setProductUpdates).not.toHaveBeenCalled()
  })

  it('does not accept an unsubscribe token for subscribing', async () => {
    const token = signUserToken('unsubscribe', 'u1')
    const res = await subscribePOST(
      new NextRequest(`http://localhost:3000/api/product-updates/subscribe?token=${encodeURIComponent(token)}`, { method: 'POST' })
    )
    expect(res.status).toBe(400)
    expect(setProductUpdates).not.toHaveBeenCalled()
  })

  it('subscribes with a subscribe token', async () => {
    const token = signUserToken('subscribe', 'u1')
    const res = await subscribePOST(
      new NextRequest(`http://localhost:3000/api/product-updates/subscribe?token=${encodeURIComponent(token)}`, { method: 'POST' })
    )
    expect(res.status).toBe(200)
    expect(setProductUpdates).toHaveBeenCalledWith('u1', true)
  })
})
