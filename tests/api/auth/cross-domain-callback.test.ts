import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  prisma: {
    crossDomainToken: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
    teacherCustomDomain: { findFirst: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }))
vi.mock('next-auth/jwt', () => ({ encode: vi.fn(async () => 'encoded-jwt') }))

import { GET } from '@/app/api/auth/cross-domain-callback/route'
import { isTunnelDomain, safeReturnPath } from '@/lib/cross-domain-auth'

const call = (query: string, host: string) =>
  GET(new NextRequest(`http://internal/api/auth/cross-domain-callback?${query}`, { headers: { host } }))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.prisma.crossDomainToken.findUnique.mockResolvedValue({
    id: 't1', domain: 'teacher.example', expiresAt: new Date(Date.now() + 60_000), usedAt: null,
    user: { id: 'u1', sites: [] },
  })
  mocks.prisma.teacherCustomDomain.findFirst.mockResolvedValue(null)
})

describe('safeReturnPath / isTunnelDomain', () => {
  it('accepts only same-host relative paths', () => {
    expect(safeReturnPath('/a/b?x=1')).toBe('/a/b?x=1')
    for (const bad of ['https://evil.example/x', '//evil.example/x', '/\\evil.example', 'evil', '', null, '/\u0000x']) {
      expect(safeReturnPath(bad as string | null)).toBe('/')
    }
  })

  it('recognises tunnel hosts with port / www', () => {
    expect(isTunnelDomain('abc.ngrok-free.app:443')).toBe(true)
    expect(isTunnelDomain('www.abc.ngrok.io')).toBe(true)
    expect(isTunnelDomain('informatikgarten.ch')).toBe(false)
    expect(isTunnelDomain('ngrok.io.evil.example')).toBe(false)
  })
})

describe('GET /api/auth/cross-domain-callback', () => {
  it('rejects the jwt branch on non-tunnel hosts (no cookie, no redirect)', async () => {
    const res = await call('jwt=attacker&returnPath=/x', 'informatikgarten.ch')
    expect(res.status).toBe(400)
    expect(res.headers.get('set-cookie')).toBeNull()
  })

  it('jwt branch on a tunnel host redirects only to a relative path on that host', async () => {
    const res = await call(`jwt=j&returnPath=${encodeURIComponent('https://evil.example/p')}`, 'abc.ngrok-free.app')
    expect(res.headers.get('location')).toBe('https://abc.ngrok-free.app/')
    const ok = await call('jwt=j&returnPath=/page', 'abc.ngrok-free.app')
    expect(ok.headers.get('location')).toBe('https://abc.ngrok-free.app/page')
  })

  it('token branch ignores absolute / protocol-relative returnPath', async () => {
    for (const rp of ['//evil.example/x', 'https://evil.example/x', '/\\evil.example']) {
      const res = await call(`token=abc&returnPath=${encodeURIComponent(rp)}`, 'teacher.example')
      expect(res.headers.get('location'), rp).toBe('https://teacher.example/')
    }
  })
})
