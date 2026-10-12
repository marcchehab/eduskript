/**
 * Pure helpers for the video encoder (scripts/video-worker.mjs): limits,
 * ffprobe parsing, rendition planning, ffmpeg argument building, HLS master
 * playlist, scrub-preview sprite VTT, transcript → WebVTT. No I/O here, so
 * everything is unit-tested (tests/lib/video-pipeline.test.ts).
 *
 * Plain .mjs because the worker runs in the production image, which has
 * scripts/ and node_modules but no src/ or tsx.
 */

// Keep in sync with src/lib/video-limits.ts (asserted by a test).
export const LIMITS = {
  maxLongSide: 1920,
  maxShortSide: 1080,
  maxBytes: 2 * 1024 ** 3,
  maxDurationSeconds: 2 * 3600,
}

export const SEGMENT_SECONDS = 4
export const MAX_FPS = 30
export const THUMB_INTERVAL = 5
export const THUMB_WIDTH = 160
export const THUMB_COLS = 10
export const THUMB_ROWS = 10
export const AUDIO_CHUNK_SECONDS = 1200
export const MAX_ATTEMPTS = 3

/** Thrown for problems a retry cannot fix (bad input). Message is shown to the teacher. */
export class PermanentError extends Error {
  constructor(message) {
    super(message)
    this.name = 'PermanentError'
  }
}

/** null when within limits, else an English reason. Orientation-independent. */
export function dimensionProblem(width, height) {
  if (!width || !height) return null
  const long = Math.max(width, height)
  const short = Math.min(width, height)
  if (long > LIMITS.maxLongSide || short > LIMITS.maxShortSide) {
    return `This video is ${width}×${height}. Eduskript accepts videos up to 1080p (1920×1080). Please export it at 1080p or lower and upload it again.`
  }
  return null
}

function parseRate(r) {
  if (!r || typeof r !== 'string') return undefined
  const [n, d] = r.split('/').map(Number)
  if (!n) return undefined
  const v = d ? n / d : n
  return Number.isFinite(v) && v > 0 ? v : undefined
}

/** ffprobe -show_streams -show_format JSON → what the encoder needs. */
export function parseProbe(json) {
  const streams = json?.streams ?? []
  const video = streams.find(s => s.codec_type === 'video' && s.disposition?.attached_pic !== 1)
  if (!video) throw new PermanentError('This file has no video stream.')
  let rotation = 0
  const tagRotate = Number(video.tags?.rotate)
  if (Number.isFinite(tagRotate)) rotation = tagRotate
  for (const sd of video.side_data_list ?? []) {
    if (typeof sd.rotation === 'number') rotation = sd.rotation
  }
  const quarter = Math.abs(Math.round(rotation / 90)) % 2 === 1
  const w = Number(video.width)
  const h = Number(video.height)
  const width = quarter ? h : w
  const height = quarter ? w : h
  const duration = Number(json?.format?.duration ?? video.duration)
  // avg_frame_rate reflects VFR sources better than r_frame_rate (which is
  // the timebase-ish max); fall back to r_frame_rate.
  const fps = parseRate(video.avg_frame_rate) ?? parseRate(video.r_frame_rate)
  return {
    width,
    height,
    duration: Number.isFinite(duration) && duration > 0 ? duration : undefined,
    fps,
    codec: video.codec_name,
    hasAudio: streams.some(s => s.codec_type === 'audio'),
  }
}

/** Throws PermanentError when the probed media must not be encoded. */
export function validateProbe(info) {
  const problem = dimensionProblem(info.width, info.height)
  if (problem) throw new PermanentError(problem)
  if (!info.width || !info.height) throw new PermanentError('Could not read the video dimensions.')
  if (!info.duration) throw new PermanentError('Could not read the video duration.')
  if (info.duration > LIMITS.maxDurationSeconds) {
    throw new PermanentError(`This video is ${Math.round(info.duration / 60)} minutes long. The limit is ${LIMITS.maxDurationSeconds / 3600} hours.`)
  }
}

const even = n => Math.max(2, 2 * Math.round(n / 2))

/**
 * Renditions named by their short side ("720p" is 1280×720 landscape or
 * 720×1280 portrait), highest first. 1080p only for ≥1080p sources (always
 * re-encoded — the original may be HEVC or a very high bitrate). Never
 * upscales: a 540p source gets one 540p rendition.
 */
