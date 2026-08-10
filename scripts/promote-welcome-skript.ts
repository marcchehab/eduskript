/**
 * One-time migration: turns the hardcoded demo-content/ tour (English) and its
 * German translation into two real, editable Skripts owned by eduadmin, with
 * Marc as co-author. These become the canonical source for seedDemoContent()
 * (see src/lib/seed-demo-content.ts) instead of the filesystem.
 *
 * Run: DATABASE_URL="$DATABASE_URL_PROD" npx tsx scripts/promote-welcome-skript.ts
 *
 * Idempotent: skips creation if a skript with the target slug already exists.
 */

import { config } from 'dotenv'
config({ path: '.env.local' })
config()

import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

const isLocal = process.env.DATABASE_URL?.includes('localhost')
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false },
})
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

const EDUADMIN_EMAIL = 'eduadmin@eduskript.org'
const MARC_EMAIL = 'marc@informatikgarten.ch'

interface SkriptSpec {
  dir: string
  slug: string
}

const SPECS: SkriptSpec[] = [
  { dir: join(process.cwd(), 'demo-content'), slug: 'welcome-to-eduskript' },
  {
    dir: '/tmp/claude-1000/-home-chris-coding-eduskript/18ca3081-ff96-4607-9d12-012947019f59/scratchpad/demo-content-de',
    slug: 'willkommen-bei-eduskript',
  },
]

function readPages(dir: string) {
  const files = readdirSync(dir)
    .filter(f => f.endsWith('.md') && !f.startsWith('_'))
    .sort()

  return files.map(filename => {
    const content = readFileSync(join(dir, filename), 'utf-8')
    const match = filename.match(/^(\d+)-(.+)\.md$/)
    const order = match ? parseInt(match[1], 10) : 999
    const slug = match ? match[2] : filename.replace('.md', '')
    const h1Match = content.match(/^#\s+(.+)$/m)
    const title = h1Match ? h1Match[1].trim() : slug
    return { slug, title, content, order }
  })
}

function readMeta(dir: string): { title: string; description?: string } {
  return JSON.parse(readFileSync(join(dir, '_skript.json'), 'utf-8'))
}

async function main() {
  const eduadmin = await prisma.user.findUniqueOrThrow({ where: { email: EDUADMIN_EMAIL }, select: { id: true } })
  const marc = await prisma.user.findUniqueOrThrow({ where: { email: MARC_EMAIL }, select: { id: true } })

  for (const spec of SPECS) {
    const existing = await prisma.skript.findFirst({ where: { slug: spec.slug }, select: { id: true } })
    if (existing) {
      console.log(`  skip ${spec.slug} — already exists (${existing.id})`)
      continue
    }

    const meta = readMeta(spec.dir)
    const pages = readPages(spec.dir)

    const skript = await prisma.skript.create({
      data: {
        title: meta.title,
        slug: spec.slug,
        description: meta.description || null,
        isPublished: false,
        authors: {
          create: [
            { userId: eduadmin.id, permission: 'author' },
            { userId: marc.id, permission: 'author' },
          ],
        },
      },
    })

    // Explicit PageAuthor rows, not just SkriptAuthor: the save path
    // (loadPageForActor in src/lib/services/pages.ts) filters directly on
    // `page.authors`, without the skript-level fallback that read/view
    // permission checks use. Without this, a skript-only author can view a
    // page in the editor but saving fails with "Page not found".
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i]
      await prisma.page.create({
        data: {
          title: page.title,
          slug: page.slug,
          content: page.content,
          order: i,
          isPublished: false,
          skriptId: skript.id,
          authors: {
            create: [
              { userId: eduadmin.id, permission: 'author' },
              { userId: marc.id, permission: 'author' },
            ],
          },
        },
      })
    }

    console.log(`  created ${spec.slug} — ${skript.id} (${pages.length} pages)`)
  }

  await prisma.$disconnect()
  await pool.end()
}

main().catch(e => {
  console.error('Failed:', e)
  process.exit(1)
})
