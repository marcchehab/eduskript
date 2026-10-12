/**
 * Self-hosted video pipeline: upload limits, ffmpeg argument building, HLS
 * master playlist, scrub sprites, transcript → VTT, retry policy,
 * provider → playback switch, and the Mux migration planning (dry-run core).
 */
import { describe, it, expect } from 'vitest'
import { VIDEO_LIMITS, videoDimensionProblem, videoSizeProblem } from '@/lib/video-limits'
import { getVideoPlayback, isVideoPending } from '@/lib/video-playback'
import { parseThumbnailsVtt } from '@/components/markdown/hls-video'
import {
  LIMITS, PermanentError, dimensionProblem, parseProbe, validateProbe, planRenditions, outputFps,
  buildEncodeArgs, buildHlsArgs, avc1Codec, playlistBandwidth, buildMasterPlaylist,
  thumbnailPlan, buildThumbnailsVtt, transcriptToCues, cuesToVtt, languageInfo, isSilent,
  contentTypeFor, failureOutcome, parseProgressLine,
  // @ts-expect-error — plain .mjs without type declarations
} from '../../scripts/video-worker/lib.mjs'
// @ts-expect-error — plain .mjs without type declarations

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
  it('1080p + 720p + 480p for 1080p sources, 720p + 480p below, never upscales, even dimensions, portrait aware', () => {
    const dims = (w: number, h: number) => planRenditions(w, h).map((r: { width: number; height: number }) => `${r.width}x${r.height}`)
    expect(dims(1920, 1080)).toEqual(['1920x1080', '1280x720', '854x480'])
    expect(dims(1080, 1920)).toEqual(['1080x1920', '720x1280', '480x854'])
    expect(dims(1440, 900)).toEqual(['1152x720', '768x480'])
    expect(planRenditions(1920, 1080)[0]).toMatchObject({ crf: 23, maxrateK: 5000 })
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
    expect(joined).toContain('[0:v:0]fps=30,format=yuv420p,setsar=1,split=3[s0][s1][s2]')
    expect(joined).toContain('scale=1920:1080')
    expect(joined).toContain('scale=1280:720')
    expect(joined).toContain('-preset veryfast')
    expect(joined).toContain('-maxrate 3000k')
    expect(joined).toContain('expr:gte(t,n_forced*4)')
    expect(args.filter((a: string) => a === '+faststart')).toHaveLength(3)
    expect(args.filter((a: string) => a === 'expr:gte(t,n_forced*4)')).toHaveLength(3) // same GOP grid in every rung
    expect(args).toContain('/w/720p.mp4')
    expect(args).toContain('/w/480p.mp4')
    expect(joined).toContain('-map 0:a:0')
  })

  it('silent source → no audio streams', () => {
    const silent = buildEncodeArgs({ input: 'x', renditions: planRenditions(1280, 720), fps: 30, hasAudio: false, outDir: '/w' })
    expect(silent).toContain('-an')
    expect(silent).not.toContain('aac')
  })

  it('HLS remux copies streams into 4 s fMP4 segments (no transmux in the browser)', () => {
    const args = buildHlsArgs('/w/720p.mp4', '/w/out/720p').join(' ')
    expect(args).toContain('-c copy')
    expect(args).toContain('-hls_time 4')
    expect(args).toContain('-hls_segment_type fmp4')
    expect(args).toContain('seg_%04d.m4s')
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
    expect(contentTypeFor('720p/seg_0001.m4s')).toBe('video/iso.segment')
    expect(contentTypeFor('720p/init.mp4')).toBe('video/mp4')
    expect(contentTypeFor('captions.de.vtt')).toBe('text/vtt; charset=utf-8')
  })
})

describe('getVideoPlayback (provider switch)', () => {
  const HLS = 'https://s3.pub1.infomaniak.cloud/object/v1/AUTH_x/b/videos/u/master.m3u8'

  it('legacy provider "mux" rows are not playable', () => {
    expect(getVideoPlayback('mux', { playbackId: 'abc', status: 'ready' })).toBeNull()
  })

  it('plays ready self-hosted rows from S3 with captions and scrub thumbnails', () => {
    const captions = [{ src: 'https://s3/c.de.vtt', lang: 'de', label: 'Deutsch (auto)' }]
    const p = getVideoPlayback('self', { status: 'ready', hlsUrl: HLS, poster: 'https://s3/p.jpg', captions, thumbnailsVtt: 'https://s3/t.vtt' })
    expect(p).toEqual({ hlsUrl: HLS, poster: 'https://s3/p.jpg', aspectRatio: undefined, captions, thumbnailsVtt: 'https://s3/t.vtt' })
  })

  it('nothing to play while an upload is queued/encoding (no fallback via muxPlaybackId)', () => {
    expect(getVideoPlayback('self', { status: 'encoding' })).toBeNull()
    expect(getVideoPlayback('self', { status: 'queued', muxPlaybackId: 'abc' })).toBeNull()
  })

  it('isVideoPending covers waiting/queued/encoding', () => {
    expect(isVideoPending({ status: 'queued' })).toBe(true)
    expect(isVideoPending({ status: 'encoding', progress: 0.5 })).toBe(true)
    expect(isVideoPending({ status: 'errored' })).toBe(false)
    expect(isVideoPending({ status: 'ready' })).toBe(false)
  })
})
