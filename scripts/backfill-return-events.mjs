#!/usr/bin/env node
/**
 * Backfill: turn every already-returned ExamSubmission into an initial `return`
 * event in the unified exam_audit_logs table, preserving its EXACT frozen
 * gradeSnapshot/score. This is the expand step of the expand/contract migration
 * that moves return state out of exam_submissions and into the event log
 * (src/lib/scoring/return-state.ts is the new source of truth).
 *
 * Run AFTER the additive `extend_exam_audit_log` migration and BEFORE the
 * `drop_exam_submission_return_fields` contract migration.
 *
 * Idempotent: skips any (page_id, student_id) that already has a `return` event,
 * so re-running never duplicates.
 *
 * Usage: node scripts/backfill-return-events.mjs
 * Verify parity: inserted count should equal the returned-submission count.
 */

import pg from 'pg'
import { config } from 'dotenv'

config({ path: '.env.local' })
config()

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error('DATABASE_URL not set')
  process.exit(1)
}

const client = new pg.Client({ connectionString })

async function main() {
  await client.connect()

  const returned = await client.query(
    `SELECT count(*)::int AS n FROM exam_submissions WHERE returned_at IS NOT NULL`,
  )
  const existing = await client.query(
    `SELECT count(*)::int AS n FROM exam_audit_logs WHERE event = 'return'`,
  )
  console.log(`Before: returned submissions=${returned.rows[0].n} | existing 'return' events=${existing.rows[0].n}`)

  // created_by = the scorer (the teacher who returned it); scored_by is always set
  // when returned_at is, but COALESCE to student_id defensively to satisfy the FK.
  // occurred_at = the original return time so the event timeline is truthful.
  const res = await client.query(`
    INSERT INTO exam_audit_logs (id, page_id, student_id, event, payload, score, created_by, occurred_at)
    SELECT
      'c' || replace(gen_random_uuid()::text, '-', ''),
      es.page_id, es.student_id, 'return',
      es.grade_snapshot, es.score,
      COALESCE(es.scored_by, es.student_id),
      COALESCE(es.returned_at, es.scored_at, NOW())
    FROM exam_submissions es
    WHERE es.returned_at IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM exam_audit_logs l
        WHERE l.page_id = es.page_id AND l.student_id = es.student_id AND l.event = 'return'
      )
    RETURNING 1
  `)
  console.log(`Inserted 'return' events: ${res.rowCount}`)

  const after = await client.query(
    `SELECT count(*)::int AS n FROM exam_audit_logs WHERE event = 'return'`,
  )
  console.log(`After: 'return' events=${after.rows[0].n}`)
  if (after.rows[0].n < returned.rows[0].n) {
    console.warn(
      `WARNING: 'return' events (${after.rows[0].n}) < returned submissions (${returned.rows[0].n}). Investigate before the contract migration.`,
    )
  } else {
    console.log('Parity OK.')
  }
}

main()
  .catch((err) => {
    console.error('Backfill failed:', err.message)
    process.exitCode = 1
  })
  .finally(() => client.end())
