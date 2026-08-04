/**
 * Server-only SkriptFiles functions.
 *
 * This file contains functions that use Prisma and should only be imported
 * in server components or API routes.
 */

import { revalidateTag, unstable_cache } from 'next/cache'
import { prisma } from './prisma'
import { CACHE_TAGS } from './cached-queries'
import { getS3Key } from './file-storage'
import { getTeacherFileUrl } from './s3'
import type { SkriptFilesData, SkriptFile, VideoInfo } from './skript-files'

/**
 * SSR: Query database for all files and videos associated with a skript.
 * Call this once at the start of rendering, not per-file.
 */
async function fetchSkriptFiles(skriptId: string): Promise<SkriptFilesData> {
  // Fetch all files for this skript
  const dbFiles = await prisma.file.findMany({
    where: {
      skriptId,
      isDirectory: false,
    },
    select: {
      id: true,
      name: true,
      hash: true,
      width: true,
      height: true,
    },
  })

  // Fetch videos connected to this skript via the SkriptVideos M2M
  const allVideos = await prisma.video.findMany({
    where: { skripts: { some: { id: skriptId } } },
    select: {
      id: true,
      filename: true,
      provider: true,
      metadata: true,
    },
  })

  // Build files record — all URLs point directly to S3 (public bucket)
  const files: Record<string, SkriptFile> = {}
  for (const file of dbFiles) {
    const ext = file.name.split('.').pop() || ''
    const url = file.hash
      ? getTeacherFileUrl(getS3Key(file.hash, ext))
      : `/api/files/${file.id}`

    files[file.name] = {
      id: file.id,
      name: file.name,
      url,
      width: file.width ?? undefined,
      height: file.height ?? undefined,
    }
  }

  // Build videos record - include all videos for now (they're global)
  const videos: Record<string, VideoInfo> = {}
  for (const video of allVideos) {
    const metadata = video.metadata as Record<string, unknown>
    videos[video.filename] = {
      id: video.id,
      filename: video.filename,
      provider: video.provider,
      metadata: {
        playbackId: metadata?.playbackId as string | undefined,
        poster: metadata?.poster as string | undefined,
        blurDataURL: metadata?.blurDataURL as string | undefined,
        aspectRatio: typeof metadata?.aspectRatio === 'number' ? metadata.aspectRatio : undefined,
        assetId: metadata?.assetId as string | undefined,
        status: metadata?.status as string | undefined,
      },
    }
  }

  return { env: 'ssr', files, videos }
}

/**
 * Coarse tag for callers that cannot name the affected skript — the Mux webhook
 * and the admin video tools work from an asset or video id, and a video is M2M
 * with skripts. Dropping every skript's file cache is fine there: both are rare,
 * manual events, and the entries rebuild from two indexed queries.
 */
export const SKRIPT_FILES_TAG = 'skript-files'

/**
 * Drop the cached file/video listing after a write.
 *
 * Call with the skript id where it is known, without it where it is not. Every
 * writer of File or Video rows must call this — see the list in the callers:
 * upload confirm, file delete, files/import, import, import-actions,
 * file-storage, videos upload-url, videos import, video delete, admin videos,
 * Mux webhook.
 */
export function invalidateSkriptFiles(skriptId?: string | null): void {
  revalidateTag(SKRIPT_FILES_TAG, { expire: 0 })
  if (skriptId) revalidateTag(CACHE_TAGS.skript(skriptId), { expire: 0 })
}

/**
 * Cached wrapper — 2 queries on every markdown render otherwise.
 *
 * Tag-based and never time-expiring. It used to be `revalidate: 60`, which was
 * a defensible trade on its own (files are written from a dozen places, none of
 * which invalidated anything, so a forever-cache would have hidden a teacher's
 * fresh upload until the next deploy) — but it was not local in effect. A
 * route's revalidation is the MINIMUM of its segment config and every cached
 * source used during the render, and this one is reached from
 * ServerMarkdownRenderer, i.e. from every public page. So one 60-second data
 * cache silently overrode `export const revalidate = false` across the whole
 * site: measured, a homepage went stale ~2 minutes after being warmed, which is
 * why the database never got its 5-minute idle window no matter how much else
 * was cached.
 */
export async function getSkriptFiles(skriptId: string): Promise<SkriptFilesData> {
  return unstable_cache(
    () => fetchSkriptFiles(skriptId),
    ['skript-files', skriptId],
    { tags: [SKRIPT_FILES_TAG, CACHE_TAGS.skript(skriptId)], revalidate: false }
  )()
}
