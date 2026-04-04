/**
 * Seeds demo content from demo-content/ markdown files for a given user.
 *
 * Used by:
 * - /api/seed-example-content (new user "Explore with examples" button)
 * - scripts/reset-demo-user.ts (nightly demo account reset)
 *
 * Reads markdown files from the demo-content/ directory at project root.
 * Creates one collection + one skript + pages, all owned by the given user.
 */

import { readFileSync, readdirSync, existsSync } from 'fs'
import { join } from 'path'

// Accept any Prisma-like client (the app uses an extended client, scripts use plain).
type PrismaLike = any

const DEMO_CONTENT_DIR = join(process.cwd(), 'demo-content')

const COLLECTION_TITLE = 'Getting Started with Eduskript'
const COLLECTION_DESCRIPTION = 'A quick tour of what you can do with Eduskript'

interface SeedDemoContentOptions {
  userId: string
  prisma: PrismaLike
  /** If true, delete existing demo content for this user before re-seeding */
  reset?: boolean
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

function collectionSlug(userId: string): string {
  return `demo-getting-started-${slugSuffix(userId)}`
}

function skriptSlug(userId: string): string {
  return `demo-welcome-${slugSuffix(userId)}`
}

/**
 * Read and parse all markdown pages from demo-content/ directory.
 * Reuses the same filename pattern as sync-docs.ts: NN-slug.md
 */
function readDemoPages(): PageData[] {
  if (!existsSync(DEMO_CONTENT_DIR)) {
    throw new Error(`Demo content directory not found: ${DEMO_CONTENT_DIR}`)
  }

  const entries = readdirSync(DEMO_CONTENT_DIR)
  const mdFiles = entries.filter(
    f => f.endsWith('.md') && !f.startsWith('_')
  )

  const pages: PageData[] = mdFiles.map(filename => {
    const content = readFileSync(join(DEMO_CONTENT_DIR, filename), 'utf-8')
    const match = filename.match(/^(\d+)-(.+)\.md$/)

    let order: number
    let slug: string

    if (match) {
      order = parseInt(match[1], 10)
      slug = match[2]
    } else {
      order = 999
      slug = filename.replace('.md', '')
    }

    // Extract title from first # heading
    let title = slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
    const h1Match = content.match(/^#\s+(.+)$/m)
    if (h1Match) {
      title = h1Match[1].trim()
    }

    return { slug, title, content, order }
  })

  pages.sort((a, b) => a.order - b.order)
  return pages
}

/**
 * Read skript metadata from _skript.json
 */
function readSkriptMeta(): { title: string; description?: string } {
  const metaPath = join(DEMO_CONTENT_DIR, '_skript.json')
  if (existsSync(metaPath)) {
    return JSON.parse(readFileSync(metaPath, 'utf-8'))
  }
  return { title: 'Welcome to Eduskript' }
}

/**
 * Delete existing demo content for a user (for reset scenarios).
 * Relies on Prisma cascade deletes for junction tables.
 */
async function deleteDemoContent(prisma: PrismaLike, userId: string): Promise<void> {
  const suffix = slugSuffix(userId)

  // Find and delete demo skripts (cascades to pages, pageAuthors, skriptAuthors, collectionSkripts)
  const skripts = await prisma.skript.findMany({
    where: { slug: { startsWith: `demo-welcome-${suffix}` } },
    select: { id: true }
  })
  for (const skript of skripts) {
    await prisma.skript.delete({ where: { id: skript.id } })
  }

  // Find and delete demo collections (cascades to collectionAuthors, collectionSkripts)
  const collections = await prisma.collection.findMany({
    where: { slug: { startsWith: `demo-getting-started-${suffix}` } },
    select: { id: true }
  })
  for (const collection of collections) {
    // Clean up PageLayoutItems referencing this collection
    await prisma.pageLayoutItem.deleteMany({
      where: { contentId: collection.id, type: 'collection' }
    })
    await prisma.collection.delete({ where: { id: collection.id } })
  }
}

export async function seedDemoContent(options: SeedDemoContentOptions): Promise<SeedResult> {
  const { userId, prisma, reset = false } = options

  if (reset) {
    await deleteDemoContent(prisma, userId)
  }

  const skriptMeta = readSkriptMeta()
  const pages = readDemoPages()
  const suffix = slugSuffix(userId)

  // Create collection
  const collection = await prisma.collection.create({
    data: {
      title: COLLECTION_TITLE,
      slug: collectionSlug(userId),
      description: COLLECTION_DESCRIPTION,
      authors: {
        create: { userId, permission: 'author' },
      },
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

  // Add collection to user's page layout
  const layout = await prisma.pageLayout.upsert({
    where: { userId },
    create: {
      userId,
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
