/**
 * Self-hosted video pipeline: upload limits, ffmpeg argument building, HLS
 * master/variant handling, scrub sprites, transcript → VTT, retry policy,
 * provider → playback switch, and the Mux migration planning (dry-run core).
 */
import { describe, it, expect } from 'vitest'
import { VIDEO_LIMITS, videoDimensionProblem, videoSizeProblem } from '@/lib/video-limits'
import { getVideoPlayback, isVideoPending } from '@/lib/video-playback'
import { parseThumbnailsVtt } from '@/components/markdown/hls-video'
import {
  LIMITS, PermanentError, dimensionProblem, parseProbe, validateProbe, planRenditions, outputFps,
  buildEncodeArgs, buildHlsArgs, avc1Codec, playlistBandwidth, buildMasterPlaylist, pickHlsVariant,
  thumbnailPlan, buildThumbnailsVtt, transcriptToCues, cuesToVtt, languageInfo, isSilent,
  contentTypeFor, failureOutcome, parseProgressLine,
  // @ts-expect-error — plain .mjs without type declarations
} from '../../scripts/video-worker/lib.mjs'
// @ts-expect-error — plain .mjs without type declarations
import { planMigration, flippedMetadata, parseArgs, muxSourceUrl } from '../../scripts/migrate-mux-to-self.mjs'

describe('resolution / size guard', () => {
  it('app and worker use the same limits', () => {
    expect(LIMITS).toEqual({ ...VIDEO_LIMITS })
  })

  it('accepts up to 1080p in either orientation', () => {
    for (const [w, h] of [[1920, 1080], [1080, 1920], [1280, 720], [1440, 1080], [640, 360]]) {
      expect(videoDimensionProblem(w, h)).toBeNull()
      expect(dimensionProblem(w, h)).toBeNull()
    }
  })

  it('refuses anything above 1080p with a clear English message', () => {
    for (const [w, h] of [[3840, 2160], [2160, 3840], [2560, 1440], [1920, 1200], [2048, 1080]]) {
      const msg = videoDimensionProblem(w, h)
      expect(msg).toMatch(/up to 1080p/)
      expect(dimensionProblem(w, h)).toBe(msg)
    }
  })

  it('refuses files over 2 GB', () => {
    expect(videoSizeProblem(2 * 1024 ** 3)).toBeNull()
    expect(videoSizeProblem(2 * 1024 ** 3 + 1)).toMatch(/limit is 2 GB/)
  })
})

describe('ffprobe parsing + validation', () => {
  const probe = (video: Record<string, unknown>, extra: Record<string, unknown>[] = [], duration = '60') => ({
    streams: [{ codec_type: 'video', width: 1920, height: 1080, avg_frame_rate: '30000/1001', ...video }, ...extra],
    format: { duration },
  })

  it('applies rotation metadata to the dimensions (portrait phone video)', () => {
    const info = parseProbe(probe({ side_data_list: [{ rotation: -90 }] }, [{ codec_type: 'audio' }]))
    expect(info).toMatchObject({ width: 1080, height: 1920, hasAudio: true })
    expect(info.fps).toBeCloseTo(29.97, 2)
  })

  it('rejects a 4K source, a file without video, and over-long videos permanently', () => {
    expect(() => validateProbe(parseProbe(probe({ width: 3840, height: 2160 })))).toThrow(PermanentError)
    expect(() => parseProbe({ streams: [{ codec_type: 'audio' }], format: { duration: '3' } })).toThrow(/no video stream/)
    expect(() => validateProbe(parseProbe(probe({}, [], String(3 * 3600))))).toThrow(/limit is 2 hours/)
  })

  it('ignores cover-art pseudo video streams', () => {
    expect(() => parseProbe({ streams: [{ codec_type: 'video', disposition: { attached_pic: 1 } }], format: {} })).toThrow(PermanentError)
  })
})

