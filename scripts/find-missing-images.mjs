#!/usr/bin/env node
/**
 * Find missing images in imported content.
 *
 * Scans all pages for image references and checks if they exist in the files table.
 * Outputs a list of missing images with skript and page context.
 */

import { PrismaClient } from '@prisma/client'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'

const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/eduskript_dev'
const pool = new Pool({ connectionString })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

// Image extensions to look for
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.avif']

// Extract image references from markdown content
function extractImageReferences(content) {
  const images = []

  // Match ![alt](path) syntax
  const mdImageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g
  let match
  while ((match = mdImageRegex.exec(content)) !== null) {
    const path = match[2].split(/[?#]/)[0] // Remove query params
    if (path && !path.startsWith('http') && !path.startsWith('/')) {
      images.push(path)
    }
  }

  // Match <Image src="path" /> or <img src="path" /> syntax
  const jsxImageRegex = /<(?:Image|img)[^>]*src=["']([^"']+)["'][^>]*>/gi
  while ((match = jsxImageRegex.exec(content)) !== null) {
    const path = match[1].split(/[?#]/)[0]
    if (path && !path.startsWith('http') && !path.startsWith('/')) {
      images.push(path)
    }
  }

  return images
}

// Normalize filename (strip ./attachments/ prefix)
function normalizeFilename(path) {
  return path
    .replace(/^\.\/attachments\//, '')
    .replace(/^attachments\//, '')
    .replace(/^\.\//, '')
}

async function findMissingImages() {
  console.log('Scanning for missing images...\n')

  // Get all pages with their skript info
  const pages = await prisma.page.findMany({
    select: {
      id: true,
      slug: true,
      title: true,
      content: true,
      skriptId: true,
      skript: {
        select: {
          id: true,
          slug: true,
          title: true
        }
      }
    }
  })

  // Get all files grouped by skript
  const files = await prisma.file.findMany({
    select: {
      name: true,
      skriptId: true
    }
  })

  // Build a map of skriptId -> Set of filenames
  const filesBySkript = new Map()
  for (const file of files) {
    if (!filesBySkript.has(file.skriptId)) {
      filesBySkript.set(file.skriptId, new Set())
    }
    filesBySkript.get(file.skriptId).add(file.name)
  }

  const missingImages = []

  for (const page of pages) {
    const imageRefs = extractImageReferences(page.content)
    const skriptFiles = filesBySkript.get(page.skriptId) || new Set()

    for (const imageRef of imageRefs) {
      const normalizedName = normalizeFilename(imageRef)

      // Check if it's an image file
      const isImage = IMAGE_EXTENSIONS.some(ext => normalizedName.toLowerCase().endsWith(ext))
      if (!isImage) continue

      // Check if file exists
      if (!skriptFiles.has(normalizedName)) {
        missingImages.push({
          skriptSlug: page.skript?.slug || 'unknown',
          skriptTitle: page.skript?.title || 'Unknown',
          skriptId: page.skriptId,
          pageSlug: page.slug,
          pageTitle: page.title,
          pageId: page.id,
          imageRef: imageRef,
          normalizedName: normalizedName
        })
      }
    }
  }

  // Group by skript for cleaner output
  const bySkript = new Map()
  for (const missing of missingImages) {
    const key = missing.skriptSlug
    if (!bySkript.has(key)) {
      bySkript.set(key, { skript: missing, images: [] })
    }
    bySkript.get(key).images.push(missing)
  }

  console.log(`Found ${missingImages.length} missing images in ${bySkript.size} skripts:\n`)

  for (const [skriptSlug, data] of bySkript) {
    console.log(`\n=== ${data.skript.skriptTitle} (${skriptSlug}) ===`)
    console.log(`Skript ID: ${data.skript.skriptId}`)

    for (const img of data.images) {
      console.log(`  Page: ${img.pageSlug}`)
      console.log(`    Missing: ${img.normalizedName}`)
      console.log(`    Original ref: ${img.imageRef}`)
      console.log(`    Page ID: ${img.pageId}`)
    }
  }

  // Output summary for easy searching
  console.log('\n\n=== SUMMARY: Files to find ===')
  const uniqueFiles = [...new Set(missingImages.map(m => m.normalizedName))]
  for (const file of uniqueFiles) {
    console.log(file)
  }

  return missingImages
}

async function main() {
  try {
    await findMissingImages()
  } finally {
    await prisma.$disconnect()
    await pool.end()
  }
}

main().catch(console.error)