export function planRenditions(width, height) {
  const short = Math.min(width, height)
  const landscape = width >= height
  const make = (target, crf, maxrateK, audioK) => {
    const s = Math.min(target, short - (short % 2)) // even, never above the source
    const scale = s / short
    const w = landscape ? even(width * scale) : s
    const h = landscape ? s : even(height * scale)
    return { name: `${s}p`, short: s, width: w, height: h, crf, maxrateK, bufsizeK: maxrateK * 2, audioK }
  }
  const out = []
  if (short >= 1080) out.push(make(1080, 23, 5000, 128))
  out.push(make(720, 23, 3000, 128))
  if (short > 480 && out[out.length - 1].short > 480) out.push(make(480, 24, 1200, 96))
  return out
}

/** Output frame rate: source rate capped at 30, constant (fixes VFR phone video). */
export function outputFps(fps) {
  if (!fps || fps > MAX_FPS + 0.5) return MAX_FPS
  // Snap near-integer rates (29.97 stays 29.97, 29.6 VFR average → 30).
  const rounded = Math.round(fps)
  if (Math.abs(fps - 30000 / 1001) < 0.01) return 30000 / 1001
  if (Math.abs(fps - 24000 / 1001) < 0.01) return 24000 / 1001
  return Math.max(1, rounded)
}

/**
 * One ffmpeg run producing an MP4 (faststart) per rendition, with keyframes
 * every SEGMENT_SECONDS so the MP4s can be remuxed into HLS without
 * re-encoding (buildHlsArgs). Autorotation is ffmpeg's default; the filter
 * chain normalises pixel format (10-bit HEVC/AV1/VP9 → yuv420p), SAR and
 * frame rate (VFR → CFR); scale targets are even.
 */
export function buildEncodeArgs({ input, renditions, fps, hasAudio, outDir, threads = 2, preset = 'veryfast', inputArgs = [] }) {
  const n = renditions.length
  const rate = outputFps(fps)
  const fpsExpr = Number.isInteger(rate) ? String(rate) : rate === 30000 / 1001 ? '30000/1001' : '24000/1001'
  const splitOuts = renditions.map((_, i) => `[s${i}]`).join('')
  const chains = renditions.map((r, i) => `[s${i}]scale=${r.width}:${r.height}:flags=bicubic[v${i}]`).join(';')
  const filter = `[0:v:0]fps=${fpsExpr},format=yuv420p,setsar=1,split=${n}${splitOuts};${chains}`
  const args = ['-hide_banner', '-nostdin', '-y', ...inputArgs, '-i', input]
  args.push('-filter_complex', filter)
  renditions.forEach((r, i) => {
    args.push('-map', `[v${i}]`)
    if (hasAudio) args.push('-map', '0:a:0')
    args.push(
      '-c:v', 'libx264', '-preset', preset, '-profile:v', 'high',
      '-crf', String(r.crf), '-maxrate', `${r.maxrateK}k`, '-bufsize', `${r.bufsizeK}k`,
      '-force_key_frames', `expr:gte(t,n_forced*${SEGMENT_SECONDS})`, '-sc_threshold', '0',
      '-threads', String(threads),
    )
    if (hasAudio) args.push('-c:a', 'aac', '-b:a', `${r.audioK}k`, '-ac', '2', '-ar', '48000')
    else args.push('-an')
    args.push('-sn', '-dn', '-map_metadata', '-1', '-movflags', '+faststart', `${outDir}/${r.name}.mp4`)
  })
  args.push('-progress', 'pipe:1', '-nostats')
  return args
}

/**
 * Remux one rendition MP4 into HLS with fragmented-MP4 segments (CMAF-style;
 * hls.js appends them to MSE as-is, Safari/iOS play them natively since
 * iOS 10). Replaced MPEG-TS on 2026-10-12: with TS, hls.js transmuxes every
 * segment in the browser and has to re-derive timestamps (TS adds a 1.4 s
 * offset and interleaves audio ~70 ms ahead of video at each cut, which
 * hls.js patches by injecting silent AAC frames) — fMP4 carries the encoder's
 * timestamps unchanged.
 */
export function buildHlsArgs(mp4, dir) {
  return [
    '-hide_banner', '-nostdin', '-y', '-i', mp4, '-map', '0', '-c', 'copy',
    '-f', 'hls', '-hls_time', String(SEGMENT_SECONDS), '-hls_playlist_type', 'vod',
    '-hls_flags', 'independent_segments', '-hls_segment_type', 'fmp4',
    '-hls_fmp4_init_filename', 'init.mp4',
    '-hls_segment_filename', `${dir}/seg_%04d.m4s`, `${dir}/index.m3u8`,
  ]
}

