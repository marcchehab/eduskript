/**
 * One-off, idempotent "neutral port" of stored annotation section ids.
 *
 * Rewrites every stroke / snap / sticky-note `sectionId` that is a legacy id
 * (before 2026-11-19, see src/lib/rehype-plugins/heading-section-ids.ts) to the
 * current id of the SAME element, taken from the `data-legacy-section-ids` map
 * that the real compile (compileMarkdown) produces for the page's current
 * content. Points and sectionOffsetY are not touched, so no stroke moves.
 * Already-current ids, orphans (legacy ids not in the map), `unknown`, and
 * `spacer-*` ids stay as they are. Spacers (`afterBlockIndex`) are not touched.
 * Logic: src/lib/annotations/port-legacy-section-ids.ts.
 *
 * Covers user_data rows of adapters annotations / snaps / sticky-notes for all
 * target types (personal, class, student, page broadcast), on pages
 * (pages.content) and front pages (front_pages.content). Rows whose item_id
 * matches neither (deleted pages) are skipped and counted.
 *
 * Changed rows get version = version + 1, updated_at = now(); the UPDATE is
 * guarded by the version read, so a row written concurrently is skipped
 * (reported) rather than overwritten. Re-running changes nothing.
 *
 *   npx tsx scripts/port-legacy-section-ids.ts [--dry-run] [--apply] [--db <url>] [--page <id>] [--user <email|id>] [--verbose]
 *
 * --db defaults to $DATABASE_URL. Refuses any host but localhost / 127.0.0.1.
 * Not meant for production as-is: there, run it against a restored copy first,
 * and note that clients holding an unsynced local copy (IndexedDB) may later
 * push legacy ids again; those still resolve through the legacy map.
 */
import pg from 'pg'
import {
  legacySectionIdMap,
  portUserData,
  PORTED_ADAPTERS,
  type ItemStatus,
} from '../src/lib/annotations/port-legacy-section-ids'

const args = process.argv.slice(2)
const flag = (name: string) => args.includes(name)
const opt = (name: string) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const apply = flag('--apply')
const verbose = flag('--verbose')
const pageFilter = opt('--page')
// One user's rows only (email or user id), e.g. to try the port on yourself first.
const userArg = opt('--user')
const dbUrl = opt('--db') ?? process.env.DATABASE_URL
if (!dbUrl) {
  console.error('No --db and no DATABASE_URL')
  process.exit(2)
}
const host = new URL(dbUrl).hostname
if (host !== 'localhost' && host !== '127.0.0.1') {
  console.error(`Refusing host "${host}": only localhost / 127.0.0.1`)
  process.exit(2)
}

type Kind = 'stroke' | 'snap' | 'note'
const KIND: Record<string, Kind> = { annotations: 'stroke', snaps: 'snap', 'sticky-notes': 'note' }

