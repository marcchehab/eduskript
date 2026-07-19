#!/usr/bin/env node
// Seeds a page to test the code-editor `output-only` mode + panel collapse:
// one output-only matplotlib editor (auto-runs, code hidden) and one normal
// editor to exercise collapse/expand of both panels.
import pg from 'pg'
import { config } from 'dotenv'
import { randomUUID } from 'node:crypto'

config()

const TEACHER_EMAIL = 'demo@eduskript.org'
const SKRIPT_SLUG = 'output-only-demo'
const SKRIPT_TITLE = 'Output-only Demo'
const COLLECTION_TITLE = 'Editor Test'
const PAGE_SLUG = 'output-only'
const PAGE_TITLE = 'Output-only code editor'

const plot = `import numpy as np
import matplotlib.pyplot as plt

x = np.linspace(-3, 3, 400)
plt.plot(x, np.sin(x), label='sin')
plt.plot(x, np.cos(x), label='cos')
plt.legend(); plt.grid(True)
plt.title('Auto-run, code hidden')
plt.show()`

const content = `# Output-only code editor

The editor below has \`output-only\`: it auto-runs on load and shows only the
plot. Click **Show code** to reveal, edit and rerun it.

\`\`\`python editor output-only height="360"
${plot}
\`\`\`

## Normal editor (collapse test)

Run this, then try the collapse buttons on each panel (hide code / hide plot)
and re-open them. The Run button must stay reachable when the code is hidden.

\`\`\`python editor id="collapse-test" height="320"
${plot}
\`\`\`
`

const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
await client.connect()
try {
  await client.query('BEGIN')
  const { rows: u } = await client.query('SELECT id FROM users WHERE email=$1', [TEACHER_EMAIL])
  if (!u.length) throw new Error(`User ${TEACHER_EMAIL} not found`)
  const userId = u[0].id
  const { rows: s } = await client.query('SELECT id, slug FROM sites WHERE user_id=$1', [userId])
  if (!s.length) throw new Error('No site')
  const siteId = s[0].id, siteSlug = s[0].slug

  const { rows: prior } = await client.query(
    `SELECT sk.id FROM skripts sk JOIN skript_authors sa ON sa."skriptId"=sk.id AND sa."userId"=$1 WHERE sk.slug=$2`,
    [userId, SKRIPT_SLUG]
  )
  for (const p of prior) await client.query('DELETE FROM skripts WHERE id=$1', [p.id])

  const collectionId = randomUUID()
  await client.query(`INSERT INTO collections (id, title, site_id, "createdAt", "updatedAt") VALUES ($1,$2,$3,NOW(),NOW())`, [collectionId, COLLECTION_TITLE, siteId])
  const skriptId = randomUUID()
  await client.query(`INSERT INTO skripts (id, title, description, slug, skript_type, "isPublished", "isUnlisted", "createdAt", "updatedAt") VALUES ($1,$2,$3,$4,'normal',true,false,NOW(),NOW())`, [skriptId, SKRIPT_TITLE, 'output-only + collapse test', SKRIPT_SLUG])
  await client.query(`INSERT INTO skript_authors (id, "skriptId", "userId", permission, "createdAt") VALUES ($1,$2,$3,'author',NOW())`, [randomUUID(), skriptId, userId])
  await client.query(`INSERT INTO collection_skripts (id, "collectionId", "skriptId", "order", "createdAt") VALUES ($1,$2,$3,0,NOW())`, [randomUUID(), collectionId, skriptId])
  const pageId = randomUUID()
  await client.query(`INSERT INTO pages (id, title, slug, content, "order", "isPublished", page_type, "skriptId", "createdAt", "updatedAt") VALUES ($1,$2,$3,$4,0,true,'normal',$5,NOW(),NOW())`, [pageId, PAGE_TITLE, PAGE_SLUG, content, skriptId])
  await client.query(`INSERT INTO page_authors (id, "pageId", "userId", permission, "createdAt") VALUES ($1,$2,$3,'author',NOW())`, [randomUUID(), pageId, userId])
  await client.query('COMMIT')
  console.log('public:', `http://localhost:3000/${siteSlug}/${SKRIPT_SLUG}/${PAGE_SLUG}`)
} catch (e) {
  await client.query('ROLLBACK'); console.error(e); process.exitCode = 1
} finally {
  await client.end()
}
