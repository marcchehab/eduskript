#!/usr/bin/env node
/**
 * Move Mux-hosted videos to Infomaniak VOD (CH). See MIGRATION-VOD.md.
 *
 * For each Video row with provider "mux" and a metadata.playbackId:
 *  1. import https://stream.mux.com/{playbackId}.m3u8 into Infomaniak
 *     (v1 import-from-URL; Infomaniak pulls the HLS itself — Mux assets have
 *     no static MP4 by default),
 *  2. flip the row to provider "infomaniak" with status "processing",
 *     metadata.mediaId/vodMediaId set and the old playbackId kept as
 *     metadata.muxPlaybackId — src/lib/video-playback.ts keeps playing the
 *     Mux original until the row is ready, so pages never show a gap,
 *  3. wait until Infomaniak reports the media ready,
 *  4. with --notify <appUrl>: POST the media id to the app's callback route,
 *     which runs the normal sync (src/lib/video-sync.server.ts: HLS/MP4 URLs,
 *     poster copy to S3, AI subtitles request, cache invalidation). Without
 *     --notify the Infomaniak callback or the daily cron does that later.
 *
 * Rows sharing a playbackId (page-copy duplicates) share one Infomaniak media;
 * only the first gets vodMediaId (unique column), the rest metadata.mediaId.
 *
 * Idempotent and resumable: rows already flipped are skipped, and a
 * playbackId that an earlier run imported (metadata.muxPlaybackId on an
 * Infomaniak row) is reused instead of imported again. A crash between the
 * import call and the DB write orphans one Infomaniak media — the media id
 * is printed before the write so it can be cleaned up by hand.
 * Does NOT delete anything on Mux.
 *
 * Plain .mjs (pg + fetch, no src/ imports) so it runs inside the production
 * container, which has scripts/ and node_modules but not src/ or tsx:
 *   bin/kamal app exec -i 'node scripts/migrate-mux-to-infomaniak.mjs --dry-run'
 *
 * Usage: node scripts/migrate-mux-to-infomaniak.mjs [--dry-run] [--limit N]
 *          [--id <videoId>] [--delay-ms 3000] [--timeout-min 60]
 *          [--notify http://localhost:3000] [--prod]
 * Env: DATABASE_URL (or DATABASE_URL_PROD with --prod), INFOMANIAK_VOD_TOKEN,
 *      INFOMANIAK_VOD_CHANNEL, INFOMANIAK_VOD_FOLDER,
 *      INFOMANIAK_VOD_CALLBACK_SECRET (for --notify).
 */

import { pathToFileURL } from 'url'

// Override only for testing against a local stub (the trial channel caps imports).
const API = process.env.INFOMANIAK_VOD_API_BASE || 'https://api.infomaniak.com'

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
    delayMs: Number(get('--delay-ms', '3000')),
    timeoutMin: Number(get('--timeout-min', '60')),
    notify: get('--notify', null),
  }
}

/**
 * Pure planning step (unit-tested): group Mux rows by playbackId and decide,
 * per group, whether to import or to reuse a media an earlier run created.
 *
 * @param {Array<{id:string, filename:string, metadata:any}>} muxRows  provider "mux" rows
 * @param {Array<{id:string, metadata:any}>} infomaniakRows  existing provider "infomaniak" rows
 * @param {{limit?: number, id?: string|null}} opts
 * @returns {Array<{playbackId:string, rows:Array<{id:string, filename:string, metadata:any}>, reuseMediaId:string|null}>}
 */
