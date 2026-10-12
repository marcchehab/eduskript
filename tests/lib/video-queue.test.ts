/**
 * Encoder queue (scripts/video-worker/queue.mjs) against a real Postgres:
 * claim order + atomicity, one worker at a time (advisory lock), retry with
 * backoff, permanent failure, stale-job recovery after a worker died, and the
 * mirror into videos.metadata.
 *
 * Runs in a throwaway schema (tables copied with LIKE … INCLUDING ALL) in the
 * local dev database; skipped when that database isn't reachable.
 * URL: VIDEO_QUEUE_TEST_DATABASE_URL, default local dev DB.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import pg from 'pg'
import {
  acquireWorkerLock, recoverStale, claimNext, heartbeat, completeJob, failJob, releaseJob,
  // @ts-expect-error — plain .mjs without type declarations
} from '../../scripts/video-worker/queue.mjs'

const URL = process.env.VIDEO_QUEUE_TEST_DATABASE_URL ?? 'postgresql://postgres:password@localhost:5432/eduskript_dev'
const SCHEMA = `vq_test_${process.pid}_${Date.now()}`

let a: pg.Client | null = null
let b: pg.Client | null = null
let available = false

async function connect() {
  const c = new pg.Client({ connectionString: URL, connectionTimeoutMillis: 2000 })
  await c.connect()
  await c.query(`SET search_path TO ${SCHEMA}`)
  return c
}

beforeAll(async () => {
  try {
    const admin = new pg.Client({ connectionString: URL, connectionTimeoutMillis: 2000 })
    await admin.connect()
    await admin.query(`CREATE SCHEMA ${SCHEMA}`)
    await admin.query(`CREATE TABLE ${SCHEMA}.video_encode_jobs (LIKE public.video_encode_jobs INCLUDING ALL)`)
    await admin.query(`CREATE TABLE ${SCHEMA}.videos (id text PRIMARY KEY, encode_job_id text, metadata jsonb NOT NULL, updated_at timestamp(3))`)
    await admin.end()
    a = await connect()
    b = await connect()
    available = true
  } catch {
    available = false
  }
})

afterAll(async () => {
  await a?.end().catch(() => {})
  await b?.end().catch(() => {})
  if (!available) return
  const admin = new pg.Client({ connectionString: URL })
  await admin.connect()
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`)
  await admin.end()
})

async function addJob(id: string, createdAgoSec = 0, extra = '') {
  await a!.query(
    `INSERT INTO video_encode_jobs (id, source, output_prefix, created_at, updated_at${extra ? ', status, attempts, locked_at' : ''})
     VALUES ($1, 's3:k', 'videos/x/', now() - make_interval(secs => $2), now()${extra})`,
    [id, createdAgoSec]
  )
  await a!.query(`INSERT INTO videos (id, encode_job_id, metadata) VALUES ($1, $2, '{"status":"queued","muxPlaybackId":"P"}')`, [`v-${id}`, id])
}
const meta = async (id: string) => (await a!.query('SELECT metadata FROM videos WHERE id = $1', [`v-${id}`])).rows[0].metadata
const job = async (id: string) => (await a!.query('SELECT * FROM video_encode_jobs WHERE id = $1', [id])).rows[0]

describe('video encode queue', () => {
  it('only one worker holds the lock at a time', async ({ skip }) => {
    if (!available) skip()
    expect(await acquireWorkerLock(a!)).toBe(true)
    expect(await acquireWorkerLock(b!)).toBe(false)
    await a!.query('SELECT pg_advisory_unlock_all()')
    expect(await acquireWorkerLock(b!)).toBe(true)
    await b!.query('SELECT pg_advisory_unlock_all()')
  })

  it('claims the oldest due job exactly once, mirrors status into the video row', async ({ skip }) => {
    if (!available) skip()
    await addJob('j-new', 0)
    await addJob('j-old', 60)
    const [x, y] = await Promise.all([claimNext(a!), claimNext(b!)])
    const ids = [x?.id, y?.id].sort()
    expect(ids).toEqual(['j-new', 'j-old'])
    expect(x.id === 'j-old' || y.id === 'j-old').toBe(true)
    expect((await job('j-old')).attempts).toBe(1)
    expect(await meta('j-old')).toMatchObject({ status: 'encoding', progress: 0 })
    expect(await claimNext(a!)).toBeNull()

    await heartbeat(a!, 'j-old', 0.42)
    expect(await meta('j-old')).toMatchObject({ progress: 0.42 })
    await completeJob(a!, 'j-old', { hlsUrl: 'https://s3/m.m3u8' })
    expect(await meta('j-old')).toEqual({ status: 'ready', hlsUrl: 'https://s3/m.m3u8', muxPlaybackId: 'P' })
    expect((await job('j-old')).status).toBe('done')
  })

  it('transient failure → requeued with backoff; third failure / permanent → failed with reason', async ({ skip }) => {
    if (!available) skip()
    const j = await job('j-new')
    const out = await failJob(a!, j, new Error('ffmpeg exited with 1'), false)
    expect(out).toEqual({ status: 'queued', retryInSeconds: 60 })
    expect(await meta('j-new')).toMatchObject({ status: 'queued' })
    expect(await claimNext(a!)).toBeNull() // backoff not over
    await a!.query(`UPDATE video_encode_jobs SET available_at = now(), attempts = 2 WHERE id = 'j-new'`)
    const again = await claimNext(a!)
    expect(again.attempts).toBe(3)
    await failJob(a!, again, new Error('still broken'), false)
    expect(await job('j-new')).toMatchObject({ status: 'failed', error: 'still broken' })
    expect(await meta('j-new')).toMatchObject({ status: 'errored', error: 'still broken' })

    await addJob('j-perm')
    const p = await claimNext(a!)
    await failJob(a!, p, new Error('This video is 3840×2160.'), true)
    expect(await job('j-perm')).toMatchObject({ status: 'failed', attempts: 1 })
  })

  it('recovers jobs a dead worker left running; SIGTERM release does not count the attempt', async ({ skip }) => {
    if (!available) skip()
    await addJob('j-stale', 0, `, 'running', 1, now() - interval '1 hour'`)
    await addJob('j-dead3', 0, `, 'running', 3, now()`)
    expect(await recoverStale(a!)).toBe(2)
    expect(await job('j-stale')).toMatchObject({ status: 'queued', locked_at: null })
    expect(await meta('j-stale')).toMatchObject({ status: 'queued' })
    expect(await job('j-dead3')).toMatchObject({ status: 'failed', error: 'Encoding was interrupted repeatedly.' })

    const c = await claimNext(a!)
    expect(c.id).toBe('j-stale')
    expect(c.attempts).toBe(2)
    await releaseJob(a!, 'j-stale')
    expect(await job('j-stale')).toMatchObject({ status: 'queued', attempts: 1 })
  })
})
