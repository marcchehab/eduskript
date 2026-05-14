#!/usr/bin/env node
/**
 * Import missing excalidraw SVG files
 */

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import { readFileSync, existsSync } from 'fs'
import { createHash } from 'crypto'
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
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

  // Upload to S3
  await uploadToS3(hash, 'svg', buffer, 'image/svg+xml')

  // Create DB record
  await prisma.file.create({
    data: {
      name: fileName,
      isDirectory: false,
      skriptId,
      hash,
      contentType: 'image/svg+xml',
      size: BigInt(buffer.length),
      createdBy: userId,
    }
  })
  console.log(`   DB: Created ${fileName}`)
}

async function main() {
  console.log('🔧 Importing missing excalidraw SVG files...\n')

  // Get admin user
  const admin = await prisma.user.findFirst({ where: { email: 'eduadmin@eduskript.org' } })
  if (!admin) throw new Error('Admin user not found')

  // Get building-an-adder skript
  const skript = await prisma.skript.findFirst({ where: { slug: 'building-an-adder' } })
  if (!skript) throw new Error('Skript not found')

  const basePath = '/home/chris/git/eduskript/oldstuff/informatikgarten.ch/sites/ig/ig_content/adder/attachments'

  const filesToImport = [
    'eva-prinzip.excalidraw.light.svg',
    'eva-prinzip.excalidraw.dark.svg',
    'logicboard-top-eva.excalidraw.light.svg',
    'logicboard-top-eva.excalidraw.dark.svg',
  ]

  for (const fileName of filesToImport) {
    const filePath = `${basePath}/${fileName}`
    if (existsSync(filePath)) {
      console.log(`Importing: ${fileName}`)
      await importFile(skript.id, filePath, fileName, admin.id)
    } else {
      console.log(`Not found: ${filePath}`)
    }
  }

  console.log('\n✅ Done!')
  await prisma.$disconnect()
}

main().catch(console.error)
