#!/usr/bin/env node
/**
 * Backfill front_pages.site_id for site-level frontpages (user / org).
 *
 * Skript frontpages (rows with skript_id set) are untouched — they
 * continue to attach directly to a Skript.
 *
 * Idempotent: skips rows where site_id is already set. Aborts and lists
 * any user/org-owned FrontPage whose owner has no Site.
 *
 * Usage:
 *   node scripts/backfill-front-pages.mjs          # apply
 *   node scripts/backfill-front-pages.mjs --dry-run # report only
 */

import pg from 'pg'
import { config } from 'dotenv'

config({ path: '.env.local' })
config()

const DRY_RUN = process.argv.includes('--dry-run')

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error('DATABASE_URL not set')
  process.exit(1)
}

const client = new pg.Client({ connectionString })

async function main() {
  await client.connect()
  if (DRY_RUN) console.log('[dry-run] No rows will be written.\n')

  // 1. User-owned FrontPages → site_id from user's Site.
  const userOwned = await client.query(`
    SELECT fp.id AS front_page_id, fp.user_id, s.id AS site_id
    FROM front_pages fp
    JOIN sites s ON s.user_id = fp.user_id
    WHERE fp.site_id IS NULL AND fp.user_id IS NOT NULL
  `)
  console.log(`User FrontPages to link: ${userOwned.rows.length}`)
  if (!DRY_RUN) {
    for (const row of userOwned.rows) {
      await client.query(
        `UPDATE front_pages SET site_id = $1 WHERE id = $2`,
        [row.site_id, row.front_page_id],
      )
    }
  }

  // 2. Org-owned FrontPages → site_id from org's Site.
  const orgOwned = await client.query(`
    SELECT fp.id AS front_page_id, fp.organization_id, s.id AS site_id
    FROM front_pages fp
    JOIN sites s ON s.organization_id = fp.organization_id
    WHERE fp.site_id IS NULL AND fp.organization_id IS NOT NULL
  `)
  console.log(`Organization FrontPages to link: ${orgOwned.rows.length}`)
  if (!DRY_RUN) {
    for (const row of orgOwned.rows) {
      await client.query(
        `UPDATE front_pages SET site_id = $1 WHERE id = $2`,
        [row.site_id, row.front_page_id],
      )
    }
  }

  // Surface orphans: user/org-owned FrontPages whose owner has no Site.
  const orphans = await client.query(`
    SELECT fp.id, fp.user_id, fp.organization_id
    FROM front_pages fp
    LEFT JOIN sites su ON su.user_id = fp.user_id
    LEFT JOIN sites so ON so.organization_id = fp.organization_id
    WHERE fp.site_id IS NULL
      AND fp.skript_id IS NULL
      AND (fp.user_id IS NOT NULL OR fp.organization_id IS NOT NULL)
      AND su.id IS NULL AND so.id IS NULL
  `)
  if (orphans.rows.length > 0) {
    console.error(`\n${orphans.rows.length} site-level FrontPages have no matching Site:`)
    orphans.rows.forEach(r =>
      console.error(`  - front_page ${r.id} (user=${r.user_id ?? 'null'}, org=${r.organization_id ?? 'null'})`)
    )
    if (!DRY_RUN) process.exit(1)
  }

  console.log(DRY_RUN ? '\nDry-run complete.' : '\nDone.')
  await client.end()
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
