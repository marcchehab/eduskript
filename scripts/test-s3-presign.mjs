#!/usr/bin/env node
/**
 * Test presigned URL upload to Scaleway S3
 */

import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import 'dotenv/config'

const REGION = process.env.SCALEWAY_REGION || process.env.SCW_REGION || 'fr-par'
const ENDPOINT = process.env.SCALEWAY_ENDPOINT || `https://s3.${REGION}.scw.cloud`
const BUCKET = process.env.SCALEWAY_BUCKET || process.env.SCW_BUCKET
const ACCESS_KEY = process.env.SCALEWAY_ACCESS_KEY_ID || process.env.SCW_ACCESS_KEY
const SECRET_KEY = process.env.SCALEWAY_SECRET_ACCESS_KEY || process.env.SCW_SECRET_KEY

console.log('Testing Presigned URL Upload to Scaleway S3\n')

const s3Client = new S3Client({
  region: REGION,
  endpoint: ENDPOINT,
  credentials: {
    accessKeyId: ACCESS_KEY,
    secretAccessKey: SECRET_KEY,
  },
  forcePathStyle: false,
})

const testKey = `test/presign-test-${Date.now()}.txt`
const testContent = `Test content uploaded via presigned URL at ${new Date().toISOString()}`

async function runTest() {
  try {
    // Step 1: Generate presigned PUT URL
    console.log('1️⃣  Generating presigned PUT URL...')
    const putCommand = new PutObjectCommand({
      Bucket: BUCKET,
      Key: testKey,
      ContentType: 'text/plain',
    })
    const presignedPutUrl = await getSignedUrl(s3Client, putCommand, { expiresIn: 300 })
    console.log('   URL:', presignedPutUrl.slice(0, 100) + '...\n')

    // Step 2: Upload using fetch (simulating browser upload)
    console.log('2️⃣  Uploading via presigned URL (fetch)...')
    const uploadResponse = await fetch(presignedPutUrl, {
      method: 'PUT',
      body: testContent,
      headers: {
        'Content-Type': 'text/plain',
      },
    })

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text()
      throw new Error(`Upload failed: ${uploadResponse.status} - ${errorText}`)
    }
    console.log('   ✅ Upload successful! Status:', uploadResponse.status, '\n')

    // Step 3: Verify by downloading
    console.log('3️⃣  Verifying by downloading...')
    const getResponse = await s3Client.send(new GetObjectCommand({
      Bucket: BUCKET,
      Key: testKey,
    }))
    const downloaded = await getResponse.Body.transformToString()

    if (downloaded === testContent) {
      console.log('   ✅ Content verified!\n')
    } else {
      console.log('   ⚠️  Content mismatch\n')
    }

    // Step 4: Cleanup
    console.log('4️⃣  Cleaning up...')
    await s3Client.send(new DeleteObjectCommand({
      Bucket: BUCKET,
      Key: testKey,
    }))
    console.log('   ✅ Deleted\n')

    console.log('🎉 Presigned URL upload works! Ready for large file imports.')

  } catch (error) {
    console.error('\n❌ Test failed:', error.message)
    if (error.Code) console.error('   S3 Error Code:', error.Code)
    process.exit(1)
  }
}

runTest()
