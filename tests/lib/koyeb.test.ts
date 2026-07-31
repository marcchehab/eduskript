import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { attachDomainToKoyeb } from '@/lib/koyeb'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('attachDomainToKoyeb', () => {
  beforeEach(() => {
    vi.stubEnv('KOYEB_API_TOKEN', 'test-token')
    vi.stubEnv('KOYEB_APP_ID', 'app-1')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('is a no-op without credentials', async () => {
    vi.stubEnv('KOYEB_API_TOKEN', '')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    expect((await attachDomainToKoyeb('a.example.com')).status).toBe('skipped')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('creates and refreshes a new domain', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method || 'GET'} ${url}`)
      if (url.includes('/domains?name=')) return json({ domains: [] })
      if (url.endsWith('/domains')) return json({ domain: { id: 'd1', status: 'PENDING' } })
      return json({ domain: { id: 'd1', status: 'ACTIVE' } })
    }))

    const r = await attachDomainToKoyeb('a.example.com')
    expect(r).toEqual({ status: 'attached', domainId: 'd1', koyebStatus: 'ACTIVE' })
    expect(calls.some(c => c === 'POST https://app.koyeb.com/v1/domains')).toBe(true)
    expect(calls.some(c => c.includes('/domains/d1/refresh'))).toBe(true)
  })

  it('refreshes instead of recreating a domain that already exists', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method || 'GET'} ${url}`)
      if (url.includes('/domains?name=')) return json({ domains: [{ id: 'd9', name: 'a.example.com', status: 'ACTIVE' }] })
      return json({ domain: { id: 'd9', status: 'ACTIVE' } })
    }))

    const r = await attachDomainToKoyeb('a.example.com')
    expect(r).toEqual({ status: 'already_exists', domainId: 'd9', koyebStatus: 'ACTIVE' })
    expect(calls.some(c => c === 'POST https://app.koyeb.com/v1/domains')).toBe(false)
  })

  it('ignores a substring match from the name filter', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      // Koyeb's ?name= filter matches substrings: www.a.example.com must not
      // be mistaken for a.example.com.
      if (url.includes('/domains?name=')) return json({ domains: [{ id: 'd9', name: 'www.a.example.com', status: 'ACTIVE' }] })
      if (url.endsWith('/domains')) return json({ domain: { id: 'd2', status: 'PENDING' } })
      return json({ domain: { id: 'd2', status: 'PENDING' } })
    }))

    expect((await attachDomainToKoyeb('a.example.com')).status).toBe('attached')
  })

  it('reports a quota rejection distinctly', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/domains?name=')) return json({ domains: [] })
      return json({ message: 'You cannot have more than 5 custom domains due to your quota.' }, 400)
    }))

    const r = await attachDomainToKoyeb('a.example.com')
    expect(r.status).toBe('quota_exceeded')
  })

  it('never throws when the API is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    expect((await attachDomainToKoyeb('a.example.com')).status).toBe('error')
  })
})
