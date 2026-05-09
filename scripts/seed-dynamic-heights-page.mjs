#!/usr/bin/env node
// Seeds a page with variable-height components (foldable callouts, code
// editors) for testing annotation alignment + fold-hides-annotations behavior.
import pg from 'pg'
import { config } from 'dotenv'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'

config()

const SKRIPT_SLUG = 'scrollenquiry'
const PAGE_SLUG = 'dynamic'
const PAGE_TITLE = 'Dynamic-height repro'
const TEACHER_EMAIL = 'teacher@eduskript.org'

const content = readFileSync(new URL('./dynamic-heights-page.md', import.meta.url), 'utf8')

const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
await client.connect()

try {
  await client.query('BEGIN')

  const { rows: userRows } = await client.query(
    'SELECT id, "pageSlug" FROM users WHERE email = $1',
    [TEACHER_EMAIL]
  )
  if (userRows.length === 0) throw new Error(`User ${TEACHER_EMAIL} not found`)
  const userId = userRows[0].id
  const pageSlug = userRows[0].pageSlug

  const { rows: skriptRows } = await client.query(
    'SELECT id FROM skripts WHERE slug = $1',
    [SKRIPT_SLUG]
  )
  if (skriptRows.length === 0) throw new Error(`Skript ${SKRIPT_SLUG} not found — run seed-scrollenquiry.mjs first`)
  const skriptId = skriptRows[0].id

  await client.query(
    'DELETE FROM pages WHERE slug = $1 AND "skriptId" = $2',
    [PAGE_SLUG, skriptId]
  )

  const pageId = randomUUID()
  await client.query(
    `INSERT INTO pages (id, title, slug, content, "order", "isPublished", page_type, "skriptId", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, 2, true, 'normal', $5, NOW(), NOW())`,
    [pageId, PAGE_TITLE, PAGE_SLUG, content, skriptId]
  )
  await client.query(
    `INSERT INTO page_authors (id, "pageId", "userId", permission, "createdAt")
     VALUES ($1, $2, $3, 'author', NOW())`,
    [randomUUID(), pageId, userId]
  )

  await client.query('COMMIT')

  const url = `http://localhost:3000/${pageSlug}/${SKRIPT_SLUG}/${SKRIPT_SLUG}/${PAGE_SLUG}`
  console.log('seeded:', url)
} catch (e) {
  await client.query('ROLLBACK')
  console.error(e)
  process.exitCode = 1
} finally {
  await client.end()
}
