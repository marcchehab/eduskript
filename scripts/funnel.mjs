#!/usr/bin/env node
/**
 * Teacher adoption funnel from PROD, read-only.
 *
 * Stages per teacher (excluding Chris' own/demo accounts, see EXCLUDE):
 *   1. registered        users.createdAt (accountType='teacher')
 *   2. own skript        first skript they author that is NOT the onboarding seed
 *   3. real content      an own skript with >= MIN_CHARS of page content in total
 *   4. class             first non-implicit class they own
 *   5. students active   first student who joined their class OR has progress/user_data
 *                        on one of their pages
 *
 * Seed detection is heuristic: a skript counts as seed if its title or any page
 * title matches SEED_PATTERN (the Welcome/First-steps skripts seeded on signup,
 * also when renamed by the teacher). Update the pattern if the seed changes.
 *
 * Runs in a `BEGIN READ ONLY` transaction via DATABASE_URL_PROD, then ROLLBACK.
 * Usage: node scripts/funnel.mjs [--md]   (--md prints a Markdown table)
 */
import pg from 'pg'
import { config } from 'dotenv'

config({ quiet: true })

const EXCLUDE = [
  'eduadmin@eduskript.org',
  'marc@informatikgarten.ch',
  'demovideo@eduskript.org',
  'demo@eduskript.org',
]
const SEED_PATTERN = '^(welcome to eduskript|willkommen|first steps|erste schritte)'
const MIN_CHARS = 1000

const SQL = `
with t as (
  select id, email, name, "createdAt" reg, "lastSeenAt" seen
  from users where "accountType" = 'teacher' and not (email = any($1))
),
own as (
  select a."userId" uid, s.id sid, s."createdAt" created,
         coalesce((select sum(length(p.content)) from pages p where p."skriptId" = s.id), 0) chars
  from skript_authors a join skripts s on s.id = a."skriptId"
  where a.permission = 'author'
    and s.title !~* $2
    and not exists (select 1 from pages p where p."skriptId" = s.id and p.title ~* $2)
),
tpages as (
  select a."userId" uid, p.id pid from skript_authors a
  join pages p on p."skriptId" = a."skriptId" where a.permission = 'author'
),
act as (
  select c.teacher_id uid, m.joined_at at from classes c join class_memberships m on m.class_id = c.id
  where not c.is_implicit
  union all
  select tp.uid, sp.last_viewed_at from tpages tp join student_progress sp on sp.page_id = tp.pid
  join users s on s.id = sp.student_id and s."accountType" = 'student'
  union all
  select tp.uid, d.updated_at from tpages tp join user_data d on d.item_id = tp.pid
  join users s on s.id = d.user_id and s."accountType" = 'student'
)
select t.email, t.name, t.reg, t.seen,
  (select min(created) from own where uid = t.id) own_skript,
  (select min(created) from own where uid = t.id and chars >= $3) real_content,
  (select min(created_at) from classes where teacher_id = t.id and not is_implicit) class,
  (select min(at) from act where uid = t.id) students,
  (select count(distinct s.id) from users s join class_memberships m on m.student_id = s.id
     join classes c on c.id = m.class_id where c.teacher_id = t.id and not c.is_implicit) n_students
from t order by t.reg`

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL_PROD,
  ssl: { rejectUnauthorized: false },
})
await client.connect()
await client.query('BEGIN READ ONLY')
let rows
try {
  rows = (await client.query(SQL, [EXCLUDE, SEED_PATTERN, MIN_CHARS])).rows
} finally {
  await client.query('ROLLBACK')
  await client.end()
}

const d = (x) => (x ? new Date(x).toLocaleDateString('sv-SE', { timeZone: 'Europe/Zurich' }) : '–')
const stages = [
  ['registered', 'reg'],
  ['own skript', 'own_skript'],
  [`content >=${MIN_CHARS} chars`, 'real_content'],
  ['class created', 'class'],
  ['students active', 'students'],
]
const weekAgo = Date.now() - 7 * 864e5

console.log(`Funnel ${d(Date.now())} (${rows.length} teachers, excl. ${EXCLUDE.length} own/demo accounts)\n`)
for (const [label, key] of stages) {
  const hit = rows.filter((r) => r[key])
  const week = hit.filter((r) => new Date(r[key]) > weekAgo).length
  console.log(`${label.padEnd(24)} ${String(hit.length).padStart(3)}   (+${week} last 7 days)`)
}

if (process.argv.includes('--md')) {
  console.log('\n| Lehrperson | registriert | zuletzt gesehen | eigenes Skript | Inhalt | Klasse | Schüler aktiv |')
  console.log('|---|---|---|---|---|---|---|')
  for (const r of rows) {
    const st = r.students ? `${d(r.students)} (${r.n_students})` : '–'
    console.log(`| ${r.name ?? r.email} | ${d(r.reg)} | ${d(r.seen)} | ${d(r.own_skript)} | ${d(r.real_content)} | ${d(r.class)} | ${st} |`)
  }
}