describe('rendition planning + ffmpeg args', () => {
  it('720p + 480p for 1080p, never upscales, even dimensions, portrait aware', () => {
    expect(planRenditions(1920, 1080).map((r: { width: number; height: number }) => `${r.width}x${r.height}`)).toEqual(['1280x720', '854x480'])
    expect(planRenditions(1080, 1920).map((r: { width: number; height: number }) => `${r.width}x${r.height}`)).toEqual(['720x1280', '480x854'])
    expect(planRenditions(641, 361).map((r: { name: string }) => r.name)).toEqual(['360p'])
    const odd = planRenditions(1001, 541)
    for (const r of odd) expect(r.width % 2 + r.height % 2).toBe(0)
  })

  it('caps frame rate at 30 and makes VFR constant', () => {
    expect(outputFps(59.94)).toBe(30)
    expect(outputFps(29.6)).toBe(30)
    expect(outputFps(30000 / 1001)).toBeCloseTo(29.97, 2)
    expect(outputFps(25)).toBe(25)
    expect(outputFps(undefined)).toBe(30)
  })

  it('one encode run: split filter, yuv420p, 4 s keyframes, bitrate caps, faststart MP4s', () => {
    const args = buildEncodeArgs({ input: 'in.mov', renditions: planRenditions(1920, 1080), fps: 60, hasAudio: true, outDir: '/w', threads: 2 })
    const joined = args.join(' ')
    expect(joined).toContain('[0:v:0]fps=30,format=yuv420p,setsar=1,split=2[s0][s1]')
    expect(joined).toContain('scale=1280:720')
    expect(joined).toContain('-preset veryfast')
    expect(joined).toContain('-maxrate 3000k')
    expect(joined).toContain('expr:gte(t,n_forced*4)')
    expect(args.filter((a: string) => a === '+faststart')).toHaveLength(2)
    expect(args).toContain('/w/720p.mp4')
    expect(args).toContain('/w/480p.mp4')
    expect(joined).toContain('-map 0:a:0')
  })

  it('silent source → no audio streams; separate HLS audio rendition → second input', () => {
    const silent = buildEncodeArgs({ input: 'x', renditions: planRenditions(1280, 720), fps: 30, hasAudio: false, outDir: '/w' })
    expect(silent).toContain('-an')
    expect(silent).not.toContain('aac')
    const two = buildEncodeArgs({ input: 'v.m3u8', audioInput: 'a.m3u8', renditions: planRenditions(1280, 720), fps: 30, hasAudio: true, outDir: '/w' })
    expect(two.filter((a: string) => a === '-i')).toHaveLength(2)
    expect(two.join(' ')).toContain('-map 1:a:0')
  })

  it('HLS remux copies streams into 4 s MPEG-TS segments', () => {
    const args = buildHlsArgs('/w/720p.mp4', '/w/out/720p').join(' ')
    expect(args).toContain('-c copy')
    expect(args).toContain('-hls_time 4')
    expect(args).toContain('-hls_segment_type mpegts')
    expect(args).toContain('-hls_playlist_type vod')
  })

  it('master playlist with bandwidth, resolution and codecs', () => {
    expect(avc1Codec('High', 31)).toBe('avc1.64001f')
    expect(avc1Codec('Main', 30)).toBe('avc1.4d001e')
    const bw = playlistBandwidth('#EXTM3U\n#EXTINF:4.0,\na.ts\n#EXTINF:4.0,\nb.ts\n#EXT-X-ENDLIST', (s: string) => (s === 'a.ts' ? 1_000_000 : 500_000))
    expect(bw).toEqual({ peak: 2_000_000, average: 1_500_000 })
    const master = buildMasterPlaylist([{ name: '720p', width: 1280, height: 720, bandwidth: 2_000_000, averageBandwidth: 1_500_000, codecs: 'avc1.64001f,mp4a.40.2', fps: 30 }])
    expect(master).toContain('RESOLUTION=1280x720,CODECS="avc1.64001f,mp4a.40.2"')
    expect(master).toContain('\n720p/index.m3u8\n')
  })

  it('parses ffmpeg -progress lines', () => {
    expect(parseProgressLine('out_time_us=12500000')).toBe(12.5)
    expect(parseProgressLine('frame=12')).toBeNull()
  })
})

describe('Mux HLS source', () => {
  const master = `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio-hi-0",NAME="Default",URI="https://m.example/audio.m3u8?x=1"
#EXT-X-STREAM-INF:BANDWIDTH=9000000,AVERAGE-BANDWIDTH=9000000,RESOLUTION=3840x2160,AUDIO="audio-hi-0"
https://m.example/4k.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1390400,AVERAGE-BANDWIDTH=1390400,CODECS="mp4a.40.2,avc1.64002a",AUDIO="audio-hi-0",RESOLUTION=1920x1080
https://m.example/1080.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=341000,AVERAGE-BANDWIDTH=341000,AUDIO="audio-hi-0",RESOLUTION=854x480
480.m3u8
`
  it('picks the best variant ≤1080p and its separate audio rendition', () => {
    expect(pickHlsVariant(master, 'https://stream.mux.com/P.m3u8')).toEqual({
      url: 'https://m.example/1080.m3u8', width: 1920, height: 1080, audioUrl: 'https://m.example/audio.m3u8?x=1',
    })
  })
  it('fails permanently when nothing ≤1080p exists', () => {
    expect(() => pickHlsVariant('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1,RESOLUTION=3840x2160\nx.m3u8\n', 'https://a/')).toThrow(PermanentError)
  })
})

