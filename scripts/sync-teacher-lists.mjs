#!/usr/bin/env node
/**
 * Backfill the EN/DE teacher product-update lists in Brevo.
 *
 * One-off companion to src/lib/teacher-list.ts (which keeps the lists in sync
 * from signup/profile routes): puts every existing non-temporary teacher with
 * an email on the list matching their site language, and removes them from the
 * other one. Calls the Brevo REST API directly (no TS imports in a .mjs).
 *
 * Usage: node scripts/sync-teacher-lists.mjs [--dry-run]
 * Needs: BREVO_API_KEY, BREVO_TEACHER_LIST_EN, BREVO_TEACHER_LIST_DE in .env
 */

import pg from 'pg'
import { config } from 'dotenv'

config()

const DRY = process.argv.includes('--dry-run')
const API_KEY = process.env.BREVO_API_KEY
const LIST_EN = Number(process.env.BREVO_TEACHER_LIST_EN)
const LIST_DE = Number(process.env.BREVO_TEACHER_LIST_DE)

if (!API_KEY || !LIST_EN || !LIST_DE) {
  console.error('Set BREVO_API_KEY, BREVO_TEACHER_LIST_EN, BREVO_TEACHER_LIST_DE first.')
  process.exit(1)
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
await client.connect()

const { rows } = await client.query(`
  SELECT u.id, u.email, u.name,
         bool_or(lower(coalesce(s.page_language, 'en')) LIKE 'de%') AS is_german
  FROM users u
  LEFT JOIN sites s ON s.user_id = u.id
  WHERE u."accountType" = 'teacher'
    AND u.is_temporary = false
    AND u.email IS NOT NULL
  GROUP BY u.id
  ORDER BY u.email
`)
await client.end()

async function brevo(path, method, body) {
  const res = await fetch(`https://api.brevo.com/v3${path}`, {
    method,
    headers: { 'api-key': API_KEY, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  return res
}

let ok = 0, failed = 0
for (const row of rows) {
  const target = row.is_german ? LIST_DE : LIST_EN
  const other = row.is_german ? LIST_EN : LIST_DE
  const label = `${row.email} -> ${row.is_german ? 'DE' : 'EN'}`
  if (DRY) {
    console.log(`[dry-run] ${label}`)
    continue
  }
  // Upsert onto the target list
  const res = await brevo('/contacts', 'POST', {
    email: row.email,
    attributes: row.name ? { FIRSTNAME: row.name } : undefined,
    listIds: [target],
    updateEnabled: true,
  })
  if (!res.ok && res.status !== 204) {
    const detail = await res.text().catch(() => '')
    console.error(`FAIL ${label}: ${res.status} ${detail.slice(0, 120)}`)
    failed++
    continue
  }
  // Remove from the other list; 400 "not in list" is the normal case
  await brevo(`/contacts/lists/${other}/contacts/remove`, 'POST', { emails: [row.email] }).catch(() => {})
  console.log(`OK   ${label}`)
  ok++
  // Brevo free-plan rate limit is generous but stay polite
  await new Promise(r => setTimeout(r, 120))
}

console.log(`\n${DRY ? rows.length + ' teachers (dry run)' : `${ok} synced, ${failed} failed`}`)
