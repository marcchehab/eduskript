/**
 * Seed demo user if it doesn't exist yet.
 * Runs at startup (in the `start` script chain) — idempotent.
 *
 * Creates demo@eduskript.org with demo content from demo-content/ files.
 * If the user already exists, does nothing.
 *
 * Run: node scripts/seed-demo.mjs
 */

import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'
import bcrypt from 'bcryptjs'
import { readFileSync, readdirSync, existsSync } from 'fs'
import { join } from 'path'

const { Pool } = pg

const DEMO_EMAIL = 'demo@eduskript.org'
const DEMO_PASSWORD = 'demodemo'
const DEMO_CONTENT_DIR = join(process.cwd(), 'demo-content')

const isLocal = process.env.DATABASE_URL?.includes('localhost')
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000,
})
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

function readDemoPages() {
  if (!existsSync(DEMO_CONTENT_DIR)) {
    console.log('  demo-content/ directory not found, skipping')
    return []
  }

  const entries = readdirSync(DEMO_CONTENT_DIR)
  const mdFiles = entries.filter(f => f.endsWith('.md') && !f.startsWith('_'))

  const pages = mdFiles.map(filename => {
    const content = readFileSync(join(DEMO_CONTENT_DIR, filename), 'utf-8')
    const match = filename.match(/^(\d+)-(.+)\.md$/)

    let order, slug
    if (match) {
      order = parseInt(match[1], 10)
      slug = match[2]
    } else {
      order = 999
      slug = filename.replace('.md', '')
    }

    let title = slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
    const h1Match = content.match(/^#\s+(.+)$/m)
    if (h1Match) title = h1Match[1].trim()

    return { slug, title, content, order }
  })

  pages.sort((a, b) => a.order - b.order)
  return pages
}

function readSkriptMeta() {
  const metaPath = join(DEMO_CONTENT_DIR, '_skript.json')
  if (existsSync(metaPath)) {
    return JSON.parse(readFileSync(metaPath, 'utf-8'))
  }
  return { title: 'Welcome to Eduskript' }
}

async function main() {
  console.log('Checking for demo user...')

  const existing = await prisma.user.findUnique({
    where: { email: DEMO_EMAIL },
  })

  if (existing) {
    console.log('Demo user already exists')
    return
  }

  console.log('Creating demo user...')

  const hashedPassword = await bcrypt.hash(DEMO_PASSWORD, 12)
  const user = await prisma.user.create({
    data: {
      email: DEMO_EMAIL,
      name: 'Demo Teacher',
      pageSlug: 'demo',
      pageName: 'Demo',
      accountType: 'teacher',
      hashedPassword,
      emailVerified: new Date(),
      billingPlan: 'pro',
    },
  })

  // Add to eduskript org if it exists
  const org = await prisma.organization.findUnique({
    where: { slug: 'eduskript' },
  })
  if (org) {
    await prisma.organizationMember.create({
      data: {
        organizationId: org.id,
        userId: user.id,
        role: 'member',
      },
    })
  }

  // Seed demo content
  const skriptMeta = readSkriptMeta()
  const pages = readDemoPages()
  const suffix = user.id.slice(-8)

  const collection = await prisma.collection.create({
    data: {
      title: 'Getting Started with Eduskript',
      slug: `demo-getting-started-${suffix}`,
      description: 'A quick tour of what you can do with Eduskript',
      authors: { create: { userId: user.id, permission: 'author' } },
    },
  })

  const skript = await prisma.skript.create({
    data: {
      title: skriptMeta.title,
      slug: `demo-welcome-${suffix}`,
      description: skriptMeta.description || null,
      isPublished: true,
      authors: { create: { userId: user.id, permission: 'author' } },
    },
  })

  await prisma.collectionSkript.create({
    data: { collectionId: collection.id, skriptId: skript.id, order: 0 },
  })

  for (let i = 0; i < pages.length; i++) {
    await prisma.page.create({
      data: {
        title: pages[i].title,
        slug: pages[i].slug,
        content: pages[i].content,
        order: i,
        isPublished: true,
        skriptId: skript.id,
        authors: { create: { userId: user.id, permission: 'author' } },
      },
    })
  }

  await prisma.pageLayout.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      items: { create: { type: 'collection', contentId: collection.id, order: 0 } },
    },
    update: {
      items: { create: { type: 'collection', contentId: collection.id, order: 0 } },
    },
  })

  console.log('========================================')
  console.log('✅ Demo user created!')
  console.log(`   Email:    ${DEMO_EMAIL}`)
  console.log(`   Password: ${DEMO_PASSWORD}`)
  console.log(`   Pages:    ${pages.length}`)
  console.log('========================================')
}

main()
  .catch(e => {
    console.error('Error seeding demo user:', e)
    // Non-fatal: don't exit(1) — server should still start
  })
  .finally(async () => {
    await prisma.$disconnect()
    await pool.end()
  })
