#!/usr/bin/env node
/**
 * Move Mux-hosted videos to the self-hosted pipeline. See MIGRATION-VIDEO.md.
 *
 * For each Video row with provider "mux" and a metadata.playbackId:
 *  1. create an encode job whose source is https://stream.mux.com/{id}.m3u8
 *     (the worker picks the best variant ≤1080p plus Mux's separate audio
 *     rendition and reads them with ffmpeg),
 *  2. flip the row to provider "self", status "queued", link it to the job,
 *     keep the old playbackId as metadata.muxPlaybackId —
 *     src/lib/video-playback.ts keeps playing the Mux original until the
 *     encoder marks the row ready, so pages never show a gap.
 * The encoder (scripts/video-worker.mjs) does the rest, one job at a time,
 * and pings the app to drop its caches after each job.
 *
 * Rows sharing a playbackId (page copies) share one job → one encoded output.
 * Idempotent and resumable: rows already flipped are skipped; a playbackId an
 * earlier run queued (metadata.muxPlaybackId on a "self" row) reuses that job.
 * Does NOT delete anything on Mux.
 *
 * Plain .mjs (pg only) so it runs inside the production container:
 *   bin/kamal app exec -i 'node scripts/migrate-mux-to-self.mjs --dry-run'
 *
 * Usage: node scripts/migrate-mux-to-self.mjs [--dry-run] [--limit N] [--id <videoId>] [--prod]
 * Env: DATABASE_URL (or DATABASE_URL_PROD with --prod), VIDEO_S3_PREFIX (optional, tests).
 * --limit counts new jobs. Jobs are only queued here; the encoder throttles itself.
 */

import { randomUUID } from 'crypto'
import { pathToFileURL } from 'url'

export function parseArgs(argv) {
  const get = (name, fallback) => {
    const i = argv.indexOf(name)
    return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback
  }
  return {
    dryRun: argv.includes('--dry-run'),
    prod: argv.includes('--prod'),
    limit: Number(get('--limit', 'Infinity')),
    id: get('--id', null),
  }
}

/**
 * Pure planning step (unit-tested): group Mux rows by playbackId and decide,
 * per group, whether to create a job or reuse one an earlier run created.
 *
 * @param {Array<{id:string, filename:string, metadata:any}>} muxRows  provider "mux" rows
 * @param {Array<{id:string, metadata:any, encode_job_id:string|null}>} selfRows  existing "self" rows with muxPlaybackId
 * @param {{limit?: number, id?: string|null}} opts
 * @returns {Array<{playbackId:string, rows:Array<{id:string, filename:string, metadata:any}>, reuseJobId:string|null}>}
 */
export function planMigration(muxRows, selfRows, opts = {}) {
  const migrated = new Map()
  for (const r of selfRows) {
    const pid = r.metadata?.muxPlaybackId
    if (typeof pid === 'string' && r.encode_job_id) migrated.set(pid, r.encode_job_id)
  }
  const groups = new Map()
  for (const row of muxRows) {
    if (opts.id && row.id !== opts.id) continue
    const pid = row.metadata?.playbackId
    if (typeof pid !== 'string' || !pid) continue
    if (!groups.has(pid)) groups.set(pid, [])
    groups.get(pid).push(row)
  }
  const plan = []
  let newJobs = 0
  for (const [playbackId, rows] of groups) {
    const reuseJobId = migrated.get(playbackId) ?? null
    if (!reuseJobId) {
      if (newJobs >= (opts.limit ?? Infinity)) continue
      newJobs++
    }
    plan.push({ playbackId, rows, reuseJobId })
  }
  return plan
}

/** Metadata for a flipped row. Keeps poster/aspectRatio for the Mux fallback. */
export function flippedMetadata(old) {
  const { playbackId, status: _status, error: _error, ...rest } = old ?? {}
  return { ...rest, status: 'queued', muxPlaybackId: playbackId }
}

export function muxSourceUrl(playbackId) {
  return `https://stream.mux.com/${playbackId}.m3u8`
}

async function main() {
  const { config: loadEnv } = await import('dotenv')
  loadEnv()
  const args = parseArgs(process.argv.slice(2))
  const connectionString = args.prod ? process.env.DATABASE_URL_PROD : process.env.DATABASE_URL
  if (!connectionString) throw new Error(`${args.prod ? 'DATABASE_URL_PROD' : 'DATABASE_URL'} not set`)
  const pg = (await import('pg')).default
  const isLocal = /localhost|@eduskript-db/.test(connectionString)
  const client = new pg.Client({ connectionString, ssl: isLocal ? false : { rejectUnauthorized: false } })
  await client.connect()
  const prefix = process.env.VIDEO_S3_PREFIX ?? ''

  try {
    const { rows: muxRows } = await client.query(
      `SELECT id, filename, metadata FROM videos WHERE provider = 'mux' ORDER BY created_at`
    )
    const { rows: selfRows } = await client.query(
      `SELECT id, metadata, encode_job_id FROM videos WHERE provider = 'self' AND metadata ? 'muxPlaybackId'`
    )
    const plan = planMigration(muxRows, selfRows, { limit: args.limit, id: args.id })
    const newJobs = plan.filter(p => !p.reuseJobId).length
    console.log(`${muxRows.length} Mux rows, ${plan.length} playback ids planned (${newJobs} new jobs)${args.dryRun ? ' — DRY RUN' : ''}`)

    for (const group of plan) {
      const label = `${group.playbackId.slice(0, 8)}… (${group.rows.map(r => r.filename).join(', ')})`
      if (args.dryRun) {
        console.log(`  would ${group.reuseJobId ? `link to job ${group.reuseJobId}` : 'queue'} ${label}`)
        continue
      }
      await client.query('BEGIN')
      try {
        let jobId = group.reuseJobId
        if (!jobId) {
          jobId = randomUUID()
          await client.query(
            `INSERT INTO video_encode_jobs (id, status, source, output_prefix, updated_at) VALUES ($1, 'queued', $2, $3, now())`,
            [jobId, muxSourceUrl(group.playbackId), `${prefix}videos/${randomUUID()}/`]
          )
        }
        for (const row of group.rows) {
          await client.query('SAVEPOINT row')
          try {
            await client.query(
              `UPDATE videos SET provider = 'self', encode_job_id = $2, metadata = $3, updated_at = now()
                WHERE id = $1 AND provider = 'mux'`,
              [row.id, jobId, JSON.stringify(flippedMetadata(row.metadata))]
            )
          } catch (err) {
            // 23505: a "self" row with the same (filename, uploader) exists —
            // e.g. the teacher re-uploaded. Leave this one on Mux.
            await client.query('ROLLBACK TO SAVEPOINT row')
            console.warn(`  ! row ${row.id} (${row.filename}) not flipped: ${err.message}`)
          }
        }
        await client.query('COMMIT')
        console.log(`  ${group.reuseJobId ? 'linked' : 'queued'} ${label} → job ${jobId}`)
      } catch (err) {
        await client.query('ROLLBACK')
        throw err
      }
    }
    if (!args.dryRun && plan.length) {
      console.log('Queued. The encoder works through them one at a time; watch with:')
      console.log("  SELECT status, count(*) FROM video_encode_jobs GROUP BY 1;")
    }
  } finally {
    await client.end()
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch(err => {
    console.error(err.message ?? err)
    process.exit(1)
  })
}
