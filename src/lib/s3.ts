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
//   SCW_REGION, SCW_USER_BUCKET, SCW_ACCESS_KEY, SCW_SECRET_KEY
//   SCW_IMPORT_BUCKET (optional, for large file imports)
//   SCW_TEACHER_BUCKET (for teacher-uploaded files like images, databases)
const SCALEWAY_REGION = process.env.SCALEWAY_REGION || process.env.SCW_REGION || 'fr-par'
const SCALEWAY_ENDPOINT = process.env.SCALEWAY_ENDPOINT || `https://s3.${SCALEWAY_REGION}.scw.cloud`
const SCALEWAY_BUCKET = process.env.SCALEWAY_BUCKET || process.env.SCW_USER_BUCKET
const SCALEWAY_IMPORT_BUCKET = process.env.SCW_IMPORT_BUCKET
const SCALEWAY_TEACHER_BUCKET = process.env.SCW_TEACHER_BUCKET
const SCALEWAY_ACCESS_KEY = process.env.SCALEWAY_ACCESS_KEY_ID || process.env.SCW_ACCESS_KEY
const SCALEWAY_SECRET_KEY = process.env.SCALEWAY_SECRET_ACCESS_KEY || process.env.SCW_SECRET_KEY

// Check if S3 credentials are configured (needed for any S3 operation)
function hasS3Credentials(): boolean {
  return !!(SCALEWAY_ACCESS_KEY && SCALEWAY_SECRET_KEY)
}

// Check if S3 is configured (for snaps/file storage - requires main bucket)
export function isS3Configured(): boolean {
  return !!(SCALEWAY_ACCESS_KEY && SCALEWAY_SECRET_KEY && SCALEWAY_BUCKET)
}

// Check if S3 import bucket is configured (for large file imports)
export function isImportS3Configured(): boolean {
  return !!(SCALEWAY_ACCESS_KEY && SCALEWAY_SECRET_KEY && SCALEWAY_IMPORT_BUCKET)
}

// Check if teacher files bucket is configured
export function isTeacherS3Configured(): boolean {
  return !!(SCALEWAY_ACCESS_KEY && SCALEWAY_SECRET_KEY && SCALEWAY_TEACHER_BUCKET)
}

// Get the teacher bucket name
export function getTeacherBucketName(): string {
  return SCALEWAY_TEACHER_BUCKET || ''
}

// Get the import bucket name
export function getImportBucketName(): string {
  return SCALEWAY_IMPORT_BUCKET || ''
}

// Create S3 client (lazy initialization)
let s3Client: S3Client | null = null

function getS3Client(): S3Client {
  if (!s3Client) {
    if (!hasS3Credentials()) {
      throw new Error(`S3 credentials not configured. Set SCW_ACCESS_KEY and SCW_SECRET_KEY. Got ACCESS_KEY=${!!SCALEWAY_ACCESS_KEY}, SECRET_KEY=${!!SCALEWAY_SECRET_KEY}`)
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
    // Cache for 1 year (snaps are immutable - identified by unique snapId)
    CacheControl: 'public, max-age=31536000, immutable',
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
 * @param bucket - Optional bucket name (defaults to main bucket)
 * @returns Object with upload URL and expiration time
 */
export async function generatePresignedUploadUrl(
  key: string,
  contentType: string,
  expiresIn: number = 900,
  bucket?: string
): Promise<{ url: string; expiresAt: Date }> {
  const client = getS3Client()
  const targetBucket = bucket || SCALEWAY_BUCKET

  const command = new PutObjectCommand({
    Bucket: targetBucket,
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
 * @param bucket - Optional bucket name (defaults to main bucket)
 * @returns File contents as Buffer
 */
export async function downloadFromS3(key: string, bucket?: string): Promise<Buffer> {
  const client = getS3Client()
  const targetBucket = bucket || SCALEWAY_BUCKET

  const response = await client.send(new GetObjectCommand({
    Bucket: targetBucket,
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
 * @param bucket - Optional bucket name (defaults to main bucket)
 */
export async function deleteFromS3(key: string, bucket?: string): Promise<void> {
  const client = getS3Client()
  const targetBucket = bucket || SCALEWAY_BUCKET

  await client.send(new DeleteObjectCommand({
    Bucket: targetBucket,
    Key: key,
  }))
}

/**
 * Upload a teacher file to S3 (images, databases, etc.)
 *
 * @param hash - Content hash (for deduplication and content-addressed storage)
 * @param extension - File extension
 * @param buffer - File contents
 * @param contentType - MIME type
 * @returns S3 key for the uploaded file
 */
export async function uploadTeacherFile(
  hash: string,
  extension: string,
  buffer: Buffer,
  contentType: string
): Promise<string> {
  if (!isTeacherS3Configured()) {
    throw new Error('Teacher S3 bucket not configured. Set SCW_TEACHER_BUCKET.')
  }

  const client = getS3Client()

  // Store files by hash for deduplication: files/{hash}.{extension}
  const key = `files/${hash}.${extension}`

  await client.send(new PutObjectCommand({
    Bucket: SCALEWAY_TEACHER_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType,
    // Make publicly readable for serving
    ACL: 'public-read',
    // Cache for 1 year (content-addressed by hash, so immutable)
    CacheControl: 'public, max-age=31536000, immutable',
  }))

  return key
}

/**
 * Download a teacher file from S3
 *
 * @param key - S3 object key
 * @returns File contents as Buffer
 */
export async function downloadTeacherFile(key: string): Promise<Buffer> {
  if (!isTeacherS3Configured()) {
    throw new Error('Teacher S3 bucket not configured. Set SCW_TEACHER_BUCKET.')
  }

  return downloadFromS3(key, SCALEWAY_TEACHER_BUCKET)
}

/**
 * Delete a teacher file from S3
 *
 * @param key - S3 object key
 */
export async function deleteTeacherFile(key: string): Promise<void> {
  if (!isTeacherS3Configured()) {
    throw new Error('Teacher S3 bucket not configured. Set SCW_TEACHER_BUCKET.')
  }

  await deleteFromS3(key, SCALEWAY_TEACHER_BUCKET)
}

/**
 * Get public URL for a teacher file
 *
 * @param key - S3 object key
 * @returns Public URL
 */
export function getTeacherFileUrl(key: string): string {
  return `${SCALEWAY_ENDPOINT}/${SCALEWAY_TEACHER_BUCKET}/${key}`
}

/**
 * Check if a teacher file exists in S3
 *
 * @param hash - Content hash
 * @param extension - File extension
 * @returns true if file exists
 */
export async function teacherFileExists(hash: string, extension: string): Promise<boolean> {
  if (!isTeacherS3Configured()) {
    return false
  }

  const client = getS3Client()
  const key = `files/${hash}.${extension}`

  try {
    await client.send(new GetObjectCommand({
      Bucket: SCALEWAY_TEACHER_BUCKET,
      Key: key,
    }))
    return true
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'name' in error && error.name === 'NoSuchKey') {
      return false
    }
    throw error
  }
}
