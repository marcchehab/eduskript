#!/usr/bin/env node
/**
 * Move snap images stored inline as data URLs (UserData adapter 'snaps', saved
 * while production had no SCW_USER_BUCKET) into the private user bucket and
 * replace them with the S3 URL — the same key and URL form uploadSnapImage()
 * in src/lib/s3.ts produces, so the access-checked /api/snaps/image proxy
 * serves them.
 *
 * Usage (in the app container, env from config/deploy.yml + app.env):
 *   node scripts/migrate-snaps-to-bucket.mjs           # dry run: counts only
 *   node scripts/migrate-snaps-to-bucket.mjs --apply   # upload + update rows
 *
 * Each row is updated with an optimistic version check (version + 1, so
 * syncing clients pull the new URLs); a row changed meanwhile is skipped and
 * can be picked up by re-running. Uploading the same key twice is harmless.
 */

import pg from 'pg'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'

const apply = process.argv.includes('--apply')
const bucket = process.env.SCALEWAY_BUCKET || process.env.SCW_USER_BUCKET
const endpoint = process.env.S3_ENDPOINT
if (!bucket || !endpoint || !process.env.S3_ACCESS_KEY || !process.env.S3_SECRET_KEY) {
  console.error('Missing SCW_USER_BUCKET, S3_ENDPOINT or S3 keys')
  process.exit(1)
}

const s3 = new S3Client({
  region: process.env.S3_REGION || 'us-east-1',
  endpoint,
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
  credentials: { accessKeyId: process.env.S3_ACCESS_KEY, secretAccessKey: process.env.S3_SECRET_KEY },
})

const DATA_URL_RE = /^data:image\/(png|jpe?g|webp|gif);base64,(.+)$/
const SAFE_RE = /^[\w-]+$/

const db = new pg.Client({ connectionString: process.env.DATABASE_URL })
await db.connect()

const { rows } = await db.query(
  `SELECT id, user_id, item_id, data, version FROM user_data
   WHERE adapter = 'snaps' AND data::text LIKE '%"data:image/%'`
)

let moved = 0, skipped = 0, updatedRows = 0, conflicts = 0
for (const row of rows) {
  const snaps = Array.isArray(row.data?.snaps) ? row.data.snaps : []
  let changed = false
  for (const snap of snaps) {
    const m = typeof snap?.imageUrl === 'string' && snap.imageUrl.match(DATA_URL_RE)
    if (!m) continue
    if (![row.user_id, row.item_id, String(snap.id)].every((s) => SAFE_RE.test(s))) {
      skipped++
      continue
    }
    const key = `snaps/${row.user_id}/${row.item_id}/${snap.id}.${m[1]}`
    if (apply) {
      await s3.send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: Buffer.from(m[2], 'base64'),
        ContentType: `image/${m[1]}`,
      }))
      snap.imageUrl = `${endpoint}/${bucket}/${key}`
    }
    moved++
    changed = true
  }
  if (!changed || !apply) continue
  const res = await db.query(
    `UPDATE user_data SET data = $1, version = version + 1, updated_at = now()
     WHERE id = $2 AND version = $3`,
    [row.data, row.id, row.version]
  )
  if (res.rowCount === 1) updatedRows++
  else conflicts++
}

console.log(`${apply ? 'Applied' : 'Dry run'}: ${rows.length} rows, ${moved} snaps ${apply ? 'moved' : 'to move'}, ${skipped} skipped (unsafe ids)` +
  (apply ? `, ${updatedRows} rows updated, ${conflicts} version conflicts (re-run)` : ''))
await db.end()
