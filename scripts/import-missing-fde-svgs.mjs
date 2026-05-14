#!/usr/bin/env node
/**
 * Import missing fde-demo excalidraw SVG files from subdirectory
 */

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import { readFileSync, existsSync, readdirSync } from 'fs'
import { createHash } from 'crypto'
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import { join, basename } from 'path'
import dotenv from 'dotenv'

dotenv.config()

const isLocal = process.env.DATABASE_URL?.includes('localhost')
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false },
})
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

// S3 config
const s3Client = new S3Client({
  region: process.env.SCW_REGION || 'fr-par',
  endpoint: `https://s3.${process.env.SCW_REGION || 'fr-par'}.scw.cloud`,
  credentials: {
    accessKeyId: process.env.SCW_ACCESS_KEY,
    secretAccessKey: process.env.SCW_SECRET_KEY,
  },
})
const bucket = process.env.SCW_TEACHER_BUCKET

async function uploadToS3(hash, ext, buffer, contentType) {
  const key = `files/${hash}.${ext}`

  // Check if already exists
  try {
    await s3Client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
    console.log(`   S3: Already exists ${key}`)
    return key
  } catch (e) {
    // Doesn't exist, upload
  }

  await s3Client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: buffer,
    ContentType: contentType,
    ACL: 'public-read',
    CacheControl: 'public, max-age=31536000, immutable',
  }))
  console.log(`   S3: Uploaded ${key}`)
  return key
}

async function importFile(skriptId, filePath, fileName, userId) {
  // Check if file already exists
  const existing = await prisma.file.findFirst({
    where: { skriptId, name: fileName }
  })

  if (existing) {
    console.log(`   DB: Already exists ${fileName}`)
    return
  }

  const buffer = readFileSync(filePath)
  const hash = createHash('sha256').update(buffer).digest('hex')
  const ext = fileName.split('.').pop()

  // Determine content type
  let contentType = 'application/octet-stream'
  if (ext === 'svg') contentType = 'image/svg+xml'
  else if (ext === 'json') contentType = 'application/json'

  // Upload to S3
  await uploadToS3(hash, ext, buffer, contentType)

  // Create DB record
  await prisma.file.create({
    data: {
      name: fileName,
      isDirectory: false,
      skriptId,
      hash,
      contentType,
      size: BigInt(buffer.length),
      createdBy: userId,
    }
  })
  console.log(`   DB: Created ${fileName}`)
}

async function main() {
  console.log('Importing missing fde-demo excalidraw SVG files...\n')

  // Get admin user
  const admin = await prisma.user.findFirst({ where: { email: 'eduadmin@eduskript.org' } })
  if (!admin) throw new Error('Admin user not found')

  // Get computer-os skript (where von-neumann-architektur page is)
  const skript = await prisma.skript.findFirst({ where: { slug: 'computer-os' } })
  if (!skript) throw new Error('Skript computer-os not found')

  console.log(`Skript: ${skript.title} (${skript.id})`)

  const basePath = '/home/chris/git/eduskript/oldstuff/informatikgarten.ch/sites/ig/content/aufbau/attachments/fde-demo'

  if (!existsSync(basePath)) {
    throw new Error(`Source directory not found: ${basePath}`)
  }

  // Find all SVG files in the directory
  const files = readdirSync(basePath).filter(f => f.endsWith('.svg'))
  console.log(`Found ${files.length} SVG files to import\n`)

  for (const fileName of files) {
    const filePath = join(basePath, fileName)
    console.log(`Importing: ${fileName}`)
    await importFile(skript.id, filePath, fileName, admin.id)
  }

  console.log('\nDone!')
  await prisma.$disconnect()
}

main().catch(console.error)
