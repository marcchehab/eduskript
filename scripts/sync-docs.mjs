/**
 * Sync documentation from docs/ folder into the database.
 *
 * Run: node scripts/sync-docs.mjs
 *
 * Structure expected:
 *   docs/
 *   ├── _collections.json      # Defines collections and which skripts belong to each
 *   ├── getting-started/       # Directory = skript
 *   │   ├── _skript.json       # {"title": "...", "description": "..."}
 *   │   ├── 01-introduction.md # Order-slug.md = page
 *   │   └── attachments/       # Files used in markdown
 *   │       └── image.png
 *
 * _collections.json format:
 *   {
 *     "collections": [
 *       {
 *         "title": "Full Documentation",
 *         "slug": "docs",
 *         "description": "Complete docs",
 *         "skripts": ["getting-started", "architecture", "contributing"]
 *       },
 *       {
 *         "title": "Quick Start",
 *         "slug": "quickstart",
 *         "skripts": ["getting-started"]  // Same skript can be in multiple collections
 *       }
 *     ]
 *   }
 *
 * All users with isAdmin: true get author permission on all synced content.
 * Git is the source of truth - DB content is overwritten on each sync.
 */

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'
import { readFileSync, readdirSync, statSync, existsSync } from 'fs'
import { join } from 'path'
import { createHash } from 'crypto'

const { Pool } = pg
const DOCS_DIR = join(process.cwd(), 'docs')

// Initialize Prisma with pg adapter
const isLocal = process.env.DATABASE_URL?.includes('localhost')
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false }
})
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

async function main() {
  console.log('📚 Starting docs sync...')
  console.log(`   Source: ${DOCS_DIR}`)

  // 1. Read collections config
  const configPath = join(DOCS_DIR, '_collections.json')
  if (!existsSync(configPath)) {
    console.error('❌ Missing docs/_collections.json')
    process.exit(1)
  }

  const config = JSON.parse(readFileSync(configPath, 'utf-8'))
  console.log(`   Found ${config.collections.length} collection(s)`)

  // 2. Get all admin users
  const admins = await prisma.user.findMany({
    where: { isAdmin: true },
    select: { id: true, email: true }
  })
  console.log(`   Admins: ${admins.length} users will get author access`)

  if (admins.length === 0) {
    console.error('❌ No admin users found. Create at least one admin first.')
    process.exit(1)
  }

  const primaryAdminId = admins[0].id

  // 3. Collect all unique skript directories referenced
  const allSkriptDirs = new Set()
  for (const collectionDef of config.collections) {
    for (const skriptDir of collectionDef.skripts) {
      allSkriptDirs.add(skriptDir)
    }
  }

  // 4. Process all skripts first (create/update them)
  const skriptIdMap = new Map()

  console.log(`\n   Processing ${allSkriptDirs.size} skript(s)...`)

  for (const skriptDir of allSkriptDirs) {
    const skriptPath = join(DOCS_DIR, skriptDir)

    if (!existsSync(skriptPath) || !statSync(skriptPath).isDirectory()) {
      console.error(`   ❌ Skript directory not found: ${skriptDir}`)
      continue
    }

    const skriptMetaPath = join(skriptPath, '_skript.json')

    // Read skript metadata
    let skriptMeta
    if (existsSync(skriptMetaPath)) {
      skriptMeta = JSON.parse(readFileSync(skriptMetaPath, 'utf-8'))
    } else {
      skriptMeta = {
        title: skriptDir.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
      }
    }

    // Find or create skript
    let skript = await prisma.skript.findFirst({
      where: { slug: skriptDir }
    })

    if (skript) {
      skript = await prisma.skript.update({
        where: { id: skript.id },
        data: {
          title: skriptMeta.title,
          description: skriptMeta.description || null
        }
      })
      console.log(`   ✓ Updated skript: ${skriptDir}`)
    } else {
      skript = await prisma.skript.create({
        data: {
          title: skriptMeta.title,
          slug: skriptDir,
          description: skriptMeta.description || null,
          isPublished: true
        }
      })
      console.log(`   ✓ Created skript: ${skriptDir}`)
    }

    skriptIdMap.set(skriptDir, skript.id)

    // Grant admins author access on skript
    for (const admin of admins) {
      await prisma.skriptAuthor.upsert({
        where: {
          skriptId_userId: {
            skriptId: skript.id,
            userId: admin.id
          }
        },
        update: { permission: 'author' },
        create: {
          skriptId: skript.id,
          userId: admin.id,
          permission: 'author'
        }
      })
    }

    // Process pages
    const pages = await processPages(skriptPath, skript.id, primaryAdminId, admins)
    console.log(`      ${pages} pages synced`)

    // Process attachments
    const files = await processAttachments(skriptPath, skript.id, primaryAdminId)
    if (files > 0) {
      console.log(`      ${files} attachments synced`)
    }
  }

  // 5. Process collections and link skripts
  console.log(`\n   Processing ${config.collections.length} collection(s)...`)

  for (const collectionDef of config.collections) {
    // Find or create collection
    let collection = await prisma.collection.findFirst({
      where: { slug: collectionDef.slug }
    })

    if (collection) {
      collection = await prisma.collection.update({
        where: { id: collection.id },
        data: {
          title: collectionDef.title,
          description: collectionDef.description || null
        }
      })
      console.log(`   ✓ Updated collection: ${collectionDef.slug}`)
    } else {
      collection = await prisma.collection.create({
        data: {
          title: collectionDef.title,
          slug: collectionDef.slug,
          description: collectionDef.description || null,
          isPublished: true
        }
      })
      console.log(`   ✓ Created collection: ${collectionDef.slug}`)
    }

    // Grant admins author access on collection
    for (const admin of admins) {
      await prisma.collectionAuthor.upsert({
        where: {
          collectionId_userId: {
            collectionId: collection.id,
            userId: admin.id
          }
        },
        update: { permission: 'author' },
        create: {
          collectionId: collection.id,
          userId: admin.id,
          permission: 'author'
        }
      })
    }

    // Link skripts to collection in specified order
    for (let order = 0; order < collectionDef.skripts.length; order++) {
      const skriptDir = collectionDef.skripts[order]
      const skriptId = skriptIdMap.get(skriptDir)

      if (!skriptId) {
        console.error(`      ⚠ Skript not found: ${skriptDir}`)
        continue
      }

      await prisma.collectionSkript.upsert({
        where: {
          collectionId_skriptId: {
            collectionId: collection.id,
            skriptId
          }
        },
        update: { order },
        create: {
          collectionId: collection.id,
          skriptId,
          order
        }
      })
    }

    console.log(`      Linked ${collectionDef.skripts.length} skript(s)`)
  }

  console.log('\n✅ Docs sync complete!')
  await prisma.$disconnect()
  await pool.end()
}

