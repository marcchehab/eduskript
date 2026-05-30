#!/usr/bin/env node
// Seeds a demo page packed with code editors for testing the toolbar-pen-driven
// code highlighter (personal-only, server-synced). Builds a full chain:
// Collection -> Skript -> Page under the dev teacher's site.
// URL: /teacher/highlight-demo/code-editors
import pg from 'pg'
import { config } from 'dotenv'
import { randomUUID } from 'node:crypto'

config()

const TEACHER_EMAIL = 'teacher@eduskript.test'
const SKRIPT_SLUG = 'highlight-demo'
const SKRIPT_TITLE = 'Highlighter demo'
const COLLECTION_TITLE = 'Highlighter demo'
const PAGE_SLUG = 'code-editors'
const PAGE_TITLE = 'Code editors — highlighter test'

const content = `# Code editors — highlighter test

Activate the **highlighter pen** in the toolbar, then select code in any editor
below. It highlights in the pen's colour — no popup. Hover a highlight to get a
bin to remove it. Reload to confirm it persists (server-synced). When
broadcasting, the highlighter greys out.

## Python — single file

\`\`\`python editor
def fib(n):
    a, b = 0, 1
    for _ in range(n):
        a, b = b, a + b
    return a

for i in range(10):
    print(i, fib(i))
\`\`\`

## Python — multi-file (highlight in one, switch tabs, switch back)

\`\`\`python editor id="multi"
# main.py
from helpers import greet

print(greet("Ada"))
print(greet("Grace"))
\`\`\`

## JavaScript

\`\`\`javascript editor
const nums = [1, 2, 3, 4, 5]
const doubled = nums.map(n => n * 2)
console.log(doubled.reduce((a, b) => a + b, 0))
\`\`\`

## SQL

\`\`\`sql editor
SELECT name, COUNT(*) AS n
FROM users
GROUP BY name
ORDER BY n DESC;
\`\`\`

## HTML (split preview)

\`\`\`html editor
<!DOCTYPE html>
<html>
  <body>
    <h1>Hello</h1>
    <p>Highlight me.</p>
  </body>
</html>
\`\`\`
`

const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
await client.connect()

try {
  await client.query('BEGIN')

  const { rows: userRows } = await client.query('SELECT id FROM users WHERE email = $1', [TEACHER_EMAIL])
  if (userRows.length === 0) throw new Error(`User ${TEACHER_EMAIL} not found — run pnpm seed-dev-teacher first`)
  const userId = userRows[0].id

  const { rows: siteRows } = await client.query('SELECT id, slug FROM sites WHERE user_id = $1', [userId])
  if (siteRows.length === 0) throw new Error(`No site for ${TEACHER_EMAIL}`)
  const siteId = siteRows[0].id
  const siteSlug = siteRows[0].slug

  // Skript (idempotent on slug). Skripts have no per-site uniqueness, so drop
  // any prior demo skript with this slug owned by our user to keep it clean.
  const { rows: priorSkripts } = await client.query(
    `SELECT s.id FROM skripts s
     JOIN skript_authors sa ON sa."skriptId" = s.id AND sa."userId" = $1
     WHERE s.slug = $2`,
    [userId, SKRIPT_SLUG]
  )
  for (const s of priorSkripts) {
    await client.query('DELETE FROM skripts WHERE id = $1', [s.id]) // cascades to pages, collection_skripts, authors
  }

  // Collection
  const collectionId = randomUUID()
  await client.query(
    `INSERT INTO collections (id, title, site_id, "createdAt", "updatedAt")
     VALUES ($1, $2, $3, NOW(), NOW())`,
    [collectionId, COLLECTION_TITLE, siteId]
  )

  // Skript
  const skriptId = randomUUID()
  await client.query(
    `INSERT INTO skripts (id, title, description, slug, skript_type, "isPublished", "isUnlisted", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, 'normal', true, false, NOW(), NOW())`,
    [skriptId, SKRIPT_TITLE, 'Code editors for highlighter testing', SKRIPT_SLUG]
  )
  await client.query(
    `INSERT INTO skript_authors (id, "skriptId", "userId", permission, "createdAt")
     VALUES ($1, $2, $3, 'author', NOW())`,
    [randomUUID(), skriptId, userId]
  )

  // Link skript to collection
  await client.query(
    `INSERT INTO collection_skripts (id, "collectionId", "skriptId", "order", "createdAt")
     VALUES ($1, $2, $3, 0, NOW())`,
    [randomUUID(), collectionId, skriptId]
  )

  // Page
  const pageId = randomUUID()
  await client.query(
    `INSERT INTO pages (id, title, slug, content, "order", "isPublished", page_type, "skriptId", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, 0, true, 'normal', $5, NOW(), NOW())`,
    [pageId, PAGE_TITLE, PAGE_SLUG, content, skriptId]
  )
  await client.query(
    `INSERT INTO page_authors (id, "pageId", "userId", permission, "createdAt")
     VALUES ($1, $2, $3, 'author', NOW())`,
    [randomUUID(), pageId, userId]
  )

  await client.query('COMMIT')
  console.log('seeded:', `http://localhost:3000/${siteSlug}/${SKRIPT_SLUG}/${PAGE_SLUG}`)
} catch (e) {
  await client.query('ROLLBACK')
  console.error(e)
  process.exitCode = 1
} finally {
  await client.end()
}