describe('scrub-preview sprites', () => {
  it('one tile per 5 s, 10×10 per sheet, URLs relative to the VTT', () => {
    const plan = thumbnailPlan(512, 1280, 720)
    expect(plan).toMatchObject({ tileW: 160, tileH: 90, count: 103, sheets: 2 })
    const vtt = buildThumbnailsVtt(plan, 512)
    expect(vtt).toContain('00:00:05.000 --> 00:00:10.000\nsprite_001.jpg#xywh=160,0,160,90')
    expect(vtt).toContain('sprite_002.jpg#xywh=0,0,160,90')
    const cues = parseThumbnailsVtt(vtt, 'https://s3.example/b/videos/u/thumbs/thumbnails.vtt')
    expect(cues).toHaveLength(103)
    expect(cues[101]).toMatchObject({ url: 'https://s3.example/b/videos/u/thumbs/sprite_002.jpg', x: 160, y: 0, start: 505 })
  })
})

describe('captions', () => {
  it('builds readable cues from word timestamps, drops no-speech segments, offsets chunks', () => {
    const result = {
      language: 'german',
      segments: [
        { start: 0, end: 4, text: ' Guten Tag. Dies ist ein Test.', no_speech_prob: 0.01 },
        { start: 10, end: 12, text: ' Untertitel im Auftrag des ZDF', no_speech_prob: 0.95 },
      ],
      words: [
        { start: 0, end: 0.4, word: ' Guten' }, { start: 0.4, end: 0.8, word: ' Tag.' },
        { start: 1.0, end: 1.3, word: ' Dies' }, { start: 1.3, end: 1.5, word: ' ist' },
        { start: 1.5, end: 1.7, word: ' ein' }, { start: 1.7, end: 2.2, word: ' Test.' },
        { start: 10, end: 12, word: ' Untertitel' },
      ],
    }
    const cues = transcriptToCues(result, 1200)
    expect(cues.map((c: { text: string }) => c.text)).toEqual(['Guten Tag. Dies ist ein Test.'])
    expect(cues[0].start).toBe(1200)
    const vtt = cuesToVtt(cues)
    expect(vtt).toContain('00:20:00.000 --> 00:20:02.200')
    expect(languageInfo('german')).toEqual({ lang: 'de', label: 'Deutsch (auto)' })
    expect(languageInfo('klingon')).toEqual({ lang: 'und', label: 'Subtitles (auto)' })
  })

  it('splits long segments without word timings', () => {
    const text = 'Ein sehr langer Satz ohne Wortzeiten, der auf mehrere Untertitel verteilt werden muss, damit er lesbar bleibt und nicht den halben Bildschirm füllt.'
    const cues = transcriptToCues({ segments: [{ start: 0, end: 10, text }] })
    expect(cues.length).toBeGreaterThan(1)
    expect(cues.every((c: { text: string }) => c.text.length <= 80)).toBe(true)
    expect(cues[cues.length - 1].end).toBeCloseTo(10)
  })

  it('detects silent audio from volumedetect', () => {
    expect(isSilent('[Parsed_volumedetect_0] max_volume: -91.0 dB')).toBe(true)
    expect(isSilent('[Parsed_volumedetect_0] max_volume: -inf dB')).toBe(true)
    expect(isSilent('[Parsed_volumedetect_0] max_volume: -3.2 dB')).toBe(false)
  })
})

describe('retry policy', () => {
  it('retries transient failures with backoff up to 3 attempts; permanent failures fail at once', () => {
    expect(failureOutcome({ attempts: 1, permanent: false })).toEqual({ status: 'queued', retryInSeconds: 60 })
    expect(failureOutcome({ attempts: 2, permanent: false })).toEqual({ status: 'queued', retryInSeconds: 120 })
    expect(failureOutcome({ attempts: 3, permanent: false })).toEqual({ status: 'failed', retryInSeconds: null })
    expect(failureOutcome({ attempts: 1, permanent: true })).toEqual({ status: 'failed', retryInSeconds: null })
  })

  it('serves outputs with the right content types', () => {
    expect(contentTypeFor('master.m3u8')).toBe('application/vnd.apple.mpegurl')
    expect(contentTypeFor('720p/seg_0001.ts')).toBe('video/mp2t')
    expect(contentTypeFor('captions.de.vtt')).toBe('text/vtt; charset=utf-8')
  })
})

