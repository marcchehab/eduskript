#!/usr/bin/env node
/**
 * Ground-truth verifier for the rich-exam test: reads ComponentScore rows for the
 * exam page and computes the EFFECTIVE score per (student, component) using the
 * same precedence as the app (highest priority with non-null earned; tiebreak by
 * latest updatedAt), then totals + the 1-6 grade. Prints a per-student table.
 *
 * Usage: node scripts/verify-rich-exam.mjs <pageId>
 */
import { config } from 'dotenv'
config({ path: '.env.local' }); config()
import pg from 'pg'

const pageId = process.argv[2]
if (!pageId) { console.error('usage: verify-rich-exam.mjs <pageId>'); process.exit(1) }

const COMPONENTS = [
  ['quiz-user-content-q1', 'Q1', 2],
  ['quiz-user-content-q2', 'Q2', 2],
  ['python-check-e1code', 'E1', 4],
  ['python-check-e2code', 'E2', 3],
  ['python-check-e3code', 'E3', 5],
]
const MAX = COMPONENTS.reduce((s, c) => s + c[2], 0)

function grade(earned) {
  const p = Math.max(0, Math.min(100, (earned / MAX) * 100))
  const raw = p <= 60 ? 1 + 3 * (p / 60) : 4 + 2 * ((p - 60) / 40)
  return Math.round(Math.min(6, Math.max(1, raw)) / 0.1) * 0.1
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
await client.connect()
const { rows } = await client.query(
  `SELECT cs.student_id, u.email, cs.component_id, cs.source, cs.priority, cs.earned, cs.updated_at
   FROM component_scores cs JOIN users u ON u.id=cs.student_id
   WHERE cs.page_id=$1 ORDER BY u.email`, [pageId])
await client.end()

// student -> component -> rows
const byStudent = new Map()
for (const r of rows) {
  if (!byStudent.has(r.email)) byStudent.set(r.email, new Map())
  const m = byStudent.get(r.email)
  if (!m.has(r.component_id)) m.set(r.component_id, [])
  m.get(r.component_id).push(r)
}

const effective = (rs) => {
  const pts = rs.filter(r => r.earned != null)
    .sort((a, b) => b.priority - a.priority || new Date(b.updated_at) - new Date(a.updated_at))
  return pts[0] ? { earned: Number(pts[0].earned), source: pts[0].source } : null
}

const emails = [...byStudent.keys()].sort()
console.log(`\nEffective scores for page ${pageId} (max ${MAX})\n`)
console.log('student'.padEnd(26) + COMPONENTS.map(c => c[1].padEnd(10)).join('') + 'total  grade')
for (const email of emails) {
  const m = byStudent.get(email)
  let total = 0
  const cells = COMPONENTS.map(([id, , ]) => {
    const e = m.has(id) ? effective(m.get(id)) : null
    if (e) { total += e.earned; return `${e.earned}(${e.source[0]})`.padEnd(10) }
    return '–'.padEnd(10)
  })
  total = Math.round(total * 10) / 10
  console.log(email.padEnd(26) + cells.join('') + String(total).padEnd(7) + grade(total).toFixed(1))
}
console.log('\n(source: c=check, a=ai, o=override)\n')
