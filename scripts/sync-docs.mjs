/**
 * Sync documentation from docs/ folder into the database.
 *
 * Run: node scripts/sync-docs.mjs
 *
 * Structure expected:
 *   docs/
 *   ├── _collections.json      # Defines collections and which skripts belong to each
 *   ├── getting-started/       # Directory = skript (slug = directory basename)
 *   │   ├── _skript.json       # {"title": "...", "description": "...", "copyFilesFrom": "<slug>"}
 *   │   ├── 01-introduction.md # Order-slug.md = page
 *   │   └── attachments/       # Files used in markdown
 *   │       └── image.png
 *   └── de/                    # Nested dirs are fine: "de/komponenten" → slug "komponenten"
 *       └── komponenten/
 *
 * _collections.json format:
 *   {
 *     "collections": [
 *       {
 *         "title": "Full Documentation",
 *         "site": "en",                  // optional: Site.slug that owns the collection.
 *                                        // Omitted → the default org's site (eduskript.org/c/…).
 *                                        // A named site that does not exist is skipped with a
 *                                        // warning (dev DBs usually lack it), never created here.
 *         "skripts": ["getting-started", "architecture", "contributing"]
 *       },
 *       {
 *         "title": "Quick Start",
 *         "skripts": ["getting-started"]  // Same skript can be in multiple collections
 *       }
 *     ]
 *   }
 *
 * Skript lookup is by slug GLOBALLY (Skript.slug is not unique per site), so a
 * translated skript needs its own slug (components → komponenten).
 *
 * `copyFilesFrom` in _skript.json copies the top-level File rows of another
 * skript (by name, only names not yet present) into this skript. S3 storage is
 * content-addressed by sha256, so no bytes move — the translation reuses the
 * original's images/databases. Nested directories are not copied.
 *
 * Each synced collection is also appended to its site's PageLayout (sidebar);
 * without that item the collection exists but is invisible on the public page.
 *
 * All users with isAdmin: true get author permission on all synced content.
 * Git is the source of truth - DB content is overwritten on each sync.
 * Pages are never deleted: a page removed from docs/ stays live until deleted
 * by hand (see docs-sync-slug-drift note in the repo history).
 */

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'
import { readFileSync, readdirSync, statSync, existsSync } from 'fs'
import { join, basename } from 'path'
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

  // Collections are 1:1-owned by a Site (CollectionAuthor is gone). Default
  // owner is the default org's Site so the docs render at
  // eduskript.org/c/<skript>/<page>; fall back to the first admin's Site for
  // self-hosted instances without an org. A collection may name another
  // site via `site` (e.g. "en" for the English manual at eduskript.org/en/…).
  const defaultOrgSlug = process.env.DEFAULT_ORG_SLUG || 'eduskript'
  let defaultSite = await prisma.site.findFirst({
    where: { slug: defaultOrgSlug, organizationId: { not: null } },
    select: { id: true, slug: true },
  })
  if (!defaultSite) {
    defaultSite = await prisma.site.findFirst({
      where: { userId: primaryAdminId },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, slug: true },
    })
  }
  if (!defaultSite) {
    console.error(`❌ No suitable Site to own the docs collection (default org "${defaultOrgSlug}" missing AND admin ${primaryAdminId} has no Site).`)
    process.exit(1)
  }

  const siteCache = new Map()
  async function resolveCollectionSite(collectionDef) {
    if (!collectionDef.site) return defaultSite
    if (!siteCache.has(collectionDef.site)) {
      siteCache.set(collectionDef.site, await prisma.site.findUnique({
        where: { slug: collectionDef.site },
        select: { id: true, slug: true },
      }))
    }
    return siteCache.get(collectionDef.site)
  }

  // 3. Collect all unique skript directories referenced, remembering the
  // site of the first collection that names each one. Skript lookup below is
  // scoped to that site: Skript.slug is NOT globally unique, and a teacher's
  // own skript with the same slug (e.g. "komponenten" on informatikgarten)
  // must never be picked up and overwritten by the docs sync.
  const allSkriptDirs = new Set()
  const skriptSiteIds = new Map()
  for (const collectionDef of config.collections) {
    const site = await resolveCollectionSite(collectionDef)
    for (const skriptDir of collectionDef.skripts) {
      allSkriptDirs.add(skriptDir)
      if (!skriptSiteIds.has(skriptDir) && site) skriptSiteIds.set(skriptDir, site.id)
    }
  }

  // 4. Process all skripts first (create/update them)
  const skriptIdMap = new Map()

  console.log(`\n   Processing ${allSkriptDirs.size} skript(s)...`)
  const pendingFileCopies = []

  for (const skriptDir of allSkriptDirs) {
    const skriptPath = join(DOCS_DIR, skriptDir)
    const skriptSlug = basename(skriptDir)

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
        title: skriptSlug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
      }
    }

    // Find or create skript — only among skripts linked to a collection on
    // the target site or on the default site (where it lived before a
    // re-home). A same-slug skript anywhere else is a different skript.
    const candidateSiteIds = [...new Set([skriptSiteIds.get(skriptDir), defaultSite.id].filter(Boolean))]
    let skript = await prisma.skript.findFirst({
      where: {
        slug: skriptSlug,
        collectionSkripts: { some: { collection: { siteId: { in: candidateSiteIds } } } },
      }
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
          slug: skriptSlug,
          description: skriptMeta.description || null,
          isPublished: true
        }
      })
      console.log(`   ✓ Created skript: ${skriptDir}`)
    }

    if (skriptMeta.copyFilesFrom) pendingFileCopies.push({ skriptDir, from: skriptMeta.copyFilesFrom, to: skript.id })

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

  // 4b. copyFilesFrom — second pass, so the source can be any skript of this
  // sync regardless of config order. Source must be a synced skript (by its
  // directory basename); anything else is refused rather than guessed.
  for (const { skriptDir, from, to } of pendingFileCopies) {
    const sourceEntry = [...skriptIdMap.entries()].find(([dir]) => basename(dir) === from)
    if (!sourceEntry) {
      console.warn(`   ⚠ ${skriptDir}: copyFilesFrom "${from}" is not a synced skript — skipped`)
      continue
    }
    const copied = await copyFilesFrom(sourceEntry[1], to)
    if (copied > 0) console.log(`   ✓ ${skriptDir}: ${copied} file(s) copied from ${from}`)
  }

  // 5. Process collections and link skripts
  console.log(`\n   Processing ${config.collections.length} collection(s)...`)
  let skippedCollections = 0

  for (const collectionDef of config.collections) {
    const site = await resolveCollectionSite(collectionDef)
    if (!site) {
      console.warn(`   ⚠ Site "${collectionDef.site}" not found — skipping collection "${collectionDef.title}" (create the site in Admin first)`)
      skippedCollections++
      continue
    }

    // Find or create collection. Collections are 1:1-owned by a Site now
    // (no slug, no description, no CollectionAuthor); look up by
    // (title, siteId) which is unique-enough for this admin-owned namespace.
    let collection = await prisma.collection.findFirst({
      where: { title: collectionDef.title, siteId: site.id }
    })

    // Re-home: the config names a site, but the collection still lives on the
    // default site (it was synced there before `site` existed). Move it —
    // and its sidebar entry — instead of creating a duplicate. One-way
    // (default → named site); moving back is a manual DB edit.
    if (!collection && site.id !== defaultSite.id) {
      const onDefault = await prisma.collection.findFirst({
        where: { title: collectionDef.title, siteId: defaultSite.id },
        select: { id: true },
      })
      if (onDefault) {
        collection = await prisma.collection.update({
          where: { id: onDefault.id },
          data: { siteId: site.id },
        })
        await prisma.pageLayoutItem.deleteMany({
          where: { type: 'collection', contentId: onDefault.id, pageLayout: { siteId: defaultSite.id } },
        })
        console.log(`   ✓ Moved collection: ${collectionDef.title} (/${defaultSite.slug} → /${site.slug})`)
      }
    }

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
          siteId: site.id,
        }
      })
      console.log(`   ✓ Created collection: ${collectionDef.title} (site /${site.slug})`)
    }

    await ensureLayoutItem(site.id, collection.id)

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

  // Store content hash so next startup skips sync if unchanged. Not stored
  // when a collection was skipped for a missing site: the next start must
  // retry, otherwise creating the site later would never pick the docs up.
  if (skippedCollections > 0) {
    console.warn(`\n⚠ ${skippedCollections} collection(s) skipped — hash not stored, sync reruns on next start.`)
  } else try {
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

/**
 * Same contract as ensurePageLayoutItem in src/lib/page-layout.ts (not
 * importable here: that module pulls in next/cache). Idempotent; appends.
 */
async function ensureLayoutItem(siteId, collectionId) {
  const layout = await prisma.pageLayout.upsert({
    where: { siteId },
    update: {},
    create: { siteId },
    include: { items: { select: { contentId: true, type: true, order: true } } },
  })
  if (layout.items.some(i => i.contentId === collectionId && i.type === 'collection')) return
  const maxOrder = layout.items.reduce((m, i) => Math.max(m, i.order), -1)
  await prisma.pageLayoutItem.create({
    data: { pageLayoutId: layout.id, type: 'collection', contentId: collectionId, order: maxOrder + 1 },
  })
}

/**
 * Copy top-level, non-directory File rows from `sourceSkriptId` into
 * `targetSkriptId`, skipping names that already exist there. No S3 traffic:
 * objects are keyed by content hash, so a duplicate row with the same hash
 * resolves to the same object (see docs/internals/03-file-storage.md).
 * A file re-uploaded on the source later is NOT re-copied (name already exists).
 */
async function copyFilesFrom(sourceSkriptId, targetSkriptId) {
  const [sourceFiles, existing] = await Promise.all([
    prisma.file.findMany({ where: { skriptId: sourceSkriptId, parentId: null, isDirectory: false } }),
    prisma.file.findMany({ where: { skriptId: targetSkriptId, parentId: null }, select: { name: true } }),
  ])
  const have = new Set(existing.map(f => f.name))
  let count = 0
  for (const f of sourceFiles) {
    if (have.has(f.name)) continue
    await prisma.file.create({
      data: {
        name: f.name,
        isDirectory: false,
        skriptId: targetSkriptId,
        hash: f.hash,
        contentType: f.contentType,
        size: f.size,
        width: f.width,
        height: f.height,
        createdBy: f.createdBy,
      },
    })
    count++
  }
  return count
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
