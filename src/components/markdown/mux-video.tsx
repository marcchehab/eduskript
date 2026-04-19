'use client'

import dynamic from 'next/dynamic'
import type { ReactElement } from 'react'
import type { SkriptFilesData } from '@/lib/skript-files'
import { resolveUrl, resolveVideo } from '@/lib/skript-files'

interface MuxVideoProps {
  src: string // Filename (e.g., "video.mp4")
  alt?: string
  /**
   * Optional poster override. Either:
   *   - a filename that exists in the skript's files (resolved via `files`), or
   *   - an absolute URL (`http(s)://` or `/...`) used as-is.
   * When omitted, falls back to the auto-generated Mux thumbnail from the
   * video's metadata (frame at time=0).
   */
  poster?: string
  className?: string
  // Files data for resolving video metadata (serializable)
  files?: SkriptFilesData
}

// Dynamic import with ssr: false ensures client-only rendering
const MuxPlayer = dynamic(
  () => import('@mux/mux-player-react').then((mod) => mod.default),
  {
    ssr: false,
    loading: () => (
      <span
        className="block bg-muted animate-pulse rounded-lg"
        style={{ aspectRatio: '16/9' }}
      />
    )
  }
)

function resolvePoster(value: string | undefined, files: SkriptFilesData | undefined): string | undefined {
  if (!value) return undefined
  // Absolute URLs pass through unchanged.
  if (value.startsWith('http://') || value.startsWith('https://') || value.startsWith('/')) {
    return value
  }
  // Otherwise treat as a filename to look up in the skript files.
  return files ? resolveUrl(files, value) : undefined
}

export function MuxVideo({ src, alt = '', poster: posterOverride, className, files }: MuxVideoProps): ReactElement {
  // Resolve video metadata
  const videoInfo = files ? resolveVideo(files, src) : undefined
  const { playbackId, poster: defaultPoster, blurDataURL, aspectRatio } = videoInfo?.metadata ?? {}

  // If no playback ID, show placeholder
  if (!playbackId) {
    return (
      <span className="block bg-muted rounded-lg p-4 text-center text-muted-foreground" style={{ aspectRatio: '16/9' }}>
        <span className="block">Video not found: {src}</span>
        <span className="block text-xs mt-1">Make sure the video has been uploaded to Mux</span>
      </span>
    )
  }

  // Author-supplied poster wins; fall back to Mux's auto-generated one.
  const poster = resolvePoster(posterOverride, files) ?? defaultPoster

  return (
    <MuxPlayer
      playbackId={playbackId}
      poster={poster}
      placeholder={blurDataURL ?? ''}
      accentColor="hsl(var(--primary))"
      className={`rounded-lg overflow-hidden ${className ?? ''}`}
      style={{ aspectRatio: aspectRatio ?? 16 / 9 }}
      autoPlay={alt.includes('autoplay')}
      loop={alt.includes('loop')}
      disableTracking // Disable Mux analytics to avoid CORS issues
    />
  )
}
