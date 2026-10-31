#!/usr/bin/env node
/**
 * One-off: give existing plugins the thumbnails captured locally with a headless
 * browser. Uploads each image the way uploadTeacherFile() in src/lib/s3.ts does
 * and sets manifest.thumbnailKey (format: src/lib/plugin-thumbnail.ts).
 *
 * Input: a directory with thumbs.json ([{ id, slug, file }]) and the .webp files.
 *
 * Deploy the thumbnail feature first: older code has no UI for the key, and its
 * seed-plugins.mjs drops the key from seeded plugins on every deploy.
 *
 * Usage, in the app container (env from config/deploy.yml + app.env):
 *   scp -r <bundle> eduskript-prod:/tmp/plugin-thumbs
 *   ssh eduskript-prod
 *   C=$(sudo docker ps --filter name=eduskript-web --format '{{.Names}}' | head -1)
 *   sudo docker cp /tmp/plugin-thumbs $C:/tmp/plugin-thumbs
 *   sudo docker exec $C node scripts/apply-plugin-thumbnails.mjs /tmp/plugin-thumbs           # dry run
 *   sudo docker exec $C node scripts/apply-plugin-thumbnails.mjs /tmp/plugin-thumbs --apply   # upload + update
 *
 * Idempotent: a plugin that already has a thumbnailKey is skipped, also when the
 * author set one between the SELECT and the UPDATE (checked in the WHERE clause).
 * Uploading the same key twice is harmless. updatedAt stays: @updatedAt is a
 * Prisma feature, this script writes plain SQL, and the plugins table has no
 * trigger (checked 2026-10-31), so the list order does not change.
 * Not transactional per run: stopped midway, re-running finishes the rest.
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'

const MAX_BYTES = 100_000 // PLUGIN_THUMBNAIL.maxBytes

const apply = process.argv.includes('--apply')
const dir = process.argv.slice(2).find((a) => !a.startsWith('--'))
const bucket = process.env.SCW_TEACHER_BUCKET
const endpoint = process.env.S3_ENDPOINT
if (!dir) {
  console.error('Usage: node scripts/apply-plugin-thumbnails.mjs <dir> [--apply]')
  process.exit(1)
}
if (!process.env.DATABASE_URL || !bucket || !endpoint || !process.env.S3_ACCESS_KEY || !process.env.S3_SECRET_KEY) {
  console.error('Missing DATABASE_URL, SCW_TEACHER_BUCKET, S3_ENDPOINT or S3 keys')
  process.exit(1)
}

const s3 = new S3Client({
  region: process.env.S3_REGION || 'us-east-1',
  endpoint,
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
  credentials: { accessKeyId: process.env.S3_ACCESS_KEY, secretAccessKey: process.env.S3_SECRET_KEY },
})

const isWebp = (b) => b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP'

const entries = JSON.parse(fs.readFileSync(path.join(dir, 'thumbs.json'), 'utf8'))

const db = new pg.Client({ connectionString: process.env.DATABASE_URL })
await db.connect()

const counts = { set: 0, alreadySet: 0, missingPlugin: 0, badFile: 0, conflict: 0 }
for (const { id, slug, file } of entries) {
  const { rows } = await db.query('SELECT manifest FROM plugins WHERE id = $1', [id])
  if (rows.length === 0) {
    console.log(`  skip ${slug}: plugin no longer exists`)
    counts.missingPlugin++
    continue
  }
  if (rows[0].manifest?.thumbnailKey) {
    counts.alreadySet++
    continue
  }

  const buffer = fs.readFileSync(path.join(dir, path.basename(file)))
  if (buffer.length > MAX_BYTES || !isWebp(buffer)) {
    console.log(`  skip ${slug}: ${file} is not a WebP of at most ${MAX_BYTES} bytes`)
    counts.badFile++
    continue
  }

  const hash = crypto.createHash('sha256').update(buffer).digest('hex')
  const key = `files/${hash}.webp`
  console.log(`  ${apply ? 'set' : 'would set'} ${slug}: ${key} (${buffer.length} B)`)
  if (!apply) {
    counts.set++
    continue
  }

  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: buffer,
    ContentType: 'image/webp',
    ACL: 'public-read',
    CacheControl: 'public, max-age=31536000, immutable',
  }))
  const { rowCount } = await db.query(
    `UPDATE plugins SET manifest = COALESCE(manifest, '{}'::jsonb) || jsonb_build_object('thumbnailKey', $2::text)
     WHERE id = $1 AND manifest->>'thumbnailKey' IS NULL`,
    [id, key],
  )
  if (rowCount === 1) counts.set++
  else counts.conflict++
}

await db.end()
console.log(`${apply ? 'Applied' : 'Dry run'}:`, counts)
