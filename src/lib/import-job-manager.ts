/**
 * Import Job Manager
 *
 * Manages import/export jobs with:
 * - Database-backed job tracking
 * - Progress updates
 * - One active job per user limit
 * - Async processing with status polling
 */

import { prisma } from './prisma'
import { downloadFromS3, deleteFromS3, getImportBucketName } from './s3'
import { processImportZip, type ImportResult } from './import-actions'
import JSZip from 'jszip'

export type JobStatus = 'pending' | 'uploading' | 'processing' | 'completed' | 'failed' | 'cancelled'

export interface JobProgress {
  status: JobStatus
  progress: number
  message: string
}

/**
 * Update job status in database
 */
export async function updateJobStatus(
  jobId: string,
  status: JobStatus,
  progress: number,
  message: string,
  result?: ImportResult,
  error?: string
): Promise<void> {
  const data: {
    status: JobStatus
    progress: number
    message: string
    result?: object
    error?: string
    completedAt?: Date
  } = {
    status,
    progress,
    message
  }

  if (result) {
    data.result = result as object
  }

  if (error) {
    data.error = error
  }

  if (status === 'completed' || status === 'failed' || status === 'cancelled') {
    data.completedAt = new Date()
  }

  await prisma.importJob.update({
    where: { id: jobId },
    data
  })
}

/**
 * Start processing an import job
 *
 * This function runs async and updates the database with progress.
 * The caller should return immediately after calling this.
 */
export async function startImportProcessing(
  jobId: string,
  userId: string,
  s3Key: string
): Promise<void> {
  // Run processing in background (don't await)
  processImportAsync(jobId, userId, s3Key).catch(error => {
    console.error(`[ImportJob ${jobId}] Unhandled error:`, error)
    updateJobStatus(jobId, 'failed', 0, 'Import failed due to internal error', undefined, String(error))
  })
}

/**
 * Async import processing
 * Downloads from S3, extracts, and imports content
 */
async function processImportAsync(
  jobId: string,
  userId: string,
  s3Key: string
): Promise<void> {
  const importBucket = getImportBucketName()

  try {
    // Update status: downloading
    await updateJobStatus(jobId, 'processing', 5, 'Downloading file from storage...')

    // Download from S3 import bucket
    const zipBuffer = await downloadFromS3(s3Key, importBucket)
    await updateJobStatus(jobId, 'processing', 15, 'File downloaded. Extracting...')

    // Extract ZIP
    const zip = await JSZip.loadAsync(zipBuffer)
    await updateJobStatus(jobId, 'processing', 20, 'Extracting manifest...')

    // Read manifest
    const manifestFile = zip.file('manifest.json')
    if (!manifestFile) {
      throw new Error('Invalid import file: missing manifest.json')
    }

    const manifestContent = await manifestFile.async('string')
    const manifest = JSON.parse(manifestContent)
    await updateJobStatus(jobId, 'processing', 25, 'Processing import...')

    // Process the import with progress callback
    const result = await processImportZip(
      zip,
      manifest,
      userId,
      async (progress: number, message: string) => {
        // Scale progress from 25-95%
        const scaledProgress = 25 + Math.floor(progress * 0.7)
        await updateJobStatus(jobId, 'processing', scaledProgress, message)
      }
    )

    // Cleanup S3 file
    await updateJobStatus(jobId, 'processing', 95, 'Cleaning up temporary files...')
    try {
      await deleteFromS3(s3Key, importBucket)
    } catch (cleanupError) {
      console.warn(`[ImportJob ${jobId}] Failed to cleanup S3 file:`, cleanupError)
      // Don't fail the job for cleanup errors
    }

    // Mark as completed
    await updateJobStatus(
      jobId,
      'completed',
      100,
      `Import completed: ${result.skriptsCreated} skripts, ${result.pagesCreated} pages, ${result.filesImported} files`,
      result
    )
  } catch (error) {
    console.error(`[ImportJob ${jobId}] Error:`, error)

    // Try to cleanup S3 file on error
    try {
      await deleteFromS3(s3Key, importBucket)
    } catch {
      // Ignore cleanup errors
    }

    await updateJobStatus(
      jobId,
      'failed',
      0,
      'Import failed',
      undefined,
      error instanceof Error ? error.message : String(error)
    )
  }
}

/**
 * Cancel an import job
 */
export async function cancelImportJob(jobId: string, userId: string): Promise<boolean> {
  const job = await prisma.importJob.findFirst({
    where: {
      id: jobId,
      userId,
      status: { in: ['pending', 'uploading'] }
    }
  })

  if (!job) {
    return false
  }

  // Cleanup S3 file if exists
  if (job.s3Key) {
    try {
      await deleteFromS3(job.s3Key, getImportBucketName())
    } catch {
      // Ignore cleanup errors
    }
  }

  await updateJobStatus(jobId, 'cancelled', 0, 'Import cancelled by user')
  return true
}

/**
 * Get job status
 */
export async function getJobStatus(jobId: string, userId: string) {
  const job = await prisma.importJob.findFirst({
    where: {
      id: jobId,
      userId
    }
  })

  if (!job) {
    return null
  }

  return {
    id: job.id,
    status: job.status as JobStatus,
    progress: job.progress,
    message: job.message,
    fileName: job.fileName,
    result: job.result as ImportResult | null,
    error: job.error,
    createdAt: job.createdAt,
    completedAt: job.completedAt
  }
}

/**
 * Cleanup old completed/failed jobs (older than 24 hours)
 */
export async function cleanupOldJobs(): Promise<number> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000)

  const result = await prisma.importJob.deleteMany({
    where: {
      status: { in: ['completed', 'failed', 'cancelled'] },
      completedAt: { lt: cutoff }
    }
  })

  return result.count
}
