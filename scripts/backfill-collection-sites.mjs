#!/usr/bin/env node
/**
 * Backfill Collection.site_id.
 *
 * Rule: a collection that appears in any OrgPageLayoutItem belongs to that
 * organization's site (org-level page). Everything else belongs to the site
 * of its first CollectionAuthor with permission='author'.
 *
 * Idempotent: skips collections that already have site_id set. Aborts and
 * lists any collection that resolves to ambiguous ownership (e.g. shows up
 * in two different org pageLayouts, or no author at all) so they can be
 * triaged manually.
 *
 * Usage: node scripts/backfill-collection-sites.mjs
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

  // 1. Collections claimed by an org pageLayout — they become org-owned.
  const orgClaims = await client.query(`
    SELECT DISTINCT c.id AS collection_id, opl.organization_id
    FROM collections c
    JOIN org_page_layout_items opli ON opli.content_id = c.id AND opli.type = 'collection'
    JOIN org_page_layouts opl ON opl.id = opli.org_page_layout_id
    WHERE c.site_id IS NULL
  `)

  // Detect ambiguity: same collection listed in two different orgs.
  const byCollection = new Map()
  for (const row of orgClaims.rows) {
    const existing = byCollection.get(row.collection_id)
    if (existing && existing !== row.organization_id) {
      console.error(`Collection ${row.collection_id} is referenced by multiple orgs — triage manually`)
      process.exit(1)
    }
    byCollection.set(row.collection_id, row.organization_id)
  }

  let orgCount = 0
  for (const [collectionId, orgId] of byCollection) {
    const siteResult = await client.query(`SELECT id FROM sites WHERE organization_id = $1`, [orgId])
    if (siteResult.rows.length === 0) {
      console.error(`No Site for organization ${orgId}; run backfill-sites.mjs first`)
      process.exit(1)
    }
    await client.query(`UPDATE collections SET site_id = $1 WHERE id = $2`, [siteResult.rows[0].id, collectionId])
    orgCount += 1
  }
  console.log(`Attributed ${orgCount} collections to organization sites.`)

  // 2. Everything else → the first user author's site.
  const orphans = await client.query(`
    SELECT c.id AS collection_id,
           (
             SELECT "userId" FROM collection_authors
             WHERE "collectionId" = c.id AND permission = 'author'
             ORDER BY "createdAt" ASC
             LIMIT 1
           ) AS owner_user_id
    FROM collections c
    WHERE c.site_id IS NULL
  `)

  let userCount = 0
  const unowned = []
  for (const row of orphans.rows) {
    if (!row.owner_user_id) {
      unowned.push(row.collection_id)
      continue
    }
    const siteResult = await client.query(`SELECT id FROM sites WHERE user_id = $1`, [row.owner_user_id])
    if (siteResult.rows.length === 0) {
      console.error(`No Site for user ${row.owner_user_id} (collection ${row.collection_id}) — run backfill-sites.mjs first`)
      process.exit(1)
    }
    await client.query(`UPDATE collections SET site_id = $1 WHERE id = $2`, [siteResult.rows[0].id, row.collection_id])
    userCount += 1
  }
  console.log(`Attributed ${userCount} collections to user sites.`)

  if (unowned.length > 0) {
    console.error(`\n${unowned.length} collections have no author at all — triage manually:`)
    unowned.forEach(id => console.error('  -', id))
    process.exit(1)
  }

  await client.end()
  console.log('Done.')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
