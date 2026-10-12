#!/usr/bin/env node
/**
 * Video encoder worker. Runs as its own container (Kamal role "encoder",
 * config/deploy.yml: same image, `cmd: node scripts/video-worker.mjs`,
 * --cpus=2, low CPU shares). See MIGRATION-VIDEO.md.
 *
 * Loop: hold the worker advisory lock → recover jobs a dead worker left
 * running → claim the oldest queued job → encode → upload → mark ready →
 * ask the app to drop its caches. Exactly one job at a time.
 *
 * Per job (source: "s3:<key>", the upload in the teacher bucket):
 *   1. ffprobe + validate (≤1080p either orientation, has video, ≤2 h, ≤2 GB)
 *   2. one ffmpeg run → 1080p (≥1080p sources) + 720p + 480p MP4s (x264 veryfast, CRF 23/24 with
 *      bitrate caps, keyframes every 4 s, CFR ≤30 fps, yuv420p, autorotate)
 *   3. remux each MP4 → HLS (fMP4, 4 s segments, no re-encode) + master
 *   4. poster JPG, scrub-preview sprites (1 frame / 5 s, 160 px, 10×10) + VTT
 *   5. audio → mono 16 kHz Opus in 20-min chunks → Infomaniak AI Whisper
 *      (async batch API) → WebVTT; skipped for silent/no-audio videos;
 *      transcription failures don't fail the job (no captions instead)
 *   6. upload everything under the job's outputPrefix (public, CH S3)
 * ffmpeg runs under `nice -n 19` and `ionice -c 3` when available.
 * The original upload stays in S3 (re-encodes later need it).
 *
 * Env: DATABASE_URL, S3_* / SCW_* (same as src/lib/s3.ts), SCW_TEACHER_BUCKET,
 * INFOMANIAK_AI_TOKEN + INFOMANIAK_AI_PRODUCT_ID (captions; optional),
 * VIDEO_WORKER_APP_URL + CRON_SECRET (cache revalidation ping; optional),
 * VIDEO_FFMPEG_THREADS (default 2), VIDEO_FFMPEG_PRESET (default veryfast),
 * VIDEO_WORKER_ONCE=1 (process the queue until empty, then exit — tests).
 */

import { spawn, spawnSync } from 'child_process'
import { createWriteStream, existsSync } from 'fs'
import { copyFile, mkdtemp, readdir, readFile, rm, stat, writeFile, mkdir } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { pipeline } from 'stream/promises'
import { pathToFileURL } from 'url'
import {
  LIMITS, PermanentError, parseProbe, validateProbe, planRenditions, outputFps, buildEncodeArgs,
  buildHlsArgs, avc1Codec, playlistBandwidth, buildMasterPlaylist, thumbnailPlan,
  buildSpriteArgs, buildThumbnailsVtt, parseProgressLine, languageInfo, transcriptToCues, cuesToVtt,
  isSilent, contentTypeFor, AUDIO_CHUNK_SECONDS,
} from './video-worker/lib.mjs'
import { acquireWorkerLock, recoverStale, claimNext, heartbeat, completeJob, failJob, releaseJob } from './video-worker/queue.mjs'

const log = (...a) => console.log(new Date().toISOString(), '[video-worker]', ...a)
const sleep = ms => new Promise(r => setTimeout(r, ms))

// --- process helpers --------------------------------------------------------

const HAS_IONICE = spawnSync('sh', ['-c', 'command -v ionice'], { encoding: 'utf8' }).status === 0
let currentChild = null

