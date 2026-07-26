#!/usr/bin/env node
/**
 * One-off data repair: drop the `user-content-` segment from stored quiz
 * componentIds.
 *
 * WHY. Until commit 3b02b16f (2026-06-22) `markdown-compiler.ts` used
 * rehype-sanitize's default `clobberPrefix: 'user-content-'`, which rewrote a
 * `<question id="q1">` to `id="user-content-q1"`. The quiz component derives its
 * componentId from that attribute, so answers/scores were written under
 * `quiz-user-content-q1`. That commit set `clobberPrefix: ''` to fix footnote
 * anchors and thereby silently renamed every quiz componentId to `quiz-q1`.
 * Consequence: all pre-2026-06-22 quiz + survey answers became invisible — the
 * survey results view and the CSV export look up `quiz-<id>` and find nothing,
 * so every question reads as unanswered while the respondent count (derived
 * from class memberships) still shows the real number.
 *
 * WHAT. Renames the legacy key in every table that stores one:
 *   - user_data.adapter              (`quiz-user-content-…` → `quiz-…`)
 *   - user_data_checkpoints.component_id
 *   - component_scores.component_id
 *   - scoring_rubrics.component_id
 *
 * Collisions: a student who answered the same question both before and after
 * 2026-06-22 has rows under both keys. Renaming would violate the unique
 * constraints, so those rows are LEFT ALONE and listed in the output — the newer
 * (unprefixed) row is the one the app already reads. Collisions are found with a
 * NULL-safe self-join per constraint rather than by catching constraint errors,
 * so a dry run reports them too. user_data_checkpoints has no unique constraint
 * (append-only history), so all of its legacy rows are renamed.
 *
 * Idempotent — re-running finds nothing to do. Dry run by default:
 *   node scripts/normalize-clobbered-component-ids.mjs            # report only
 *   node scripts/normalize-clobbered-component-ids.mjs --apply    # write
 *
 * Run against production by exporting the prod DATABASE_URL first.
 * Related: src/lib/scoring/components.ts, src/app/api/survey-responses/.
 */

import pg from 'pg'
import { config } from 'dotenv'

config()

const APPLY = process.argv.includes('--apply')
const LEGACY = 'quiz-user-content-'

/**
 * Each target: table, the column holding the componentId, and the OTHER columns
 * of its unique constraint (used to find pre-existing canonical twins). `keyCols:
 * null` means the table has no unique constraint on that column.
 */
const TARGETS = [
  { table: 'user_data', column: 'adapter', keyCols: ['user_id', 'item_id', 'target_type', 'target_id'] },
  { table: 'user_data_checkpoints', column: 'component_id', keyCols: null },
  { table: 'component_scores', column: 'component_id', keyCols: ['page_id', 'student_id', 'source'] },
  { table: 'scoring_rubrics', column: 'component_id', keyCols: ['page_id'] },
]

const client = new pg.Client({ connectionString: process.env.DATABASE_URL })

/** NULL-safe equality per key column, so nullable targetType/targetId match. */
function joinOn(keyCols) {
  return keyCols.map((c) => `l.${c} IS NOT DISTINCT FROM c.${c}`).join(' AND ')
}

try {
  await client.connect()

  let totalRenamable = 0
  let totalCollisions = 0

  for (const { table, column, keyCols } of TARGETS) {
    const { rows: legacy } = await client.query(
      `SELECT count(*)::int AS n FROM ${table} WHERE ${column} LIKE $1`,
      [`${LEGACY}%`]
    )
    if (legacy[0].n === 0) {
      console.log(`${table}.${column}: nothing to do`)
      continue
    }

    // Legacy rows whose canonical twin already exists — renaming them would
    // collide, so they are reported and skipped.
    const collisions = keyCols
      ? (
          await client.query(
            `SELECT l.id, l.${column} AS legacy_key
               FROM ${table} l
               JOIN ${table} c
                 ON c.${column} = 'quiz-' || substring(l.${column} from ${LEGACY.length + 1})
                AND ${joinOn(keyCols)}
              WHERE l.${column} LIKE $1`,
            [`${LEGACY}%`]
          )
        ).rows
      : []

    const renamable = legacy[0].n - collisions.length
    totalRenamable += renamable
    totalCollisions += collisions.length
    console.log(
      `${table}.${column}: ${legacy[0].n} legacy row(s) — ${renamable} renamable, ${collisions.length} collision(s)`
    )
    for (const c of collisions) {
      console.log(`    skip ${c.id} (${c.legacy_key}) — canonical twin exists`)
    }

    if (!APPLY || renamable === 0) continue

    const skipIds = collisions.map((c) => c.id)
    const { rowCount } = await client.query(
      `UPDATE ${table}
          SET ${column} = 'quiz-' || substring(${column} from ${LEGACY.length + 1})
        WHERE ${column} LIKE $1
          AND NOT (id = ANY($2::text[]))`,
      [`${LEGACY}%`, skipIds]
    )
    console.log(`    renamed ${rowCount} row(s)`)
  }

  console.log(
    APPLY
      ? `\nDone. ${totalRenamable} row(s) normalized, ${totalCollisions} skipped.`
      : `\nDry run. ${totalRenamable} row(s) would be normalized, ${totalCollisions} skipped. Re-run with --apply.`
  )
} catch (error) {
  console.error('Failed:', error.message)
  process.exit(1)
} finally {
  await client.end()
}
