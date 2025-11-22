#!/usr/bin/env node
/**
 * Migrate old Informatikgarten content to new Eduskript system
 *
 * This script migrates content from the old Obsidian-based structure to Eduskript.
 * It handles:
 * - Collection and Skript creation
 * - Page creation with order preservation
 * - Markdown transformation (wiki-links, callouts, etc.)
 * - Asset upload (images, Excalidraw diagrams)
 * - Video filename preservation for later upload
 *
 * Usage:
 *   node scripts/migrate-content.mjs <topic-directory> [--dry-run]
 *
 * Example:
 *   node scripts/migrate-content.mjs code --dry-run
 *   node scripts/migrate-content.mjs code
 */

import { readFileSync, readdirSync, existsSync, writeFileSync, statSync } from 'fs'
import { mkdir } from 'fs/promises'
import { join, dirname, basename, extname } from 'path'
import { fileURLToPath } from 'url'
import { createHash } from 'crypto'
import dotenv from 'dotenv'
import pg from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'

// Load environment variables
dotenv.config({ path: '.env.local' })
dotenv.config()

const __dirname = dirname(fileURLToPath(import.meta.url))
const oldContentDir = join(__dirname, '..', 'oldstuff', 'informatikgarten.ch', 'sites', 'ig', 'ig_content')
const uploadDir = process.env.UPLOAD_DIR || join(__dirname, '..', 'uploads')

// Parse arguments
const topicDir = process.argv[2]
const dryRun = process.argv.includes('--dry-run')

if (!topicDir) {
  console.error('❌ Error: Topic directory is required')
  console.error('\nUsage: node scripts/migrate-content.mjs <topic-directory> [--dry-run]')
  console.error('\nExample: node scripts/migrate-content.mjs code --dry-run')
  process.exit(1)
}

// Setup Prisma
const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error('❌ Error: DATABASE_URL environment variable is not set')
  process.exit(1)
}

const pool = new pg.Pool({ connectionString })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

// Collection mapping from _meta.tsx
const COLLECTION_MAP = {
  'adder': { collection: 'Grundjahr', title: 'Building an Adder' },
  'aufbau': { collection: 'Grundjahr', title: 'Computer & OS' },
  'code': { collection: 'Grundjahr', title: 'Programmieren 1' },
  'data': { collection: 'Grundjahr', title: 'Daten & Information' },
  'code2': { collection: 'Grundjahr', title: 'Programmieren 2' },
  'net': { collection: 'Grundjahr', title: 'Netzwerke & Internet' },
  'blender': { collection: 'Weitere Inhalte', title: 'Blender & VFX' },
  'crypto': { collection: 'Weitere Inhalte', title: 'Kryptologie' },
  'microbit': { collection: 'Weitere Inhalte', title: 'Robotik' },
  'didactics': { collection: 'Weitere Inhalte', title: 'Didaktik' },
  'sql': { collection: 'Weitere Inhalte', title: 'Datenbanken' },
  'turtleinvaders': { collection: 'Weitere Inhalte', title: 'Turtle Invaders' },
  'webdev': { collection: 'Weitere Inhalte', title: 'Web-Entwicklung' },
  'IKT': { collection: 'Weitere Inhalte', title: 'ICT' },
  'population': { collection: 'Weitere Inhalte', title: 'Populationsdynamik' }
}

/**
 * Calculate SHA256 hash of a buffer
 */
