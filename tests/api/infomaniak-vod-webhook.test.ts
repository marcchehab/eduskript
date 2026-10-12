/**
 * Infomaniak VOD callback: bearer/token auth, and that duplicate deliveries
 * just re-run the (idempotent) sync for every row sharing the media.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const sync = vi.hoisted(() => ({
  findVideosByMediaId: vi.fn(async () => ['v1', 'v1-copy']),
  syncInfomaniakVideo: vi.fn(async () => ({ status: 'ready' })),
}))
vi.mock('@/lib/video-sync.server', () => sync)
const invalidate = vi.hoisted(() => vi.fn())
vi.mock('@/lib/skript-files.server', () => ({ invalidateSkriptFiles: invalidate }))

function callback(opts: { auth?: string; query?: string; body?: unknown } = {}) {
  return new NextRequest(`http://localhost/api/webhooks/infomaniak-vod${opts.query ?? ''}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(opts.auth ? { authorization: opts.auth } : {}) },
    body: JSON.stringify(opts.body ?? { id: 'MEDIA1', notification_event: ['MEDIA_READY'] }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('INFOMANIAK_VOD_CALLBACK_SECRET', 'cb-secret')
})

describe('POST /api/webhooks/infomaniak-vod', () => {
  it('rejects calls without or with a wrong secret', async () => {
    const { POST } = await import('@/app/api/webhooks/infomaniak-vod/route')
    expect((await POST(callback())).status).toBe(401)
    expect((await POST(callback({ auth: 'Bearer nope' }))).status).toBe(401)
    expect((await POST(callback({ query: '?token=nope' }))).status).toBe(401)
    expect(sync.syncInfomaniakVideo).not.toHaveBeenCalled()
  })

  it('rejects everything when no secret is configured', async () => {
    vi.stubEnv('INFOMANIAK_VOD_CALLBACK_SECRET', '')
    const { POST } = await import('@/app/api/webhooks/infomaniak-vod/route')
    expect((await POST(callback({ auth: 'Bearer ' }))).status).toBe(401)
  })

  it('accepts the bearer header or ?token= and syncs every row of the media', async () => {
    const { POST } = await import('@/app/api/webhooks/infomaniak-vod/route')
    const res = await POST(callback({ auth: 'Bearer cb-secret' }))
    expect(res.status).toBe(200)
    expect(sync.findVideosByMediaId).toHaveBeenCalledWith('MEDIA1')
    expect(sync.syncInfomaniakVideo.mock.calls.map(c => (c as unknown[])[0])).toEqual(['v1', 'v1-copy'])
    expect(invalidate).toHaveBeenCalled()

    expect((await POST(callback({ query: '?token=cb-secret' }))).status).toBe(200)
  })

  it('handles duplicate deliveries by re-syncing (no extra state)', async () => {
    const { POST } = await import('@/app/api/webhooks/infomaniak-vod/route')
    const results = await Promise.all([1, 2, 3].map(() => POST(callback({ auth: 'Bearer cb-secret' }))))
    expect(results.every(r => r.status === 200)).toBe(true)
    expect(sync.syncInfomaniakVideo).toHaveBeenCalledTimes(6)
  })

  it('ignores payloads without a media id', async () => {
    const { POST } = await import('@/app/api/webhooks/infomaniak-vod/route')
    const res = await POST(callback({ auth: 'Bearer cb-secret', body: { notification_event: ['X'] } }))
    expect(res.status).toBe(200)
    expect(sync.findVideosByMediaId).not.toHaveBeenCalled()
  })
})
