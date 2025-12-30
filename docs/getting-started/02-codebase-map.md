# Codebase Map

Where everything lives.

## Directory Structure

```
src/
├── app/                  # Next.js App Router
│   ├── api/             # API routes
│   ├── dashboard/       # Teacher dashboard (protected)
│   └── [domain]/        # Public pages (student-facing)
│
├── components/
│   ├── dashboard/       # Dashboard UI
│   ├── public/          # Public page UI
│   ├── markdown/        # Markdown renderer
│   └── ui/              # Primitives (buttons, dialogs)
│
├── lib/
│   ├── remark-plugins/  # Markdown AST transforms
│   ├── rehype-plugins/  # HTML AST transforms
│   ├── prisma.ts        # Database client
│   ├── auth.ts          # NextAuth config
│   └── permissions.ts   # Permission checks
│
└── types/               # TypeScript definitions

prisma/
├── schema.prisma        # Database schema
└── seed.ts              # Seed data
```

## Key Files

| File | Purpose |
|------|---------|
| `src/lib/prisma.ts` | Database client singleton |
| `src/lib/auth.ts` | Authentication config |
| `src/lib/permissions.ts` | `canEdit()`, `canView()` checks |
| `src/components/markdown/markdown-renderer.tsx` | Renders markdown to React |
| `prisma/schema.prisma` | All data models |

## Data Models

```
User
 └── Collection (course)
      └── Skript (module)
           └── Page (lesson)
                └── File (attachment)
```

Junction tables for permissions: `CollectionAuthor`, `SkriptAuthor`, `PageAuthor`

## Request Flow

**Public page request:** `/username/collection/skript/page`

```
[domain]/[collection]/[skript]/[page]/page.tsx
  → fetch page from database
  → check if published
  → render with MarkdownRenderer
  → hydrate interactive components client-side
```

**API request:** `POST /api/pages`

```
src/app/api/pages/route.ts
  → getServerSession() for auth
  → check permissions
  → prisma query
  → return JSON
```

## Where to Add Things

| I want to... | Look at... |
|--------------|------------|
| Add markdown feature | `src/lib/remark-plugins/` |
| Add API endpoint | `src/app/api/` |
| Add dashboard feature | `src/components/dashboard/` |
| Change data model | `prisma/schema.prisma` |
| Add interactive component | `src/components/public/` |
