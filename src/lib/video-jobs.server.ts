/**
 * App side of the self-hosted video pipeline: upload keys, enqueueing encode
 * jobs, retry, and cleanup on delete. The encoding itself happens in the
 * separate worker process (scripts/video-worker.mjs, queue in
 * scripts/video-worker/queue.mjs); it writes the results into
 * Video.metadata of every row linked to the job.
 *
 * S3 layout (teacher bucket, publicly readable):
 *   {VIDEO_S3_PREFIX}video-uploads/<random>.<ext>   original upload (kept)
 *   {VIDEO_S3_PREFIX}videos/<uuid>/…                encoder outputs
 * VIDEO_S3_PREFIX is empty in production; tests use e.g. "video-test/".
 */

import { randomBytes, randomUUID } from 'crypto'
import { Prisma } from '@prisma/client'
import { prisma } from './prisma'
import { deleteFromS3, deleteS3Prefix, getTeacherBucketName } from './s3'

export function videoS3Prefix(): string {
  return process.env.VIDEO_S3_PREFIX ?? ''
}

/** Random part because the teacher bucket is publicly readable. */
export function newUploadKey(filename: string): string {
  const ext = (filename.split('.').pop() || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp4'
  return `${videoS3Prefix()}video-uploads/${randomBytes(16).toString('hex')}.${ext}`
}

export function newOutputPrefix(): string {
  return `${videoS3Prefix()}videos/${randomUUID()}/`
}

type Meta = Record<string, unknown>

/**
 * The browser finished the S3 PUT: queue the encode. Idempotent — a row that
 * already has a job keeps it.
 */
export async function enqueueUploadedVideo(videoId: string): Promise<Meta> {
  const video = await prisma.video.findUnique({ where: { id: videoId } })
  if (!video || video.provider !== 'self') throw new Error('Video not found')
  const meta = (video.metadata ?? {}) as Meta
  if (video.encodeJobId) return meta
  const uploadKey = typeof meta.uploadKey === 'string' ? meta.uploadKey : null
  if (!uploadKey) throw new Error('Video has no pending upload')

  const next: Meta = { ...meta, status: 'queued' }
  await prisma.$transaction(async tx => {
    const job = await tx.videoEncodeJob.create({
      data: { source: `s3:${uploadKey}`, outputPrefix: newOutputPrefix() },
    })
    await tx.video.update({
      where: { id: videoId },
      data: { encodeJobId: job.id, metadata: next as Prisma.InputJsonValue },
    })
  })
  return next
}

/** Put a failed job back into the queue with fresh attempts. */
export async function retryVideoJob(videoId: string): Promise<boolean> {
  const video = await prisma.video.findUnique({ where: { id: videoId }, select: { encodeJobId: true } })
  if (!video?.encodeJobId) return false
  const job = await prisma.videoEncodeJob.updateMany({
    where: { id: video.encodeJobId, status: 'failed' },
    data: { status: 'queued', attempts: 0, error: null, availableAt: new Date(), progress: null },
  })
  if (job.count === 0) return false
  await prisma.$executeRaw`
    UPDATE videos SET metadata = (metadata - 'error' - 'progress') || '{"status":"queued"}'::jsonb, updated_at = now()
     WHERE encode_job_id = ${video.encodeJobId}`
  return true
}

/**
 * After a Video row was deleted: if no other row uses its job, delete the
 * job, its outputs and the original upload. Best effort (logs, never throws).
 * O(objects under the prefix).
 */
export async function cleanupDeletedVideo(encodeJobId: string | null, meta: Meta): Promise<void> {
  try {
    if (encodeJobId) {
      const others = await prisma.video.count({ where: { encodeJobId } })
      if (others > 0) return
      const job = await prisma.videoEncodeJob.findUnique({ where: { id: encodeJobId } })
      if (job) {
        await deleteS3Prefix(job.outputPrefix, getTeacherBucketName())
        if (job.source.startsWith('s3:')) await deleteFromS3(job.source.slice(3), getTeacherBucketName())
        await prisma.videoEncodeJob.delete({ where: { id: encodeJobId } })
      }
    } else if (typeof meta.uploadKey === 'string') {
      await deleteFromS3(meta.uploadKey, getTeacherBucketName())
    }
  } catch (error) {
    console.warn('Video cleanup failed:', error instanceof Error ? error.message : error)
  }
}