/** "High", 31 → "avc1.64001f" */
export function avc1Codec(profile, level) {
  const p = { Baseline: '4200', 'Constrained Baseline': '42e0', Main: '4d00', High: '6400' }[profile] ?? '6400'
  const l = Number(level) > 0 ? Number(level) : 31
  return `avc1.${p}${l.toString(16).padStart(2, '0')}`
}

/** Media playlist + segment sizes → { peak, average } bits per second. */
export function playlistBandwidth(playlistText, sizeOf) {
  const lines = playlistText.split('\n')
  let total = 0
  let bytes = 0
  let peak = 0
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^#EXTINF:([\d.]+)/)
    if (!m) continue
    const dur = Number(m[1])
    const seg = lines[i + 1]?.trim()
    const size = seg ? sizeOf(seg) : 0
    total += dur
    bytes += size
    if (dur > 0.5) peak = Math.max(peak, (size * 8) / dur)
  }
  const average = total > 0 ? (bytes * 8) / total : 0
  return { peak: Math.ceil(peak || average), average: Math.ceil(average) }
}

/** variants: [{ name, width, height, bandwidth, averageBandwidth, codecs, fps }] (highest first) */
export function buildMasterPlaylist(variants) {
  const out = ['#EXTM3U', '#EXT-X-VERSION:7', '#EXT-X-INDEPENDENT-SEGMENTS']
  for (const v of variants) {
    out.push(
      `#EXT-X-STREAM-INF:BANDWIDTH=${v.bandwidth},AVERAGE-BANDWIDTH=${v.averageBandwidth},RESOLUTION=${v.width}x${v.height},CODECS="${v.codecs}",FRAME-RATE=${v.fps.toFixed(3)}`,
      `${v.name}/index.m3u8`,
    )
  }
  return out.join('\n') + '\n'
}

export function thumbnailPlan(duration, width, height) {
  const tileH = even((THUMB_WIDTH * height) / width)
  const count = Math.max(1, Math.ceil(duration / THUMB_INTERVAL))
  const perSheet = THUMB_COLS * THUMB_ROWS
  return { interval: THUMB_INTERVAL, tileW: THUMB_WIDTH, tileH, count, perSheet, sheets: Math.ceil(count / perSheet) }
}

export function buildSpriteArgs(input, plan, outDir) {
  return [
    '-hide_banner', '-nostdin', '-y', '-i', input, '-an',
    '-vf', `fps=1/${plan.interval},scale=${plan.tileW}:${plan.tileH},tile=${THUMB_COLS}x${THUMB_ROWS}`,
    '-q:v', '6', `${outDir}/sprite_%03d.jpg`,
  ]
}

function ts(seconds) {
  const ms = Math.max(0, Math.round(seconds * 1000))
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  const r = ms % 1000
  const p = (n, w = 2) => String(n).padStart(w, '0')
  return `${p(h)}:${p(m)}:${p(s)}.${p(r, 3)}`
}

/** WebVTT for scrub previews: one cue per sprite tile, URLs relative to the VTT. */
export function buildThumbnailsVtt(plan, duration) {
  const out = ['WEBVTT', '']
  for (let i = 0; i < plan.count; i++) {
    const start = i * plan.interval
    const end = Math.min((i + 1) * plan.interval, duration)
    if (end <= start) break
    const sheet = Math.floor(i / plan.perSheet) + 1
    const pos = i % plan.perSheet
    const x = (pos % THUMB_COLS) * plan.tileW
    const y = Math.floor(pos / THUMB_COLS) * plan.tileH
    out.push(`${ts(start)} --> ${ts(end)}`, `sprite_${String(sheet).padStart(3, '0')}.jpg#xywh=${x},${y},${plan.tileW},${plan.tileH}`, '')
  }
  return out.join('\n')
}

/** ffmpeg -progress line "out_time_us=…" → seconds, else null */
export function parseProgressLine(line) {
  const m = line.match(/^out_time_(?:us|ms)=(\d+)/)
  return m ? Number(m[1]) / 1e6 : null
}

const LANGS = {
  german: ['de', 'Deutsch'], english: ['en', 'English'], french: ['fr', 'Français'],
  italian: ['it', 'Italiano'], spanish: ['es', 'Español'], portuguese: ['pt', 'Português'],
  dutch: ['nl', 'Nederlands'], romansh: ['rm', 'Rumantsch'],
}

