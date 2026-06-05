#!/usr/bin/env node
/**
 * Backfill: copy the two legacy score-source tables into the unified
 * `component_scores` table (the priority-based score record).
 *
 *   exam_check_runs       -> source="check",    priority=10
 *   exam_question_grades  -> source="override", priority=100
 *
 * After this runs and the resolver/writers no longer read the old tables, the
 * `drop_legacy_score_tables` migration removes exam_check_runs +
 * exam_question_grades. See src/lib/scoring and the plan doc.
 *
 * Idempotent: ON CONFLICT (page_id, student_id, component_id, source) DO NOTHING,
 * so re-running never duplicates. New `ai` rows are never touched.
 *
 * Usage: node scripts/backfill-component-scores.mjs
 * Verify parity: the printed copied counts should match the source row counts.
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

  const before = await client.query('SELECT count(*)::int AS n FROM component_scores')
  const checks = await client.query('SELECT count(*)::int AS n FROM exam_check_runs')
  const overrides = await client.query('SELECT count(*)::int AS n FROM exam_question_grades')
  console.log(
    `Before: component_scores=${before.rows[0].n} | exam_check_runs=${checks.rows[0].n} | exam_question_grades=${overrides.rows[0].n}`,
  )

  // check score: earned/max always present; meta carries the test counts.
  const checkRes = await client.query(`
    INSERT INTO component_scores
      (id, page_id, student_id, component_id, source, priority, earned, max, feedback, meta, created_by, created_at, updated_at)
    SELECT
      'c' || replace(gen_random_uuid()::text, '-', ''),
      page_id, student_id, component_id, 'check', 10,
      earned, max, NULL,
      jsonb_build_object('passed', passed, 'total', total),
      ran_by, ran_at, ran_at
    FROM exam_check_runs
    ON CONFLICT (page_id, student_id, component_id, source) DO NOTHING
  `)
  console.log(`Copied check scores: ${checkRes.rowCount}`)

  // override: awarded_points may be NULL (row carried feedback only) -> earned NULL.
  const overrideRes = await client.query(`
    INSERT INTO component_scores
      (id, page_id, student_id, component_id, source, priority, earned, max, feedback, meta, created_by, created_at, updated_at)
    SELECT
      'c' || replace(gen_random_uuid()::text, '-', ''),
      page_id, student_id, component_id, 'override', 100,
      awarded_points, max_points, feedback,
      NULL,
      graded_by, created_at, updated_at
    FROM exam_question_grades
    ON CONFLICT (page_id, student_id, component_id, source) DO NOTHING
  `)
  console.log(`Copied override scores: ${overrideRes.rowCount}`)

  const after = await client.query('SELECT count(*)::int AS n FROM component_scores')
  console.log(`After: component_scores=${after.rows[0].n}`)

  await client.end()
}

main().catch((e) => {
  console.error(e)
  client.end()
  process.exit(1)
})
