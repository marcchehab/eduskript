# CLAUDE.md / AGENTS.md (symlinked)

Guidance for Claude Code in this repo.

## Style

Be concise. Stoic responses preferred. No verbose explanations.

## Comments

Be truthful in code comments. Document what the code *actually* does, not the ideal. Note known limitations, workarounds, complexity (O(n), O(n²)). Don't oversell — future contributors need the truth. Link related files.

## Commands

We use `pnpm`.

### Database
- `pnpm db:generate` — Generate Prisma client after schema changes
- `pnpm db:push` — Push schema changes (dev)
- `pnpm db:migrate` — Deploy migrations (prod)
- `pnpm db:studio` — Open Prisma Studio
- `pnpm db:reset` — Reset DB and re-migrate
- `pnpm db:local` / `pnpm db:local:stop` — Start/stop local PostgreSQL in Docker

**NEVER create migration files manually.** Always `prisma migrate dev --name <name>`. If non-interactive mode blocks it, ask the user to run it.

### Direct DB queries
```bash
psql postgresql://postgres:postgres@localhost:5432/eduskript_dev -c "SELECT id, email, \"pageSlug\" FROM users;"
node scripts/db-query.mjs "SELECT * FROM users LIMIT 5"
```

### Clear caches (if stale data after DB changes)
```bash
rm -rf .next && pnpm dev
```

### Dev & build
- `pnpm dev` — Dev server (Turbopack)
- `pnpm build` — Production build (includes Prisma generation)
- `pnpm start` — Production server
- `pnpm lint` / `pnpm type-check`
- `pnpm validate` — type-check + lint + tests (quick)
- `pnpm pre-push` — full validation incl. build

## Architecture

Multi-tenant education platform. Hierarchy: **User → Collection → Skript → Page**.

- **Collections** bundle skripts. **Skripts** are modules of pages. **Pages** hold markdown content.
- Path-based routing: `eduskript.org/[pageSlug]/[collectionSlug]/[skriptSlug]/[pageSlug]`. No subdomain routing.
- Dashboard at `/dashboard` (protected). API under `/api`.

**Stack:** Next.js 16 (App Router, ES2023, ESM) · PostgreSQL + Prisma 7 (pg adapter) · NextAuth (JWT) · TailwindCSS + Radix · CodeMirror 6 · unified/remark/rehype + KaTeX · Vitest 4 · Husky pre-push.

**Deployment:** Koyeb (managed PostgreSQL + Next.js). Scaleway S3 for user-uploaded snaps.

### Page vs profile fields
- **Page** (public): `pageSlug`, `pageName`, `pageDescription`
- **Profile** (collaborators): `name`, `bio`, `title`

### Account types
- `accountType: "teacher" | "student"`
- Students use OAuth identity, not email. `studentPseudonym` for privacy.

### Permissions (summary)
No-access-by-default. Junction tables (`CollectionAuthor`, `SkriptAuthor`, `PageAuthor`) with `permission: "author" | "viewer"`. Page-level overrides skript-level. Permission logic in `src/lib/permissions.ts`. Drag-to-move requires `author` on source + target. Details: `docs/internals/02-permissions.md`.

## Deep dives

When working in these areas, read the corresponding doc:

- `docs/internals/01-data-models.md` — schema overview, models beyond core
- `docs/internals/02-permissions.md` — permission inheritance, sharing flows
- `docs/internals/03-file-storage.md` — file system, dedup, public access
- `docs/internals/04-authentication.md` — NextAuth providers, JWT
- `docs/internals/05-realtime.md` — realtime features
- `docs/internals/06-markdown-pipeline.md` — remark/rehype plugin order, hydration, callouts
- `docs/internals/07-sql-runtime.md` — SQL.js, DB files, schema images
- `POSITIONING.md` — positioning and coordinate systems with zoom/pan
- `CLAUDE_ROADMAP.md` — current roadmap (keep up to date)

## Key files

- `prisma/schema.prisma` — schema
- `src/proxy.ts` — proxy (no subdomain routing)
- `src/lib/auth.ts`, `src/lib/permissions.ts`, `src/lib/prisma.ts`
- `src/app/layout.tsx`, `src/app/dashboard/`, `src/app/[domain]/`
- `src/components/dashboard/page-builder*.tsx` — drag-and-drop page builder
- `src/components/markdown/markdown-renderer.tsx` — primary markdown processor
- `src/lib/markdown.ts` — markdown *utilities* (slug, excerpt, validate), not a processor
- `src/types/index.ts`

## Testing

Vitest 4 + React Testing Library. v8 coverage, 80%+ target. Husky pre-push runs: type-check, lint, full tests, build. `pnpm validate` for quick check (skips build).

## Conventions

- Don't mark tasks as complete unless the user says so.
- All UI strings in English (see memory).
- No browser alerts; use `ConfirmationDialog` / `useAlertDialog` + `AlertDialogModal`.
- Reuse existing routes/tables/UI before proposing parallel infrastructure.
- YAGNI. Simplest architecture that does the job.
