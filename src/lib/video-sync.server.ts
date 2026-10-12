/**
 * Infomaniak VOD: upload hand-off and status sync for Video rows.
 *
 * Flow (see also MIGRATION-VOD.md):
 *  1. /api/videos/upload-url creates the row (provider "infomaniak",
 *     status "waiting", uploadKey) and a presigned S3 PUT under video-uploads/.
 *  2. The browser PUTs the file, then calls /api/videos/[id]/uploaded →
 *     startInfomaniakImport(): presigned S3 GET → Infomaniak v1 import →
 *     vodMediaId + status "processing".
 *  3. syncInfomaniakVideo() pulls GET /2/vod/media/{id} and fills the row once
 *     ready (HLS, highest MP4, poster copied to our S3, captions), requests AI
 *     subtitles, and deletes the S3 upload object. Triggered by the callback
 *     (src/app/api/webhooks/infomaniak-vod), the dashboard poll
 *     (/api/videos/sync) and the daily cron — callbacks can't reach localhost
 *     and may be missed in production.
 *
 * Idempotent: every step checks the stored metadata first, the subtitle
 * request is claimed with a conditional UPDATE (duplicate callbacks arrive
 * concurrently), the poster copy is content-addressed and S3 deletes are
 * no-ops on missing keys. Cost per sync of a pending row: 1–2 VOD API calls.
 */

import { createHash, randomBytes } from 'crypto'
import { Prisma } from '@prisma/client'
import { prisma } from './prisma'
import {
  deleteFromS3,
  generatePresignedDownloadUrl,
  getTeacherBucketName,
  getTeacherFileUrl,
  uploadTeacherFile,
} from './s3'
import {
  getMedia,
  getVodConfig,
  importFromUrl,
  listSubtitles,
  parseMedia,
  requestSubtitles,
  type VodConfig,
} from './infomaniak-vod'
import { invalidateSkriptFiles } from './skript-files.server'
import type { VideoCaption } from './video-playback'

/** Give up waiting for AI subtitles after this long (silent clips never get any). */
export const SUBTITLE_TIMEOUT_MS = 30 * 60 * 1000

export type VideoMeta = Record<string, unknown>

export function requireVodConfig(): VodConfig {
  const config = getVodConfig()
  if (!config) {
    throw new Error('Video hosting is not configured (INFOMANIAK_VOD_TOKEN / _CHANNEL / _FOLDER).')
  }
  return config
}

