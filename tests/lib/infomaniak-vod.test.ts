/**
 * Infomaniak VOD: response parsing, provider → playback switch, and the
 * Mux migration script's planning/dry-run logic.
 */
import { describe, it, expect } from 'vitest'
import { parseMedia } from '@/lib/infomaniak-vod'
import { getVideoPlayback, isVideoPending } from '@/lib/video-playback'
// @ts-expect-error — plain .mjs script without type declarations
import { planMigration, flippedMetadata, parseArgs } from '../../scripts/migrate-mux-to-infomaniak.mjs'

const HLS = 'https://play.vod2.infomaniak.com/hls/m1/enc/,a,b,.urlset/manifest.m3u8'

function rawMedia(state: string[]) {
  return {
    id: 'm1',
    state,
    duration: '00:07:50.94',
    thumbnails: { poster: 'https://api.infomaniak.com/2/vod/res/thumbnails/p.jpg' },
    streams: {
      singles: [
        { source: 'https://play.vod2.infomaniak.com/single/m1/enc/360.mp4', video_height: 360, container: 'mp4' },
        { source: 'https://play.vod2.infomaniak.com/single/m1/enc/1080.mp4', video_height: 1080, container: 'mp4' },
        { source: 'https://play.vod2.infomaniak.com/single/m1/enc/720.mp4', video_height: 720, container: 'mp4' },
      ],
      adaptatives: [
        { strategy: 'dash', source: 'https://play.vod2.infomaniak.com/dash/x.mpd' },
        { strategy: 'hls', source: HLS },
      ],
      upload: { display_aspect_ratio: '16:9', video_width: 1920, video_height: 1080 },
    },
  }
}

describe('parseMedia', () => {
  it('reads HLS, highest MP4, poster, duration and aspect ratio of a ready media', () => {
    const p = parseMedia(rawMedia(['available', 'ready']))
    expect(p.state).toBe('ready')
    expect(p.hlsUrl).toBe(HLS)
    expect(p.mp4Url).toContain('1080.mp4')
    expect(p.posterUrl).toContain('/thumbnails/p.jpg')
    expect(p.duration).toBeCloseTo(470.94)
    expect(p.aspectRatio).toBeCloseTo(16 / 9)
  })

  it('reports processing while encoding and failed on an error state', () => {
    expect(parseMedia(rawMedia(['encoding', 'available'])).state).toBe('processing')
    expect(parseMedia(rawMedia(['encoding_failed'])).state).toBe('failed')
  })
})

describe('getVideoPlayback (provider switch)', () => {
  it('plays Mux rows from stream.mux.com', () => {
    const p = getVideoPlayback('mux', { playbackId: 'abc', poster: 'https://image.mux.com/abc/t.webp', status: 'ready' })
    expect(p?.hlsUrl).toBe('https://stream.mux.com/abc.m3u8')
    expect(p?.captions).toEqual([])
  })

  it('plays ready Infomaniak rows from their HLS URL with VTT captions', () => {
    const captions = [{ src: 'https://api.infomaniak.com/2/vod/res/subtitles/s.vtt', lang: 'de', label: 'Deutsch' }]
    const p = getVideoPlayback('infomaniak', { status: 'ready', hlsUrl: HLS, poster: 'https://s3/p.jpg', captions })
    expect(p).toEqual({ hlsUrl: HLS, poster: 'https://s3/p.jpg', aspectRatio: undefined, captions })
  })

  it('has nothing to play for an Infomaniak upload still processing', () => {
    expect(getVideoPlayback('infomaniak', { status: 'processing', mediaId: 'm1' })).toBeNull()
  })

  it('keeps a migrated row on its Mux original until Infomaniak is ready', () => {
    const p = getVideoPlayback('infomaniak', { status: 'processing', mediaId: 'm1', muxPlaybackId: 'abc' })
    expect(p?.hlsUrl).toBe('https://stream.mux.com/abc.m3u8')
  })

  it('isVideoPending covers encoding and outstanding captions', () => {
    expect(isVideoPending({ status: 'processing' })).toBe(true)
    expect(isVideoPending({ status: 'ready', captionsStatus: 'pending' })).toBe(true)
    expect(isVideoPending({ status: 'ready', captionsStatus: 'ready' })).toBe(false)
  })
})

describe('migrate-mux-to-infomaniak planning (dry-run core)', () => {
  const mux = [
    { id: 'v1', filename: 'a.mp4', metadata: { playbackId: 'P1', status: 'ready' } },
    { id: 'v2', filename: 'a.mp4', metadata: { playbackId: 'P1', status: 'ready' } }, // page-copy duplicate
    { id: 'v3', filename: 'b.mp4', metadata: { playbackId: 'P2', status: 'ready' } },
    { id: 'v4', filename: 'c.mp4', metadata: { status: 'errored' } }, // no playback id
  ]

  it('groups rows sharing a playbackId into one import and skips rows without one', () => {
    const plan = planMigration(mux, [], {})
    expect(plan.map((p: { playbackId: string }) => p.playbackId)).toEqual(['P1', 'P2'])
    expect(plan[0].rows.map((r: { id: string }) => r.id)).toEqual(['v1', 'v2'])
    expect(plan.every((p: { reuseMediaId: string | null }) => p.reuseMediaId === null)).toBe(true)
  })

  it('reuses media an earlier run created (resumable) and limits only new imports', () => {
    const migrated = [{ id: 'v9', metadata: { muxPlaybackId: 'P1', mediaId: 'MEDIA1' } }]
    const plan = planMigration(mux, migrated, { limit: 0 })
    expect(plan).toHaveLength(1)
    expect(plan[0]).toMatchObject({ playbackId: 'P1', reuseMediaId: 'MEDIA1' })
  })

  it('can target a single video', () => {
    const plan = planMigration(mux, [], { id: 'v3' })
    expect(plan).toHaveLength(1)
    expect(plan[0].rows[0].id).toBe('v3')
  })

  it('flipped metadata keeps the Mux id for fallback/rollback and starts processing', () => {
    const m = flippedMetadata({ playbackId: 'P1', poster: 'x', aspectRatio: 1.5, status: 'ready' }, 'MEDIA1')
    expect(m).toEqual({ poster: 'x', aspectRatio: 1.5, status: 'processing', mediaId: 'MEDIA1', muxPlaybackId: 'P1' })
  })

  it('parses CLI flags', () => {
    expect(parseArgs(['--dry-run', '--limit', '1', '--id', 'v3'])).toMatchObject({ dryRun: true, limit: 1, id: 'v3' })
    expect(parseArgs([]).limit).toBe(Infinity)
  })
})
