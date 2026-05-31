#!/usr/bin/env node
// Seeds a page packed with MANY Python editors to stress-test client-side
// performance (CodeMirror view count, runtime preloads, listeners) on weaker
// devices. Chain: Collection -> Skript -> Page under the dev teacher's site.
// URL: /teacher/perf-many-editors/python-wall
// Count overridable: EDITOR_COUNT=60 node scripts/seed-perf-many-editors.mjs
import pg from 'pg'
import { config } from 'dotenv'
import { randomUUID } from 'node:crypto'

config()

const TEACHER_EMAIL = 'teacher@eduskript.test'
const SKRIPT_SLUG = 'perf-many-editors'
const SKRIPT_TITLE = 'Perf — many editors'
const COLLECTION_TITLE = 'Perf testing'
const PAGE_SLUG = 'python-wall'
const PAGE_TITLE = 'Python editor wall (perf)'
const COUNT = Number(process.env.EDITOR_COUNT || 40)

function editorBlock(i) {
  return `## Exercise ${i + 1}

Some explanatory prose for exercise ${i + 1}. Read the snippet, predict the
output, then run it. This paragraph exists to make the page realistically tall
so editors are spread across a long scroll.

\`\`\`python editor
# Exercise ${i + 1}
def compute_${i}(n):
    total = 0
    for k in range(n):
        total += k * ${i + 1}
    return total

values = [compute_${i}(x) for x in range(${(i % 5) + 3})]
print("Exercise ${i + 1}:", values)
print("Sum:", sum(values))
\`\`\`
`
}

const content = `# Python editor wall (perf)

A long page with ${COUNT} Python editors to profile client-side performance.

${Array.from({ length: COUNT }, (_, i) => editorBlock(i)).join('\n')}
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
    [skriptId, SKRIPT_TITLE, 'Stress test: many Python editors', SKRIPT_SLUG]
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
  console.log(`seeded ${COUNT} editors:`, `http://localhost:3000/${siteSlug}/${SKRIPT_SLUG}/${PAGE_SLUG}`)
} catch (e) {
  await client.query('ROLLBACK')
  console.error(e)
  process.exitCode = 1
} finally {
  await client.end()
}
