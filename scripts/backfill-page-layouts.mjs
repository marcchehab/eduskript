#!/usr/bin/env node
/**
 * Backfill page_layouts.site_id, merging OrgPageLayout rows into the same
 * table. After this script runs, every PageLayout has site_id set and every
 * OrgPageLayout has been mirrored into page_layouts (keyed by the org's site)
 * with its items copied across.
 *
 * Idempotent: skips rows where site_id is already set, and skips org layouts
 * whose mirror PageLayout already exists.
 *
 * Usage:
 *   node scripts/backfill-page-layouts.mjs          # apply
 *   node scripts/backfill-page-layouts.mjs --dry-run # report only, no writes
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

function cuid() {
  return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
}

async function main() {
  await client.connect()
  if (DRY_RUN) console.log('[dry-run] No rows will be written.\n')

  // 1. Fill site_id on existing user-owned PageLayouts.
  const userLayouts = await client.query(`
    SELECT pl.id AS layout_id, pl.user_id, s.id AS site_id
    FROM page_layouts pl
    JOIN sites s ON s.user_id = pl.user_id
    WHERE pl.site_id IS NULL AND pl.user_id IS NOT NULL
  `)
  console.log(`User PageLayouts to link: ${userLayouts.rows.length}`)
  if (!DRY_RUN) {
    for (const row of userLayouts.rows) {
      await client.query(
        `UPDATE page_layouts SET site_id = $1 WHERE id = $2`,
        [row.site_id, row.layout_id],
      )
    }
  }

  // Detect user PageLayouts whose owning user has no Site — refuse silently,
  // surface them so the operator can decide.
  const orphanUserLayouts = await client.query(`
    SELECT pl.id, pl.user_id
    FROM page_layouts pl
    LEFT JOIN sites s ON s.user_id = pl.user_id
    WHERE pl.site_id IS NULL AND pl.user_id IS NOT NULL AND s.id IS NULL
  `)
  if (orphanUserLayouts.rows.length > 0) {
    console.error(`\n${orphanUserLayouts.rows.length} PageLayouts belong to users without a Site:`)
    orphanUserLayouts.rows.forEach(r => console.error(`  - layout ${r.id} (user ${r.user_id})`))
    if (!DRY_RUN) process.exit(1)
  }

  // 2. Mirror every OrgPageLayout into page_layouts keyed by the org's site.
  const orgLayouts = await client.query(`
    SELECT opl.id AS org_layout_id, opl.organization_id, s.id AS site_id
    FROM org_page_layouts opl
    JOIN sites s ON s.organization_id = opl.organization_id
    WHERE NOT EXISTS (
      SELECT 1 FROM page_layouts pl WHERE pl.site_id = s.id
    )
  `)
  console.log(`OrgPageLayouts to mirror: ${orgLayouts.rows.length}`)

  for (const row of orgLayouts.rows) {
    const items = await client.query(
      `SELECT type, content_id, "order" FROM org_page_layout_items WHERE org_page_layout_id = $1 ORDER BY "order"`,
      [row.org_layout_id],
    )
    console.log(`  - org_layout ${row.org_layout_id} → site ${row.site_id} (${items.rows.length} items)`)
    if (DRY_RUN) continue

    const newLayoutId = cuid()
    await client.query(
      `INSERT INTO page_layouts (id, site_id, created_at, updated_at)
       VALUES ($1, $2, NOW(), NOW())`,
      [newLayoutId, row.site_id],
    )
    for (const item of items.rows) {
      await client.query(
        `INSERT INTO page_layout_items (id, page_layout_id, type, content_id, "order", created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [cuid(), newLayoutId, item.type, item.content_id, item.order],
      )
    }
  }

  // Surface org layouts whose org has no Site — same shape as above.
  const orphanOrgLayouts = await client.query(`
    SELECT opl.id, opl.organization_id
    FROM org_page_layouts opl
    LEFT JOIN sites s ON s.organization_id = opl.organization_id
    WHERE s.id IS NULL
  `)
  if (orphanOrgLayouts.rows.length > 0) {
    console.error(`\n${orphanOrgLayouts.rows.length} OrgPageLayouts belong to organizations without a Site:`)
    orphanOrgLayouts.rows.forEach(r => console.error(`  - layout ${r.id} (org ${r.organization_id})`))
    if (!DRY_RUN) process.exit(1)
  }

  console.log(DRY_RUN ? '\nDry-run complete.' : '\nDone.')
  await client.end()
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
