#!/usr/bin/env node
/**
 * Import video metadata from .mp4.json files into the Video table.
 *
 * Usage: node scripts/import-videos.mjs [export-dir]
 * Default export-dir: ./export-output
 */

import { PrismaClient } from '@prisma/client'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Initialize Prisma with pg adapter
const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/eduskript_dev'
const pool = new Pool({ connectionString })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

async function findVideoFiles(dir) {
  const results = []

  async function walk(currentDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name)

      if (entry.isDirectory()) {
        await walk(fullPath)
      } else if (entry.name.endsWith('.mp4.json') || entry.name.endsWith('.mov.json')) {
        results.push(fullPath)
      }
    }
  }

  await walk(dir)
  return results
}

async function importVideos(exportDir) {
  console.log(`Scanning ${exportDir} for video metadata files...`)

  const videoFiles = await findVideoFiles(exportDir)
  console.log(`Found ${videoFiles.length} video metadata files`)

  let created = 0
  let skipped = 0
  let errors = 0

  for (const filePath of videoFiles) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8')
      const data = JSON.parse(content)

      // Extract filename from the JSON file path
      // e.g., "aufbau-binary-count.mp4.json" -> "aufbau-binary-count.mp4"
      const jsonFilename = path.basename(filePath)
      const videoFilename = jsonFilename.replace(/\.json$/, '')

      // Extract Mux metadata
      const playbackId = data.providerMetadata?.mux?.playbackId
      const assetId = data.providerMetadata?.mux?.assetId
      const poster = data.poster
      const blurDataURL = data.blurDataURL
      const status = data.status || 'ready'

      if (!playbackId) {
        console.log(`  Skipping ${videoFilename}: No playbackId found`)
        skipped++
        continue
      }

      // Check if video already exists
      const existing = await prisma.video.findFirst({
        where: { filename: videoFilename }
      })

      if (existing) {
        console.log(`  Skipping ${videoFilename}: Already exists`)
        skipped++
        continue
      }

      // Create video record
      await prisma.video.create({
        data: {
          filename: videoFilename,
          provider: 'mux',
          metadata: {
            playbackId,
            assetId,
            poster,
            blurDataURL,
            status
          }
        }
      })

      console.log(`  Created: ${videoFilename}`)
      created++

    } catch (err) {
      console.error(`  Error processing ${filePath}:`, err.message)
      errors++
    }
  }

  console.log('\n--- Summary ---')
  console.log(`Created: ${created}`)
  console.log(`Skipped: ${skipped}`)
  console.log(`Errors: ${errors}`)

  return { created, skipped, errors }
}

async function main() {
  const exportDir = process.argv[2] || path.join(__dirname, '..', 'export-output')

  if (!fs.existsSync(exportDir)) {
    console.error(`Export directory not found: ${exportDir}`)
    process.exit(1)
  }

  try {
    await importVideos(exportDir)
  } finally {
    await prisma.$disconnect()
    await pool.end()
  }
}

main().catch(console.error)
