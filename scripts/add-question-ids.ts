/**
 * One-off repair: give stored lowercase `<question>` tags an id.
 *
 * WHY. A question without an id has the componentId `quiz-`: all of them on a
 * page share one stored answer, and exam grading skips them. See
 * src/lib/question-ids.ts. New questions get an id from the editor; this handles
 * content that already exists.
 *
 * WHAT, per affected page:
 *   - inserts id="q-<8 hex of sha1(pageId:position)>" into pages.content and
 *     appends a page_versions row. Ids are derived, so a dry run shows the ids an
 *     apply will write. Questions that already have an id are not touched.
 *   - answers: exactly one question without an id on the page means every `quiz-`
 *     row of that page belongs to it, so the rows are renamed to `quiz-<new id>`
 *     (user_data.adapter and the component_id of user_data_checkpoints,
 *     component_scores, scoring_rubrics). See scripts/normalize-clobbered-component-ids.mjs.
 *   - two or more on the page: a `quiz-` row holds whichever question the student
 *     answered last, and the row does not say which one. Mapping it to a question
 *     would be a guess, so these rows are NOT renamed. They stay in the database
 *     and are listed in the output, but no question reads them after the repair,
 *     so those students see these questions as unanswered.
 *
 * Limits: position-derived ids are stable only for a given page content, so run
 * the dry run right before the apply. The public page cache is not
 * invalidated by this script: rendered pages stay stale until their cache expires
 * or the page is saved. Not run against production as of writing.
 *
 *   DATABASE_URL=… npx tsx scripts/add-question-ids.ts            # report only
 *   DATABASE_URL=… npx tsx scripts/add-question-ids.ts --apply    # write
 *
 * Idempotent: a second run finds nothing, because the pages then have ids.
 */

import { createHash, randomUUID } from 'node:crypto'
import pg from 'pg'
import { addQuestionIds } from '../src/lib/question-ids'

const APPLY = process.argv.includes('--apply')
const SHARED_ID = 'quiz-'
const CHANGE_LOG = 'Add missing question ids (scripts/add-question-ids.ts)'

/** Tables keyed by componentId, with the column that holds the page id. */
const TARGETS = [
  { table: 'user_data', column: 'adapter', pageColumn: 'item_id' },
  { table: 'user_data_checkpoints', column: 'component_id', pageColumn: 'page_id' },
  { table: 'component_scores', column: 'component_id', pageColumn: 'page_id' },
  { table: 'scoring_rubrics', column: 'component_id', pageColumn: 'page_id' },
]

const deriveId = (pageId: string, index: number) =>
  `q-${createHash('sha1').update(`${pageId}:${index}`).digest('hex').slice(0, 8)}`

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()

  const { rows: pages } = await client.query<{ id: string; slug: string; content: string; page_type: string }>(
    `SELECT id, slug, content, page_type FROM pages WHERE content LIKE '%<question%' ORDER BY id`
  )

  const totals = { pages: 0, examPages: 0, questions: 0, renamed: 0, unmapped: 0, unmappedPages: 0 }

  for (const page of pages) {
    const { content, ids } = addQuestionIds(page.content, (i) => deriveId(page.id, i))
    if (ids.length === 0) continue

    totals.pages++
    totals.questions += ids.length
    if (page.page_type === 'exam') totals.examPages++

    const counts: Record<string, number> = {}
    for (const { table, column, pageColumn } of TARGETS) {
      const { rows } = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM ${table} WHERE ${column} = $1 AND ${pageColumn} = $2`,
        [SHARED_ID, page.id]
      )
      counts[table] = rows[0].n
    }
    const rowCount = Object.values(counts).reduce((sum, n) => sum + n, 0)
    const mappable = ids.length === 1
    if (mappable) totals.renamed += rowCount
    else if (rowCount > 0) {
      totals.unmapped += rowCount
      totals.unmappedPages++
    }
    console.log(
      `${page.id} ${page.page_type} ${page.slug}: ${ids.length} question(s), ${rowCount} shared row(s) `
      + `${rowCount === 0 ? '' : mappable ? 'to rename' : 'NOT mapped'} ${JSON.stringify(counts)}`
    )

    if (!APPLY) continue

    await client.query('BEGIN')
    try {
      // Locks the row and re-checks, so a concurrent author edit is not overwritten.
      const { rows: [current] } = await client.query<{ content: string }>(
        'SELECT content FROM pages WHERE id = $1 FOR UPDATE', [page.id]
      )
      if (current.content !== page.content) throw new Error('page changed since it was read')

      const { rows: [{ version, author_id: authorId }] } = await client.query<{ version: number; author_id: string | null }>(
        `SELECT (SELECT COALESCE(max(version), 0) FROM page_versions WHERE "pageId" = $1) AS version,
                (SELECT "userId" FROM page_authors WHERE "pageId" = $1 ORDER BY "createdAt" LIMIT 1) AS author_id`,
        [page.id]
      )
      if (!authorId) throw new Error('page has no author for the version row')

      await client.query('UPDATE pages SET content = $1, "updatedAt" = now() WHERE id = $2', [content, page.id])
      await client.query(
        `INSERT INTO page_versions (id, content, version, "changeLog", "authorId", "pageId")
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [randomUUID(), content, version + 1, CHANGE_LOG, authorId, page.id]
      )
      if (mappable) {
        for (const { table, column, pageColumn } of TARGETS) {
          await client.query(
            `UPDATE ${table} SET ${column} = $1 WHERE ${column} = $2 AND ${pageColumn} = $3`,
            [`quiz-${ids[0]}`, SHARED_ID, page.id]
          )
        }
      }
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      console.error(`  skipped: ${(error as Error).message}`)
    }
  }

  console.log(APPLY ? '\nApplied.' : '\nDry run. Pass --apply to write.')
  console.log(totals)
  await client.end()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
