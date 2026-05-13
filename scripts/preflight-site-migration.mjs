#!/usr/bin/env node
/**
 * Preflight audit for the Site refactor production migration.
 *
 * Read-only. Run this against the production database BEFORE starting the
 * migration sequence. Exits 0 if it's safe to proceed, 1 (with a list of
 * blocking issues) otherwise.
 *
 * What it checks:
 *   1. Slug collisions: User.pageSlug values that collide with
 *      Organization.slug. Site.slug is globally unique post-migration, so
 *      either side has to be renamed before backfill-sites.mjs runs.
 *   2. Teacher accounts without a pageSlug — they'll be skipped by the
 *      backfill, which is fine (they get prompted to claim a slug from the
 *      dashboard), but it's worth surfacing the count.
 *   3. Orphan Collections: rows with no SkriptAuthor or CollectionAuthor
 *      that could indicate the owner inference in backfill-collection-sites
 *      will skip them.
 *   4. Counts: how many Site rows will be created, so the operator has a
 *      sanity number to compare against post-backfill.
 *
 * Usage: node scripts/preflight-site-migration.mjs
 *
 * The script tolerates either pre-migration schema (User.pageSlug +
 * Organization.slug present) or post-Stage-1 (Site table exists too) — so
 * it can be re-run mid-sequence to verify progress.
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

async function tableHasColumn(table, column) {
  const r = await client.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
    [table, column],
  )
  return r.rowCount > 0
}

async function tableExists(table) {
  const r = await client.query(
    `SELECT 1 FROM information_schema.tables WHERE table_name = $1`,
    [table],
  )
  return r.rowCount > 0
}

const blockers = []
const notes = []

async function main() {
  await client.connect()

  const hasUserPageSlug = await tableHasColumn('users', 'pageSlug')
  const hasOrgSlug = await tableHasColumn('organizations', 'slug')
  const hasSites = await tableExists('sites')

  console.log('Schema state:')
  console.log(`  User.pageSlug column present:      ${hasUserPageSlug}`)
  console.log(`  Organization.slug column present:  ${hasOrgSlug}`)
  console.log(`  sites table present:               ${hasSites}`)
  console.log('')

  // 1. Slug collisions between users and orgs. Only meaningful when both
  // source columns still exist.
  if (hasUserPageSlug && hasOrgSlug) {
    const collisions = await client.query(`
      SELECT u."pageSlug" AS slug,
             u.id AS user_id,
             u.email AS user_email,
             o.id AS org_id,
             o.name AS org_name
      FROM users u
      JOIN organizations o ON o.slug = u."pageSlug"
      WHERE u."pageSlug" IS NOT NULL
    `)
    if (collisions.rowCount > 0) {
      blockers.push({
        kind: 'slug-collision',
        message: `${collisions.rowCount} user pageSlug(s) collide with an organization slug. Rename one side before backfill.`,
        rows: collisions.rows,
      })
    } else {
      notes.push('No user/org slug collisions.')
    }
  } else {
    notes.push('Slug collision check skipped (source columns already dropped).')
  }

  // 2. Teacher users with no pageSlug — these get no Site row.
  if (hasUserPageSlug) {
    const teachersNoSlug = await client.query(`
      SELECT COUNT(*)::int AS count
      FROM users
      WHERE "accountType" = 'teacher' AND "pageSlug" IS NULL
    `)
    notes.push(`${teachersNoSlug.rows[0].count} teacher account(s) have no pageSlug (will not get a Site row).`)
  }

  // 3. Expected Site-row counts.
  if (hasUserPageSlug) {
    const userSites = await client.query(`
      SELECT COUNT(*)::int AS count
      FROM users
      WHERE "pageSlug" IS NOT NULL AND "accountType" = 'teacher'
    `)
    notes.push(`backfill-sites will create up to ${userSites.rows[0].count} user-Site row(s).`)
  }
  if (hasOrgSlug) {
    const orgSites = await client.query(`SELECT COUNT(*)::int AS count FROM organizations`)
    notes.push(`backfill-sites will create up to ${orgSites.rows[0].count} org-Site row(s).`)
  }
  if (hasSites) {
    const existingSites = await client.query(`SELECT COUNT(*)::int AS count FROM sites`)
    notes.push(`${existingSites.rows[0].count} Site row(s) currently exist (backfill scripts are idempotent).`)
  }

  // 4. Orphan collections: any collection without an owning user or org
  // reference that the collection backfill can latch onto.
  if (await tableExists('collections')) {
    const collectionAuthorTable = await tableExists('collection_authors')
    if (collectionAuthorTable) {
      // Pre-Stage-2 state: collections own themselves via CollectionAuthor.
      // collection_authors is a legacy table without @map, so the FK column
      // is camelCase ("collectionId") rather than snake_case. Quote so it
      // parses against both casings if a fresh @map is ever added.
      const orphans = await client.query(`
        SELECT c.id, c.title
        FROM collections c
        WHERE NOT EXISTS (
          SELECT 1 FROM collection_authors ca WHERE ca."collectionId" = c.id
        )
      `)
      if (orphans.rowCount > 0) {
        blockers.push({
          kind: 'orphan-collections',
          message: `${orphans.rowCount} collection(s) have no CollectionAuthor — the collection-site backfill cannot infer an owner. Delete or assign before running.`,
          rows: orphans.rows.slice(0, 20),
        })
      } else {
        notes.push('No orphan collections.')
      }
    } else {
      // Post-Stage-2 state: collection_site_id should be populated.
      const nullSite = await client.query(
        `SELECT COUNT(*)::int AS count FROM collections WHERE site_id IS NULL`,
      ).catch(() => ({ rows: [{ count: 'n/a (column missing)' }] }))
      notes.push(`Collections with NULL site_id: ${nullSite.rows[0].count}`)
    }
  }

  // 5. Drift check (only meaningful with both columns + Site present):
  // Stage 5a/5b drop User/Org columns assuming Site has identical values.
  // Any drift means the drop will lose data.
  if (hasSites && hasUserPageSlug) {
    const drift = await client.query(`
      SELECT COUNT(*)::int AS count FROM users u
      JOIN sites s ON s.user_id = u.id
      WHERE u."pageSlug" IS NOT NULL AND u."pageSlug" IS DISTINCT FROM s.slug
    `)
    if (drift.rows[0].count > 0) {
      blockers.push({
        kind: 'user-slug-drift',
        message: `${drift.rows[0].count} user(s) have a pageSlug that no longer matches Site.slug — re-run backfill or investigate.`,
      })
    } else {
      notes.push('User.pageSlug ↔ Site.slug fully synced.')
    }
  }
  if (hasSites && hasOrgSlug) {
    const drift = await client.query(`
      SELECT COUNT(*)::int AS count FROM organizations o
      JOIN sites s ON s.organization_id = o.id
      WHERE o.slug IS DISTINCT FROM s.slug
    `)
    if (drift.rows[0].count > 0) {
      blockers.push({
        kind: 'org-slug-drift',
        message: `${drift.rows[0].count} organization(s) have a slug that no longer matches Site.slug — re-run backfill or investigate.`,
      })
    } else {
      notes.push('Organization.slug ↔ Site.slug fully synced.')
    }
  }

  // Report.
  console.log('Notes:')
  for (const n of notes) console.log(`  - ${n}`)
  console.log('')

  if (blockers.length === 0) {
    console.log('✓ Preflight OK — safe to proceed with the migration sequence.')
    await client.end()
    process.exit(0)
  }

  console.error('✗ Preflight found blocking issues:')
  for (const b of blockers) {
    console.error(`  [${b.kind}] ${b.message}`)
    if (b.rows) {
      for (const row of b.rows) {
        console.error(`    - ${JSON.stringify(row)}`)
      }
    }
  }
  await client.end()
  process.exit(1)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
