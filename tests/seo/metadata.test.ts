/**
 * SEO hygiene gate.
 *
 * Loads each public-facing route module and asserts its metadata (either
 * `generateMetadata()` or static `metadata`) declares the SEO fields a
 * crawler / social-share preview / KaTeX index needs.
 *
 * The test treats missing fields the same way the migration test treats
 * a hand-written .sql file: the build fails, you fix the route, you push.
 * Same lifehack pattern. No exceptions, no judgement calls.
 *
 * Routes intentionally NOT covered (with reason):
 *   - src/app/page.tsx                       — server-side redirect, no SEO surface
 *   - src/app/consent/page.tsx               — auth-gated client component
 *   - src/app/[domain]/[skriptSlug]/page.tsx — explicit noindex (skript preview)
 *   - src/app/exam/...                       — explicit noindex (exam routes)
 *   - src/app/org/[orgSlug]/[pageSlug]/...   — extra org page-layout routes;
 *                                              add as the surface stabilises
 *
 * Strategy and roadmap live in ~/Documents/2_Areas/eduskript/promo.md
 * (see .seo/README.md).
 */
import { describe, it, expect, vi } from 'vitest'
import type { Metadata } from 'next'
import fs from 'node:fs'
import path from 'node:path'

// --- Mocks (must be declared before importing the route modules) --------
// Public route modules pull in next-auth, prisma, the cached-query layer,
// and React Server Components. None of that work matters for metadata —
// stub it all so the test stays fast and deterministic.

vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('next-auth', () => ({ getServerSession: vi.fn() }))
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_cache: <T>(fn: T) => fn,
}))

const fixtureTeacher = {
  id: 'teacher-1',
  name: 'Marc',
  email: 'marc@example.com',
  pageSlug: 'marc',
  pageName: 'Marc',
  pageDescription: 'Computer science teacher in Switzerland',
  pageIcon: null,
  pageLanguage: 'en',
  pageTagline: 'Teaching CS the open way',
  title: 'Teacher',
  bio: 'Bio',
  sidebarBehavior: 'contextual',
  typographyPreference: 'modern',
  billingPlan: 'free',
  customDomains: [],
}

// Page content is intentionally meaty — the description-derivation test
// asserts it lands as og:description (i.e. the route uses the page
// content excerpt, not the generic collection-description fallback).
const PAGE_CONTENT_PREFIX =
  'This page demonstrates SEO metadata derivation'

const fixtureContent = {
  collection: {
    id: 'col-1',
    title: 'Test Collection',
    slug: 'test-col',
    description: 'A collection description that should NOT appear as og:description',
    accentColor: null,
  },
  skript: {
    id: 'sk-1',
    title: 'Test Skript',
    slug: 'test-skript',
    isPublished: true,
    order: 0,
  },
  page: {
    id: 'pg-1',
    title: 'Test Page',
    slug: 'test-page',
    content:
      `${PAGE_CONTENT_PREFIX}. The excerpt should come from the first 160 ` +
      `characters of cleaned-up markdown content, not the collection ` +
      `description or a templated fallback.`,
    order: 0,
    isPublished: true,
    isUnlisted: false,
    pageType: 'standard',
    examSettings: null,
    createdAt: new Date('2026-01-15T10:00:00Z'),
    updatedAt: new Date('2026-04-20T14:30:00Z'),
  },
  allPages: [],
}

const fixtureOrganization = {
  id: 'org-1',
  name: 'Eduskript',
  description: 'Open-source platform for interactive lessons',
  showIcon: true,
  iconUrl: '/og-default.svg',
  pageTagline: null,
  pageLanguage: 'en',
  customDomains: [],
}

