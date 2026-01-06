/**
 * Migration script to populate the Video table from .mp4.json files stored in SkriptFiles.
 *
 * Usage:
 *   DATABASE_URL="..." npx tsx scripts/migrate-video-metadata-from-db.ts --dry-run
 *   DATABASE_URL="..." npx tsx scripts/migrate-video-metadata-from-db.ts
 *
 * This script:
 * 1. Finds all .mp4.json files in the File table
 * 2. Fetches their content from S3 (via the file API or direct S3)
 * 3. Creates Video records in the database with Mux metadata
 * 4. After running this, run cleanup-video-json-files.ts to remove the .mp4.json files
 */

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'
import dotenv from 'dotenv'
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'

// Load environment variables
dotenv.config({ path: '.env.local' })
dotenv.config()

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error('DATABASE_URL not set')
  process.exit(1)
}

const isLocal = connectionString.includes('localhost') || connectionString.includes('127.0.0.1')
const pool = new pg.Pool({
  connectionString,
  ssl: isLocal ? false : { rejectUnauthorized: false },
})
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

// S3 client for Scaleway
const s3Client = new S3Client({
  region: 'fr-par',
  endpoint: 'https://s3.fr-par.scw.cloud',
  credentials: {
    accessKeyId: process.env.SCW_ACCESS_KEY || '',
    secretAccessKey: process.env.SCW_SECRET_KEY || '',
  },
})

const BUCKET = process.env.SCW_TEACHER_BUCKET || 'eduskript-teacher-files'

interface MuxMetadata {
  status: string
  originalFilePath?: string
  provider: string
  providerMetadata: {
    mux: {
      uploadId: string
      assetId: string
      playbackId: string
    }
  }
  createdAt: number
  updatedAt: number
  size: number
  sources: Array<{ src: string; type: string }>
  poster?: string
  blurDataURL?: string
}

async function fetchFileContent(hash: string): Promise<string | null> {
  // Try with .json extension first (how mp4.json files are stored)
  const keysToTry = [
    `files/${hash}.json`,
    `files/${hash}`,
  ]

  for (const key of keysToTry) {
    try {
      const response = await s3Client.send(new GetObjectCommand({
        Bucket: BUCKET,
        Key: key,
      }))

      if (!response.Body) continue
      return await response.Body.transformToString('utf-8')
    } catch {
      // Try next key
    }
  }

  console.error(`  Failed to fetch from S3 (tried ${keysToTry.length} keys)`)
  return null
}

async function migrateVideoMetadata(dryRun: boolean = false) {
  console.log('Video Metadata Migration (from Database)')
  console.log('=========================================')
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`)
  console.log(`Database: ${connectionString?.replace(/:[^:@]+@/, ':***@')}`)
  console.log('')

  // Find all .mp4.json files in the database
  const jsonFiles = await prisma.file.findMany({
    where: { name: { endsWith: '.mp4.json' } },
    select: { id: true, name: true, hash: true, skriptId: true }
  })

  console.log(`Found ${jsonFiles.length} .mp4.json files in database`)
  console.log('')

  let created = 0
  let skipped = 0
  let errors = 0

  for (const file of jsonFiles) {
    // The video filename is the .mp4.json name without .json
    // e.g., "video.mp4.json" -> "video.mp4"
    const videoFilename = file.name.replace('.json', '')

    try {
      // Fetch content from S3
      if (!file.hash) {
        console.log(`  SKIP: ${file.name} - no hash (file not in S3)`)
        skipped++
        continue
      }

      const content = await fetchFileContent(file.hash)
      if (!content) {
        console.log(`  SKIP: ${file.name} - could not fetch content`)
        skipped++
        continue
      }

      let metadata: MuxMetadata
      try {
        metadata = JSON.parse(content)
      } catch {
        console.log(`  SKIP: ${file.name} - invalid JSON`)
        skipped++
        continue
      }

      // Extract Mux-specific data
      const muxData = {
        playbackId: metadata.providerMetadata?.mux?.playbackId,
        assetId: metadata.providerMetadata?.mux?.assetId,
        uploadId: metadata.providerMetadata?.mux?.uploadId,
        poster: metadata.poster,
        blurDataURL: metadata.blurDataURL,
        status: metadata.status,
        size: metadata.size,
      }

      if (!muxData.playbackId) {
        console.log(`  SKIP: ${file.name} - no playbackId in metadata`)
        skipped++
        continue
      }

      if (dryRun) {
        console.log(`  [DRY] Would create Video: ${videoFilename}`)
        console.log(`        playbackId: ${muxData.playbackId}`)
        console.log(`        skriptId: ${file.skriptId}`)
        created++
      } else {
        // Check if video already exists
        const existing = await prisma.video.findUnique({
          where: { filename_provider: { filename: videoFilename, provider: 'mux' } }
        })

        if (existing) {
          console.log(`  SKIP: ${videoFilename} - Video record already exists`)
          skipped++
          continue
        }

        // Create the video record
        await prisma.video.create({
          data: {
            filename: videoFilename,
            provider: 'mux',
            metadata: muxData,
          }
        })

        console.log(`  CREATE: ${videoFilename} (playbackId: ${muxData.playbackId})`)
        created++
      }
    } catch (error) {
      console.error(`  ERROR: ${file.name} - ${error}`)
      errors++
    }
  }

  console.log('')
  console.log('Summary')
  console.log('-------')
  console.log(`Created: ${created}`)
  console.log(`Skipped: ${skipped}`)
  console.log(`Errors:  ${errors}`)

  if (!dryRun && created > 0) {
    console.log('')
    console.log('Next step: Run cleanup-video-json-files.ts to remove the .mp4.json files')
  }

  await prisma.$disconnect()
  await pool.end()
}

// Parse arguments
const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')

migrateVideoMetadata(dryRun).catch(console.error)
