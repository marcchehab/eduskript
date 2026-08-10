/**
 * Seeds demo content for a given user by cloning the pages of a template
 * skript owned by eduadmin (see scripts/promote-welcome-skript.ts).
 *
 * Used by:
 * - /api/seed-example-content (new user "Explore with examples" button)
 * - scripts/reset-demo-user.ts (nightly demo account reset)
 *
 * Picks the English or German template based on the user's Site.pageLanguage
 * (BCP-47, null/non-"de" = English). Creates one collection + one skript +
 * pages, all owned by the given user.
 */

// Mirrors PRIMARY_SITE_ORDER in src/lib/sites.ts. Inlined rather than imported:
// that module pulls in @/lib/prisma, which throws at import time when
// DATABASE_URL is not yet loaded — and this file is imported by standalone
// scripts that load their env after the import graph is evaluated.
const PRIMARY_SITE_ORDER = [{ order: 'asc' as const }, { createdAt: 'asc' as const }]

// Accept any Prisma-like client (the app uses an extended client, scripts use plain).
type PrismaLike = any

// Slugs of the eduadmin-owned template skripts created by
// scripts/promote-welcome-skript.ts. Edit their content via the dashboard
// (Marc is a co-author on both) — this file only clones them.
const TEMPLATE_SKRIPT_SLUG_EN = 'welcome-to-eduskript'
const TEMPLATE_SKRIPT_SLUG_DE = 'willkommen-bei-eduskript'

const COLLECTION_TITLE = 'Getting Started with Eduskript'
// COLLECTION_DESCRIPTION removed — collections no longer have a description.

interface SeedDemoContentOptions {
  userId: string
  prisma: PrismaLike
}

export interface SeedResult {
  collectionId: string
  skriptId: string
  layoutId: string
  pageCount: number
}

interface PageData {
  slug: string
  title: string
  content: string
  order: number
}

function slugSuffix(userId: string): string {
  return userId.slice(-8)
}

function skriptSlug(userId: string): string {
  return `demo-welcome-${slugSuffix(userId)}`
}

export { DEMO_EMAIL, DEMO_PASSWORD, DEMO_SITE_SLUG } from './demo-account'
import { DEMO_EMAIL, DEMO_PASSWORD, DEMO_SITE_SLUG } from './demo-account'

const DEMO_FRONTPAGE_CONTENT = `# Demo

Here you can log in using **demo@eduskript.org** with the password **demodemo**. All changes you make are reset every night.

If you would like to try Eduskript for longer, you can:

<cta href="https://eduskript.org/auth/signup" size="lg">Create a free account</cta>
`

/**
 * The demo user, by email or — if a visitor changed the email — by the site
 * slug it owns. Without the fallback a changed email makes the nightly reset
 * create a second demo user, which then collides on the unique site slug and
 * fails, leaving the tampered account live indefinitely.
 */
export async function findDemoUser(prisma: PrismaLike) {
  return (
    (await prisma.user.findUnique({ where: { email: DEMO_EMAIL } })) ??
    (await prisma.user.findFirst({
      where: { sites: { some: { slug: DEMO_SITE_SLUG } } },
    }))
  )
}

/**
 * Delete the demo user outright, plus the S3 objects only it owned.
 *
 * Deleting the User row is what makes the reset total: every user-owned model
 * cascades from it (sites, collections, skripts, pages, files, classes, exams,
 * userData, OAuth access tokens, plugins, mail hooks). Selective deletion only
 * ever covered the seeded demo content, so anything a visitor created stayed
 * forever.
 *
 * S3 has to be handled before and after the row goes:
 * - snaps/{userId}/ is owned by this user alone, so the whole prefix goes.
 * - files/{hash}.{ext} is content-addressed and shared across ALL users, so a
 *   blob is only removed once no File row anywhere still references its hash.
 *   Checked after the cascade, when the demo rows are gone.
 *
 * Orphan risk in the other direction: if the S3 delete fails the blob leaks,
 * which is preferable to deleting a blob a real teacher's page still renders.
 */
async function purgeDemoUser(prisma: PrismaLike, userId: string): Promise<void> {
  const { deleteS3Prefix, deleteTeacherFile, isS3Configured, isTeacherS3Configured } =
    await import('./s3')

  const files: { hash: string | null; name: string }[] = await prisma.file.findMany({
    where: { createdBy: userId, isDirectory: false },
    select: { hash: true, name: true },
  })

  if (isS3Configured()) {
    try {
      await deleteS3Prefix(`snaps/${userId}/`)
    } catch (error) {
      console.warn(`[demo] snap purge failed: ${String(error).slice(0, 200)}`)
    }
  }

  await prisma.user.delete({ where: { id: userId } })

  if (!isTeacherS3Configured()) return

  const seen = new Set<string>()
  for (const file of files) {
    if (!file.hash || seen.has(file.hash)) continue
    seen.add(file.hash)

    const stillUsed = await prisma.file.count({ where: { hash: file.hash } })
    if (stillUsed > 0) continue

    const extension = file.name.includes('.') ? file.name.split('.').pop()! : ''
    if (!extension) continue

    try {
      await deleteTeacherFile(`files/${file.hash}.${extension}`)
    } catch (error) {
      console.warn(`[demo] blob purge failed for ${file.hash}: ${String(error).slice(0, 200)}`)
    }
  }
}