async function processPages(skriptPath, skriptId, primaryAdminId, admins) {
  const entries = readdirSync(skriptPath)
  const mdFiles = entries.filter(
    f => f.endsWith('.md') && !f.startsWith('_')
  )

  // Parse order from filename: 01-introduction.md -> order=1, slug=introduction
  const pageData = mdFiles.map(filename => {
    const content = readFileSync(join(skriptPath, filename), 'utf-8')
    const match = filename.match(/^(\d+)-(.+)\.md$/)

    let order
    let slug

    if (match) {
      order = parseInt(match[1], 10)
      slug = match[2]
    } else {
      order = 999
      slug = filename.replace('.md', '')
    }

    // Extract title from first h1 or frontmatter
    let title = slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

    // Check for frontmatter title
    const frontmatterMatch = content.match(/^---\n[\s\S]*?title:\s*["']?([^"'\n]+)["']?[\s\S]*?\n---/)
    if (frontmatterMatch) {
      title = frontmatterMatch[1].trim()
    } else {
      // Check for first h1
      const h1Match = content.match(/^#\s+(.+)$/m)
      if (h1Match) {
        title = h1Match[1].trim()
      }
    }

    // Strip frontmatter from content
    const bodyContent = content.replace(/^---\n[\s\S]*?\n---\n/, '')

    return { slug, title, content: bodyContent, order }
  })

  // Sort by order
  pageData.sort((a, b) => a.order - b.order)

  // Sync pages
  for (let i = 0; i < pageData.length; i++) {
    const page = pageData[i]

    let dbPage = await prisma.page.findFirst({
      where: { slug: page.slug, skriptId }
    })

    if (dbPage) {
      dbPage = await prisma.page.update({
        where: { id: dbPage.id },
        data: {
          title: page.title,
          content: page.content,
          order: i,
          isPublished: true
        }
      })
    } else {
      dbPage = await prisma.page.create({
        data: {
          title: page.title,
          slug: page.slug,
          content: page.content,
          order: i,
          isPublished: true,
          skriptId
        }
      })
    }

    // Grant admins author access on page
    for (const admin of admins) {
      await prisma.pageAuthor.upsert({
        where: {
          pageId_userId: {
            pageId: dbPage.id,
            userId: admin.id
          }
        },
        update: { permission: 'author' },
        create: {
          pageId: dbPage.id,
          userId: admin.id,
          permission: 'author'
        }
      })
    }
  }

  return pageData.length
}

async function processAttachments(skriptPath, skriptId, createdBy) {
  const attachmentsPath = join(skriptPath, 'attachments')
  if (!existsSync(attachmentsPath)) {
    return 0
  }

  const files = readdirSync(attachmentsPath).filter(f => {
    const fullPath = join(attachmentsPath, f)
    return statSync(fullPath).isFile()
  })

  let count = 0
  for (const filename of files) {
    const filePath = join(attachmentsPath, filename)
    const buffer = readFileSync(filePath)
    const hash = createHash('sha256').update(buffer).digest('hex')
    const ext = filename.split('.').pop() || 'bin'

    const contentTypeMap = {
      'png': 'image/png',
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'svg': 'image/svg+xml',
      'webp': 'image/webp',
      'gif': 'image/gif',
      'pdf': 'application/pdf',
      'excalidraw': 'application/json',
      'json': 'application/json'
    }
    const contentType = contentTypeMap[ext.toLowerCase()] || 'application/octet-stream'

    // Upsert file record (actual S3 upload would happen via import system)
    await prisma.file.upsert({
      where: {
        unique_file_name_per_parent_skript: {
          parentId: null,
          name: filename,
          skriptId
        }
      },
      update: {
        hash,
        contentType,
        size: BigInt(buffer.length)
      },
      create: {
        name: filename,
        isDirectory: false,
        skriptId,
        hash,
        contentType,
        size: BigInt(buffer.length),
        createdBy
      }
    })

    count++
  }

  return count
}

main().catch(e => {
  console.error('❌ Sync failed:', e)
  process.exit(1)
})
