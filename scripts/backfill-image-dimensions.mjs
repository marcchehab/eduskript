#!/usr/bin/env node
/**
 * Backfill image dimensions for existing files.
 *
 * Queries all File records with image content types and null width/height,
 * downloads each from S3, extracts dimensions with sharp, and updates the DB.
 *
 * Usage: node scripts/backfill-image-dimensions.mjs
 * Requires: DATABASE_URL and S3 env vars configured
 */

import pg from 'pg'
import { config } from 'dotenv'
import sharp from 'sharp'
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import * as crypto from 'crypto'

config()

const connectionString = process.env.DATABASE_URL
const client = new pg.Client({ connectionString })

const s3Client = new S3Client({
  region: process.env.SCALEWAY_REGION || 'fr-par',
  endpoint: process.env.SCALEWAY_ENDPOINT || 'https://s3.fr-par.scw.cloud',
  credentials: {
    accessKeyId: process.env.SCALEWAY_ACCESS_KEY_ID || process.env.SCW_ACCESS_KEY || '',
    secretAccessKey: process.env.SCALEWAY_SECRET_ACCESS_KEY || process.env.SCW_SECRET_KEY || '',
  },
  forcePathStyle: true,
})

const bucket = process.env.SCW_TEACHER_BUCKET

function getExtension(filename) {
  const lastDot = filename.lastIndexOf('.')
  if (lastDot === -1 || lastDot === filename.length - 1) return null
  return filename.substring(lastDot + 1).toLowerCase()
}

function parseSvgDimensions(buffer) {
  const svgStr = buffer.toString('utf-8').slice(0, 2000)
  const wMatch = svgStr.match(/\bwidth=["']([.\d]+)/)
  const hMatch = svgStr.match(/\bheight=["']([.\d]+)/)
  if (wMatch && hMatch) {
    return { width: Math.round(parseFloat(wMatch[1])), height: Math.round(parseFloat(hMatch[1])) }
  }
  const viewBox = svgStr.match(/viewBox=["']([^"']+)["']/)
  if (viewBox) {
    const parts = viewBox[1].split(/[\s,]+/)
    return { width: Math.round(parseFloat(parts[2])), height: Math.round(parseFloat(parts[3])) }
  }
  return null
}

async function downloadFromS3(key) {
  const command = new GetObjectCommand({ Bucket: bucket, Key: key })
  const response = await s3Client.send(command)
  const chunks = []
  for await (const chunk of response.Body) {
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

try {
  await client.connect()

  // Find all image files without dimensions (raster + SVG)
  const result = await client.query(`
    SELECT id, name, hash, content_type
    FROM files
    WHERE content_type LIKE 'image/%'
      AND width IS NULL
      AND hash IS NOT NULL
      AND is_directory = false
  `)

  console.log(`Found ${result.rows.length} images to backfill`)

  let updated = 0
  let failed = 0

  for (const file of result.rows) {
    const ext = getExtension(file.name)
    if (!ext || !file.hash) {
      failed++
      continue
    }

    const s3Key = `files/${file.hash}.${ext}`
    const isSvg = file.content_type === 'image/svg+xml'

    try {
      const buffer = await downloadFromS3(s3Key)

      let width, height
      if (isSvg) {
        const dims = parseSvgDimensions(buffer)
        if (dims) ({ width, height } = dims)
      } else {
        const metadata = await sharp(buffer).metadata()
        width = metadata.width
        height = metadata.height
      }

      if (width && height) {
        await client.query(
          'UPDATE files SET width = $1, height = $2 WHERE id = $3',
          [width, height, file.id]
        )
        updated++
        console.log(`  ${file.name}: ${width}x${height}${isSvg ? ' (svg)' : ''}`)
      } else {
        failed++
        console.log(`  ${file.name}: no dimensions found`)
      }
    } catch (err) {
      failed++
      console.log(`  ${file.name}: ${err.message}`)
    }
  }

  console.log(`\nDone. Updated: ${updated}, Failed: ${failed}`)
} catch (error) {
  console.error('Backfill failed:', error.message)
  process.exit(1)
} finally {
  await client.end()
}