/** Run ffmpeg/ffprobe at lowest priority. Resolves { stdout, stderr }; rejects on non-zero exit. */
function run(bin, args, { onStdoutLine } = {}) {
  const prefix = HAS_IONICE ? ['-n', '19', 'ionice', '-c', '3', bin] : ['-n', '19', bin]
  return new Promise((resolve, reject) => {
    const child = spawn('nice', [...prefix, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
    currentChild = child
    let stdout = ''
    let stderr = ''
    let partial = ''
    child.stdout.on('data', d => {
      const s = d.toString()
      stdout += s.length < 1e6 ? s : ''
      if (onStdoutLine) {
        partial += s
        const lines = partial.split('\n')
        partial = lines.pop()
        lines.forEach(onStdoutLine)
      }
    })
    child.stderr.on('data', d => {
      stderr = (stderr + d.toString()).slice(-20000)
    })
    child.on('error', reject)
    child.on('close', code => {
      currentChild = null
      if (code === 0) resolve({ stdout, stderr })
      else reject(new Error(`${bin} exited with ${code}: ${stderr.split('\n').slice(-6).join(' | ')}`))
    })
  })
}

async function probe(input, inputArgs = []) {
  let out
  try {
    out = await run('ffprobe', ['-v', 'error', ...inputArgs, '-show_streams', '-show_format', '-of', 'json', input])
  } catch (err) {
    throw new PermanentError(`Could not read this video file (${String(err.message).slice(0, 160)}).`)
  }
  return JSON.parse(out.stdout)
}

// --- S3 ---------------------------------------------------------------------

async function s3Setup() {
  const { S3Client, GetObjectCommand, HeadObjectCommand, PutObjectCommand } = await import('@aws-sdk/client-s3')
  const region = process.env.S3_REGION || process.env.SCW_REGION || 'fr-par'
  const endpoint = process.env.S3_ENDPOINT || `https://s3.${region}.scw.cloud`
  const bucket = process.env.SCW_TEACHER_BUCKET
  if (!bucket) throw new Error('SCW_TEACHER_BUCKET not set')
  const client = new S3Client({
    region,
    endpoint,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY || process.env.SCW_ACCESS_KEY,
      secretAccessKey: process.env.S3_SECRET_KEY || process.env.SCW_SECRET_KEY,
    },
  })
  const publicBase = process.env.S3_PUBLIC_BASE_URL || endpoint
  return {
    bucket,
    publicUrl: key => `${publicBase}/${bucket}/${key}`,
    async size(key) {
      const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
      return Number(head.ContentLength ?? 0)
    },
    async download(key, file) {
      const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
      await pipeline(res.Body, createWriteStream(file))
    },
    async upload(key, file, contentType) {
      const body = await readFile(file)
      await client.send(new PutObjectCommand({
        Bucket: bucket, Key: key, Body: body, ContentType: contentType,
        // Job prefixes are unique per encode, so outputs never change.
        CacheControl: 'public, max-age=31536000, immutable',
      }))
    },
  }
}

async function listFiles(dir) {
  const out = []
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...(await listFiles(p)))
    else out.push(p)
  }
  return out
}

/** Upload a directory tree, 4 files in parallel. */
async function uploadDir(s3, dir, prefix) {
  const files = await listFiles(dir)
  let i = 0
  const workers = Array.from({ length: 4 }, async () => {
    while (i < files.length) {
      const file = files[i++]
      const rel = path.relative(dir, file).split(path.sep).join('/')
      await s3.upload(prefix + rel, file, contentTypeFor(rel))
    }
  })
  await Promise.all(workers)
  return files.length
}

// --- captions ---------------------------------------------------------------

const AI_BASE = 'https://api.infomaniak.com/1/ai'

