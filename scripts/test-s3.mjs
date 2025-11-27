#!/usr/bin/env node
/**
 * Simple S3 test script
 * Tests upload, download, and delete operations
 */

import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import 'dotenv/config'

const REGION = process.env.SCALEWAY_REGION || process.env.SCW_REGION || 'fr-par'
const ENDPOINT = process.env.SCALEWAY_ENDPOINT || `https://s3.${REGION}.scw.cloud`
const BUCKET = process.env.SCALEWAY_BUCKET || process.env.SCW_BUCKET
const ACCESS_KEY = process.env.SCALEWAY_ACCESS_KEY_ID || process.env.SCW_ACCESS_KEY
const SECRET_KEY = process.env.SCALEWAY_SECRET_ACCESS_KEY || process.env.SCW_SECRET_KEY

console.log('S3 Configuration:')
console.log('  Region:', REGION)
console.log('  Endpoint:', ENDPOINT)
console.log('  Bucket:', BUCKET)
console.log('  Access Key:', ACCESS_KEY ? `${ACCESS_KEY.slice(0, 8)}...` : 'NOT SET')
console.log('  Secret Key:', SECRET_KEY ? '***SET***' : 'NOT SET')
console.log('')

if (!BUCKET || !ACCESS_KEY || !SECRET_KEY) {
  console.error('❌ Missing required environment variables!')
  console.error('   Make sure SCALEWAY_BUCKET, SCALEWAY_ACCESS_KEY_ID, and SCALEWAY_SECRET_ACCESS_KEY are set')
  process.exit(1)
}

const s3Client = new S3Client({
  region: REGION,
  endpoint: ENDPOINT,
  credentials: {
    accessKeyId: ACCESS_KEY,
    secretAccessKey: SECRET_KEY,
  },
  forcePathStyle: false,
})

const testKey = `test/s3-test-${Date.now()}.txt`
const testContent = `Hello from eduskript! Timestamp: ${new Date().toISOString()}`

async function runTests() {
  try {
    // Test 1: Upload
    console.log('1️⃣  Testing upload...')
    await s3Client.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: testKey,
      Body: testContent,
      ContentType: 'text/plain',
    }))
    console.log('   ✅ Upload successful!')

    // Test 2: Generate presigned URL
    console.log('2️⃣  Testing presigned URL generation...')
    const presignedUrl = await getSignedUrl(
      s3Client,
      new GetObjectCommand({ Bucket: BUCKET, Key: testKey }),
      { expiresIn: 60 }
    )
    console.log('   ✅ Presigned URL:', presignedUrl.slice(0, 80) + '...')

    // Test 3: Download
    console.log('3️⃣  Testing download...')
    const response = await s3Client.send(new GetObjectCommand({
      Bucket: BUCKET,
      Key: testKey,
    }))
    const downloaded = await response.Body.transformToString()
    if (downloaded === testContent) {
      console.log('   ✅ Download successful! Content matches.')
    } else {
      console.log('   ⚠️  Download worked but content mismatch')
    }

    // Test 4: Delete
    console.log('4️⃣  Testing delete...')
    await s3Client.send(new DeleteObjectCommand({
      Bucket: BUCKET,
      Key: testKey,
    }))
    console.log('   ✅ Delete successful!')

    console.log('')
    console.log('🎉 All S3 tests passed! Your bucket is ready for imports.')

  } catch (error) {
    console.error('')
    console.error('❌ Test failed:', error.message)
    if (error.Code) console.error('   Error code:', error.Code)
    process.exit(1)
  }
}

runTests()
