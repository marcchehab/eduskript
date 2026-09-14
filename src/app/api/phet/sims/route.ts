import { NextResponse } from 'next/server'
import { compactPhetCatalogue, PHET_METADATA_URL, type PhetSimSummary } from '@/lib/phet'

/**
 * GET /api/phet/sims — compact PhET catalogue for the editor's PhET picker.
 *
 * Public data, no auth. PhET's raw metadata is ~6.6 MB, so it's fetched
 * server-side and kept in this process's memory for a day. Per-instance cache
 * only (each Koyeb instance fetches once a day); on a failed refresh the stale
 * copy is served rather than an error.
 */

const TTL_MS = 24 * 60 * 60 * 1000

let cache: { at: number; sims: PhetSimSummary[] } | null = null
let inflight: Promise<PhetSimSummary[]> | null = null

async function loadCatalogue(): Promise<PhetSimSummary[]> {
  const res = await fetch(PHET_METADATA_URL, { cache: 'no-store', signal: AbortSignal.timeout(30_000) })
  if (!res.ok) throw new Error(`PhET metadata responded ${res.status}`)
  return compactPhetCatalogue(await res.json())
}

export async function GET() {
  if (!cache || Date.now() - cache.at > TTL_MS) {
    inflight ??= loadCatalogue()
      .then((sims) => {
        cache = { at: Date.now(), sims }
        return sims
      })
      .finally(() => {
        inflight = null
      })
    try {
      await inflight
    } catch (err) {
      console.error('[phet] catalogue refresh failed:', err)
      if (!cache) {
        return NextResponse.json({ error: 'PhET catalogue unavailable' }, { status: 502 })
      }
    }
  }

  return NextResponse.json(
    { sims: cache!.sims },
    { headers: { 'Cache-Control': 'public, max-age=3600' } },
  )
}
