'use client'

import dynamic from 'next/dynamic'
import { useRef, type ReactElement } from 'react'
import type { SkriptFilesData } from '@/lib/skript-files'
import { resolveUrl, resolveVideo } from '@/lib/skript-files'
import { useVideoGate, CouplingToggle } from './coupled-video-context'
import { StickMe } from './stick-me'

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
  /** Pin the player into a corner overlay once it scrolls off the top. */
  pin?: boolean
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

export function MuxVideo({ src, alt = '', poster: posterOverride, className, pin, files }: MuxVideoProps): ReactElement {
  // Coupled-video gating. next/dynamic doesn't reliably forward refs, so we
  // capture the underlying <mux-player> element (which implements the media
  // element API: currentTime, pause(), play()) from the media events instead.
  // Declared before the early return below so hook order stays stable.
  const playerElRef = useRef<HTMLMediaElement | null>(null)
  const { onTimeUpdate, onManualPlay } = useVideoGate({
    pause: () => playerElRef.current?.pause(),
    play: () => {
      const p = playerElRef.current?.play()
      if (p && typeof p.catch === 'function') p.catch(() => {})
    },
  })

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

  // preload="none": don't fetch video manifest, audio/video chunks, or
  // subtitle tracks until the user actually plays. Default Mux behaviour
  // pulls 4-6 segment requests on mount, which kept the page tab in
  // "loading" state for several seconds on slower connections even though
  // most visitors never play the video. Trade-off: ~200-400 ms buffering
  // pause when Play is first clicked. The poster image still preloads, so
  // the player still looks ready. Pages that explicitly mark a video as
  // autoplay opt back into preloading by setting preload="auto".
  const preloadStrategy = alt.includes('autoplay') ? 'auto' : 'none'

  return (
    <span className="block">
      <StickMe enabled={pin} footer={<CouplingToggle />} storageKey={`coupled-video:${src}`}>
      <MuxPlayer
        playbackId={playbackId}
        poster={poster}
        placeholder={blurDataURL ?? ''}
        accentColor="hsl(var(--primary))"
        className={`rounded-lg overflow-hidden ${className ?? ''}`}
        style={{ aspectRatio: aspectRatio ?? 16 / 9 }}
        autoPlay={alt.includes('autoplay')}
        loop={alt.includes('loop')}
        preload={preloadStrategy}
        disableTracking // Disable Mux analytics to avoid CORS issues
        onTimeUpdate={(e: Event) => {
          const el = e.target as HTMLMediaElement | null
          if (!el) return
          playerElRef.current = el
          onTimeUpdate(el.currentTime)
        }}
        onPlay={(e: Event) => {
          playerElRef.current = (e.target as HTMLMediaElement | null) ?? playerElRef.current
          onManualPlay()
        }}
      />
      </StickMe>
    </span>
  )
}