vi.mock('@/lib/cached-queries', () => ({
  CACHE_TAGS: {
    user: () => 'user',
    collection: () => 'collection',
    collectionBySlug: () => 'collectionBySlug',
    skript: () => 'skript',
    skriptBySlug: () => 'skriptBySlug',
    page: () => 'page',
    pageBySlug: () => 'pageBySlug',
    teacherContent: () => 'teacherContent',
    organization: () => 'organization',
    orgContent: () => 'orgContent',
  },
  getTeacherByPageSlug: vi.fn(() => Promise.resolve(fixtureTeacher)),
  getTeacherByUsername: vi.fn(() => Promise.resolve(fixtureTeacher)),
  getTeacherByPageSlugDeduped: vi.fn(() => Promise.resolve(fixtureTeacher)),
  getTeacherByUsernameDeduped: vi.fn(() => Promise.resolve(fixtureTeacher)),
  getPublishedPage: vi.fn(() => Promise.resolve(fixtureContent)),
  getOrgPublishedPage: vi.fn(() => Promise.resolve(fixtureContent)),
  getOrgWithLayout: vi.fn(() => Promise.resolve(null)),
  getOrgHomepageContent: vi.fn(() => Promise.resolve({ collections: [], rootSkripts: [] })),
  getOrgFullSiteStructure: vi.fn(() => Promise.resolve([])),
  getTeacherWithLayout: vi.fn(() => Promise.resolve(null)),
  getPublishedCollection: vi.fn(() => Promise.resolve(null)),
  getAllPublishedCollections: vi.fn(() => Promise.resolve([])),
  getFullSiteStructure: vi.fn(() => Promise.resolve([])),
  getTeacherHomepageContent: vi.fn(() => Promise.resolve({ collections: [], rootSkripts: [] })),
  getCollectionForPreview: vi.fn(() => Promise.resolve(null)),
  getSkriptForPreview: vi.fn(() => Promise.resolve(null)),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    organization: {
      findUnique: vi.fn(() => Promise.resolve(fixtureOrganization)),
    },
    user: { findFirst: vi.fn() },
    frontPage: { findFirst: vi.fn() },
    userData: { findMany: vi.fn(() => Promise.resolve([])) },
    pageLayout: { findFirst: vi.fn() },
    organizationMember: { findMany: vi.fn(() => Promise.resolve([])) },
    orgPageLayout: { findFirst: vi.fn(), findUnique: vi.fn() },
    skript: { findFirst: vi.fn() },
    collection: { findMany: vi.fn(), findFirst: vi.fn() },
  },
}))

// --- Required field sets per route category -----------------------------

type Category = 'frontpage' | 'teacher-home' | 'teacher-content' | 'org-content' | 'static-legal'

const FULL_SEO: string[] = [
  'title',
  'description',
  'alternates.canonical',
  'openGraph.title',
  'openGraph.description',
  'openGraph.type',
  'openGraph.url',
  'openGraph.images',
  'twitter.card',
  'twitter.images',
]

// Article-style pages (skript content) need freshness signals so Google
// can prefer recently-updated material. Both timestamps live on the Page
// model already — generateMetadata just has to plumb them through.
const CONTENT_EXTRA: string[] = [
  'openGraph.publishedTime',
  'openGraph.modifiedTime',
]

const REQUIRED_BY_CATEGORY: Record<Category, string[]> = {
  'frontpage': FULL_SEO,
  'teacher-home': FULL_SEO,
  'teacher-content': [...FULL_SEO, ...CONTENT_EXTRA],
  'org-content': [...FULL_SEO, ...CONTENT_EXTRA],
  // Legal pages aren't search landings — they just need the basics so
  // bookmarks and inline links render with a sensible title/description.
  'static-legal': ['title', 'description'],
}

interface PageModule {
  generateMetadata?: (args: { params: Promise<Record<string, string>> }) => Promise<Metadata> | Metadata
  metadata?: Metadata
}

interface RouteSpec {
  label: string
  category: Category
  module: () => Promise<PageModule>
  params: Record<string, string>
}

// Dynamic imports kept inside thunks so Vite resolves the path-with-brackets
// aliases at build time. Static top-level imports of `@/app/[domain]/...`
// are rejected by Vite's module-id parser.
const PUBLIC_ROUTES: RouteSpec[] = [
  {
    label: 'src/app/org/[orgSlug]/page.tsx (eduskript.org frontpage)',
    category: 'frontpage',
    module: () => import('@/app/org/[orgSlug]/page'),
    params: { orgSlug: 'eduskript' },
  },
  {
    label: 'src/app/org/[orgSlug]/c/[skriptSlug]/[pageSlug]/page.tsx',
    category: 'org-content',
    module: () => import('@/app/org/[orgSlug]/c/[skriptSlug]/[pageSlug]/page'),
    params: { orgSlug: 'eduskript', skriptSlug: 'test-skript', pageSlug: 'test-page' },
  },
  {
    label: 'src/app/[domain]/page.tsx (teacher home)',
    category: 'teacher-home',
    module: () => import('@/app/[domain]/page'),
    params: { domain: 'marc' },
  },
  {
    label: 'src/app/[domain]/[skriptSlug]/[pageSlug]/page.tsx (teacher content)',
    category: 'teacher-content',
    module: () => import('@/app/[domain]/[skriptSlug]/[pageSlug]/page'),
    params: { domain: 'marc', skriptSlug: 'test-skript', pageSlug: 'test-page' },
  },
  {
    label: 'src/app/impressum/page.tsx',
    category: 'static-legal',
    module: () => import('@/app/impressum/page'),
    params: {},
  },
  {
    label: 'src/app/terms/page.tsx',
    category: 'static-legal',
    module: () => import('@/app/terms/page'),
    params: {},
  },
]

