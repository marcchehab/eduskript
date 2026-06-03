#!/usr/bin/env node
// Seeds a page with GeoGebra embeds (two applets, to confirm one shared
// deployggb.js load) under the dev teacher's site.
// URL: /teacher/geogebra-demo/applets
import pg from 'pg'
import { config } from 'dotenv'
import { randomUUID } from 'node:crypto'
config()

const TEACHER = 'teacher@eduskript.test'
const SKRIPT_SLUG = 'geogebra-demo'
const PAGE_SLUG = 'applets'
const content = `# GeoGebra demo

A quadratic-function applet loaded from a geogebra.org material by id:

<geogebra material-id="dNPHaqgb" height="500" />

Some prose between the two so the second one starts below the fold.

${Array.from({ length: 15 }, (_, i) => `Filler paragraph ${i + 1}.`).join('\n\n')}

A second applet (with toolbar) to confirm both mount independently:

<geogebra material-id="aJ4ecNF6" height="450" show-toolbar="true" />
`

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
  await c.query(`INSERT INTO collections (id,title,site_id,"createdAt","updatedAt") VALUES ($1,$2,$3,NOW(),NOW())`, [cid, 'GeoGebra demo', sid])
  const kid = randomUUID()
  await c.query(`INSERT INTO skripts (id,title,description,slug,skript_type,"isPublished","isUnlisted","createdAt","updatedAt") VALUES ($1,$2,$3,$4,'normal',true,false,NOW(),NOW())`, [kid, 'GeoGebra demo', '', SKRIPT_SLUG])
  await c.query(`INSERT INTO skript_authors (id,"skriptId","userId",permission,"createdAt") VALUES ($1,$2,$3,'author',NOW())`, [randomUUID(), kid, uid])
  await c.query(`INSERT INTO collection_skripts (id,"collectionId","skriptId","order","createdAt") VALUES ($1,$2,$3,0,NOW())`, [randomUUID(), cid, kid])
  const pid = randomUUID()
  await c.query(`INSERT INTO pages (id,title,slug,content,"order","isPublished",page_type,"skriptId","createdAt","updatedAt") VALUES ($1,$2,$3,$4,0,true,'normal',$5,NOW(),NOW())`,
    [pid, 'Applets', PAGE_SLUG, content, kid])
  await c.query(`INSERT INTO page_authors (id,"pageId","userId",permission,"createdAt") VALUES ($1,$2,$3,'author',NOW())`, [randomUUID(), pid, uid])
  await c.query('COMMIT')
  console.log(`http://localhost:3000/${sslug}/${SKRIPT_SLUG}/${PAGE_SLUG}`)
} catch (e) { await c.query('ROLLBACK'); console.error(e); process.exitCode = 1 } finally { await c.end() }