/** Whisper language name/code → { lang, label } (label marks it as automatic). */
export function languageInfo(name) {
  const key = String(name ?? '').toLowerCase()
  const hit = LANGS[key] ?? Object.values(LANGS).find(([code]) => code === key)
  if (hit) return { lang: hit[0], label: `${hit[1]} (auto)` }
  return { lang: 'und', label: 'Subtitles (auto)' }
}

const MAX_CUE_CHARS = 80
const MAX_CUE_SECONDS = 6

/**
 * Whisper verbose_json (segments + optional word timestamps) → cues.
 * Segments Whisper itself rates as probably silent (no_speech_prob > 0.8) are
 * dropped — that is where it hallucinates text. Cues break at sentence ends,
 * ~80 characters, 6 s or a pause > 1.2 s. `offset` shifts chunked audio.
 */
export function transcriptToCues(result, offset = 0) {
  const segments = (result?.segments ?? []).filter(s => !(s.no_speech_prob > 0.8) && String(s.text ?? '').trim())
  const words = result?.words ?? []
  const cues = []
  for (const seg of segments) {
    const ws = words.filter(w => w.start >= seg.start - 0.05 && w.end <= seg.end + 0.05 && String(w.word ?? '').trim())
    if (ws.length === 0) {
      cues.push(...splitText(String(seg.text).trim(), seg.start, seg.end).map(c => ({ ...c, start: c.start + offset, end: c.end + offset })))
      continue
    }
    let cur = null
    ws.forEach((w, i) => {
      const word = String(w.word).trim()
      if (!cur) cur = { start: w.start, end: w.end, text: word }
      else {
        cur.text += ' ' + word
        cur.end = w.end
      }
      const next = ws[i + 1]
      const sentenceEnd = /[.?!…]$/.test(word) && cur.text.length >= 15
      const tooLong = cur.text.length >= MAX_CUE_CHARS || cur.end - cur.start >= MAX_CUE_SECONDS
      const pause = next && next.start - w.end > 1.2
      if (!next || sentenceEnd || tooLong || pause) {
        cues.push({ start: cur.start + offset, end: Math.max(cur.end, cur.start + 0.8) + offset, text: cur.text })
        cur = null
      }
    })
  }
  return cues
}

/** Split a long segment without word timings into ~80-char cues, time proportional to length. */
function splitText(text, start, end) {
  const parts = []
  let buf = ''
  for (const word of text.split(/\s+/)) {
    if (buf && (buf.length + word.length + 1 > MAX_CUE_CHARS || /[.?!]$/.test(buf))) {
      parts.push(buf)
      buf = word
    } else buf = buf ? `${buf} ${word}` : word
  }
  if (buf) parts.push(buf)
  const total = parts.reduce((n, p) => n + p.length, 0) || 1
  let t = start
  return parts.map(p => {
    const d = ((end - start) * p.length) / total
    const cue = { start: t, end: t + d, text: p }
    t += d
    return cue
  })
}

export function cuesToVtt(cues) {
  const out = ['WEBVTT', '']
  for (const c of cues) out.push(`${ts(c.start)} --> ${ts(c.end)}`, c.text.replace(/-->/g, '→'), '')
  return out.join('\n')
}

/** max_volume from ffmpeg volumedetect output; below -45 dB counts as silent. */
export function isSilent(volumedetectStderr) {
  const m = volumedetectStderr.match(/max_volume:\s*(-?[\d.]+|-inf) dB/)
  if (!m) return false
  return m[1] === '-inf' || Number(m[1]) < -45
}

export function contentTypeFor(name) {
  if (name.endsWith('.m3u8')) return 'application/vnd.apple.mpegurl'
  if (name.endsWith('.m4s')) return 'video/iso.segment'
  if (name.endsWith('.ts')) return 'video/mp2t'
  if (name.endsWith('.mp4')) return 'video/mp4'
  if (name.endsWith('.jpg')) return 'image/jpeg'
  if (name.endsWith('.vtt')) return 'text/vtt; charset=utf-8'
  return 'application/octet-stream'
}

/** Next status after a failed attempt (attempts already counts this one). */
export function failureOutcome({ attempts, permanent }) {
  if (permanent || attempts >= MAX_ATTEMPTS) return { status: 'failed', retryInSeconds: null }
  return { status: 'queued', retryInSeconds: 60 * 2 ** (attempts - 1) }
}