function calculateHash(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

/**
 * Parse YAML frontmatter from markdown
 */
function parseFrontmatter(content) {
  const frontmatterRegex = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/
  const match = content.match(frontmatterRegex)

  if (!match) {
    return { frontmatter: {}, content }
  }

  const [, frontmatterStr, bodyContent] = match
  const frontmatter = {}

  // Simple YAML parser for title
  frontmatterStr.split('\n').forEach(line => {
    const [key, ...valueParts] = line.split(':')
    if (key && valueParts.length > 0) {
      frontmatter[key.trim()] = valueParts.join(':').trim()
    }
  })

  return { frontmatter, content: bodyContent }
}

/**
 * Transform Obsidian callouts - preserve original syntax
 * The remark plugin will handle the transformation
 */
function transformCallouts(content) {
  // Keep callouts as-is with > [!type] syntax
  // The remarkCallouts plugin will process them during markdown rendering
  return content
}

/**
 * Transform wiki-links to proper references
 * Returns {transformedContent, referencedAssets}
 */
function transformWikiLinks(content, topicDir, attachmentsDir, globalAttachmentsDir) {
  const referencedAssets = new Set()

  // Transform image/video embeds: ![[filename]]
  let transformed = content.replace(/!\[\[([^\]]+?)\]\]/g, (match, filename) => {
    // Check if it's a reference (no extension or .excalidraw)
    if (!filename.includes('.') || filename.endsWith('.excalidraw')) {
      // Excalidraw diagrams - keep the reference with empty alt text
      referencedAssets.add(filename)
      return `![](${filename})`
    }

    // Find the actual file
    const possiblePaths = [
      join(attachmentsDir, filename),
      join(globalAttachmentsDir, filename),
      join(globalAttachmentsDir, '..', 'videos', filename)
    ]

    const actualPath = possiblePaths.find(p => existsSync(p))
    if (actualPath) {
      referencedAssets.add(filename)
      // For videos, preserve the filename; for images, mark for upload
      if (filename.match(/\.(mp4|webm|mov)$/i)) {
        return `![${filename}](VIDEO:${filename})`
      } else {
        return `![${filename}](UPLOAD:${filename})`
      }
    }

    return match // Keep as-is if not found
  })

  // Transform internal links: [[page-name|link text]] or [[page-name]]
  transformed = transformed.replace(/\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g, (match, target, linkText) => {
    const displayText = linkText || target
    // For now, keep as regular markdown link - will need to resolve later
    return `[${displayText}](${target})`
  })

  // Transform inline code with language hints: `code{:python}` → `code`
  transformed = transformed.replace(/`([^`]+?)\{:(\w+)\}`/g, '`$1`')

  return { transformedContent: transformed, referencedAssets: Array.from(referencedAssets) }
}

/**
 * Transform code block languages
 */
function transformCodeBlocks(content) {
  // Transform turtle → python editor for interactive turtle graphics
  return content.replace(/```turtle\n/g, '```python editor\n')
}

/**
 * Save physical file to upload directory
 */
async function savePhysicalFile(buffer, filename) {
  const hash = calculateHash(buffer)
  const extension = extname(filename).slice(1) || 'bin'
  const physicalFilename = `${hash}.${extension}`
  const physicalPath = join(uploadDir, physicalFilename)

  if (!existsSync(physicalPath)) {
    writeFileSync(physicalPath, buffer)
    console.log(`    💾 Saved: ${physicalFilename}`)
  } else {
    console.log(`    ♻️  Exists: ${physicalFilename}`)
  }

  return { hash, physicalFilename }
}

/**
 * Upload asset and create file record
 */
async function uploadAsset(assetPath, filename, skriptId, userId) {
  const buffer = readFileSync(assetPath)
  const size = BigInt(buffer.length)
  const { hash } = await savePhysicalFile(buffer, filename)

  // Determine content type
  const ext = extname(filename).toLowerCase()
  const contentTypeMap = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.pdf': 'application/pdf',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm'
  }
  const contentType = contentTypeMap[ext] || 'application/octet-stream'

  const fileRecord = await prisma.file.create({
    data: {
      name: filename,
      isDirectory: false,
      skriptId: skriptId,
      hash: hash,
      contentType: contentType,
      size: size,
      createdBy: userId,
      parentId: null
    }
  })

  return fileRecord
}

/**
 * Find and upload all referenced assets
 */
