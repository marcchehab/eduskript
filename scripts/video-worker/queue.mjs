/**
 * Postgres-backed job queue for the video encoder (table video_encode_jobs,
 * see prisma/schema.prisma). Functions take a pg client so tests can run them
 * against a scratch schema.
 *
 * One-at-a-time: the worker holds a session-level advisory lock for its whole
 * life (acquireWorkerLock). A second worker — e.g. the old and new encoder
 * container overlapping during a Kamal deploy — waits until the first exits.
 * Because of that lock, any job still 'running' when a worker acquires it
 * belongs to a dead worker and is recovered (recoverStale).
 *
 * Every state change is mirrored into videos.metadata (status/progress/error)
 * of all rows linked to the job, which is what the dashboard and the player
 * read (src/lib/video-playback.ts).
 */

import { MAX_ATTEMPTS, failureOutcome } from './lib.mjs'

export const WORKER_LOCK_KEY = 7243001

/** Try once; true when this session now holds the worker lock. */
export async function acquireWorkerLock(client) {
  const { rows } = await client.query('SELECT pg_try_advisory_lock($1) AS ok', [WORKER_LOCK_KEY])
  return rows[0].ok === true
}

async function mirror(client, jobId, patch, remove = []) {
  let expr = 'metadata'
  for (const key of remove) expr = `(${expr} - '${key.replace(/'/g, '')}')`
  await client.query(
    `UPDATE videos SET metadata = ${expr} || $2::jsonb, updated_at = now() WHERE encode_job_id = $1`,
    [jobId, JSON.stringify(patch)]
  )
}

/** Requeue (or fail after MAX_ATTEMPTS) jobs left 'running' by a dead worker. Call while holding the lock. */
export async function recoverStale(client) {
  const { rows } = await client.query(
    `UPDATE video_encode_jobs
        SET status = CASE WHEN attempts >= $1 THEN 'failed' ELSE 'queued' END,
            error = CASE WHEN attempts >= $1 THEN 'Encoding was interrupted repeatedly.' ELSE error END,
            locked_at = NULL, updated_at = now()
      WHERE status = 'running'
      RETURNING id, status, error`,
    [MAX_ATTEMPTS]
  )
  for (const job of rows) {
    if (job.status === 'failed') await mirror(client, job.id, { status: 'errored', error: job.error }, ['progress'])
    else await mirror(client, job.id, { status: 'queued' }, ['progress'])
  }
  return rows.length
}

/** Atomically take the oldest due job. Returns the job row or null. */
export async function claimNext(client) {
  const { rows } = await client.query(
    `UPDATE video_encode_jobs
        SET status = 'running', attempts = attempts + 1, locked_at = now(), progress = 0, error = NULL, updated_at = now()
      WHERE id = (SELECT id FROM video_encode_jobs
                   WHERE status = 'queued' AND available_at <= now()
                   ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING *`
  )
  const row = rows[0]
  if (!row) return null
  await mirror(client, row.id, { status: 'encoding', progress: 0 }, ['error'])
  return { id: row.id, source: row.source, outputPrefix: row.output_prefix, attempts: row.attempts }
}

export async function heartbeat(client, jobId, progress) {
  await client.query(
    `UPDATE video_encode_jobs SET locked_at = now(), progress = $2, updated_at = now() WHERE id = $1`,
    [jobId, progress]
  )
  await mirror(client, jobId, { progress: Math.round(progress * 100) / 100 })
}

/** Success: write the outputs into every linked video row. */
export async function completeJob(client, jobId, outputs) {
  await client.query(
    `UPDATE video_encode_jobs SET status = 'done', progress = 1, locked_at = NULL, error = NULL, updated_at = now() WHERE id = $1`,
    [jobId]
  )
  await mirror(client, jobId, { ...outputs, status: 'ready' }, ['progress', 'error'])
}

/** Failure: retry with backoff or give up (permanent errors give up at once). */
export async function failJob(client, job, error, permanent) {
  const outcome = failureOutcome({ attempts: job.attempts, permanent })
  const reason = String(error?.message ?? error).slice(0, 500)
  await client.query(
    `UPDATE video_encode_jobs
        SET status = $2, error = $3, locked_at = NULL, updated_at = now(),
            available_at = now() + make_interval(secs => $4)
      WHERE id = $1`,
    [job.id, outcome.status, reason, outcome.retryInSeconds ?? 0]
  )
  if (outcome.status === 'failed') await mirror(client, job.id, { status: 'errored', error: reason }, ['progress'])
  else await mirror(client, job.id, { status: 'queued' }, ['progress'])
  return outcome
}

/** Worker shutting down mid-job (SIGTERM): put it back without counting the attempt. */
export async function releaseJob(client, jobId) {
  await client.query(
    `UPDATE video_encode_jobs SET status = 'queued', attempts = GREATEST(attempts - 1, 0), locked_at = NULL, updated_at = now() WHERE id = $1 AND status = 'running'`,
    [jobId]
  )
  await mirror(client, jobId, { status: 'queued' }, ['progress'])
}
