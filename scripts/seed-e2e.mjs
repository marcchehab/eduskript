/**
 * Deterministic seed for the e2e annotation harness (see e2e/).
 *
 * Creates a teacher with FIXED slugs so the Playwright suite can navigate to a
 * stable URL: /e2e/e2e-annotations/canvas. The page markdown is shaped to
 * exercise reflow — multiple heading sections, a COLLAPSED callout (expanding it
 * pushes content down), and a code editor.
 *
 * Idempotent: deletes prior e2e data first (Cascade clears children), then
 * recreates — so re-running refreshes the page content.
 *
 * Import-safe: the constants below are imported by the test helpers; the DB work
 * only runs when this file is executed directly (`node scripts/seed-e2e.mjs`).
 */

import { fileURLToPath } from 'url'

export const E2E_EMAIL = 'e2e-teacher@eduskript.test'
export const E2E_PASSWORD = 'e2e-password-123'
export const E2E_SITE_SLUG = 'e2e'
export const E2E_SKRIPT_SLUG = 'e2e-annotations'
export const E2E_PAGE_SLUG = 'canvas'
export const E2E_PAGE_PATH = `/${E2E_SITE_SLUG}/${E2E_SKRIPT_SLUG}/${E2E_PAGE_SLUG}`

// Markdown chosen for reflow tests: Section Two strokes shift when the collapsed
// callout in Section One is expanded; the editor + filler make the page scroll.
// Exported so the content-edit test can prepend to it and restore it.
export const PAGE_CONTENT = `# E2E Annotation Test Page

Intro paragraph so the first section has some height before the headings begin.

## Section One

> [!tip]- Collapsible callout (starts collapsed)
> Hidden line 1 — expanding this callout pushes everything below it downward.
> Hidden line 2.
> Hidden line 3.
> Hidden line 4.
> Hidden line 5.

A paragraph after the callout.

## Section Two

This is the section we draw strokes in. Expanding the callout above must shift
these strokes (and their eraser hit-zone and label) down with the section.

${Array.from({ length: 12 }, (_, i) => `Filler paragraph ${i + 1} to give the page enough height to scroll and to make reflow visible.`).join('\n\n')}

\`\`\`python editor
print("hello from the e2e editor")
\`\`\`

## Section Three

Trailing content so Section Two is not the last element on the page.

${Array.from({ length: 8 }, (_, i) => `Trailing paragraph ${i + 1}.`).join('\n\n')}

## Pinned reference

Content above the pinned card so there's scroll room before it docks to the margin.

<stickme id="e2e-pin">
> [!info] E2E pinned card
> Generic content pinned to the right margin — used by the stickme e2e test.
</stickme>

${Array.from({ length: 16 }, (_, i) => `Scroll filler ${i + 1} after the pinned card, so it stays docked while scrolling past it.`).join('\n\n')}
`

async function seed() {
  const { default: dotenv } = await import('dotenv')
  dotenv.config()
  const { PrismaClient } = await import('@prisma/client')
  const { PrismaPg } = await import('@prisma/adapter-pg')
  const pg = (await import('pg')).default
  const bcrypt = (await import('bcryptjs')).default

  const isLocal = process.env.DATABASE_URL?.includes('localhost')
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: isLocal ? false : { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
  })
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

  // FIXED ids (not auto-cuid) so row ids are STABLE across re-seeds. The dev
  // server persists an ISR / unstable_cache render of the page on disk and
  // reuses it across restarts (re-seeding doesn't invalidate it); with stable
  // ids the cached render's pageId always matches the DB row, so editing the
  // page by id (PATCH /api/pages/[id]) resolves instead of 404-ing on a stale
  // (deleted) id. Content is reset to PAGE_CONTENT every run regardless.
  const USER_ID = 'e2e-user-0001'
  const SITE_ID = 'e2e-site-0001'
  const COLLECTION_ID = 'e2e-collection-0001'
  const SKRIPT_ID = 'e2e-skript-0001'
  const PAGE_ID = 'e2e-page-canvas'

  try {
    console.log('Seeding e2e teacher…')
    // Skript has a slug (cascade clears its pages + authors + CollectionSkript).
    // Collection has no slug — owned by the Site, so deleting the user cascades
    // Site → Collection → CollectionSkript.
    await prisma.skript.deleteMany({ where: { slug: E2E_SKRIPT_SLUG } })
    await prisma.user.deleteMany({ where: { email: E2E_EMAIL } })

    const hashedPassword = await bcrypt.hash(E2E_PASSWORD, 12)

    const { user, site } = await prisma.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: {
          id: USER_ID,
          email: E2E_EMAIL,
          name: 'E2E Teacher',
          accountType: 'teacher',
          hashedPassword,
          emailVerified: new Date(),
          billingPlan: 'pro',
        },
      })
      const s = await tx.site.create({
        data: { id: SITE_ID, slug: E2E_SITE_SLUG, userId: u.id, pageName: 'E2E' },
      })
      return { user: u, site: s }
    })

    const collection = await prisma.collection.create({
      data: { id: COLLECTION_ID, title: 'E2E Collection', siteId: site.id },
    })

    const skript = await prisma.skript.create({
      data: {
        id: SKRIPT_ID,
        title: 'E2E Annotations',
        slug: E2E_SKRIPT_SLUG,
        isPublished: true,
        authors: { create: { userId: user.id, permission: 'author' } },
      },
    })

    await prisma.collectionSkript.create({
      data: { collectionId: collection.id, skriptId: skript.id, order: 0 },
    })

    await prisma.page.create({
      data: {
        id: PAGE_ID,
        title: 'Canvas',
        slug: E2E_PAGE_SLUG,
        content: PAGE_CONTENT,
        order: 0,
        isPublished: true,
        skriptId: skript.id,
        authors: { create: { userId: user.id, permission: 'author' } },
      },
    })

    console.log('========================================')
    console.log('✅ E2E teacher seeded')
    console.log(`   Email:    ${E2E_EMAIL}`)
    console.log(`   Password: ${E2E_PASSWORD}`)
    console.log(`   Page:     ${E2E_PAGE_PATH}`)
    console.log('========================================')
  } finally {
    await prisma.$disconnect()
    await pool.end()
  }
}

// Run only when executed directly, not when imported for its constants.
const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (invokedDirectly) {
  seed().catch((e) => {
    console.error('Error seeding e2e teacher:', e)
    process.exit(1)
  })
}
