#!/usr/bin/env node
/**
 * Upload missing images from informatikgarten.ch source to eduskript.
 */

import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/eduskript_dev'
const pool = new Pool({ connectionString })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

// Source directory
const SOURCE_BASE = '/home/chris/git/informatikgarten.ch/sites/ig/content'

// Mapping from source folder to skript slug
const FOLDER_TO_SKRIPT = {
  'code': 'programmieren-1',
  'data': 'daten-information',
  'crypto': 'kryptologie',
  'microbit': 'robotik',
  'net': 'netzwerke-internet',
  'aufbau': 'building-an-adder',
  'didactics': 'robotik', // microbit.gif is referenced from robotik
}

// Missing files to upload (from find-missing-images.mjs output)
const MISSING_FILES = [
  { name: 'Pasted-image-20230818101343.png', source: 'code/attachments', skript: 'programmieren-1' },
  { name: 'Pasted-image-20230904192011.png', source: 'code/attachments', skript: 'programmieren-1' },
  { name: 'Pasted-image-20230904192315.png', source: 'code/attachments', skript: 'programmieren-1' },
  { name: 'Pasted-image-20230904183640.png', source: 'code/attachments', skript: 'programmieren-1' },
  { name: 'Pasted-image-20230904183937.png', source: 'code/attachments', skript: 'programmieren-1' },
  { name: 'Pasted-image-20230904184720.png', source: 'code/attachments', skript: 'programmieren-1' },
  { name: 'Pasted-image-20230904190230.png', source: 'code/attachments', skript: 'programmieren-1' },
  { name: 'Pasted-image-20230904194355.png', source: 'code/attachments', skript: 'programmieren-1' },
  { name: 'Pasted-image-20230904194406.png', source: 'code/attachments', skript: 'programmieren-1' },
  { name: 'Pasted-image-20230815060449.png', source: 'code/attachments', skript: 'programmieren-1' },
  { name: 'Pasted-image-20230821153731.png', source: 'code/attachments', skript: 'programmieren-1' },
  { name: 'Pasted-image-20230821211004.png', source: 'code/attachments', skript: 'programmieren-1' },
  { name: 'Pasted-image-20231119131705.png', source: 'data/attachments', skript: 'daten-information' },
  { name: 'Pasted-image-20231119130057.png', source: 'data/attachments', skript: 'daten-information' },
  { name: 'Pasted-image-20231105164519.png', source: 'data/attachments', skript: 'daten-information' },
  { name: 'sagan.jpg', source: 'data/attachments', skript: 'daten-information' },
  { name: 'Pastedimage20240610125006.png', source: 'crypto/attachments', skript: 'kryptologie' },
  { name: 'star-led.png', source: 'microbit/attachments', skript: 'robotik' },
  { name: 'microbit.gif', source: 'microbit/attachments', skript: 'robotik' },
  { name: 'hw-04-prüfungsvorbereitung-20240520125635.png', source: 'aufbau/attachments', skript: 'building-an-adder' },
  { name: 'arelion.png', source: 'net/attachments', skript: 'netzwerke-internet' },
]

// Get content type from extension
function getContentType(filename) {
  const ext = path.extname(filename).toLowerCase()
  const types = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
  }
  return types[ext] || 'application/octet-stream'
}

async function uploadFile(filePath, filename, skriptSlug, userId) {
  // Read file
  const buffer = fs.readFileSync(filePath)
  const hash = crypto.createHash('sha256').update(buffer).digest('hex')
  const contentType = getContentType(filename)
  const ext = path.extname(filename).slice(1) || 'bin'

  // Get skript ID
  const skript = await prisma.skript.findFirst({
    where: { slug: skriptSlug },
    select: { id: true }
  })

  if (!skript) {
    console.log(`  ERROR: Skript not found: ${skriptSlug}`)
    return false
  }

  // Check if file already exists
  const existing = await prisma.file.findFirst({
    where: { name: filename, skriptId: skript.id }
  })

  if (existing) {
    console.log(`  SKIP: Already exists: ${filename}`)
    return true
  }

  // Upload to S3
  const { uploadTeacherFile, teacherFileExists } = await import('../src/lib/s3.ts')

  const existsInS3 = await teacherFileExists(hash, ext)
  if (!existsInS3) {
    await uploadTeacherFile(hash, ext, buffer, contentType)
  }

  // Create file record
  await prisma.file.create({
    data: {
      name: filename,
      isDirectory: false,
      skriptId: skript.id,
      hash,
      contentType,
      size: BigInt(buffer.length),
      createdBy: userId
    }
  })

  console.log(`  UPLOADED: ${filename} -> ${skriptSlug}`)
  return true
}

async function main() {
  console.log('Uploading missing images...\n')

  // Get a user ID (first admin)
  const user = await prisma.user.findFirst({
    where: { email: { contains: '@' } },
    select: { id: true }
  })

  if (!user) {
    console.error('No user found')
    process.exit(1)
  }

  let uploaded = 0
  let skipped = 0
  let errors = 0

  for (const file of MISSING_FILES) {
    const sourcePath = path.join(SOURCE_BASE, file.source, file.name)

    if (!fs.existsSync(sourcePath)) {
      console.log(`  NOT FOUND: ${sourcePath}`)
      errors++
      continue
    }

    try {
      const result = await uploadFile(sourcePath, file.name, file.skript, user.id)
      if (result) {
        uploaded++
      } else {
        skipped++
      }
    } catch (err) {
      console.log(`  ERROR: ${file.name}: ${err.message}`)
      errors++
    }
  }

  console.log('\n--- Summary ---')
  console.log(`Uploaded: ${uploaded}`)
  console.log(`Skipped: ${skipped}`)
  console.log(`Errors: ${errors}`)
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect()
    await pool.end()
  })