/** Infomaniak AI Whisper: async batch → poll → verbose_json with word timestamps. */
async function transcribeChunk(file) {
  const token = process.env.INFOMANIAK_AI_TOKEN
  const product = process.env.INFOMANIAK_AI_PRODUCT_ID
  const form = new FormData()
  form.append('file', new Blob([await readFile(file)], { type: 'audio/ogg' }), path.basename(file))
  form.append('model', 'whisper')
  form.append('response_format', 'verbose_json')
  form.append('timestamp_granularities[]', 'word')
  form.append('timestamp_granularities[]', 'segment')
  const res = await fetch(`${AI_BASE}/${product}/openai/audio/transcriptions`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form,
  })
  const started = await res.json().catch(() => ({}))
  if (!res.ok || !started.batch_id) throw new Error(`transcription start failed (${res.status})`)
  const deadline = Date.now() + 20 * 60_000
  while (Date.now() < deadline) {
    await sleep(3000)
    const r = await fetch(`${AI_BASE}/${product}/results/${started.batch_id}`, { headers: { Authorization: `Bearer ${token}` } })
    const body = await r.json().catch(() => ({}))
    if (body.status === 'success') {
      if (typeof body.data === 'string' && body.data) return JSON.parse(body.data)
      const dl = await fetch(body.url, { headers: { Authorization: `Bearer ${token}` } })
      return await dl.json()
    }
    if (body.status === 'error' || body.status === 'failed') throw new Error('transcription failed')
  }
  throw new Error('transcription timed out')
}

/** Returns a caption descriptor ({ file, lang, label }) or null (silent / no speech / not configured). */
async function makeCaptions(sourceMp4, work) {
  if (!process.env.INFOMANIAK_AI_TOKEN || !process.env.INFOMANIAK_AI_PRODUCT_ID) {
    log('captions skipped: INFOMANIAK_AI_* not set')
    return null
  }
  const vol = await run('ffmpeg', ['-hide_banner', '-nostdin', '-i', sourceMp4, '-vn', '-af', 'volumedetect', '-f', 'null', '-'])
  if (isSilent(vol.stderr)) {
    log('captions skipped: silent audio')
    return null
  }
  const dir = path.join(work, 'audio')
  await mkdir(dir)
  await run('ffmpeg', [
    '-hide_banner', '-nostdin', '-y', '-i', sourceMp4, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libopus', '-b:a', '24k',
    '-f', 'segment', '-segment_time', String(AUDIO_CHUNK_SECONDS), '-segment_format', 'ogg', '-reset_timestamps', '1',
    path.join(dir, 'chunk_%03d.ogg'),
  ])
  const chunks = (await readdir(dir)).filter(f => f.endsWith('.ogg')).sort()
  const cues = []
  let language = null
  for (const [i, name] of chunks.entries()) {
    const result = await transcribeChunk(path.join(dir, name))
    language ??= result.language
    cues.push(...transcriptToCues(result, i * AUDIO_CHUNK_SECONDS))
  }
  if (cues.length === 0) return null
  const file = path.join(work, 'captions.vtt')
  await writeFile(file, cuesToVtt(cues))
  return { file, ...languageInfo(language) }
}

// --- the job ----------------------------------------------------------------

async function resolveInput(job, s3, work) {
  if (job.source.startsWith('s3:')) {
    const key = job.source.slice(3)
    const size = await s3.size(key).catch(err => {
      if (err?.$metadata?.httpStatusCode === 404) throw new PermanentError('The uploaded file is missing.')
      throw err
    })
    if (size > LIMITS.maxBytes) throw new PermanentError('This file is larger than 2 GB.')
    const file = path.join(work, 'source')
    await s3.download(key, file)
    return { input: file, inputArgs: [] }
  }
  throw new PermanentError(`Unknown source ${job.source}`)
}

