import { NextRequest, NextResponse } from 'next/server'
import { mergeShipped } from '@/lib/metrics/buffer'

/**
 * Receives buffered counters from the proxy bundle.
 *
 * The proxy is the only runtime that sees every request (an ISR cache hit never
 * reaches the page component), but it has its own module instance of the
 * metrics buffer and never touches Prisma — so it has no open DB connection to
 * ride and would only persist at shutdown, if it were signalled at all. It
 * ships its buffer here instead; this runtime merges it and writes it out on
 * the next query that was going to happen anyway.
 *
 * Localhost-only by construction: the proxy calls it over
 * http://localhost:$PORT and the matcher in src/proxy.ts excludes
 * /api/internal, so it is not reachable through the public edge.
 */
export async function POST(request: NextRequest) {
  try {
    const payload = await request.json()
    mergeShipped({
      metrics: Array.isArray(payload?.metrics) ? payload.metrics : [],
      paths: Array.isArray(payload?.paths) ? payload.paths : [],
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[Metrics] Ingest failed:', error)
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }
}
