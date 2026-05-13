#!/usr/bin/env node
/**
 * Backfill: create one Site per teacher (User with pageSlug) and per Organization.
 *
 * The Site model owns page-display fields (slug, pageName, pageDescription,
 * pageIcon, pageLanguage, sidebarBehavior, typographyPreference, showIcon,
 * pageTagline, aiSystemPrompt). For now those fields stay on User/Organization
 * too — Site mirrors them. This script copies the current values across.
 *
 * Skips users who already have a Site row, so it's idempotent.
 *
 * Collisions: User.pageSlug and Organization.slug live in separate uniqueness
 * scopes today, but Site.slug is globally unique. If any user slug equals an
 * org slug, this script aborts and lists the conflicts — they need manual
 * renaming before the migration can proceed.
 *
 * Usage: node scripts/backfill-sites.mjs
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

function cuid() {
  // Simple cuid-ish id good enough for backfill rows; real cuid generation
  // happens server-side, but we just need a stable unique string here.
  return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
}

async function main() {
  await client.connect()

  const slugConflicts = await client.query(`
    SELECT u."pageSlug" AS slug
    FROM users u
    JOIN organizations o ON o.slug = u."pageSlug"
    WHERE u."pageSlug" IS NOT NULL
  `)
  if (slugConflicts.rows.length > 0) {
    console.error('Slug collisions between users and organizations — rename one side before backfilling:')
    slugConflicts.rows.forEach(r => console.error('  -', r.slug))
    process.exit(1)
  }

  const userResult = await client.query(`
    SELECT id, "pageSlug", "pageName", "pageDescription", "pageIcon",
           page_language, page_tagline, "sidebarBehavior", "typographyPreference",
           "aiSystemPrompt"
    FROM users
    WHERE "pageSlug" IS NOT NULL
      AND "accountType" = 'teacher'
      AND NOT EXISTS (SELECT 1 FROM sites s WHERE s.user_id = users.id)
  `)

  console.log(`Creating Site rows for ${userResult.rows.length} teachers…`)
  for (const u of userResult.rows) {
    await client.query(
      `INSERT INTO sites (
         id, slug, user_id, page_name, page_description, page_icon,
         page_tagline, page_language, sidebar_behavior, typography_preference,
         show_icon, ai_system_prompt, created_at, updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())`,
      [
        cuid(),
        u.pageSlug,
        u.id,
        u.pageName,
        u.pageDescription,
        u.pageIcon,
        u.page_tagline,
        u.page_language,
        u.sidebarBehavior ?? 'full',
        u.typographyPreference ?? 'modern',
        true, // showIcon — users don't have this column today; default to true
        u.aiSystemPrompt,
      ],
    )
  }

  const orgResult = await client.query(`
    SELECT id, slug, name, description, icon_url, show_icon, page_tagline,
           page_language, sidebar_behavior, ai_system_prompt
    FROM organizations
    WHERE NOT EXISTS (SELECT 1 FROM sites s WHERE s.organization_id = organizations.id)
  `)

  console.log(`Creating Site rows for ${orgResult.rows.length} organizations…`)
  for (const o of orgResult.rows) {
    await client.query(
      `INSERT INTO sites (
         id, slug, organization_id, page_name, page_description, page_icon,
         page_tagline, page_language, sidebar_behavior, typography_preference,
         show_icon, ai_system_prompt, created_at, updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())`,
      [
        cuid(),
        o.slug,
        o.id,
        o.name, // org "page name" defaults to its display name
        o.description,
        o.icon_url,
        o.page_tagline,
        o.page_language,
        o.sidebar_behavior ?? 'contextual',
        'modern', // orgs don't have typographyPreference today
        o.show_icon ?? true,
        o.ai_system_prompt,
      ],
    )
  }

  console.log('Done.')
  await client.end()
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
