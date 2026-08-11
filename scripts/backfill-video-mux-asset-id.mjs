#!/usr/bin/env node
/**
 * Backfill videos.mux_asset_id for existing Video rows.
 *
 * The column was added for webhook lookup (docs: "For webhook lookup when
 * asset ready", prisma/schema.prisma) — videos uploaded before that never
 * got it populated, even though they play fine via metadata.playbackId.
 * The client-side skript export (src/app/api/videos/[id]/prepare-download/route.ts)
 * needs mux_asset_id to request a static MP4 rendition, so those older
 * videos fail export with "Video is not ready on Mux yet".
 *
 * For each Video with a playbackId but no mux_asset_id, resolves the asset
 * ID via Mux's playback-ID lookup and writes it back.
 *
 * Idempotent — only touches rows where mux_asset_id IS NULL.
 *
 * Usage: node scripts/backfill-video-mux-asset-id.mjs [--dry-run] [--prod]
 * Requires: DATABASE_URL (or DATABASE_URL_PROD with --prod), MUX_TOKEN_ID,
 * MUX_TOKEN_SECRET in env or .env
 */

import pg from 'pg'
import { config } from 'dotenv'
import Mux from '@mux/mux-node'

config()

const dryRun = process.argv.includes('--dry-run')
const isProd = process.argv.includes('--prod')
const connectionString = isProd ? process.env.DATABASE_URL_PROD : process.env.DATABASE_URL
if (!connectionString) {
  console.error(`${isProd ? 'DATABASE_URL_PROD' : 'DATABASE_URL'} not set in .env`)
  process.exit(1)
}
const client = new pg.Client(isProd ? { connectionString, ssl: { rejectUnauthorized: false } } : { connectionString })
const mux = new Mux({
  tokenId: process.env.MUX_TOKEN_ID,
  tokenSecret: process.env.MUX_TOKEN_SECRET,
})

try {
  await client.connect()

  const { rows: videos } = await client.query(`
    SELECT id, filename, metadata
    FROM videos
    WHERE mux_asset_id IS NULL
  `)

  console.log(`Found ${videos.length} video(s) without mux_asset_id`)

  let updated = 0
  let skipped = 0
  let failed = 0

  for (const video of videos) {
    const playbackId = video.metadata?.playbackId
    if (!playbackId) {
      console.log(`  ${video.filename} (${video.id}): no playbackId in metadata, skipping`)
      skipped++
      continue
    }

    try {
      const result = await mux.video.playbackIds.retrieve(playbackId)
      if (result.object.type !== 'asset') {
        console.log(`  ${video.filename} (${video.id}): playback ID resolves to a ${result.object.type}, not an asset, skipping`)
        skipped++
        continue
      }
      const assetId = result.object.id

      if (dryRun) {
        console.log(`  [dry-run] ${video.filename} (${video.id}): would set mux_asset_id = ${assetId}`)
        updated++
        continue
      }

      await client.query(`UPDATE videos SET mux_asset_id = $1 WHERE id = $2`, [assetId, video.id])
      console.log(`  ${video.filename} (${video.id}): mux_asset_id = ${assetId}`)
      updated++
    } catch (err) {
      console.error(`  ${video.filename} (${video.id}): Mux lookup failed — ${err.message}`)
      failed++
    }
  }

  const verb = dryRun ? 'Would update' : 'Updated'
  console.log(`\nDone. ${verb} ${updated}, skipped ${skipped}, failed ${failed}.`)
} catch (error) {
  console.error('Backfill failed:', error.message)
  process.exit(1)
} finally {
  await client.end()
}