async function processAssets(referencedAssets, attachmentsDir, globalAttachmentsDir, skriptId, userId, dryRun) {
  const assetMap = {} // filename → file URL

  for (const filename of referencedAssets) {
    // Skip Excalidraw references without extension
    if (!filename.includes('.') || filename.endsWith('.excalidraw')) {
      // Find light and dark SVG versions
      const baseName = filename.replace(/\.excalidraw$/, '')
      const lightFile = `${baseName}.excalidraw.light.svg`
      const darkFile = `${baseName}.excalidraw.dark.svg`

      for (const svgFile of [lightFile, darkFile]) {
        const possiblePaths = [
          join(attachmentsDir, svgFile),
          join(globalAttachmentsDir, svgFile)
        ]

        const actualPath = possiblePaths.find(p => existsSync(p))
        if (actualPath) {
          console.log(`    📊 Found Excalidraw: ${svgFile}`)
          if (!dryRun) {
            // Upload the SVG files but don't add to assetMap
            // The markdown processor will handle theme-aware rendering
            await uploadAsset(actualPath, svgFile, skriptId, userId)
          }
        }
      }

      // Keep the Excalidraw reference as-is (just the base name)
      // The markdown processor will find the appropriate light/dark SVG
      assetMap[filename] = filename.replace(/\.excalidraw$/, '.excalidraw')
      continue
    }

    // Find regular asset file
    const possiblePaths = [
      join(attachmentsDir, filename),
      join(globalAttachmentsDir, filename),
      join(globalAttachmentsDir, '..', 'videos', filename)
    ]

    const actualPath = possiblePaths.find(p => existsSync(p))
    if (!actualPath) {
      console.log(`    ⚠️  Not found: ${filename}`)
      continue
    }

    // Skip videos (preserve filename for later)
    if (filename.match(/\.(mp4|webm|mov)$/i)) {
      console.log(`    📹 Video (skipped): ${filename}`)
      assetMap[filename] = `VIDEO:${filename}`
      continue
    }

    console.log(`    📎 Uploading: ${filename}`)
    if (!dryRun) {
      const fileRecord = await uploadAsset(actualPath, filename, skriptId, userId)
      assetMap[filename] = `/api/files/${fileRecord.id}`
    }
  }

  return assetMap
}

/**
 * Replace asset references in markdown with actual URLs
 */
function replaceAssetReferences(content, assetMap) {
  let result = content

  for (const [filename, url] of Object.entries(assetMap)) {
    // Replace UPLOAD:filename with actual URL
    result = result.replace(new RegExp(`\\(UPLOAD:${filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`, 'g'), `(${url})`)
    // Replace plain filename references
    result = result.replace(new RegExp(`\\(${filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`, 'g'), `(${url})`)
  }

  return result
}

/**
 * Get or create collection
 */
async function getOrCreateCollection(collectionName, userId, dryRun) {
  if (dryRun) {
    console.log(`  📁 Would create/find collection: ${collectionName}`)
    return { id: 'dry-run-collection-id', title: collectionName }
  }

  // Find existing collection
  let collection = await prisma.collection.findFirst({
    where: {
      title: collectionName,
      authors: {
        some: { userId }
      }
    }
  })

  if (!collection) {
    // Create new collection
    const slug = collectionName.toLowerCase().replace(/[^a-z0-9]+/g, '-')
    collection = await prisma.collection.create({
      data: {
        title: collectionName,
        description: `Migrated from old Informatikgarten content`,
        slug: slug,
        isPublished: false,
        authors: {
          create: {
            userId: userId,
            permission: 'author'
          }
        }
      }
    })
    console.log(`  ✅ Created collection: ${collection.title}`)
  } else {
    console.log(`  ✅ Found existing collection: ${collection.title}`)
  }

  return collection
}

/**
 * Create skript
 */
async function createSkript(title, description, collectionId, userId, dryRun) {
  if (dryRun) {
    console.log(`  📚 Would create skript: ${title}`)
    return { id: 'dry-run-skript-id', title, slug: title.toLowerCase().replace(/[^a-z0-9]+/g, '-') }
  }

  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-')

  const skript = await prisma.skript.create({
    data: {
      title,
      description,
      slug,
      isPublished: false,
      authors: {
        create: {
          userId: userId,
          permission: 'author'
        }
      },
      collectionSkripts: {
        create: {
          collectionId: collectionId,
          order: 0
        }
      }
    }
  })

  console.log(`  ✅ Created skript: ${skript.title} (${skript.slug})`)
  return skript
}

/**
 * Create page
 */
async function createPage(title, content, order, skriptId, userId, dryRun) {
  if (dryRun) {
    console.log(`    📄 Would create page ${order}: ${title}`)
    return { id: 'dry-run-page-id', title }
  }

  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-')

  const page = await prisma.page.create({
    data: {
      title,
      content,
      slug,
      order,
      isPublished: false,
      skriptId: skriptId,
      authors: {
        create: {
          userId: userId,
          permission: 'author'
        }
      }
    }
  })

  // Create initial version
  await prisma.pageVersion.create({
    data: {
      pageId: page.id,
      content: content,
      version: 1,
      authorId: userId,
      changeLog: 'Initial migration'
    }
  })

  console.log(`    ✅ Created page ${order}: ${page.title}`)
  return page
}

/**
 * Main migration function
 */
