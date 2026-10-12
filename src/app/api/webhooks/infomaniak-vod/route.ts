import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { findVideosByMediaId, syncInfomaniakVideo } from '@/lib/video-sync.server'
import { invalidateSkriptFiles } from '@/lib/skript-files.server'

/**
 * POST /api/webhooks/infomaniak-vod — Infomaniak VOD callback.
 *
 * Infomaniak does not sign callbacks. The callback is registered with
 * auth "bearer" and INFOMANIAK_VOD_CALLBACK_SECRET as bearer_token
 * (MIGRATION-VOD.md); `?token=` is accepted too in case a callback has to be
 * registered without auth. Without the env var every call is rejected.
 *
 * The payload is the v1 media object + `notification_event`; we only take its
 * `id` and re-read the media from the v2 API (syncInfomaniakVideo), so any
 * event type works and duplicate/out-of-order deliveries (observed: the same
 * event 3× within a second) converge to the same row state.
 */

function authorized(request: NextRequest, secret: string | undefined): boolean {
  if (!secret) return false
  const header = request.headers.get('authorization') ?? ''
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : ''
  const provided = bearer || request.nextUrl.searchParams.get('token') || ''
  const a = Buffer.from(provided)
  const b = Buffer.from(secret)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function POST(request: NextRequest) {
  if (!authorized(request, process.env.INFOMANIAK_VOD_CALLBACK_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let mediaId: string | undefined
  try {
    const body = await request.json()
    mediaId = typeof body?.id === 'string' ? body.id : undefined
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (!mediaId) return NextResponse.json({ received: true, ignored: 'no media id' })

  try {
    const ids = await findVideosByMediaId(mediaId)
    for (const id of ids) await syncInfomaniakVideo(id)
    // Even when the sync wrote nothing: the migration script pings this after
    // rewriting rows directly in the DB, which the skript-files cache can't see.
    if (ids.length > 0) invalidateSkriptFiles()
    return NextResponse.json({ received: true, videos: ids.length })
  } catch (error) {
    console.error('Infomaniak VOD callback error:', error instanceof Error ? error.message : error)
    // 500 → Infomaniak may retry; the cron/dashboard sync catches it otherwise.
    return NextResponse.json({ error: 'Callback processing failed' }, { status: 500 })
  }
}
