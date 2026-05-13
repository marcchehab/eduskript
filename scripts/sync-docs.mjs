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

/**
 * Recursively hash all files in a directory to produce a single content fingerprint.
 * Used to skip sync when docs haven't changed since last run.
 */
function hashDirectory(dir) {
  const hash = createHash('sha256')
  const entries = readdirSync(dir).sort()
  for (const entry of entries) {
    const fullPath = join(dir, entry)
    const stat = statSync(fullPath)
    if (stat.isDirectory()) {
      hash.update(hashDirectory(fullPath))
    } else {
      hash.update(entry)
      hash.update(readFileSync(fullPath))
    }
  }
  return hash.digest('hex')
}

async function main() {
  console.log('📚 Starting docs sync...')
  console.log(`   Source: ${DOCS_DIR}`)

  if (!existsSync(DOCS_DIR)) {
    console.log('   No docs/ directory found, skipping sync.')
    return
  }

  // Compute content hash of entire docs/ directory
  const currentHash = hashDirectory(DOCS_DIR)

  // Check if docs have changed since last sync (stored in DB via raw SQL)
  // Uses a single-row convention: key = 'docs_sync_hash' in a raw query
  // against an existing table would require a migration, so we use a
  // lightweight approach: store the hash on the first admin's bio field...
  // Actually, just use raw SQL to check if a table exists and create it if not.
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "_sync_metadata" (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `)
    const rows = await prisma.$queryRawUnsafe(
      `SELECT value FROM "_sync_metadata" WHERE key = 'docs_content_hash'`
    )
    if (Array.isArray(rows) && rows.length > 0 && rows[0].value === currentHash) {
      console.log('   Docs unchanged since last sync, skipping.')
      await prisma.$disconnect()
      await pool.end()
      return
    }
  } catch {
    // Table doesn't exist or query failed — proceed with sync
  }

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

  // Docs sync needs a single owning Site. Collections are 1:1-owned by a
  // Site now (CollectionAuthor is gone). Prefer the default org's Site so
  // the docs render at eduskript.org/c/<skript>/<page>; fall back to the
  // first admin's Site for self-hosted instances without an org.
  const defaultOrgSlug = process.env.DEFAULT_ORG_SLUG || 'eduskript'
  let ownerSite = await prisma.site.findFirst({
    where: { slug: defaultOrgSlug, organizationId: { not: null } },
    select: { id: true },
  })
  if (!ownerSite) {
    ownerSite = await prisma.site.findUnique({
      where: { userId: primaryAdminId },
      select: { id: true },
    })
  }
  if (!ownerSite) {
    console.error(`❌ No suitable Site to own the docs collection (default org "${defaultOrgSlug}" missing AND admin ${primaryAdminId} has no Site).`)
    process.exit(1)
  }
  const adminSite = ownerSite

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
    // Find or create collection. Collections are 1:1-owned by a Site now
    // (no slug, no description, no CollectionAuthor); look up by
    // (title, siteId) which is unique-enough for this admin-owned namespace.
    let collection = await prisma.collection.findFirst({
      where: { title: collectionDef.title, siteId: adminSite.id }
    })

    if (collection) {
      collection = await prisma.collection.update({
        where: { id: collection.id },
        data: { title: collectionDef.title }
      })
      console.log(`   ✓ Updated collection: ${collectionDef.title}`)
    } else {
      collection = await prisma.collection.create({
        data: {
          title: collectionDef.title,
          siteId: adminSite.id,
        }
      })
      console.log(`   ✓ Created collection: ${collectionDef.title}`)
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

  // Store content hash so next startup skips sync if unchanged
  try {
    await prisma.$executeRawUnsafe(`
      INSERT INTO "_sync_metadata" (key, value) VALUES ('docs_content_hash', '${currentHash}')
      ON CONFLICT (key) DO UPDATE SET value = '${currentHash}'
    `)
  } catch {
    // Non-fatal: sync succeeded even if hash storage fails
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
