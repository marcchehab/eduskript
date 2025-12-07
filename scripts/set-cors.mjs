#!/usr/bin/env node
/**
 * Set CORS configuration on Scaleway S3 bucket
 */

import { S3Client, PutBucketCorsCommand, GetBucketCorsCommand } from '@aws-sdk/client-s3'
import 'dotenv/config'

const REGION = process.env.SCALEWAY_REGION || process.env.SCW_REGION || 'fr-par'
const ENDPOINT = process.env.SCALEWAY_ENDPOINT || `https://s3.${REGION}.scw.cloud`
const BUCKET = process.env.SCALEWAY_BUCKET || process.env.SCW_USER_BUCKET
const ACCESS_KEY = process.env.SCALEWAY_ACCESS_KEY_ID || process.env.SCW_ACCESS_KEY
const SECRET_KEY = process.env.SCALEWAY_SECRET_ACCESS_KEY || process.env.SCW_SECRET_KEY

const s3Client = new S3Client({
  region: REGION,
  endpoint: ENDPOINT,
  credentials: {
    accessKeyId: ACCESS_KEY,
    secretAccessKey: SECRET_KEY,
  },
  forcePathStyle: false,
})

const corsConfig = {
  CORSRules: [
    {
      AllowedOrigins: ['http://localhost:3000', 'https://eduskript.org'],
      AllowedHeaders: ['*'],
      AllowedMethods: ['GET', 'PUT'],
      MaxAgeSeconds: 3000,
      ExposeHeaders: ['ETag'],
    },
  ],
}

async function setCors() {
  console.log('Setting CORS on bucket:', BUCKET)
  console.log('Endpoint:', ENDPOINT)
  console.log('Config:', JSON.stringify(corsConfig, null, 2))
  console.log('')

  try {
    await s3Client.send(new PutBucketCorsCommand({
      Bucket: BUCKET,
      CORSConfiguration: corsConfig,
    }))
    console.log('✅ CORS configuration set successfully!')

    // Verify
    console.log('\nVerifying...')
    const result = await s3Client.send(new GetBucketCorsCommand({
      Bucket: BUCKET,
    }))
    console.log('Current CORS rules:', JSON.stringify(result.CORSRules, null, 2))

  } catch (error) {
    console.error('❌ Failed to set CORS:', error.message)
    if (error.Code) console.error('   Error code:', error.Code)
    process.exit(1)
  }
}

setCors()
