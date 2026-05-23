#!/usr/bin/env node
// Seeds a demo page exercising the coupled-video gating feature.
// URL: /teacher/interactive-code/coupled-video-demo
import pg from 'pg'
import { config } from 'dotenv'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'

config()

const SKRIPT_SLUG = 'interactive-code'
const PAGE_SLUG = 'coupled-video-demo'
const PAGE_TITLE = 'Coupled video demo'
const TEACHER_EMAIL = 'teacher@eduskript.org'

const content = readFileSync(new URL('./coupled-demo-page.md', import.meta.url), 'utf8')

const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
await client.connect()

try {
  await client.query('BEGIN')

  const { rows: userRows } = await client.query('SELECT id FROM users WHERE email = $1', [TEACHER_EMAIL])
  if (userRows.length === 0) throw new Error(`User ${TEACHER_EMAIL} not found`)
  const userId = userRows[0].id

  const { rows: skriptRows } = await client.query('SELECT id FROM skripts WHERE slug = $1', [SKRIPT_SLUG])
  if (skriptRows.length === 0) throw new Error(`Skript ${SKRIPT_SLUG} not found`)
  const skriptId = skriptRows[0].id

  await client.query('DELETE FROM pages WHERE slug = $1 AND "skriptId" = $2', [PAGE_SLUG, skriptId])

  const pageId = randomUUID()
  await client.query(
    `INSERT INTO pages (id, title, slug, content, "order", "isPublished", page_type, "skriptId", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, 99, true, 'normal', $5, NOW(), NOW())`,
    [pageId, PAGE_TITLE, PAGE_SLUG, content, skriptId]
  )
  await client.query(
    `INSERT INTO page_authors (id, "pageId", "userId", permission, "createdAt")
     VALUES ($1, $2, $3, 'author', NOW())`,
    [randomUUID(), pageId, userId]
  )

  await client.query('COMMIT')
  console.log('seeded:', `http://localhost:3000/teacher/${SKRIPT_SLUG}/${PAGE_SLUG}`)
} catch (e) {
  await client.query('ROLLBACK')
  console.error(e)
  process.exitCode = 1
} finally {
  await client.end()
}
