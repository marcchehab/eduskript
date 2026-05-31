#!/usr/bin/env node
// Seeds a GeoGebra exercise page + fake student submissions so the teacher's
// "how many got it right" class tally can be tested end-to-end.
// Exercise: <geogebra material-id="dNPHaqgb" correct-when="correct" />
//   → componentId = geogebra-dNPHaqgb
// Seeds 3 students of the "E2E Class" (all members): 2 correct, 1 incorrect.
// URL: /teacher/geogebra-exercise/exercise
import pg from 'pg'
import { config } from 'dotenv'
import { randomUUID } from 'node:crypto'
config()

const TEACHER = 'teacher@eduskript.test'
const SKRIPT_SLUG = 'geogebra-exercise'
const PAGE_SLUG = 'exercise'
const MATERIAL_ID = 'dNPHaqgb'
const COMPONENT_ID = `geogebra-${MATERIAL_ID}`
const content = `# GeoGebra exercise

Construct the parabola so it passes through the marked points. The applet
defines a boolean \`correct\` that turns true when your answer is right.

<geogebra material-id="${MATERIAL_ID}" correct-when="correct" height="500" />
`

// Members of "E2E Class" (all 3 dev students) + their seeded results.
const RESULTS = [
  { email: 'student1@eduskript.test', correct: true },
  { email: 'student2@eduskript.test', correct: true },
  { email: 'student3@eduskript.test', correct: false },
]

const c = new pg.Client({ connectionString: process.env.DATABASE_URL })
await c.connect()
try {
  await c.query('BEGIN')
  const { rows: u } = await c.query('SELECT id FROM users WHERE email=$1', [TEACHER])
  const uid = u[0].id
  const { rows: s } = await c.query('SELECT id, slug FROM sites WHERE user_id=$1', [uid])
  const sid = s[0].id, sslug = s[0].slug

  const { rows: prior } = await c.query(
    `SELECT s.id FROM skripts s JOIN skript_authors sa ON sa."skriptId"=s.id AND sa."userId"=$1 WHERE s.slug=$2`,
    [uid, SKRIPT_SLUG])
  for (const r of prior) await c.query('DELETE FROM skripts WHERE id=$1', [r.id])

  const cid = randomUUID()
  await c.query(`INSERT INTO collections (id,title,site_id,"createdAt","updatedAt") VALUES ($1,$2,$3,NOW(),NOW())`, [cid, 'GeoGebra exercise', sid])
  const kid = randomUUID()
  await c.query(`INSERT INTO skripts (id,title,description,slug,skript_type,"isPublished","isUnlisted","createdAt","updatedAt") VALUES ($1,$2,$3,$4,'normal',true,false,NOW(),NOW())`, [kid, 'GeoGebra exercise', '', SKRIPT_SLUG])
  await c.query(`INSERT INTO skript_authors (id,"skriptId","userId",permission,"createdAt") VALUES ($1,$2,$3,'author',NOW())`, [randomUUID(), kid, uid])
  await c.query(`INSERT INTO collection_skripts (id,"collectionId","skriptId","order","createdAt") VALUES ($1,$2,$3,0,NOW())`, [randomUUID(), cid, kid])
  const pid = randomUUID()
  await c.query(`INSERT INTO pages (id,title,slug,content,"order","isPublished",page_type,"skriptId","createdAt","updatedAt") VALUES ($1,$2,$3,$4,0,true,'normal',$5,NOW(),NOW())`,
    [pid, 'Exercise', PAGE_SLUG, content, kid])
  await c.query(`INSERT INTO page_authors (id,"pageId","userId",permission,"createdAt") VALUES ($1,$2,$3,'author',NOW())`, [randomUUID(), pid, uid])

  // Seed each student's stored result (adapter=componentId, item_id=pageId).
  for (const r of RESULTS) {
    const { rows: su } = await c.query('SELECT id FROM users WHERE email=$1', [r.email])
    if (!su.length) { console.warn('missing', r.email); continue }
    const studentId = su[0].id
    await c.query(
      `DELETE FROM user_data WHERE user_id=$1 AND adapter=$2 AND item_id=$3`,
      [studentId, COMPONENT_ID, pid])
    await c.query(
      `INSERT INTO user_data (id, user_id, adapter, item_id, data, version, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,1,NOW(),NOW())`,
      [randomUUID(), studentId, COMPONENT_ID, pid, JSON.stringify({ correct: r.correct, hasAttempted: true, ggbBase64: '' })])
  }

  await c.query('COMMIT')
  console.log(`seeded exercise: http://localhost:3000/${sslug}/${SKRIPT_SLUG}/${PAGE_SLUG}`)
  console.log(`componentId=${COMPONENT_ID}, pageId=${pid}`)
  console.log('Expected with "E2E Class" selected: 2 correct, 1 incorrect (of 3).')
} catch (e) { await c.query('ROLLBACK'); console.error(e); process.exitCode = 1 } finally { await c.end() }
