#!/usr/bin/env node
// Seeds a page for testing the <spacer> writing-area component: exercises with
// checkered / lined / dots / blank spacers below them. In the editor each spacer
// shows a bottom drag-handle (height) + a top-right pattern/delete toolbar; the
// public page renders a plain patterned box students write on with the pens.
// Chain: Collection -> Skript -> Page under the dev teacher's site.
import pg from 'pg'
import { config } from 'dotenv'
import { randomUUID } from 'node:crypto'

config()

const TEACHER_EMAIL = 'demo@eduskript.org'
const SKRIPT_SLUG = 'spacer-demo'
const SKRIPT_TITLE = 'Spacer Demo'
const COLLECTION_TITLE = 'Spacer Test'
const PAGE_SLUG = 'writing-areas'
const PAGE_TITLE = 'Spacer — writing areas'

const content = `# Spacer writing areas

Each exercise below is followed by a ${'`<spacer>`'} — a blank area students solve
on by hand with the annotation pens. In the editor, hover a spacer to drag its
bottom edge (height) and use the top-right toolbar to switch pattern or delete it.

## Exercise 1 — checkered (graph paper)

Solve the quadratic equation, showing each step:

$$x^2 - 5x + 6 = 0$$

<spacer id="sp-quad" pattern="checkered" height="220" />

## Exercise 2 — lines

Differentiate and note the intermediate steps:

$$f(x) = 3x^3 - 2x^2 + x - 5$$

<spacer id="sp-deriv" pattern="lines" height="180" />

## Exercise 3 — dots

Sketch the graph:

<spacer id="sp-sketch" pattern="dots" height="260" />

## Exercise 4 — blank

Free working space:

<spacer id="sp-free" pattern="blank" height="160" />
`

const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
await client.connect()

try {
  await client.query('BEGIN')

  const { rows: userRows } = await client.query('SELECT id FROM users WHERE email = $1', [TEACHER_EMAIL])
  if (userRows.length === 0) throw new Error(`User ${TEACHER_EMAIL} not found`)
  const userId = userRows[0].id

  const { rows: siteRows } = await client.query('SELECT id, slug FROM sites WHERE user_id = $1', [userId])
  if (siteRows.length === 0) throw new Error(`No site for ${TEACHER_EMAIL}`)
  const siteId = siteRows[0].id
  const siteSlug = siteRows[0].slug

  // Idempotent: drop any prior skript with this slug owned by our user.
  const { rows: priorSkripts } = await client.query(
    `SELECT s.id FROM skripts s
     JOIN skript_authors sa ON sa."skriptId" = s.id AND sa."userId" = $1
     WHERE s.slug = $2`,
    [userId, SKRIPT_SLUG]
  )
  for (const s of priorSkripts) {
    await client.query('DELETE FROM skripts WHERE id = $1', [s.id])
  }

  const collectionId = randomUUID()
  await client.query(
    `INSERT INTO collections (id, title, site_id, "createdAt", "updatedAt")
     VALUES ($1, $2, $3, NOW(), NOW())`,
    [collectionId, COLLECTION_TITLE, siteId]
  )

  const skriptId = randomUUID()
  await client.query(
    `INSERT INTO skripts (id, title, description, slug, skript_type, "isPublished", "isUnlisted", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, 'normal', true, false, NOW(), NOW())`,
    [skriptId, SKRIPT_TITLE, 'Test page for the <spacer> writing-area component', SKRIPT_SLUG]
  )
  await client.query(
    `INSERT INTO skript_authors (id, "skriptId", "userId", permission, "createdAt")
     VALUES ($1, $2, $3, 'author', NOW())`,
    [randomUUID(), skriptId, userId]
  )

  await client.query(
    `INSERT INTO collection_skripts (id, "collectionId", "skriptId", "order", "createdAt")
     VALUES ($1, $2, $3, 0, NOW())`,
    [randomUUID(), collectionId, skriptId]
  )

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
  console.log('seeded page:', `http://localhost:3000/${siteSlug}/${SKRIPT_SLUG}/${PAGE_SLUG}`)
  console.log('editor:', `http://localhost:3000/dashboard/pages/${pageId}`)
} catch (e) {
  await client.query('ROLLBACK')
  console.error(e)
  process.exitCode = 1
} finally {
  await client.end()
}
