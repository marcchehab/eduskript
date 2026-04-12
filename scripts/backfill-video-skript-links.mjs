#!/usr/bin/env node
/**
 * Backfill the _SkriptVideos M2M for existing Video rows.
 *
 * Until now video resolution ignored the SkriptVideos relation and fetched
 * the entire Video table globally, so the M2M was never populated. This
 * script connects each existing Video to every Skript where the video's
 * filename appears in the content of some page in that skript.
 *
 * When the Video has an uploaded_by_id (added in migration
 * 20260312002546_add_video_upload_fields), we additionally restrict matches
 * to skripts authored by the uploader — the stronger signal disambiguates
 * filename collisions across teachers.
 *
 * For older "orphan" Videos (uploaded_by_id IS NULL — predate the column or
 * came from import/admin scripts), we match on filename alone. This is
 * strictly no worse than current behaviour: resolution has been global, so
 * any filename collision already exists silently today.
 *
 * Idempotent — _SkriptVideos primary key is ("A", "B"), so re-running is a no-op.
 *
 * Usage: node scripts/backfill-video-skript-links.mjs [--dry-run]
 * Requires: DATABASE_URL in env or .env
 */

import pg from 'pg'
import { config } from 'dotenv'

config()

const dryRun = process.argv.includes('--dry-run')
const client = new pg.Client({ connectionString: process.env.DATABASE_URL })

try {
  await client.connect()

  const { rows: videos } = await client.query(`
    SELECT id, filename, uploaded_by_id
    FROM videos
  `)

  console.log(`Found ${videos.length} videos to consider`)

  let totalConnects = 0
  let videosTouched = 0
  let videosWithoutMatches = 0

  for (const video of videos) {
    // Two match strategies: uploader-scoped (stronger) or filename-only (fallback).
    // Worst case in either: an over-connect to a skript that merely mentions the
    // filename in prose — still safe, since resolution requires a real
    // ![](filename) reference at render time.
    const skriptQuery = video.uploaded_by_id
      ? {
          text: `
            SELECT DISTINCT s.id
            FROM skripts s
            JOIN skript_authors sa ON sa."skriptId" = s.id
              AND sa."userId" = $1
              AND sa.permission = 'author'
            JOIN pages p ON p."skriptId" = s.id
            WHERE p.content ILIKE '%' || $2 || '%'
          `,
          values: [video.uploaded_by_id, video.filename],
        }
      : {
          text: `
            SELECT DISTINCT p."skriptId" AS id
            FROM pages p
            WHERE p.content ILIKE '%' || $1 || '%'
          `,
          values: [video.filename],
        }

    const { rows: skripts } = await client.query(skriptQuery)

    if (skripts.length === 0) {
      videosWithoutMatches++
      continue
    }

    // Filter out links that already exist so dry-run and real-run agree on counts.
    const { rows: alreadyLinked } = await client.query(
      `SELECT "A" FROM "_SkriptVideos" WHERE "B" = $1 AND "A" = ANY($2::text[])`,
      [video.id, skripts.map((s) => s.id)]
    )
    const alreadySet = new Set(alreadyLinked.map((r) => r.A))
    const newSkriptIds = skripts.map((s) => s.id).filter((id) => !alreadySet.has(id))

    if (newSkriptIds.length === 0) continue

    const scope = video.uploaded_by_id ? 'uploader-scoped' : 'orphan'

    if (dryRun) {
      videosTouched++
      totalConnects += newSkriptIds.length
      console.log(
        `  [dry-run] ${video.filename} (${video.id}, ${scope}): would link ${newSkriptIds.length} skript(s): ${newSkriptIds.join(', ')}`
      )
      continue
    }

    const result = await client.query(
      `
      INSERT INTO "_SkriptVideos" ("A", "B")
      SELECT unnest($1::text[]), $2
      ON CONFLICT DO NOTHING
      `,
      [newSkriptIds, video.id]
    )

    if (result.rowCount > 0) {
      videosTouched++
      totalConnects += result.rowCount
      console.log(
        `  ${video.filename} (${video.id}, ${scope}): +${result.rowCount} skript link(s)`
      )
    }
  }

  const verb = dryRun ? 'Would add' : 'Added'
  console.log(
    `\nDone. ${verb} ${totalConnects} new links across ${videosTouched} videos.`
  )
  if (videosWithoutMatches > 0) {
    console.log(
      `${videosWithoutMatches} video(s) had no matching skript (filename not referenced in any page content).`
    )
  }
} catch (error) {
  console.error('Backfill failed:', error.message)
  process.exit(1)
} finally {
  await client.end()
}
