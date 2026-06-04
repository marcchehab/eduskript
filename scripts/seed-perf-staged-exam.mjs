#!/usr/bin/env node
// Self-contained staged exam (<next-stage>) with a programming editor in stage 2
// that intentionally LACKS the `exam` fence flag — the case where stage-2 editors
// would lazy-mount on reveal without the StageFlow EagerMountContext fix.
// URL: /exam/teacher/perf-staged/staged
import pg from 'pg'
import { config } from 'dotenv'
import { randomUUID } from 'node:crypto'
config()

const TEACHER = 'teacher@eduskript.test'
const SKRIPT_SLUG = 'perf-staged'
const PAGE_SLUG = 'staged'
const content = `# Staged exam (perf test)

## Stage 1 — predict the output

\`\`\`python
for i in range(3):
    print(i * 2)
\`\`\`

<question id="s1q1" type="text" points="2">
Predict the output:

\`\`\`expected
0
2
4
\`\`\`

</question>

<next-stage label="Hand in & continue">

## Stage 2 — write a program

Write and run a program that prints the squares of 0..3.

\`\`\`python editor id="task"
# your code here
\`\`\`
`
const examSettings = { requireSEB: false, unlockForAll: true }

const c = new pg.Client({ connectionString: process.env.DATABASE_URL })
await c.connect()
try {
  await c.query('BEGIN')
  const { rows: u } = await c.query('SELECT id FROM users WHERE email=$1', [TEACHER])
  if (!u.length) throw new Error('teacher not found')
  const uid = u[0].id
  const { rows: s } = await c.query('SELECT id, slug FROM sites WHERE user_id=$1', [uid])
  const sid = s[0].id, sslug = s[0].slug
  const { rows: prior } = await c.query(
    `SELECT s.id FROM skripts s JOIN skript_authors sa ON sa."skriptId"=s.id AND sa."userId"=$1 WHERE s.slug=$2`,
    [uid, SKRIPT_SLUG])
  for (const r of prior) await c.query('DELETE FROM skripts WHERE id=$1', [r.id])
  const cid = randomUUID()
  await c.query(`INSERT INTO collections (id,title,site_id,"createdAt","updatedAt") VALUES ($1,$2,$3,NOW(),NOW())`, [cid, 'Perf staged', sid])
  const kid = randomUUID()
  await c.query(`INSERT INTO skripts (id,title,description,slug,skript_type,"isPublished","isUnlisted","createdAt","updatedAt") VALUES ($1,$2,$3,$4,'normal',true,false,NOW(),NOW())`, [kid, 'Perf staged', '', SKRIPT_SLUG])
  await c.query(`INSERT INTO skript_authors (id,"skriptId","userId",permission,"createdAt") VALUES ($1,$2,$3,'author',NOW())`, [randomUUID(), kid, uid])
  await c.query(`INSERT INTO collection_skripts (id,"collectionId","skriptId","order","createdAt") VALUES ($1,$2,$3,0,NOW())`, [randomUUID(), cid, kid])
  const pid = randomUUID()
  await c.query(`INSERT INTO pages (id,title,slug,content,"order","isPublished",page_type,exam_settings,"skriptId","createdAt","updatedAt") VALUES ($1,$2,$3,$4,0,true,'exam',$5,$6,NOW(),NOW())`,
    [pid, 'Staged', PAGE_SLUG, content, JSON.stringify(examSettings), kid])
  await c.query(`INSERT INTO page_authors (id,"pageId","userId",permission,"createdAt") VALUES ($1,$2,$3,'author',NOW())`, [randomUUID(), pid, uid])
  await c.query('COMMIT')
  console.log(`http://localhost:3000/exam/${sslug}/${SKRIPT_SLUG}/${PAGE_SLUG}`)
} catch (e) { await c.query('ROLLBACK'); console.error(e); process.exitCode = 1 } finally { await c.end() }