describe('getVideoPlayback (provider switch)', () => {
  const HLS = 'https://s3.pub1.infomaniak.cloud/object/v1/AUTH_x/b/videos/u/master.m3u8'

  it('plays Mux rows from stream.mux.com', () => {
    const p = getVideoPlayback('mux', { playbackId: 'abc', poster: 'https://image.mux.com/abc/t.webp', status: 'ready' })
    expect(p?.hlsUrl).toBe('https://stream.mux.com/abc.m3u8')
  })

  it('plays ready self-hosted rows from S3 with captions and scrub thumbnails', () => {
    const captions = [{ src: 'https://s3/c.de.vtt', lang: 'de', label: 'Deutsch (auto)' }]
    const p = getVideoPlayback('self', { status: 'ready', hlsUrl: HLS, poster: 'https://s3/p.jpg', captions, thumbnailsVtt: 'https://s3/t.vtt' })
    expect(p).toEqual({ hlsUrl: HLS, poster: 'https://s3/p.jpg', aspectRatio: undefined, captions, thumbnailsVtt: 'https://s3/t.vtt' })
  })

  it('nothing to play while an upload is queued/encoding; migrated rows fall back to Mux', () => {
    expect(getVideoPlayback('self', { status: 'encoding' })).toBeNull()
    expect(getVideoPlayback('self', { status: 'queued', muxPlaybackId: 'abc' })?.hlsUrl).toBe('https://stream.mux.com/abc.m3u8')
  })

  it('isVideoPending covers waiting/queued/encoding', () => {
    expect(isVideoPending({ status: 'queued' })).toBe(true)
    expect(isVideoPending({ status: 'encoding', progress: 0.5 })).toBe(true)
    expect(isVideoPending({ status: 'errored' })).toBe(false)
    expect(isVideoPending({ status: 'ready' })).toBe(false)
  })
})

describe('migrate-mux-to-self planning (dry-run core)', () => {
  const mux = [
    { id: 'v1', filename: 'a.mp4', metadata: { playbackId: 'P1', status: 'ready' } },
    { id: 'v2', filename: 'a.mp4', metadata: { playbackId: 'P1', status: 'ready' } }, // page-copy duplicate
    { id: 'v3', filename: 'b.mp4', metadata: { playbackId: 'P2', status: 'ready' } },
    { id: 'v4', filename: 'c.mp4', metadata: { status: 'errored' } }, // no playback id
  ]

  it('one job per playbackId (page copies share the output), skips rows without one', () => {
    const plan = planMigration(mux, [], {})
    expect(plan.map((p: { playbackId: string }) => p.playbackId)).toEqual(['P1', 'P2'])
    expect(plan[0].rows.map((r: { id: string }) => r.id)).toEqual(['v1', 'v2'])
    expect(muxSourceUrl('P1')).toBe('https://stream.mux.com/P1.m3u8')
  })

  it('reuses the job of an earlier run (resumable); --limit counts new jobs only', () => {
    const migrated = [{ id: 'v9', metadata: { muxPlaybackId: 'P1' }, encode_job_id: 'JOB1' }]
    const plan = planMigration(mux, migrated, { limit: 0 })
    expect(plan).toEqual([{ playbackId: 'P1', rows: mux.slice(0, 2), reuseJobId: 'JOB1' }])
  })

  it('--id targets a single video', () => {
    expect(planMigration(mux, [], { id: 'v3' }).map((p: { rows: { id: string }[] }) => p.rows[0].id)).toEqual(['v3'])
  })

  it('flipped rows keep the Mux id (fallback/rollback) and are queued', () => {
    expect(flippedMetadata({ playbackId: 'P1', poster: 'x', aspectRatio: 1.5, status: 'ready' })).toEqual({
      poster: 'x', aspectRatio: 1.5, status: 'queued', muxPlaybackId: 'P1',
    })
    expect(parseArgs(['--dry-run', '--limit', '1', '--id', 'v3'])).toMatchObject({ dryRun: true, limit: 1, id: 'v3' })
  })
})