export function planMigration(muxRows, infomaniakRows, opts = {}) {
  const migrated = new Map()
  for (const r of infomaniakRows) {
    const pid = r.metadata?.muxPlaybackId
    const mediaId = r.metadata?.mediaId
    if (typeof pid === 'string' && typeof mediaId === 'string') migrated.set(pid, mediaId)
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
  for (const [playbackId, rows] of groups) {
    const reuseMediaId = migrated.get(playbackId) ?? null
    // --limit counts new imports only (the trial channel allows 5 media).
    if (!reuseMediaId && plan.filter(p => !p.reuseMediaId).length >= (opts.limit ?? Infinity)) continue
    plan.push({ playbackId, rows, reuseMediaId })
  }
  return plan
}

/** Metadata for a flipped row. Keeps poster/aspectRatio for the Mux fallback. */
export function flippedMetadata(old, mediaId) {
  const { playbackId, status: _status, error: _error, ...rest } = old ?? {}
  return { ...rest, status: 'processing', mediaId, muxPlaybackId: playbackId }
}

async function vod(config, path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.token}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || json.result === 'error') {
    throw new Error(`VOD ${init.method ?? 'GET'} ${path} → ${res.status} ${json.error?.description ?? ''}`)
  }
  return json.data
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function main() {
  const { config: loadEnv } = await import('dotenv')
  loadEnv()
  const args = parseArgs(process.argv.slice(2))
  const connectionString = args.prod ? process.env.DATABASE_URL_PROD : process.env.DATABASE_URL
  if (!connectionString) throw new Error(`${args.prod ? 'DATABASE_URL_PROD' : 'DATABASE_URL'} not set`)
  const vodConfig = {
    token: process.env.INFOMANIAK_VOD_TOKEN,
    channel: process.env.INFOMANIAK_VOD_CHANNEL,
    folder: process.env.INFOMANIAK_VOD_FOLDER,
  }
  if (!args.dryRun && (!vodConfig.token || !vodConfig.channel || !vodConfig.folder)) {
    throw new Error('INFOMANIAK_VOD_TOKEN / _CHANNEL / _FOLDER not set')
  }

  const pg = (await import('pg')).default
  const isLocal = connectionString.includes('localhost') || connectionString.includes('@eduskript-db')
  const client = new pg.Client({ connectionString, ssl: isLocal ? false : { rejectUnauthorized: false } })
  await client.connect()

  try {
    const { rows: muxRows } = await client.query(
      `SELECT id, filename, metadata FROM videos WHERE provider = 'mux' ORDER BY created_at`
    )
    const { rows: ikRows } = await client.query(
      `SELECT id, metadata FROM videos WHERE provider = 'infomaniak' AND metadata ? 'muxPlaybackId'`
    )
    const plan = planMigration(muxRows, ikRows, { limit: args.limit, id: args.id })
    const newImports = plan.filter(p => !p.reuseMediaId).length
    console.log(`${muxRows.length} Mux rows, ${plan.length} playback ids planned (${newImports} new imports)${args.dryRun ? ' — DRY RUN' : ''}`)

    const started = new Set()
    for (const group of plan) {
      const label = `${group.playbackId.slice(0, 8)}… (${group.rows.map(r => r.filename).join(', ')})`
      if (args.dryRun) {
        console.log(`  would ${group.reuseMediaId ? `reuse media ${group.reuseMediaId} for` : 'import'} ${label}`)
        continue
      }
      let mediaId = group.reuseMediaId
      if (!mediaId) {
        const data = await vod(vodConfig, `/1/vod/channel/${vodConfig.channel}/upload`, {
          method: 'POST',
          body: JSON.stringify({
            folder: vodConfig.folder,
            filename: group.rows[0].filename,
            url: `https://stream.mux.com/${group.playbackId}.m3u8`,
          }),
        })
        mediaId = data.id
        console.log(`  imported ${label} → media ${mediaId}`)
      } else {
        console.log(`  reusing media ${mediaId} for ${label}`)
      }

      // vodMediaId is unique: first row of a new import gets it, unless an
      // earlier run already gave it to another row.
      let claimVodId = !group.reuseMediaId
      for (const row of group.rows) {
        try {
          await client.query(
            `UPDATE videos SET provider = 'infomaniak', vod_media_id = $2, metadata = $3, updated_at = now()
              WHERE id = $1 AND provider = 'mux'`,
            [row.id, claimVodId ? mediaId : null, JSON.stringify(flippedMetadata(row.metadata, mediaId))]
          )
          claimVodId = false
        } catch (err) {
          // 23505: an Infomaniak row with the same (filename, uploader) exists
          // already — e.g. the teacher re-uploaded. Leave this one on Mux.
          console.warn(`  ! row ${row.id} (${row.filename}) not flipped: ${err.message}`)
        }
      }
      started.add(mediaId)
      if (!group.reuseMediaId) await sleep(args.delayMs)
    }

    if (args.dryRun || started.size === 0) return

    // Also wait for rows an interrupted earlier run left processing.
    const { rows: processing } = await client.query(
      `SELECT DISTINCT metadata->>'mediaId' AS media FROM videos
        WHERE provider = 'infomaniak' AND metadata ? 'muxPlaybackId' AND metadata->>'status' = 'processing'`
    )
    for (const r of processing) if (r.media) started.add(r.media)

    console.log(`Waiting for ${started.size} media (timeout ${args.timeoutMin} min)…`)
    const deadline = Date.now() + args.timeoutMin * 60_000
    const pending = new Set(started)
    while (pending.size > 0 && Date.now() < deadline) {
      for (const mediaId of [...pending]) {
        const media = await vod(vodConfig, `/2/vod/media/${mediaId}`)
        const state = media.state ?? []
        const failed = state.some(s => /error|fail/i.test(s))
        if (state.includes('ready') || failed) {
          pending.delete(mediaId)
          console.log(`  ${mediaId}: ${failed ? 'FAILED (row keeps playing from Mux)' : 'ready'}`)
          if (args.notify) {
            const res = await fetch(`${args.notify.replace(/\/$/, '')}/api/webhooks/infomaniak-vod`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${process.env.INFOMANIAK_VOD_CALLBACK_SECRET ?? ''}`,
              },
              body: JSON.stringify({ id: mediaId, notification_event: ['MIGRATION'] }),
            })
            console.log(`    notify → ${res.status}`)
          }
        }
        await sleep(1000)
      }
      if (pending.size > 0) await sleep(10_000)
    }
    if (pending.size > 0) {
      console.log(`Still processing: ${[...pending].join(', ')} — re-run later (resumes) or let the callback/cron finish.`)
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
