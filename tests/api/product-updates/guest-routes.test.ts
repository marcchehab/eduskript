import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/product-updates/service', () => ({
  requestGuestSubscription: vi.fn(async () => 'confirmation-sent'),
  confirmGuest: vi.fn(async () => true),
  unsubscribeGuest: vi.fn(async () => {}),
  setProductUpdates: vi.fn(async () => true),
}))

import { clearAllRateLimits } from '@/lib/rate-limit'
import { confirmGuest, requestGuestSubscription, setProductUpdates, unsubscribeGuest } from '@/lib/product-updates/service'
import { signUserToken } from '@/lib/product-updates/tokens'
import { POST as signupPOST } from '@/app/api/product-updates/signup/route'
import { POST as subscribePOST } from '@/app/api/product-updates/subscribe/route'
import { POST as unsubscribePOST } from '@/app/api/product-updates/unsubscribe/route'

let ipCounter = 0
const signup = (body: object, ip = `10.0.0.${++ipCounter}`) =>
  signupPOST(
    new NextRequest('http://localhost:3000/api/product-updates/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
      body: JSON.stringify(body),
    })
  )
const withToken = (path: string, token: string) =>
  new NextRequest(`http://localhost:3000/api/product-updates/${path}?token=${encodeURIComponent(token)}`, { method: 'POST' })

beforeEach(() => {
  vi.clearAllMocks()
  clearAllRateLimits()
})

describe('POST /api/product-updates/signup', () => {
  it('answers the same whether the address is new or already subscribed', async () => {
    const a = await signup({ email: 'new@x.ch', lang: 'de' })
    vi.mocked(requestGuestSubscription).mockResolvedValueOnce('already-subscribed')
    const b = await signup({ email: 'old@x.ch', lang: 'de' })
    expect(a.status).toBe(200)
    expect(b.status).toBe(200)
    expect(await a.json()).toEqual(await b.json())
    expect(requestGuestSubscription).toHaveBeenCalledWith('new@x.ch', 'de')
  })

  it('answers generically when the confirmation mail fails', async () => {
    vi.mocked(requestGuestSubscription).mockRejectedValueOnce(new Error('smtp down'))
    const res = await signup({ email: 'a@x.ch', lang: 'en' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('rejects a malformed address', async () => {
    const res = await signup({ email: 'not-an-email' })
    expect(res.status).toBe(400)
    expect(requestGuestSubscription).not.toHaveBeenCalled()
  })

  it('defaults lang to en', async () => {
    await signup({ email: 'a@x.ch', lang: 'fr' })
    expect(requestGuestSubscription).toHaveBeenCalledWith('a@x.ch', 'en')
  })

  it('rate-limits per IP with 429', async () => {
    const statuses: number[] = []
    for (let i = 0; i < 11; i++) statuses.push((await signup({ email: `a${i}@x.ch` }, '1.2.3.4')).status)
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true)
    expect(statuses[10]).toBe(429)
  })

  it('rate-limits per address silently (same generic answer, no further mail)', async () => {
    for (let i = 0; i < 5; i++) {
      const res = await signup({ email: 'Victim@x.ch' })
      expect(res.status).toBe(200)
    }
    expect(requestGuestSubscription).toHaveBeenCalledTimes(3)
  })
})

describe('guest confirm / unsubscribe', () => {
  it('confirms with a guest-confirm token', async () => {
    const res = await subscribePOST(withToken('subscribe', signUserToken('guest-confirm', 's1')))
    expect(res.status).toBe(200)
    expect(confirmGuest).toHaveBeenCalledWith('s1')
    expect(setProductUpdates).not.toHaveBeenCalled()
  })

  it('answers 410 for an expired confirmation', async () => {
    vi.mocked(confirmGuest).mockResolvedValueOnce(false)
    const res = await subscribePOST(withToken('subscribe', signUserToken('guest-confirm', 's1')))
    expect(res.status).toBe(410)
  })

  it('does not confirm with a guest-unsubscribe token', async () => {
    const res = await subscribePOST(withToken('subscribe', signUserToken('guest-unsubscribe', 's1')))
    expect(res.status).toBe(400)
    expect(confirmGuest).not.toHaveBeenCalled()
  })

  it('unsubscribes a guest (row deleted) with a guest-unsubscribe token', async () => {
    const res = await unsubscribePOST(withToken('unsubscribe', signUserToken('guest-unsubscribe', 's1')))
    expect(res.status).toBe(200)
    expect(unsubscribeGuest).toHaveBeenCalledWith('s1')
    expect(setProductUpdates).not.toHaveBeenCalled()
  })

  it('does not unsubscribe a guest with a confirm token', async () => {
    const res = await unsubscribePOST(withToken('unsubscribe', signUserToken('guest-confirm', 's1')))
    expect(res.status).toBe(400)
    expect(unsubscribeGuest).not.toHaveBeenCalled()
  })
})
