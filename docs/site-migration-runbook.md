# Site Refactor — Production Migration Runbook

## What this migration does

Consolidates every public-page property onto a single `Site` model
(replacing scattered fields on `User`, `Organization`, `Collection`,
`PageLayout`, `OrgPageLayout`, and `FrontPage`). Site is the unified
polymorphic owner of public pages; one Site row per teacher account, one
per organization.

The refactor ships as **nine database migrations + four backfill scripts**
that must be interleaved. Running `prisma migrate deploy` alone will fail
or destroy data — the backfills populate columns that subsequent
migrations require to be NOT NULL.

## Before you start

1. **Snapshot the production database.** Use the hosting platform's
   point-in-time backup (Koyeb managed Postgres). This migration drops
   columns and tables — rollback means restoring from snapshot.
2. **Take a maintenance window.** Estimate: <5 minutes for a DB the size
   of `eduskript_dev`. Scale linearly with row count if larger.
3. **Run preflight from your laptop against prod DATABASE_URL:**
   ```
   DATABASE_URL=<prod-url> node scripts/preflight-site-migration.mjs
   ```
   Exit code 0 means safe to proceed. Any blocker (slug collision, orphan
   collection) must be resolved in prod data before continuing.

## Sequence

Each step is one of:
- **Migration** — apply via `psql $DATABASE_URL -f <file>` then mark with
  `pnpm prisma migrate resolve --applied <name>` so the migration ledger
  stays in sync.
- **Backfill** — `node scripts/<name>.mjs`. All backfills are idempotent
  (safe to re-run if the connection drops).

Set `DATABASE_URL` to the prod connection string for every step.

### Phase 1 — Add Site model
```
psql $DATABASE_URL -f prisma/migrations/20260513160000_add_site_model/migration.sql
pnpm prisma migrate resolve --applied 20260513160000_add_site_model
node scripts/backfill-sites.mjs
```
After this: every teacher with a `pageSlug` and every organization has a
Site row. Aborts if `User.pageSlug` collides with `Organization.slug`.

### Phase 2 — Collections move to Site
```
psql $DATABASE_URL -f prisma/migrations/20260513160253_add_collection_site_id/migration.sql
pnpm prisma migrate resolve --applied 20260513160253_add_collection_site_id
node scripts/backfill-collection-sites.mjs
psql $DATABASE_URL -f prisma/migrations/20260513174028_slim_collection_to_site/migration.sql
pnpm prisma migrate resolve --applied 20260513174028_slim_collection_to_site
```
After this: every `Collection` has `site_id` pointing to its owning Site
(inferred from `CollectionAuthor`). `CollectionAuthor` is dropped — site
ownership replaces it.

### Phase 3 — PageLayout merge
```
psql $DATABASE_URL -f prisma/migrations/20260513175527_add_page_layout_site_id/migration.sql
pnpm prisma migrate resolve --applied 20260513175527_add_page_layout_site_id
node scripts/backfill-page-layouts.mjs
psql $DATABASE_URL -f prisma/migrations/20260513181901_merge_page_layouts_into_site/migration.sql
pnpm prisma migrate resolve --applied 20260513181901_merge_page_layouts_into_site
```
After this: `PageLayout.site_id` populated for user layouts, and
`OrgPageLayout` rows have been merged into `PageLayout` rows keyed by the
org's Site. `OrgPageLayout` + `OrgPageLayoutItem` tables dropped.

### Phase 4 — FrontPage collapses to siteId
```
psql $DATABASE_URL -f prisma/migrations/20260513190640_add_front_page_site_id/migration.sql
pnpm prisma migrate resolve --applied 20260513190640_add_front_page_site_id
node scripts/backfill-front-pages.mjs
psql $DATABASE_URL -f prisma/migrations/20260513191351_drop_front_page_user_org_branch/migration.sql
pnpm prisma migrate resolve --applied 20260513191351_drop_front_page_user_org_branch
```
After this: `FrontPage` uses `site_id` for site-level frontpages (skript
frontpages keep `skriptId`). The old `user_id` and `organization_id`
columns are gone.

### Phase 5 — Drop the duplicated identity columns
```
# Re-run preflight first; it'll confirm zero drift between User.pageSlug
# / Organization.slug and Site.slug.
DATABASE_URL=<prod> node scripts/preflight-site-migration.mjs

psql $DATABASE_URL -f prisma/migrations/20260513205851_drop_user_pageslug_org_slug/migration.sql
pnpm prisma migrate resolve --applied 20260513205851_drop_user_pageslug_org_slug
```
After this: `User.pageSlug` and `Organization.slug` are gone. Site is the
sole owner of the URL slug.

### Phase 6 — Drop the duplicated display fields
```
psql $DATABASE_URL -f prisma/migrations/20260513212310_drop_user_org_display_fields/migration.sql
pnpm prisma migrate resolve --applied 20260513212310_drop_user_org_display_fields
```
After this: `pageName`, `pageDescription`, `pageIcon`, `pageLanguage`,
`pageTagline`, `sidebarBehavior`, `typographyPreference`, and
`aiSystemPrompt` are gone from `User`. `description`, `showIcon`,
`iconUrl`, `pageLanguage`, `pageTagline`, `sidebarBehavior`, and
`aiSystemPrompt` are gone from `Organization`. Site owns them all now.

## Verification

After the last migration:

1. `DATABASE_URL=<prod> node scripts/preflight-site-migration.mjs` —
   should exit 0 with all source columns reported as missing (post-state).
2. Smoke-test the app:
   - Sign in as a teacher; verify the dashboard loads and shows the
     teacher's page name + description.
   - Open the teacher's public page; verify sidebar, frontpage, and a
     skript page render.
   - Open `/org/eduskript` (or another org page); verify it renders.
3. Watch the application logs for `Prisma` errors for the first 10
   minutes — any reference to a dropped column would surface here.

## Rollback

If anything fails irrecoverably mid-sequence: restore from the snapshot
taken in "Before you start" and redeploy the previous app version. The
schema and code must move together — there is no in-between safe point.

Partial-failure tolerance:
- A backfill script crashing partway is safe to re-run. They check for
  existing rows and skip.
- A migration crashing partway leaves the DB in the state described by
  the SQL up to the failure point. Either fix forward (run the rest of
  the SQL manually) or restore.

## Why not just `prisma migrate deploy`?

`migrate deploy` applies every pending migration in order with no hook
for inserting backfill calls. Three of the migrations in this sequence
make a previously-nullable column required, drop a join table, or relax
a uniqueness constraint — all of which require the backfill rows to
already exist. Running them against an un-backfilled prod will throw
`NOT NULL constraint violated` and stop, leaving the schema partly
applied.