export async function processJob(job, { db, s3 }) {
  // Never write into the bucket root (or another job's prefix).
  if (typeof job.outputPrefix !== 'string' || !/^[\w.-]+\/(?:[\w.-]+\/)*$/.test(job.outputPrefix)) {
    throw new PermanentError(`Invalid output prefix: ${job.outputPrefix}`)
  }
  const work = await mkdtemp(path.join(tmpdir(), 'video-'))
  const t0 = Date.now()
  try {
    const { input, inputArgs } = await resolveInput(job, s3, work)
    const info = parseProbe(await probe(input, inputArgs))
    validateProbe(info)
    const renditions = planRenditions(info.width, info.height)
    const out = path.join(work, 'out')
    await mkdir(out)

    // 1. encode (≈85 % of the time) — progress from ffmpeg -progress
    let lastBeat = 0
    await run('ffmpeg', buildEncodeArgs({
      input, inputArgs, renditions, fps: info.fps, hasAudio: info.hasAudio, outDir: work,
      threads: Number(process.env.VIDEO_FFMPEG_THREADS || 2), preset: process.env.VIDEO_FFMPEG_PRESET || 'veryfast',
    }), {
      onStdoutLine: line => {
        const t = parseProgressLine(line)
        if (t === null || Date.now() - lastBeat < 5000) return
        lastBeat = Date.now()
        heartbeat(db, job.id, Math.min(0.85, (t / info.duration) * 0.85)).catch(() => {})
      },
    })
    const tEncode = Date.now()

    // 2. HLS per rendition + master playlist
    const variants = []
    for (const r of renditions) {
      const dir = path.join(out, r.name)
      await mkdir(dir)
      await run('ffmpeg', buildHlsArgs(path.join(work, `${r.name}.mp4`), dir))
      const playlist = await readFile(path.join(dir, 'index.m3u8'), 'utf8')
      const sizes = new Map()
      for (const f of await readdir(dir)) sizes.set(f, (await stat(path.join(dir, f))).size)
      const bw = playlistBandwidth(playlist, seg => sizes.get(seg) ?? 0)
      const vprobe = JSON.parse((await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_streams', '-of', 'json', path.join(work, `${r.name}.mp4`)])).stdout)
      const vs = vprobe.streams[0]
      variants.push({
        name: r.name, width: r.width, height: r.height,
        bandwidth: bw.peak, averageBandwidth: bw.average, // segments include the audio
        codecs: info.hasAudio ? `${avc1Codec(vs.profile, vs.level)},mp4a.40.2` : avc1Codec(vs.profile, vs.level),
        fps: outputFps(info.fps),
      })
    }
    await writeFile(path.join(out, 'master.m3u8'), buildMasterPlaylist(variants))
    await heartbeat(db, job.id, 0.88)

    // 3. download MP4 (highest rendition), poster, scrub sprites
    const top = renditions[0]
    const topMp4 = path.join(work, `${top.name}.mp4`)
    // Download/export: the 720p rendition (already faststart). 1080p would be
    // free CPU-wise but roughly doubles the stored download file.
    const dl = renditions.find(r => r.short <= 720) ?? top
    await copyFile(path.join(work, `${dl.name}.mp4`), path.join(out, 'download.mp4'))
    const posterAt = Math.min(2, info.duration / 3)
    await run('ffmpeg', ['-hide_banner', '-nostdin', '-y', '-ss', posterAt.toFixed(2), '-i', topMp4, '-frames:v', '1', '-q:v', '3', path.join(out, 'poster.jpg')])
    const thumbs = path.join(out, 'thumbs')
    await mkdir(thumbs)
    const plan = thumbnailPlan(info.duration, top.width, top.height)
    const smallMp4 = path.join(work, `${renditions[renditions.length - 1].name}.mp4`)
    await run('ffmpeg', buildSpriteArgs(smallMp4, plan, thumbs))
    await writeFile(path.join(thumbs, 'thumbnails.vtt'), buildThumbnailsVtt(plan, info.duration))
    await heartbeat(db, job.id, 0.9)
    const tAssets = Date.now()

    // 4. captions (never fails the job)
    let captions = null
    if (info.hasAudio) {
      try {
        const c = await makeCaptions(smallMp4, work)
        if (c) {
          await writeFile(path.join(out, `captions.${c.lang}.vtt`), await readFile(c.file))
          captions = { name: `captions.${c.lang}.vtt`, lang: c.lang, label: c.label }
        }
      } catch (err) {
        log('captions failed (continuing without):', err.message)
      }
    }
    await heartbeat(db, job.id, 0.95)
    const tCaptions = Date.now()

    // 5. upload
    const count = await uploadDir(s3, out, job.outputPrefix)
    const url = name => s3.publicUrl(job.outputPrefix + name)
    const outputs = {
      hlsUrl: url('master.m3u8'),
      mp4Url: url('download.mp4'),
      poster: url('poster.jpg'),
      thumbnailsVtt: url('thumbs/thumbnails.vtt'),
      captions: captions ? [{ src: url(captions.name), lang: captions.lang, label: captions.label }] : [],
      width: info.width,
      height: info.height,
      aspectRatio: info.width / info.height,
      duration: Math.round(info.duration * 100) / 100,
      renditions: renditions.map(r => r.short),
    }
    await completeJob(db, job.id, outputs)
    const s = ms => (ms / 1000).toFixed(1) + 's'
    log(`job ${job.id} done: ${info.width}x${info.height} ${s(info.duration * 1000)} → encode ${s(tEncode - t0)}, hls+assets ${s(tAssets - tEncode)}, captions ${s(tCaptions - tAssets)}, upload ${count} files ${s(Date.now() - tCaptions)}`)
    return outputs
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}

/** Tell the app to drop its skript-files/page caches (it can't see our DB writes). */
async function pingApp(jobId, db) {
  const base = process.env.VIDEO_WORKER_APP_URL
  if (!base || !process.env.CRON_SECRET) return
  try {
    const { rows } = await db.query('SELECT id FROM videos WHERE encode_job_id = $1', [jobId])
    const res = await fetch(`${base.replace(/\/$/, '')}/api/videos/revalidate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.CRON_SECRET}` },
      body: JSON.stringify({ videoIds: rows.map(r => r.id) }),
    })
    if (!res.ok) log('revalidate ping failed:', res.status)
  } catch (err) {
    log('revalidate ping failed:', err.message)
  }
}

async function main() {
  const { config } = await import('dotenv')
  config()
  const pg = (await import('pg')).default
  const url = process.env.DATABASE_URL
  const local = /localhost|@eduskript-db/.test(url ?? '')
  const db = new pg.Client({ connectionString: url, ssl: local ? false : { rejectUnauthorized: false } })
  await db.connect()
  const s3 = await s3Setup()
  const once = process.env.VIDEO_WORKER_ONCE === '1'

  while (!(await acquireWorkerLock(db))) {
    log('another worker holds the lock; waiting')
    await sleep(30_000)
  }
  const recovered = await recoverStale(db)
  log(`started (ionice: ${HAS_IONICE}); recovered ${recovered} interrupted job(s)`)

  let current = null
  let stopping = false
  const stop = async () => {
    if (stopping) return
    stopping = true
    log('stopping')
    currentChild?.kill('SIGTERM')
    if (current) await releaseJob(db, current.id).catch(() => {})
    await db.end().catch(() => {})
    process.exit(0)
  }
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)

  while (!stopping) {
    const job = await claimNext(db)
    if (!job) {
      if (once) break
      await sleep(10_000)
      continue
    }
    current = job
    log(`job ${job.id} attempt ${job.attempts}: ${job.source.startsWith('s3:') ? 's3 upload' : job.source}`)
    try {
      await processJob(job, { db, s3 })
    } catch (err) {
      if (stopping) break
      const permanent = err instanceof PermanentError
      const outcome = await failJob(db, job, err, permanent)
      log(`job ${job.id} failed (${permanent ? 'permanent' : 'transient'}) → ${outcome.status}: ${err.message}`)
    }
    current = null
    await pingApp(job.id, db)
  }
  await db.end()
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  if (!existsSync('/usr/bin/ffmpeg') && spawnSync('sh', ['-c', 'command -v ffmpeg']).status !== 0) {
    console.error('ffmpeg not found')
    process.exit(1)
  }
  main().catch(err => {
    console.error(err)
    process.exit(1)
  })
}
