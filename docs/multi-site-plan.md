# Multi-site support — implementation plan

Let one **User** own multiple **Sites**. Today it's 1:1 (`Site.userId @unique`, `User.site` singular).

## Status (2026-07-18)

**All phases done & validated** (type-check + lint + 997 tests + prod build all green): the schema change + migration `20260718073728_multi_site_support`, the ~60-file query migration, session token, MCP (Phases 1/2/5/6); and the dashboard (Phase 3, **site-scoped URLs** chosen) + superadmin provisioning (Phase 4). New routes: `/dashboard/site/[siteId]/{page-builder,frontpage}`, `/api/sites/[siteId]/{page-layout,frontpage}`, `/api/user/sites`, `/api/admin/users/[id]/sites`. Sidebar stacks: sites → orgs → account → admin. **Deferred (fast-follow):** per-site Settings and Plugins still operate at the user/primary level.

## Locked decisions

- **Provisioning:** superadmin-only. Extra sites are a special deal, granted via the admin UI. No self-serve site creation for teachers — they never make/delete sites themselves. A teacher typically has 1 site; the multi-site case is the exception.
- **Billing:** per-user. One subscription (`User.billingPlan`) covers all of a user's sites. No per-site entitlement, no `maxSites` enforcement (superadmin gates count manually). No change to `src/lib/billing.ts`.
- **Classes:** teacher-global. `Class.teacherId → User`, spans all the teacher's sites. No schema change.
- **Collaboration:** unchanged. Already content-scoped (`SkriptAuthor`/`PageAuthor` keyed on `userId`); a skript isn't pinned to one site. The `listSkriptsForUser` OR-clause (`collection: { site: { userId } }`) already matches *all* of a user's sites — works as-is.

## Why this is mostly mechanical

The public rendering path is already site-centric: routing resolves a site by its own globally-unique `Site.slug` (`src/proxy.ts` → `resolve-domain` → `getTeacherByPageSlug`), and content tables (`Collection`, `PageLayout`, `FrontPage`) already hang off `siteId`, not `userId`. Permissions (`canEditSite`) already take a site object. The coupling that must change is: (1) the DB unique constraint, (2) queries that look a site up *by userId*, (3) the session token's single embedded `pageSlug`, (4) the dashboard, which has no site dimension at all.

## Data model

- `prisma/schema.prisma:216` — drop `@unique` on `Site.userId`, keep it indexed (`@@index([userId])`).
- `prisma/schema.prisma:118` — `User.site Site?` → `User.sites Site[]`.
- Add `Site.order Int @default(0)` for stable sidebar stacking.
- Add `User.defaultSiteId String?` (or treat lowest-`order` site as primary) — needed for post-login redirect and legacy single-slug fallbacks.
- Migration via `prisma migrate dev --name multi_site` (ask user to run — non-interactive is blocked). Backfill: existing rows already satisfy the relaxed constraint; set `order = 0`, `defaultSiteId` = the user's one site.

## Phases

### 1. Schema + query layer (~1–2 days)
Relax the constraint, then fix every query that assumes uniqueness. Prisma **won't compile** `findUnique`/`upsert` on the now-non-unique `userId`, so these are hard breaks, not silent:
- Introduce `getSitesForUser(userId)` and `getSiteById(siteId, userId)` (ownership-checked) helpers.
- Rewrite ~15–20 call sites from `site.findUnique/upsert({ where: { userId } })` to explicit `siteId`. Notably: `api/user/profile` (upsert-by-userId), `api/collections`, `api/skripts/[id]`, `api/skripts/move`, `api/frontpage/user`, and the per-setting routes (`ai-prompt`, `typography-preference`, `sidebar-preference`).

### 2. Session / JWT (~0.5 day)
- `src/lib/auth.ts:299–354, 490–546` — stop grafting a single site's `pageSlug`/page-display fields onto the token. Keep only a `defaultSiteSlug` for the login redirect.
- `src/types/next-auth.d.ts` — drop the scalar `pageSlug/pageName/pageDescription/pageIcon`; the dashboard fetches per-site instead.
- Fix `cross-domain` + `cross-domain-callback` token grafts (`api/auth/cross-domain*`) to use the target site, not "the" site.

### 3. Dashboard sidebar + routing (the bulk, ~2–3 days)
- Add a site dimension to dashboard routes — e.g. `/dashboard/site/[siteId]/page-builder`, `.../frontpage`, `.../plugins`. Active site = route param (no top-nav dropdown).
- **Sidebar stacking order** (per the design): each **Site** as its own block (page builder, plugins, frontpage, settings), then **Orgs**, then **user-admin**, then **superadmin**. A 1-site teacher sees one site block — visually unchanged from today.
- Thread `siteId` through `PageBuilderInterface`, frontpage editor, and the per-setting pages (all currently bind implicitly to "the user's site").

### 4. Superadmin site provisioning (~0.5 day)
- In the existing admin users UI (`api/admin/users/*`), add "grant additional site" — create a `Site` with a new global slug + `userId`. Remove the implicit one-site assumption in admin upserts.
- Signup (`api/auth/register`) still creates exactly one site for a new teacher — no change needed there.

### 5. Per-site settings resolution (~0.5 day)
- `aiSystemPrompt`, `typographyPreference`, `sidebarBehavior` already live on `Site`. AI routes (`api/ai/chat`, `ai/edit*`) currently read `user.site.aiSystemPrompt` (the single site). Resolve from the **site in context** instead — the active dashboard site, or for public rendering the site being viewed.
- **Known ambiguity:** a skript can appear on multiple sites, so "which site's `aiSystemPrompt`" has no unique answer for a shared skript. Resolve by the site in the current request context (active/rendered site), not by the skript.

### 6. Singular-site readers cleanup (~0.5 day)
Iterate sites instead of reading `.site` singular:
- `src/lib/tenant.ts:54–70` (custom-domain→lang), `src/app/sitemap.ts:41,57–73`, `src/app/[domain]/page.tsx:104–118` (frontpage lookup joins by `userId` — scope to the resolved site).

## Effort

~1 week total. Schema + queries (1–2d) and the dashboard sidebar/routing (2–3d) are the real cost; the rest is cleanup. No new billing, classes, or collaboration work — those stay as-is.

## Not doing (YAGNI)

- Self-serve site creation/deletion UI for teachers.
- Per-site billing or `maxSites` enforcement.
- Per-site classes.
- A top-nav site switcher (sidebar stacking replaces it).
