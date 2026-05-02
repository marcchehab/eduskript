/**
 * JSON-LD presence + shape gate.
 *
 * The metadata.test.ts gate enforces meta-tag fields. JSON-LD lives in
 * the rendered HTML body (a `<script type="application/ld+json">` tag),
 * not in Next.js's metadata API, so it needs its own check.
 *
 * Strategy: invoke each public page component as a function, walk the
 * resulting React element tree, and assert a `<JsonLd>` element is
 * present. We compare by reference to the imported `JsonLd` function so
 * a rename or accidental removal trips the test immediately.
 *
 * The schema factory functions are unit-tested separately for shape.
 */
import { describe, it, expect, vi } from 'vitest'
import type { ReactElement, ReactNode } from 'react'

// --- Mocks (declared before importing route modules) --------------------
// Same shape as tests/seo/metadata.test.ts. Kept duplicated rather than
// extracted because vi.mock hoisting + shared mock factories across
// files is fragile.

vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('next-auth', () => ({ getServerSession: vi.fn(() => Promise.resolve(null)) }))
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_cache: <T>(fn: T) => fn,
}))
vi.mock('@/lib/org-auth', () => ({
  getOrgMembership: vi.fn(() => Promise.resolve(null)),
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

const fixtureContent = {
  collection: {
    id: 'col-1',
    title: 'Test Collection',
    slug: 'test-col',
    description: 'A collection description',
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
    content: 'Some page content for the excerpt and JSON-LD body.',
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
  sidebarBehavior: 'contextual',
  customDomains: [],
  // Org page-render reads frontPage and pageLayout via getOrgWithLayout.
  frontPage: null,
  pageLayout: null,
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
  getOrgWithLayout: vi.fn(() => Promise.resolve(fixtureOrganization)),
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
    frontPage: { findFirst: vi.fn(() => Promise.resolve(null)) },
    userData: { findMany: vi.fn(() => Promise.resolve([])) },
    pageLayout: { findFirst: vi.fn() },
    organizationMember: { findMany: vi.fn(() => Promise.resolve([])) },
    orgPageLayout: { findFirst: vi.fn(), findUnique: vi.fn() },
    skript: { findFirst: vi.fn() },
    collection: { findMany: vi.fn(), findFirst: vi.fn() },
  },
}))

// --- Imports that depend on mocks ---------------------------------------

import {
  JsonLd,
  organizationSchema,
  learningResourceSchema,
  breadcrumbSchema,
} from '@/lib/seo/json-ld'

// --- Schema factory unit tests ------------------------------------------

describe('JSON-LD schema factories', () => {
  it('organizationSchema declares @type Organization with required fields', () => {
    const schema = organizationSchema() as Record<string, unknown>
    expect(schema['@context']).toBe('https://schema.org')
    expect(schema['@type']).toBe('Organization')
    expect(schema.name).toBeTruthy()
    expect(schema.url).toBeTruthy()
  })

  it('learningResourceSchema includes author, dates, language, url', () => {
    const schema = learningResourceSchema({
      title: 'A page',
      description: 'A description',
      url: 'https://example.com/page',
      inLanguage: 'de',
      author: 'Marc',
      dateCreated: new Date('2026-01-01T00:00:00Z'),
      dateModified: new Date('2026-04-01T00:00:00Z'),
    }) as Record<string, unknown>
    expect(schema['@type']).toBe('LearningResource')
    expect(schema.name).toBe('A page')
    expect(schema.inLanguage).toBe('de')
    expect(schema.dateCreated).toBe('2026-01-01T00:00:00.000Z')
    expect(schema.dateModified).toBe('2026-04-01T00:00:00.000Z')
    expect((schema.author as { name: string }).name).toBe('Marc')
  })

  it('breadcrumbSchema numbers items starting at 1', () => {
    const schema = breadcrumbSchema([
      { name: 'Home', url: 'https://example.com/' },
      { name: 'Section', url: 'https://example.com/section' },
      { name: 'Page', url: 'https://example.com/section/page' },
    ]) as { itemListElement: Array<{ position: number; name: string }> }
    expect(schema['@type' as keyof typeof schema]).toBe('BreadcrumbList')
    expect(schema.itemListElement).toHaveLength(3)
    expect(schema.itemListElement[0].position).toBe(1)
    expect(schema.itemListElement[2].name).toBe('Page')
  })
})

// --- JsonLd component unit test -----------------------------------------

describe('JsonLd component', () => {
  it('emits a <script type="application/ld+json"> with serialised schema', () => {
    const element = JsonLd({ schema: { '@type': 'Test', name: 'value' } }) as ReactElement<{
      type: string
      dangerouslySetInnerHTML: { __html: string }
    }>
    expect(element.type).toBe('script')
    expect(element.props.type).toBe('application/ld+json')
    const parsed = JSON.parse(element.props.dangerouslySetInnerHTML.__html)
    expect(parsed['@type']).toBe('Test')
  })
})

// --- Page-level wiring tests --------------------------------------------
// React elements are plain objects { type, props }. Walk recursively and
// search for a node whose `type` is the JsonLd function (reference
// equality survives bundling).

interface ReactNodeWithChildren {
  type?: unknown
  props?: { children?: ReactNode }
}

function containsJsonLd(node: ReactNode): boolean {
  if (node == null || typeof node === 'boolean' || typeof node === 'string' || typeof node === 'number') {
    return false
  }
  if (Array.isArray(node)) {
    return node.some(containsJsonLd)
  }
  const obj = node as ReactNodeWithChildren
  if (obj.type === JsonLd) return true
  return containsJsonLd(obj.props?.children)
}

interface PageComponentProps {
  params: Promise<Record<string, string>>
}

interface PageModule {
  default: (props: PageComponentProps) => Promise<ReactElement>
}

describe('JSON-LD wiring on public pages', () => {
  it('eduskript org frontpage embeds Organization JSON-LD', async () => {
    const mod = (await import('@/app/org/[orgSlug]/page')) as unknown as PageModule
    const tree = await mod.default({ params: Promise.resolve({ orgSlug: 'eduskript' }) })
    expect(
      containsJsonLd(tree),
      'Org frontpage should render <JsonLd schema={organizationSchema()} />. ' +
        'If it stopped, restore the JsonLd JSX in src/app/org/[orgSlug]/page.tsx.'
    ).toBe(true)
  })

  it('teacher content page embeds LearningResource + Breadcrumb JSON-LD', async () => {
    const mod = (await import('@/app/[domain]/[skriptSlug]/[pageSlug]/page')) as unknown as PageModule
    const tree = await mod.default({
      params: Promise.resolve({ domain: 'marc', skriptSlug: 'test-skript', pageSlug: 'test-page' }),
    })
    expect(
      containsJsonLd(tree),
      'Teacher content page should render <JsonLd schema={[learningResourceSchema(...), breadcrumbSchema(...)]} />. ' +
        'If it stopped, restore the JsonLd JSX in src/app/[domain]/[skriptSlug]/[pageSlug]/page.tsx.'
    ).toBe(true)
  })

  it('org content page embeds LearningResource + Breadcrumb JSON-LD', async () => {
    const mod = (await import('@/app/org/[orgSlug]/c/[skriptSlug]/[pageSlug]/page')) as unknown as PageModule
    const tree = await mod.default({
      params: Promise.resolve({ orgSlug: 'eduskript', skriptSlug: 'test-skript', pageSlug: 'test-page' }),
    })
    expect(
      containsJsonLd(tree),
      'Org content page should render <JsonLd schema={[learningResourceSchema(...), breadcrumbSchema(...)]} />.'
    ).toBe(true)
  })
})
