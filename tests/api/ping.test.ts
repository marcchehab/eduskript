import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { EventEmitter } from 'node:events'

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))

// Controllable mocks for DNS resolution and TCP connect behaviour.
let mockLookup: (host: string, opts: unknown) => Promise<Array<{ address: string; family: number }>>
let socketScript: (socket: EventEmitter & { setTimeout: () => void; destroy: () => void }) => void

vi.mock('node:dns', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  const promises = { lookup: (h: string, o: unknown) => mockLookup(h, o) }
  return { ...actual, default: { ...(actual.default as object), promises }, promises }
})

// Self-contained: importOriginal() returns an incomplete module for node
// builtins under vitest, so we supply our own isIPv4/isIPv6 (sufficient for the
// test IPs) and a fake connect driven by socketScript.
vi.mock('node:net', () => {
  const isIPv4 = (s: string) => /^(\d{1,3})(\.\d{1,3}){3}$/.test(s)
  const isIPv6 = (s: string) => !isIPv4(s) && s.includes(':')
  const connect = () => {
    const s = Object.assign(new EventEmitter(), {
      setTimeout: vi.fn(),
      destroy: vi.fn(),
    })
    queueMicrotask(() => socketScript(s))
    return s
  }
  const mod = { isIPv4, isIPv6, connect }
  return { ...mod, default: mod }
})

import { getServerSession } from 'next-auth'
import { POST, isBlockedIp } from '@/app/api/tools/ping/route'
import { clearAllRateLimits } from '@/lib/rate-limit'

const mockedSession = vi.mocked(getServerSession)

const makeReq = (body: object) =>
  new NextRequest('http://localhost/api/tools/ping', {
    method: 'POST',
    body: JSON.stringify(body),
  })

beforeEach(() => {
  clearAllRateLimits()
  mockLookup = async () => [{ address: '93.184.216.34', family: 4 }]
  socketScript = (s) => s.emit('connect') // reachable by default
  mockedSession.mockResolvedValue({ user: { id: 'u1' } } as never) // logged in by default
})

describe('isBlockedIp', () => {
  it('blocks private, loopback, link-local, CGNAT and multicast IPv4', () => {
    for (const ip of ['10.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.1.1',
      '127.0.0.1', '169.254.1.1', '100.64.0.1', '224.0.0.1', '0.0.0.0']) {
      expect(isBlockedIp(ip), ip).toBe(true)
    }
  })

  it('allows public IPv4', () => {
    for (const ip of ['93.184.216.34', '8.8.8.8', '1.1.1.1', '172.15.0.1', '172.32.0.1']) {
      expect(isBlockedIp(ip), ip).toBe(false)
    }
  })

  it('blocks IPv6 loopback, ULA, link-local, multicast and mapped-private', () => {
    for (const ip of ['::1', 'fd00::1', 'fe80::1', 'ff02::1', '::ffff:10.0.0.1']) {
      expect(isBlockedIp(ip), ip).toBe(true)
    }
  })

  it('allows public IPv6', () => {
    expect(isBlockedIp('2606:4700:4700::1111')).toBe(false)
  })
})

describe('POST /api/tools/ping', () => {
  it('returns 401 when not logged in', async () => {
    mockedSession.mockResolvedValue(null)
    const res = await POST(makeReq({ host: 'example.com' }))
    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe('unauthorized')
  })

  it('rejects an invalid host', async () => {
    const res = await POST(makeReq({ host: 'bad host!' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid-host')
  })

  it('returns name-not-resolved when DNS fails', async () => {
    mockLookup = async () => {
      throw Object.assign(new Error('nope'), { code: 'ENOTFOUND' })
    }
    const res = await POST(makeReq({ host: 'nonexistent.invalid' }))
    expect(res.status).toBe(200)
    expect((await res.json()).error).toBe('name-not-resolved')
  })

  it('blocks hosts that resolve to a private address (403)', async () => {
    mockLookup = async () => [{ address: '192.168.0.1', family: 4 }]
    const res = await POST(makeReq({ host: 'internal.example' }))
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('blocked-host')
  })

  it('reports a reachable host with real rtt on connect', async () => {
    const res = await POST(makeReq({ host: 'example.com', count: 2 }))
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.ip).toBe('93.184.216.34')
    expect(json.stats.recv).toBe(2)
    expect(json.stats.lossPct).toBe(0)
    expect(json.probes[0].rttMs).toBeGreaterThanOrEqual(0)
  })

  it('counts ECONNREFUSED (RST) as reachable with a real rtt', async () => {
    socketScript = (s) => s.emit('error', Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }))
    const res = await POST(makeReq({ host: 'example.com', count: 1 }))
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.stats.recv).toBe(1)
    expect(json.probes[0].ok).toBe(true)
  })

  it('treats a timeout as unreachable (loss)', async () => {
    socketScript = (s) => s.emit('timeout')
    const res = await POST(makeReq({ host: 'example.com', count: 1 }))
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.stats.recv).toBe(0)
    expect(json.stats.lossPct).toBe(100)
    expect(json.probes[0].ok).toBe(false)
  })

  it('rate-limits after 20 probes from the same client', async () => {
    let last: Response | undefined
    for (let i = 0; i < 21; i++) last = await POST(makeReq({ host: 'example.com', count: 1 }))
    expect(last!.status).toBe(429)
    expect((await last!.json()).error).toBe('rate-limited')
  })
})
