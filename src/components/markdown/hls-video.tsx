'use client'

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactElement } from 'react'
import { Play } from 'lucide-react'
import type { VideoCaption } from '@/lib/video-playback'

/**
 * Plain <video> + hls.js (bundled from npm, loaded on demand — no CDN).
 * Replaced @mux/mux-player-react on 2026-10-12 so that a page view only
 * contacts the video host itself (Infomaniak, CH; Mux for not-yet-migrated
 * rows) and nothing else — mux-player also pulled its own analytics/CDN code.
 *
 * Loading:
 *  - preload "none" (default): nothing is fetched except the poster. A play
 *    button overlays the poster; clicking it imports hls.js, loads the
 *    manifest and starts playback. Native controls appear from then on.
 *    Trade-off: hls.js (~150 kB gz) and the first segments load after the
 *    click, so the first play takes a moment longer.
 *  - preload "auto" (gif/autoplay): loads on mount and plays muted.
 *  - Safari/iOS without MSE: native HLS via video.src.
 *
 * Captions: out-of-band WebVTT as <track> (Infomaniak); Mux manifests carry
 * their captions in-band, hls.js exposes those as text tracks itself. Tracks
 * are not "default", so browsers fetch them only when the viewer turns
 * captions on. crossOrigin="anonymous" is required for cross-origin tracks.
 */

export interface HlsVideoProps {
  hlsUrl: string
  poster?: string
  captions?: VideoCaption[]
  aspectRatio?: number
  /** Muted autoplay, loop, no controls, not clickable. */
  gif?: boolean
  /** Muted autoplay with controls. */
  autoplay?: boolean
  loop?: boolean
  className?: string
  style?: CSSProperties
  onTimeUpdate?: (el: HTMLVideoElement) => void
  onPlay?: (el: HTMLVideoElement) => void
}

type HlsInstance = { destroy(): void }

export function HlsVideo({
  hlsUrl,
  poster,
  captions = [],
  aspectRatio,
  gif = false,
  autoplay = false,
  loop = false,
  className,
  style,
  onTimeUpdate,
  onPlay,
}: HlsVideoProps): ReactElement {
  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsRef = useRef<HlsInstance | null>(null)
  const eager = gif || autoplay
  const [activated, setActivated] = useState(eager)

  // Attach the stream once activated. Re-runs only when the URL changes.
  useEffect(() => {
    const video = videoRef.current
    if (!video || !activated) return
    let cancelled = false

    const start = async () => {
      const { default: Hls } = await import('hls.js')
      if (cancelled) return
      if (Hls.isSupported()) {
        const hls = new Hls({ capLevelToPlayerSize: true })
        hls.loadSource(hlsUrl)
        hls.attachMedia(video)
        hlsRef.current = hls
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = hlsUrl
      } else {
        return
      }
      const p = video.play()
      if (p && typeof p.catch === 'function') p.catch(() => {})
    }
    start()

    return () => {
      cancelled = true
      hlsRef.current?.destroy()
      hlsRef.current = null
    }
  }, [activated, hlsUrl])

  const activate = useCallback(() => setActivated(true), [])

  return (
    <span
      className={`relative block bg-black rounded-lg overflow-hidden ${className ?? ''}`}
      style={{ aspectRatio: aspectRatio ?? 16 / 9, ...(gif ? { pointerEvents: 'none' as const } : {}), ...style }}
    >
      <video
        ref={videoRef}
        className="block w-full h-full object-contain"
        poster={poster}
        preload={eager ? 'auto' : 'none'}
        crossOrigin="anonymous"
        controls={!gif && activated}
        muted={eager}
        autoPlay={eager}
        playsInline
        loop={gif || loop}
        onTimeUpdate={e => onTimeUpdate?.(e.currentTarget)}
        onPlay={e => onPlay?.(e.currentTarget)}
      >
        {captions.map(c => (
          <track key={c.src} kind="subtitles" src={c.src} srcLang={c.lang} label={c.label} />
        ))}
      </video>
      {!activated && (
        <button
          type="button"
          onClick={activate}
          aria-label="Play video"
          className="absolute inset-0 flex items-center justify-center group"
        >
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-black/60 text-white transition-transform group-hover:scale-110">
            <Play className="h-7 w-7 translate-x-0.5" fill="currentColor" />
          </span>
        </button>
      )}
    </span>
  )
}
