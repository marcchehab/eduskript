#!/usr/bin/env node
/**
 * Check if files exist in S3 teacher bucket
 */

import { S3Client, HeadObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Load .env from project root
dotenv.config({ path: join(__dirname, '..', '.env') })

const REGION = process.env.SCALEWAY_REGION || process.env.SCW_REGION || 'fr-par'
const ENDPOINT = process.env.SCALEWAY_ENDPOINT || `https://s3.${REGION}.scw.cloud`
const TEACHER_BUCKET = process.env.SCW_TEACHER_BUCKET
const ACCESS_KEY = process.env.SCALEWAY_ACCESS_KEY_ID || process.env.SCW_ACCESS_KEY
const SECRET_KEY = process.env.SCALEWAY_SECRET_ACCESS_KEY || process.env.SCW_SECRET_KEY

console.log('S3 Configuration:')
console.log(`  Region: ${REGION}`)
console.log(`  Endpoint: ${ENDPOINT}`)
console.log(`  Teacher Bucket: ${TEACHER_BUCKET}`)
console.log(`  Access Key: ${ACCESS_KEY?.slice(0, 8)}...`)
console.log(`  Secret Key: ${SECRET_KEY ? '***SET***' : 'NOT SET'}`)

if (!ACCESS_KEY || !SECRET_KEY || !TEACHER_BUCKET) {
  console.error('\n❌ Missing required environment variables!')
  process.exit(1)
}

const client = new S3Client({
  region: REGION,
  endpoint: ENDPOINT,
  credentials: {
    accessKeyId: ACCESS_KEY,
    secretAccessKey: SECRET_KEY,
  },
  forcePathStyle: false,
})

async function checkFile(hash, extension) {
  const key = `files/${hash}.${extension}`
  try {
    const result = await client.send(new HeadObjectCommand({
      Bucket: TEACHER_BUCKET,
      Key: key,
    }))
    return { exists: true, size: result.ContentLength }
  } catch (error) {
    if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
      return { exists: false }
    }
    throw error
  }
}

async function listFiles(prefix = 'files/', maxKeys = 20) {
  try {
    const result = await client.send(new ListObjectsV2Command({
      Bucket: TEACHER_BUCKET,
      Prefix: prefix,
      MaxKeys: maxKeys,
    }))
    return result.Contents || []
  } catch (error) {
    console.error('List error:', error.name, error.message)
    return []
  }
}

async function main() {
  console.log('\n--- Listing files in bucket ---')
  const files = await listFiles()
  console.log(`Found ${files.length} files:`)
  files.forEach(f => console.log(`  - ${f.Key} (${f.Size} bytes)`))

  console.log('\n--- Checking specific file ---')
  const testHash = '7dbecb4a2e0c6629d5cdc4033687f0c24aed8331d992ce201d0202935908eb05'
  const result = await checkFile(testHash, 'svg')
  if (result.exists) {
    console.log(`✅ File exists: ${result.size} bytes`)
  } else {
    console.log('❌ File not found')
  }
}

main().catch(console.error)