async function main() {
  const client = new pg.Client({ connectionString: dbUrl })
  await client.connect()
  console.log(`${apply ? 'APPLY' : 'DRY RUN'} on ${host}:${new URL(dbUrl!).port}${new URL(dbUrl!).pathname}${pageFilter ? ` page=${pageFilter}` : ''}`)

  let userId: string | undefined
  if (userArg) {
    const u = await client.query<{ id: string; email: string | null }>(
      'SELECT id, email FROM users WHERE id = $1 OR lower(email) = lower($1)',
      [userArg],
    )
    if (u.rows.length !== 1) {
      console.error(`--user "${userArg}" matched ${u.rows.length} users`)
      process.exit(2)
    }
    userId = u.rows[0].id
    console.log(`user=${u.rows[0].email ?? ''} (${userId})`)
  }

  const params: unknown[] = [PORTED_ADAPTERS]
  let filter = ''
  if (pageFilter) { params.push(pageFilter); filter += ` AND item_id = $${params.length}` }
  if (userId) { params.push(userId); filter += ` AND user_id = $${params.length}` }
  const { rows } = await client.query<{
    id: string; adapter: string; item_id: string; data: unknown; version: number; target_type: string | null
  }>(
    `SELECT id, adapter, item_id, data, version, target_type FROM user_data
     WHERE adapter = ANY($1) AND data::text LIKE '%sectionId%'${filter}
     ORDER BY item_id, id`,
    params,
  )

  const byItem = new Map<string, typeof rows>()
  for (const r of rows) {
    const list = byItem.get(r.item_id)
    if (list) list.push(r)
    else byItem.set(r.item_id, [r])
  }

  const total = { rows: 0, rowsChanged: 0, conflicts: 0, skippedNoContent: 0, errors: 0 }
  const byKind: Record<Kind, Record<ItemStatus, number>> = {
    stroke: { rewritten: 0, current: 0, orphan: 0, spacer: 0, unanchored: 0 },
    snap: { rewritten: 0, current: 0, orphan: 0, spacer: 0, unanchored: 0 },
    note: { rewritten: 0, current: 0, orphan: 0, spacer: 0, unanchored: 0 },
  }
  const perPage: Array<{ item: string; source: string; rows: number; changed: number; rewritten: number; orphans: number; unanchored: number }> = []

  for (const [itemId, itemRows] of byItem) {
    total.rows += itemRows.length
    const src = await client.query<{ content: string; skript_id: string | null; source: string }>(
      `SELECT content, "skriptId" AS skript_id, 'page' AS source FROM pages WHERE id = $1
       UNION ALL
       SELECT content, coalesce(file_skript_id, skript_id), 'front' FROM front_pages WHERE id = $1`,
      [itemId],
    )
    if (src.rows.length === 0) {
      total.skippedNoContent += itemRows.length
      console.log(`  ${itemId}: no page/front page, ${itemRows.length} rows skipped`)
      continue
    }
    const { content, skript_id, source } = src.rows[0]
    const fileNames = skript_id
      ? (await client.query<{ name: string }>(
          `SELECT name FROM files WHERE skript_id = $1 AND is_directory = false
           UNION ALL SELECT v.filename FROM videos v JOIN "_SkriptVideos" sv ON sv."B" = v.id WHERE sv."A" = $1`,
          [skript_id],
        )).rows.map(r => r.name)
      : []
    const map = await legacySectionIdMap(content, { fileNames })

    const page = { item: itemId, source, rows: itemRows.length, changed: 0, rewritten: 0, orphans: 0, unanchored: 0 }
    const orphanIds = new Set<string>()
    for (const row of itemRows) {
      const res = portUserData(row.adapter, row.data, map)
      if (res.error) {
        total.errors++
        console.log(`  ${itemId} row ${row.id}: ${res.error} (left as is)`)
      }
      const kind = KIND[row.adapter]
      for (const k of Object.keys(res.counts) as ItemStatus[]) byKind[kind][k] += res.counts[k]
      page.rewritten += res.counts.rewritten
      page.orphans += res.counts.orphan
      page.unanchored += res.counts.unanchored
      res.orphanIds.forEach(id => orphanIds.add(id))
      if (!res.changed) continue
      page.changed++
      total.rowsChanged++
      if (apply) {
        const upd = await client.query(
          `UPDATE user_data SET data = $1::jsonb, version = version + 1, updated_at = now()
           WHERE id = $2 AND version = $3`,
          [JSON.stringify(res.data), row.id, row.version],
        )
        if (upd.rowCount !== 1) {
          total.conflicts++
          console.log(`  ${itemId} row ${row.id}: version changed since read, skipped`)
        }
      }
    }
    perPage.push(page)
    if (verbose && orphanIds.size) console.log(`  ${itemId} orphan ids: ${[...orphanIds].join(', ')}`)
  }

  perPage.sort((a, b) => b.rewritten - a.rewritten)
  console.log('\nitem_id                     source rows changed rewritten orphans unanchored')
  for (const p of perPage) {
    console.log(`${p.item.padEnd(27)} ${p.source.padEnd(6)} ${String(p.rows).padStart(4)} ${String(p.changed).padStart(7)} ${String(p.rewritten).padStart(9)} ${String(p.orphans).padStart(7)} ${String(p.unanchored).padStart(10)}`)
  }
  console.log('\nby kind:', JSON.stringify(byKind))
  console.log('totals:', JSON.stringify({ pages: byItem.size, ...total }))
  if (!apply && total.rowsChanged > 0) console.log('dry run: nothing written (use --apply)')
  await client.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
