import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import net from 'node:net'
import dns from 'node:dns'
import { performance } from 'node:perf_hooks'
import { authOptions } from '@/lib/auth'
import { pingRateLimiter, getClientIdentifier } from '@/lib/rate-limit'
import { isBlockedIp } from '@/lib/ssrf-guard'

// Raw TCP sockets need the Node runtime, not the edge runtime.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// This is NOT ICMP. We open a TCP connection and time the handshake:
// a SYN->SYN-ACK (port open) or SYN->RST (ECONNREFUSED) is one real round
// trip, so the measured RTT is genuine. Only a timeout means unreachable.
// Ports are fixed (443 then 80) — the client cannot pick a port, which keeps
// the endpoint from being usable as a generic port scanner.
const PRIMARY_PORT = 443
const FALLBACK_PORT = 80
const PROBE_TIMEOUT_MS = 2000
const PROBE_GAP_MS = 300
const MAX_COUNT = 8
const DEFAULT_COUNT = 4

const HOST_RE = /^[a-zA-Z0-9._:-]{1,253}$/

interface ProbeResult {
  rttMs: number | null
  ok: boolean
  code?: string // TIMEOUT | ECONNREFUSED | EHOSTUNREACH | ...
}

function probeOnce(ip: string, port: number): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const start = performance.now()
    let settled = false
    const finish = (r: ProbeResult) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(r)
    }
    const socket = net.connect({ host: ip, port })
    socket.setTimeout(PROBE_TIMEOUT_MS)
    socket.once('connect', () => finish({ rttMs: performance.now() - start, ok: true }))
    socket.once('timeout', () => finish({ rttMs: null, ok: false, code: 'TIMEOUT' }))
    socket.once('error', (err: NodeJS.ErrnoException) => {
      // A refused connection (RST) still completed a round trip → real RTT, reachable.
      if (err.code === 'ECONNREFUSED') {
        finish({ rttMs: performance.now() - start, ok: true, code: 'ECONNREFUSED' })
      } else {
        finish({ rttMs: null, ok: false, code: err.code || 'ERROR' })
      }
    })
  })
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function POST(request: NextRequest) {
  try {
    // Student-typed hosts → require a logged-in user so probes are attributable.
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
    }

    const identifier = getClientIdentifier(request)
    const rateLimit = pingRateLimiter.check(identifier)
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { ok: false, error: 'rate-limited', retryAfter: rateLimit.retryAfter },
        {
          status: 429,
          headers: {
            'Retry-After': rateLimit.retryAfter?.toString() || '60',
            'X-RateLimit-Limit': '20',
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': new Date(rateLimit.resetAt).toISOString(),
          },
        }
      )
    }

    const body = await request.json().catch(() => ({}))
    const host = typeof body.host === 'string' ? body.host.trim() : ''
    const count = Math.min(MAX_COUNT, Math.max(1, Number(body.count) || DEFAULT_COUNT))

    if (!host || !HOST_RE.test(host)) {
      return NextResponse.json({ ok: false, error: 'invalid-host' }, { status: 400 })
    }

    // Resolve server-side. A bad name is a normal ping outcome (200), so the
    // client can render "cannot resolve host" rather than treating it as an error.
    let ip: string
    try {
      const resolved = await dns.promises.lookup(host, { all: true })
      if (!resolved.length) {
        return NextResponse.json({ ok: false, error: 'name-not-resolved', host })
      }
      ip = resolved[0].address
    } catch {
      return NextResponse.json({ ok: false, error: 'name-not-resolved', host })
    }

    if (isBlockedIp(ip)) {
      return NextResponse.json({ ok: false, error: 'blocked-host', host }, { status: 403 })
    }

    // Pick a port: try 443; if it times out (firewall drop), retry on 80.
    let port = PRIMARY_PORT
    const probes: Array<{ seq: number; rttMs: number | null; ok: boolean }> = []
    let first = await probeOnce(ip, PRIMARY_PORT)
    if (!first.ok && first.code === 'TIMEOUT') {
      const alt = await probeOnce(ip, FALLBACK_PORT)
      if (alt.ok) {
        port = FALLBACK_PORT
        first = alt
      }
    }
    probes.push({ seq: 0, rttMs: first.rttMs, ok: first.ok })

    for (let seq = 1; seq < count; seq++) {
      await sleep(PROBE_GAP_MS)
      const r = await probeOnce(ip, port)
      probes.push({ seq, rttMs: r.rttMs, ok: r.ok })
    }

    const times = probes.filter((p) => p.ok && p.rttMs != null).map((p) => p.rttMs as number)
    const recv = times.length
    const sent = probes.length
    const avg = recv ? times.reduce((a, b) => a + b, 0) / recv : 0
    const mdev = recv
      ? Math.sqrt(times.reduce((a, b) => a + (b - avg) ** 2, 0) / recv)
      : 0

    return NextResponse.json({
      ok: true,
      host,
      ip,
      port,
      probes,
      stats: {
        sent,
        recv,
        lossPct: sent ? ((sent - recv) / sent) * 100 : 0,
        min: recv ? Math.min(...times) : 0,
        avg,
        max: recv ? Math.max(...times) : 0,
        mdev,
      },
    })
  } catch (error) {
    console.error('ping error:', error)
    return NextResponse.json({ ok: false, error: 'internal' }, { status: 500 })
  }
}