// --- Helpers ------------------------------------------------------------

function getNested(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc == null || typeof acc !== 'object') return undefined
    return (acc as Record<string, unknown>)[key]
  }, obj)
}

// "Present" means: not null/undefined, not an empty string, not an empty
// array. Empty values count as missing — an og:image with no src is no
// better than no og:image.
function isPresent(v: unknown): boolean {
  if (v == null) return false
  if (typeof v === 'string' && v.length === 0) return false
  if (Array.isArray(v) && v.length === 0) return false
  return true
}

async function loadMetadata(mod: PageModule, params: Record<string, string>): Promise<Metadata> {
  if (typeof mod.generateMetadata === 'function') {
    return await mod.generateMetadata({ params: Promise.resolve(params) })
  }
  if (mod.metadata) {
    return mod.metadata
  }
  throw new Error('module exports neither generateMetadata nor metadata')
}

// --- The gate -----------------------------------------------------------

// Pull `src/app/.../page.tsx` from a route label like
// `src/app/[domain]/page.tsx (teacher home)`. The route file lives next to the
// `opengraph-image.*` file convention, so the test can infer where to look.
function routeFilePath(label: string): string | null {
  const match = label.match(/^(\S+\.tsx?)/)
  return match ? match[1] : null
}

// True when a Next.js opengraph-image file convention sits next to the route's
// page.tsx — the framework auto-injects og:image / twitter:image and we
// shouldn't also require them in generateMetadata (the manual values would
// in fact override the file-based OG, see commit history).
function hasFileOgImage(label: string): boolean {
  const filePath = routeFilePath(label)
  if (!filePath) return false
  const dir = path.dirname(path.join(process.cwd(), filePath))
  return ['tsx', 'ts', 'jsx', 'js'].some((ext) =>
    fs.existsSync(path.join(dir, `opengraph-image.${ext}`)),
  )
}

describe('SEO hygiene gate', () => {
  for (const route of PUBLIC_ROUTES) {
    it(`${route.label} declares required metadata fields`, async () => {
      const mod = await route.module()
      const meta = await loadMetadata(mod, route.params)
      let required = REQUIRED_BY_CATEGORY[route.category]
      if (hasFileOgImage(route.label)) {
        required = required.filter(
          (f) => f !== 'openGraph.images' && f !== 'twitter.images',
        )
      }
      const missing = required.filter((field) => !isPresent(getNested(meta, field)))
      expect(
        missing,
        `${route.label} is missing SEO fields: ${missing.join(', ')}\n` +
          `Add them to the route's generateMetadata (or src/app/layout.tsx for global defaults).`
      ).toEqual([])
    })
  }

  // Content pages must derive og:description from page content (excerpt),
  // NOT from the collection's shared description or a templated fallback.
  // Without this every page in a collection ships an identical description.
  for (const route of PUBLIC_ROUTES.filter(
    (r) => r.category === 'teacher-content' || r.category === 'org-content'
  )) {
    it(`${route.label} derives og:description from page content`, async () => {
      const mod = await route.module()
      const meta = await loadMetadata(mod, route.params)
      const description = String(meta.description ?? '')
      expect(
        description,
        `${route.label} description must include the page-content excerpt prefix ` +
          `("${PAGE_CONTENT_PREFIX}"). Got: "${description}". ` +
          `If you reverted to the collection-description fallback, restore the ` +
          `generateExcerpt(page.content) call in generateMetadata.`
      ).toContain(PAGE_CONTENT_PREFIX)
    })
  }
})
