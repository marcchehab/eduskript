#!/usr/bin/env node
// Seeds two Mux videos (16:9 + non-16:9) linked to the interactive-code skript,
// so the coupled-video / stickme demo can exercise real Mux playback.
import pg from 'pg'
import { config } from 'dotenv'
import { randomUUID } from 'node:crypto'

config()

const SKRIPT_SLUG = 'interactive-code'
const TEACHER_EMAIL = 'teacher@eduskript.org'

const VIDEOS = [
  { filename: 'demo.mp4', playbackId: 'yTJW3pwgZjvPJf2ipgxfCuHoJyz900ZOaszToF84005RY', aspectRatio: 426 / 432 }, // ~square
  { filename: 'wide.mp4', playbackId: '00ORrbAILBX0200B126Dfxf202fj3EEGwg4KpKgT8Tw7DoI', aspectRatio: 16 / 9 },
]

const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
await client.connect()
try {
  await client.query('BEGIN')

  const { rows: u } = await client.query('SELECT id FROM users WHERE email=$1', [TEACHER_EMAIL])
  if (!u.length) throw new Error('teacher not found')
  const userId = u[0].id
  const { rows: s } = await client.query('SELECT id FROM skripts WHERE slug=$1', [SKRIPT_SLUG])
  if (!s.length) throw new Error('skript not found')
  const skriptId = s[0].id

  for (const v of VIDEOS) {
    // Replace any prior seed of this filename for this teacher.
    await client.query('DELETE FROM videos WHERE filename=$1 AND uploaded_by_id=$2 AND provider=$3', [v.filename, userId, 'mux'])
    const id = randomUUID()
    await client.query(
      `INSERT INTO videos (id, filename, provider, metadata, uploaded_by_id, created_at, updated_at)
       VALUES ($1,$2,'mux',$3,$4,NOW(),NOW())`,
      [id, v.filename, JSON.stringify({ playbackId: v.playbackId, aspectRatio: v.aspectRatio, status: 'ready' }), userId],
    )
    await client.query('INSERT INTO "_SkriptVideos" ("A","B") VALUES ($1,$2) ON CONFLICT DO NOTHING', [skriptId, id])
    console.log(`seeded ${v.filename} (aspect ${v.aspectRatio.toFixed(3)}) -> ${id}`)
  }

  await client.query('COMMIT')
} catch (e) {
  await client.query('ROLLBACK')
  console.error(e)
  process.exitCode = 1
} finally {
  await client.end()
}