async function main() {
  console.log('🚀 Starting content migration...\n')

  if (dryRun) {
    console.log('🔍 DRY RUN MODE - No changes will be made\n')
  }

  // Verify topic directory exists
  const topicPath = join(oldContentDir, topicDir)
  if (!existsSync(topicPath)) {
    console.error(`❌ Error: Topic directory not found: ${topicPath}`)
    process.exit(1)
  }

  // Get topic metadata
  const topicMeta = COLLECTION_MAP[topicDir]
  if (!topicMeta) {
    console.error(`❌ Error: Topic "${topicDir}" not found in collection map`)
    console.error('Available topics:', Object.keys(COLLECTION_MAP).join(', '))
    process.exit(1)
  }

  console.log(`📖 Topic: ${topicMeta.title}`)
  console.log(`📁 Collection: ${topicMeta.collection}\n`)

  // Get current user (first user in database for now)
  const user = await prisma.user.findFirst()
  if (!user) {
    console.error('❌ Error: No users found in database. Please create a user first.')
    await prisma.$disconnect()
    await pool.end()
    process.exit(1)
  }

  console.log(`👤 User: ${user.name || user.email}\n`)

  // Create upload directory if needed
  if (!dryRun && !existsSync(uploadDir)) {
    await mkdir(uploadDir, { recursive: true })
    console.log(`📁 Created upload directory: ${uploadDir}\n`)
  }

  // Get or create collection
  const collection = await getOrCreateCollection(topicMeta.collection, user.id, dryRun)

  // Create skript
  const skript = await createSkript(
    topicMeta.title,
    `Migrated from ${topicDir}`,
    collection.id,
    user.id,
    dryRun
  )

  // Find all markdown files
  const files = readdirSync(topicPath)
    .filter(f => f.endsWith('.md') && !f.startsWith('_'))
    .sort((a, b) => {
      // Extract number prefix for sorting
      const numA = parseInt(a.match(/^(\d+)/)?.[1] || '999')
      const numB = parseInt(b.match(/^(\d+)/)?.[1] || '999')
      return numA - numB
    })

  console.log(`\n📝 Found ${files.length} pages to migrate\n`)

  const attachmentsDir = join(topicPath, 'attachments')
  const globalAttachmentsDir = join(oldContentDir, 'attachments')

  // Process each page
  for (let i = 0; i < files.length; i++) {
    const filename = files[i]
    const filepath = join(topicPath, filename)

    console.log(`\n[${i + 1}/${files.length}] Processing: ${filename}`)

    // Read and parse markdown
    const rawContent = readFileSync(filepath, 'utf-8')
    const { frontmatter, content } = parseFrontmatter(rawContent)

    const title = frontmatter.title || filename.replace(/^\d+-/, '').replace('.md', '')
    console.log(`  📌 Title: ${title}`)

    // Transform markdown
    let transformedContent = content
    transformedContent = transformCallouts(transformedContent)
    const { transformedContent: contentWithLinks, referencedAssets } = transformWikiLinks(
      transformedContent,
      topicDir,
      attachmentsDir,
      globalAttachmentsDir
    )
    transformedContent = contentWithLinks
    transformedContent = transformCodeBlocks(transformedContent)

    if (referencedAssets.length > 0) {
      console.log(`  📎 Referenced assets: ${referencedAssets.length}`)

      // Process assets
      const assetMap = await processAssets(
        referencedAssets,
        attachmentsDir,
        globalAttachmentsDir,
        skript.id,
        user.id,
        dryRun
      )

      // Replace asset references
      transformedContent = replaceAssetReferences(transformedContent, assetMap)
    }

    // Create page
    await createPage(title, transformedContent, i, skript.id, user.id, dryRun)
  }

  console.log(`\n\n✨ Migration complete!`)
  console.log(`   Collection: ${collection.title}`)
  console.log(`   Skript: ${skript.title}`)
  console.log(`   Pages: ${files.length}`)

  if (!dryRun) {
    console.log(`\n📝 Next steps:`)
    console.log(`   1. Start dev server: pnpm dev`)
    console.log(`   2. View migrated content at: http://localhost:3000/dashboard/collections/${collection.id}`)
    console.log(`   3. Review and adjust content as needed`)
    console.log(`   4. Upload videos later by matching preserved filenames`)
  }

  await prisma.$disconnect()
  await pool.end()
}

main().catch((error) => {
  console.error('💥 Migration failed:', error)
  process.exit(1)
})
