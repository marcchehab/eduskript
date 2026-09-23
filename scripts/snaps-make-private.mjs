#!/usr/bin/env node
/**
 * One-off: set every existing object under snaps/ in the user bucket to a
 * private ACL. Snaps used to be uploaded public-read; since 2026-09-23 they are
 * served through the access-checked /api/snaps/image proxy.
 *
 * Run AFTER the proxy is deployed, otherwise existing snaps stop loading.
 *   node scripts/snaps-make-private.mjs            # dry run: count objects
 *   node scripts/snaps-make-private.mjs --apply    # set ACL private
 *
 * Uses DATABASE_URL, SCW_USER_BUCKET (or SCALEWAY_BUCKET) and the SCW_* keys
 * from .env — run it with the PROD values. Keys come from the snap URLs stored
 * in user_data (adapter 'snaps'), not from a bucket listing: the user-data
 * bucket policy denies ListObjects to our keys. One PutObjectAcl request per
 * object, sequential — O(n), fine for thousands.
 */

import { S3Client, PutObjectAclCommand } from '@aws-sdk/client-s3'
import pg from 'pg'
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), '..', '.env') })

const REGION = process.env.SCALEWAY_REGION || process.env.SCW_REGION || 'fr-par'
const ENDPOINT = process.env.SCALEWAY_ENDPOINT || `https://s3.${REGION}.scw.cloud`
const BUCKET = process.env.SCALEWAY_BUCKET || process.env.SCW_USER_BUCKET
const ACCESS_KEY = process.env.SCALEWAY_ACCESS_KEY_ID || process.env.SCW_ACCESS_KEY
const SECRET_KEY = process.env.SCALEWAY_SECRET_ACCESS_KEY || process.env.SCW_SECRET_KEY
const apply = process.argv.includes('--apply')

if (!BUCKET || !ACCESS_KEY || !SECRET_KEY) {
  console.error('Missing SCW_USER_BUCKET / SCW_ACCESS_KEY / SCW_SECRET_KEY')
  process.exit(1)
}

const client = new S3Client({
  region: REGION,
  endpoint: ENDPOINT,
  credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY },
})

const db = new pg.Client({ connectionString: process.env.DATABASE_URL })
await db.connect()
const { rows } = await db.query("select data from user_data where adapter = 'snaps'")
await db.end()

const keys = new Set()
for (const { data } of rows) {
  for (const snap of data?.snaps ?? []) {
    const m = typeof snap.imageUrl === 'string' && snap.imageUrl.match(/\/(snaps\/.+)$/)
    if (m) keys.add(m[1])
  }
}

let done = 0
let failed = 0
for (const Key of keys) {
  if (!apply) continue
  try {
    await client.send(new PutObjectAclCommand({ Bucket: BUCKET, Key, ACL: 'private' }))
    done++
  } catch (e) {
    failed++
    console.warn(`${Key}: ${e.name}`)
  }
}

console.log(apply
  ? `Set private: ${done}, failed: ${failed} (of ${keys.size} snap objects in ${BUCKET})`
  : `Would set private: ${keys.size} snap objects in ${BUCKET}`)