/**
 * Rebuild the demo account from scratch: purge, recreate, re-seed.
 *
 * The user id changes on every run, which is fine — every slug the seeder
 * derives is keyed to it. Callers are the nightly cron and
 * scripts/reset-demo-user.ts; both used to carry their own copy of this.
 *
 * What still survives a reset: S3 blobs whose hash another user shares,
 * newsletter addresses in Brevo, mail already sent, and AI spend.
 */
export async function resetDemoUser(prisma: PrismaLike): Promise<SeedResult & { userId: string }> {
  const bcrypt = (await import('bcryptjs')).default

  const existing = await findDemoUser(prisma)
  if (existing) await purgeDemoUser(prisma, existing.id)

  const user = await prisma.user.create({
    data: {
      email: DEMO_EMAIL,
      name: 'Demo Teacher',
      accountType: 'teacher',
      hashedPassword: await bcrypt.hash(DEMO_PASSWORD, 12),
      emailVerified: new Date(),
      billingPlan: 'pro',
      sites: { create: { slug: DEMO_SITE_SLUG, pageName: 'Demo' } },
    },
    select: { id: true },
  })

  // Membership in the eduskript org, when that org exists (its slug lives on
  // the org's Site).
  const orgSite = await prisma.site.findUnique({
    where: { slug: 'eduskript' },
    select: { organizationId: true },
  })
  if (orgSite?.organizationId) {
    await prisma.organizationMember.create({
      data: { organizationId: orgSite.organizationId, userId: user.id, role: 'member' },
    })
  }

  const site = await prisma.site.findFirst({
    where: { userId: user.id, slug: DEMO_SITE_SLUG },
    select: { id: true },
  })
  if (site) {
    await prisma.frontPage.create({
      data: { siteId: site.id, content: DEMO_FRONTPAGE_CONTENT, isPublished: true },
    })
  }

  const result = await seedDemoContent({ userId: user.id, prisma })
  return { ...result, userId: user.id }
}

/**
 * Read the template skript's metadata + pages from the DB (see
 * scripts/promote-welcome-skript.ts for how these were created).
 */
async function readTemplateSkript(
  prisma: PrismaLike,
  slug: string
): Promise<{ title: string; description?: string; pages: PageData[] }> {
  // findFirst, not findUnique — Skript.slug has no @unique constraint at the
  // schema level (only [skriptId, slug] on Page is unique).
  const skript = await prisma.skript.findFirst({
    where: { slug },
    select: {
      title: true,
      description: true,
      pages: {
        orderBy: { order: 'asc' },
        select: { slug: true, title: true, content: true, order: true },
      },
    },
  })
  if (!skript) {
    throw new Error(`Template skript not found: ${slug}`)
  }
  return skript
}

export async function seedDemoContent(options: SeedDemoContentOptions): Promise<SeedResult> {
  const { userId, prisma } = options

  // Create collection. Ownership goes through the user's Site, not via a
  // CollectionAuthor row — the demo seeder requires the user to already have
  // a Site (every teacher with a pageSlug does). A user can own several sites,
  // so this takes the primary one (findUnique on userId stopped being valid
  // when Site went one-to-many).
  const site = await prisma.site.findFirst({
    where: { userId },
    orderBy: PRIMARY_SITE_ORDER,
    select: { id: true, pageLanguage: true },
  })
  if (!site) {
    throw new Error(
      `Cannot seed demo content for user ${userId}: no Site exists. Set a pageSlug first.`
    )
  }

  const templateSlug = site.pageLanguage?.toLowerCase().startsWith('de')
    ? TEMPLATE_SKRIPT_SLUG_DE
    : TEMPLATE_SKRIPT_SLUG_EN
  const skriptMeta = await readTemplateSkript(prisma, templateSlug)
  const pages = skriptMeta.pages

  const collection = await prisma.collection.create({
    data: {
      title: COLLECTION_TITLE,
      siteId: site.id,
    },
  })

  // Create skript
  const skript = await prisma.skript.create({
    data: {
      title: skriptMeta.title,
      slug: skriptSlug(userId),
      description: skriptMeta.description || null,
      isPublished: true,
      authors: {
        create: { userId, permission: 'author' },
      },
    },
  })

  // Link skript to collection
  await prisma.collectionSkript.create({
    data: {
      collectionId: collection.id,
      skriptId: skript.id,
      order: 0,
    },
  })

  // Create pages
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i]
    await prisma.page.create({
      data: {
        title: page.title,
        slug: page.slug,
        content: page.content,
        order: i,
        isPublished: true,
        skriptId: skript.id,
        authors: {
          create: { userId, permission: 'author' },
        },
      },
    })
  }

  // Add collection to the user's site-level page layout. `site` was fetched
  // earlier in this function so we can rely on it here.
  const layout = await prisma.pageLayout.upsert({
    where: { siteId: site.id },
    create: {
      siteId: site.id,
      items: {
        create: {
          type: 'collection',
          contentId: collection.id,
          order: 0,
        },
      },
    },
    update: {
      items: {
        create: {
          type: 'collection',
          contentId: collection.id,
          order: 0,
        },
      },
    },
  })

  return {
    collectionId: collection.id,
    skriptId: skript.id,
    layoutId: layout.id,
    pageCount: pages.length,
  }
}