/** S3 key for a fresh upload. Random part because the teacher bucket is publicly readable. */
export function newUploadKey(filename: string): string {
  const ext = (filename.split('.').pop() || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp4'
  return `video-uploads/${randomBytes(16).toString('hex')}.${ext}`
}

/**
 * Hand the uploaded S3 object to Infomaniak. No-op if the row already has a
 * media id (double-clicks, retries). Returns the updated metadata.
 */
export async function startInfomaniakImport(videoId: string): Promise<VideoMeta> {
  const video = await prisma.video.findUnique({ where: { id: videoId } })
  if (!video || video.provider !== 'infomaniak') throw new Error('Video not found')
  const meta = (video.metadata ?? {}) as VideoMeta
  if (meta.mediaId) return meta
  const uploadKey = typeof meta.uploadKey === 'string' ? meta.uploadKey : null
  if (!uploadKey) throw new Error('Video has no pending upload')

  const config = requireVodConfig()
  // 24 h: Infomaniak queues imports; the URL must survive the queue.
  const sourceUrl = await generatePresignedDownloadUrl(uploadKey, 24 * 3600, getTeacherBucketName())
  const mediaId = await importFromUrl(config, sourceUrl, video.filename)

  const next: VideoMeta = { ...meta, mediaId, status: 'processing' }
  await prisma.video.update({
    where: { id: videoId },
    data: { vodMediaId: mediaId, metadata: next as Prisma.InputJsonValue },
  })
  invalidateSkriptFiles()
  return next
}

/** Copy the Infomaniak poster into our S3 (cacheable, content-addressed). Falls back to the source URL. */
async function copyPoster(posterUrl: string): Promise<string> {
  try {
    const res = await fetch(posterUrl)
    if (!res.ok) throw new Error(`poster fetch ${res.status}`)
    const buf = Buffer.from(await res.arrayBuffer())
    const hash = createHash('sha256').update(buf).digest('hex')
    const key = await uploadTeacherFile(hash, 'jpg', buf, 'image/jpeg')
    return getTeacherFileUrl(key)
  } catch (err) {
    console.warn('[video-sync] poster copy failed, using Infomaniak URL:', err instanceof Error ? err.message : err)
    return posterUrl
  }
}

/**
 * Atomically mark that subtitles were requested. Returns true for exactly one
 * caller per row, so concurrent duplicate callbacks request them once.
 */
async function claimSubtitleRequest(videoId: string, at: string): Promise<boolean> {
  const count = await prisma.$executeRaw`
    UPDATE videos
       SET metadata = metadata || jsonb_build_object('subtitlesRequestedAt', ${at}::text)
     WHERE id = ${videoId} AND NOT (metadata ? 'subtitlesRequestedAt')`
  return count === 1
}

export function needsSync(meta: VideoMeta): boolean {
  if (!meta.mediaId) return false
  if (meta.status === 'errored') return false
  return meta.status !== 'ready' || meta.captionsStatus === 'pending' || !meta.posterSource || !!meta.uploadKey
}

/**
 * Pull the media state from Infomaniak and write it to the row. Safe to call
 * any number of times; does nothing for rows that are fully synced.
 */
export async function syncInfomaniakVideo(videoId: string, now: Date = new Date()): Promise<VideoMeta | null> {
  const video = await prisma.video.findUnique({ where: { id: videoId } })
  if (!video || video.provider !== 'infomaniak') return null
  const meta = (video.metadata ?? {}) as VideoMeta
  if (!needsSync(meta)) return meta

  const config = requireVodConfig()
  const mediaId = meta.mediaId as string
  const parsed = parseMedia(await getMedia(config, mediaId))
  let next: VideoMeta = { ...meta }

  if (parsed.state === 'failed') {
    next.status = 'errored'
    next.error = 'Encoding failed at Infomaniak'
  } else if (parsed.state === 'processing') {
    next.status = 'processing'
  } else {
    next = {
      ...next,
      status: 'ready',
      hlsUrl: parsed.hlsUrl,
      mp4Url: parsed.mp4Url,
      duration: parsed.duration,
      aspectRatio: parsed.aspectRatio ?? next.aspectRatio,
      readyAt: next.readyAt ?? now.toISOString(),
    }

    // Poster: arrives with/after THUMBNAIL_FINISHED, possibly after "ready".
    if (parsed.posterUrl && next.posterSource !== parsed.posterUrl) {
      next.poster = await copyPoster(parsed.posterUrl)
      next.posterSource = parsed.posterUrl
    }

    // Captions: AI transcription, requested once after encoding.
    const subs = await listSubtitles(config, mediaId)
    const ready: VideoCaption[] = subs
      .filter(s => s.ready)
      .map(s => ({ src: s.vttUrl, lang: s.lang, label: s.label }))
    if (ready.length > 0) {
      next.captions = ready
      next.captionsStatus = 'ready'
    } else {
      if (subs.length === 0 && !next.subtitlesRequestedAt) {
        const at = now.toISOString()
        if (await claimSubtitleRequest(videoId, at)) {
          await requestSubtitles(config, mediaId)
          next.subtitlesRequestedAt = at
        } else {
          const fresh = await prisma.video.findUnique({ where: { id: videoId }, select: { metadata: true } })
          next.subtitlesRequestedAt = (fresh?.metadata as VideoMeta | null)?.subtitlesRequestedAt ?? at
        }
      }
      const since = Date.parse(String(next.subtitlesRequestedAt ?? next.readyAt))
      next.captions = []
      next.captionsStatus = now.getTime() - since > SUBTITLE_TIMEOUT_MS ? 'none' : 'pending'
    }

    // The S3 upload is no longer needed once Infomaniak has encoded it.
    if (typeof next.uploadKey === 'string') {
      try {
        await deleteFromS3(next.uploadKey, getTeacherBucketName())
      } catch (err) {
        console.warn('[video-sync] could not delete upload object:', err instanceof Error ? err.message : err)
      }
      delete next.uploadKey
    }
  }

  if (JSON.stringify(next) !== JSON.stringify(meta)) {
    await prisma.video.update({ where: { id: videoId }, data: { metadata: next as Prisma.InputJsonValue } })
    // M2M with skripts and called from id-only contexts → drop all file caches.
    invalidateSkriptFiles()
  }
  return next
}

/** Rows sharing a media id: the owner (vodMediaId) plus page-copy duplicates (metadata.mediaId). */
export async function findVideosByMediaId(mediaId: string): Promise<string[]> {
  const rows = await prisma.video.findMany({
    where: {
      provider: 'infomaniak',
      OR: [{ vodMediaId: mediaId }, { metadata: { path: ['mediaId'], equals: mediaId } }],
    },
    select: { id: true },
  })
  return rows.map(r => r.id)
}

/**
 * Sync every unfinished Infomaniak row updated within `maxAgeDays`. Used by
 * the daily cron as the last-resort fallback for missed callbacks. O(n) VOD
 * API calls in pending rows, sequential.
 */
export async function syncPendingInfomaniakVideos(maxAgeDays = 7): Promise<{ checked: number; failed: number }> {
  const since = new Date(Date.now() - maxAgeDays * 24 * 3600 * 1000)
  const rows = await prisma.video.findMany({
    where: { provider: 'infomaniak', updatedAt: { gte: since } },
    select: { id: true, metadata: true },
  })
  let checked = 0
  let failed = 0
  for (const row of rows) {
    if (!needsSync((row.metadata ?? {}) as VideoMeta)) continue
    checked++
    try {
      await syncInfomaniakVideo(row.id)
    } catch (err) {
      failed++
      console.error('[video-sync] sync failed for', row.id, err instanceof Error ? err.message : err)
    }
  }
  return { checked, failed }
}
