#!/usr/bin/env node
// Adds a long single-section page (no headings) to the scrollenquiry skript so
// we can isolate "scaling" hypothesis from "section-accumulation" hypothesis
// when chasing the canvas-vs-SVG offset bug.
import pg from 'pg'
import { config } from 'dotenv'
import { randomUUID } from 'node:crypto'

config()

const SKRIPT_SLUG = 'scrollenquiry'
const PAGE_SLUG = 'longtext'
const PAGE_TITLE = 'Longtext — single-section'
const TEACHER_EMAIL = 'teacher@eduskript.org'

const PARAGRAPH = `Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.`

// 80 paragraphs ≈ tall page, no headings → exactly one section (page itself).
const content = Array.from({ length: 80 }, () => PARAGRAPH).join('\n\n')

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
     VALUES ($1, $2, $3, $4, 1, true, 'normal', $5, NOW(), NOW())`,
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
