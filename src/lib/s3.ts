/**
 * Scaleway Object Storage (S3-compatible) client
 *
 * Used for storing user-generated content like snaps (screenshots)
 * that would be too large/expensive to store in PostgreSQL.
 */

import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

// Scaleway Object Storage configuration
// Supports both SCW_* (Scaleway CLI convention) and SCALEWAY_* naming
// Set these in your .env file:
//   SCW_REGION, SCW_BUCKET, SCW_ACCESS_KEY, SCW_SECRET_KEY
const SCALEWAY_REGION = process.env.SCALEWAY_REGION || process.env.SCW_REGION || 'fr-par'
const SCALEWAY_ENDPOINT = process.env.SCALEWAY_ENDPOINT || `https://s3.${SCALEWAY_REGION}.scw.cloud`
const SCALEWAY_BUCKET = process.env.SCALEWAY_BUCKET || process.env.SCW_BUCKET
const SCALEWAY_ACCESS_KEY = process.env.SCALEWAY_ACCESS_KEY_ID || process.env.SCW_ACCESS_KEY
const SCALEWAY_SECRET_KEY = process.env.SCALEWAY_SECRET_ACCESS_KEY || process.env.SCW_SECRET_KEY

// Check if S3 is configured
export function isS3Configured(): boolean {
  return !!(SCALEWAY_ACCESS_KEY && SCALEWAY_SECRET_KEY && SCALEWAY_BUCKET)
}

// Create S3 client (lazy initialization)
let s3Client: S3Client | null = null

function getS3Client(): S3Client {
  if (!s3Client) {
    if (!isS3Configured()) {
      throw new Error('Scaleway S3 credentials not configured. Set SCALEWAY_ACCESS_KEY_ID and SCALEWAY_SECRET_ACCESS_KEY.')
    }

    s3Client = new S3Client({
      region: SCALEWAY_REGION,
      endpoint: SCALEWAY_ENDPOINT,
      credentials: {
        accessKeyId: SCALEWAY_ACCESS_KEY!,
        secretAccessKey: SCALEWAY_SECRET_KEY!,
      },
      forcePathStyle: false, // Use virtual-hosted style for Scaleway
    })
  }
  return s3Client
}

/**
 * Upload a snap image to S3
 *
 * @param userId - User ID (for path organization)
 * @param pageId - Page ID (for path organization)
 * @param snapId - Unique snap ID
 * @param imageData - Base64 encoded image data (data URL)
 * @returns Public URL of the uploaded image
 */
export async function uploadSnapImage(
  userId: string,
  pageId: string,
  snapId: string,
  imageData: string
): Promise<string> {
  const client = getS3Client()

  // Parse base64 data URL
  const matches = imageData.match(/^data:image\/(\w+);base64,(.+)$/)
  if (!matches) {
    throw new Error('Invalid image data URL format')
  }

  const [, format, base64Data] = matches
  const buffer = Buffer.from(base64Data, 'base64')

  // Generate S3 key: snaps/{userId}/{pageId}/{snapId}.{format}
  const key = `snaps/${userId}/${pageId}/${snapId}.${format}`

  await client.send(new PutObjectCommand({
    Bucket: SCALEWAY_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: `image/${format}`,
    // Make publicly readable
    ACL: 'public-read',
  }))

  // Return public URL
  return `${SCALEWAY_ENDPOINT}/${SCALEWAY_BUCKET}/${key}`
}

/**
 * Delete a snap image from S3
 *
 * @param imageUrl - Full URL of the image to delete
 */
export async function deleteSnapImage(imageUrl: string): Promise<void> {
  const client = getS3Client()

  // Extract key from URL
  const urlPattern = new RegExp(`${SCALEWAY_ENDPOINT}/${SCALEWAY_BUCKET}/(.+)$`)
  const match = imageUrl.match(urlPattern)

  if (!match) {
    console.warn('Could not extract S3 key from URL:', imageUrl)
    return
  }

  const key = match[1]

  await client.send(new DeleteObjectCommand({
    Bucket: SCALEWAY_BUCKET,
    Key: key,
  }))
}

/**
 * Get the bucket name for reference
 */
export function getBucketName(): string {
  return SCALEWAY_BUCKET || ''
}

/**
 * Generate a presigned URL for uploading a file to S3
 *
 * @param key - The S3 object key (path)
 * @param contentType - MIME type of the file
 * @param expiresIn - URL expiry time in seconds (default: 900 = 15 minutes)
 * @returns Object with upload URL and expiration time
 */
export async function generatePresignedUploadUrl(
  key: string,
  contentType: string,
  expiresIn: number = 900
): Promise<{ url: string; expiresAt: Date }> {
  const client = getS3Client()

  const command = new PutObjectCommand({
    Bucket: SCALEWAY_BUCKET,
    Key: key,
    ContentType: contentType,
  })

  const url = await getSignedUrl(client, command, { expiresIn })
  const expiresAt = new Date(Date.now() + expiresIn * 1000)

  return { url, expiresAt }
}

/**
 * Generate a presigned URL for downloading a file from S3
 *
 * @param key - The S3 object key (path)
 * @param expiresIn - URL expiry time in seconds (default: 3600 = 1 hour)
 * @returns Presigned download URL
 */
export async function generatePresignedDownloadUrl(
  key: string,
  expiresIn: number = 3600
): Promise<string> {
  const client = getS3Client()

  const command = new GetObjectCommand({
    Bucket: SCALEWAY_BUCKET,
    Key: key,
  })

  return await getSignedUrl(client, command, { expiresIn })
}

/**
 * Download a file from S3 as a buffer
 *
 * @param key - The S3 object key (path)
 * @returns File contents as Buffer
 */
export async function downloadFromS3(key: string): Promise<Buffer> {
  const client = getS3Client()

  const response = await client.send(new GetObjectCommand({
    Bucket: SCALEWAY_BUCKET,
    Key: key,
  }))

  if (!response.Body) {
    throw new Error(`Empty response for S3 key: ${key}`)
  }

  // Convert stream to buffer
  const chunks: Uint8Array[] = []
  for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

/**
 * Delete a file from S3 by key
 *
 * @param key - The S3 object key (path)
 */
export async function deleteFromS3(key: string): Promise<void> {
  const client = getS3Client()

  await client.send(new DeleteObjectCommand({
    Bucket: SCALEWAY_BUCKET,
    Key: key,
  }))
}
