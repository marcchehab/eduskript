'use client'

import Image from 'next/image'
import { useState, useEffect, useRef, useCallback } from 'react'
import { usePathname } from 'next/navigation'
import { useVideoGate, CouplingToggle } from './coupled-video-context'
import { StickMe } from './stick-me'

interface YoutubeProps {
  id?: string
  playlist?: string
  startTime?: number
  caption?: string
  /** Stick the video to the top of the viewport while scrolling. */
  pin?: boolean
}

/** 1280x720. Missing for some older/low-res uploads — hence the fallback. */
const maxResThumb = (id: string) => `https://img.youtube.com/vi/${id}/maxresdefault.jpg`
/** 480x360. YouTube generates this for every video. */
const fallbackThumb = (id: string) => `https://img.youtube.com/vi/${id}/hqdefault.jpg`

export function Youtube({ id, playlist, startTime, caption, pin }: YoutubeProps) {
  const [isOpen, setIsOpen] = useState(false)
  // Derived from the id, not fetched: the <img> is then part of the server-
  // rendered HTML and starts downloading with everything else on the page.
  // State only so onError can fall back; `thumbFor` tracks which id it belongs
  // to, so a changed id resets it during render rather than in an effect.
  const [thumbnailUrl, setThumbnailUrl] = useState(() => (id ? maxResThumb(id) : null))
  const [thumbFor, setThumbFor] = useState(id)
  if (thumbFor !== id) {
    setThumbFor(id)
    setThumbnailUrl(id ? maxResThumb(id) : null)
  }
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const pathname = usePathname()

  // Unique ID for targeting this specific video from timestamp links
  const uniqueId = `${id}-${pathname?.replace(/\//g, '-') || 'default'}`

  const handleClick = useCallback(() => setIsOpen(true), [])

  const buildEmbedUrl = useCallback(() => {
    const params = new URLSearchParams()
    params.append('autoplay', '1')
    params.append('enablejsapi', '1')
    if (typeof window !== 'undefined') {
      params.append('origin', window.location.origin)
    }
    if (startTime) params.append('start', startTime.toString())
    if (playlist) params.append('list', playlist)

    return `https://www.youtube.com/embed/${id}?${params.toString()}`
  }, [id, startTime, playlist])

  // Listen for timestamp navigation events from YT components
  useEffect(() => {
    if (!isOpen || !iframeRef.current) return

    const handleTimestampClick = (event: MessageEvent) => {
      if (event.data.type === 'youtube-seek' && event.data.targetId === uniqueId) {
        const iframe = iframeRef.current
        if (iframe?.contentWindow) {
          // Send seekTo command to YouTube iframe
          iframe.contentWindow.postMessage(
            JSON.stringify({
              event: 'command',
              func: 'seekTo',
              args: [event.data.time, true]
            }),
            '*'
          )

          // Ensure video is playing
          iframe.contentWindow.postMessage(
            JSON.stringify({
              event: 'command',
              func: 'playVideo'
            }),
            '*'
          )

          // Scroll to video
          iframe.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
      }
    }

    window.addEventListener('message', handleTimestampClick)
    return () => window.removeEventListener('message', handleTimestampClick)
  }, [isOpen, uniqueId])

  // ── Coupled-video gating ────────────────────────────────────────────────
  const postCommand = useCallback((func: string, args: unknown[] = []) => {
    iframeRef.current?.contentWindow?.postMessage(
      JSON.stringify({ event: 'command', func, args }),
      '*',
    )
  }, [])

  const { onTimeUpdate, onManualPlay } = useVideoGate({
    pause: () => postCommand('pauseVideo'),
    play: () => postCommand('playVideo'),
  })

  // YouTube IFrame API over postMessage. The player only streams state once
  // it receives an {event:'listening'} message; it then sends `infoDelivery`
  // events carrying currentTime (coarse ~250ms ticks) and playerState.
  useEffect(() => {
    if (!isOpen) return
    const iframe = iframeRef.current

    const handle = (event: MessageEvent) => {
      if (typeof event.data !== 'string') return
      let data: { event?: string; info?: { currentTime?: number; playerState?: number } }
      try {
        data = JSON.parse(event.data)
      } catch {
        return
      }
      if (data?.event === 'infoDelivery' && data.info) {
        if (typeof data.info.currentTime === 'number') onTimeUpdate(data.info.currentTime)
        // playerState 1 = playing. Treat as a manual resume so a user override
        // past an unsatisfied gate isn't immediately re-paused (soft gating).
        if (data.info.playerState === 1) onManualPlay()
      }
    }

    const startListening = () =>
      iframe?.contentWindow?.postMessage(JSON.stringify({ event: 'listening' }), '*')

    window.addEventListener('message', handle)
    iframe?.addEventListener('load', startListening)
    const kick = setTimeout(startListening, 500)
    return () => {
      window.removeEventListener('message', handle)
      iframe?.removeEventListener('load', startListening)
      clearTimeout(kick)
    }
  }, [isOpen, onTimeUpdate, onManualPlay])

  // Early return after all hooks
  if (!id && !playlist) return <div>No video id or playlist provided</div>

  const captionNode = caption
    ? <span className="block text-center text-sm text-muted-foreground mt-2">{caption}</span>
    : null

  // The player (thumbnail before open, iframe after) — this is what gets
  // pinned into the corner overlay when `pin` and the user scrolls past it.
  const player = !isOpen ? (
    <span
      className="relative cursor-pointer aspect-video block rounded-lg overflow-hidden"
      onClick={handleClick}
    >
      <span className="absolute inset-0 overflow-hidden bg-muted">
        <Image
          src={thumbnailUrl || fallbackThumb(id ?? '')}
          fill
          sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
          alt="YouTube video thumbnail"
          className="object-cover"
          // Straight from YouTube's CDN. Routing it through /_next/image added
          // a hop to our own server, which then had to fetch and re-encode a
          // JPEG that is already small and edge-cached.
          unoptimized
          onError={() => {
            // maxresdefault does not exist for every video; hqdefault always does.
            if (id && thumbnailUrl !== fallbackThumb(id)) setThumbnailUrl(fallbackThumb(id))
          }}
        />
      </span>
      <span className="absolute inset-0 flex items-center justify-center">
        <span className="bg-black/50 rounded-full p-4 transition-transform hover:scale-110">
          <svg className="w-16 h-16 text-white" fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z" />
          </svg>
        </span>
        {playlist && (
          <span className="absolute bottom-4 right-4 bg-black/70 text-white px-2 py-1 rounded-md text-sm flex items-center">
            <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 24 24">
              <path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-1 9h-4v4h-2v-4H9V9h4V5h2v4h4v2z" />
            </svg>
            Playlist
          </span>
        )}
      </span>
    </span>
  ) : (
    <iframe
      ref={iframeRef}
      className="w-full aspect-video rounded-lg"
      src={buildEmbedUrl()}
      title="YouTube Video"
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
      allowFullScreen
    />
  )

  return (
    <span className="block my-6">
      <StickMe enabled={pin} footer={<CouplingToggle />} storageKey={`coupled-video:${id ?? 'yt'}`}>{player}</StickMe>
      {captionNode}
    </span>
  )
}

// ============================================================================
// YT - Timestamp link component
// ============================================================================

interface YTProps {
  time: number      // Time in seconds
  videoId: string   // YouTube video ID to target
  label: string     // Display text
}

/**
 * YT - Clickable timestamp link that seeks a Youtube video to specific time.
 * Works with Youtube component via postMessage.
 */
export function YT({ time, videoId, label }: YTProps) {
  const pathname = usePathname()
  const uniqueId = `${videoId}-${pathname?.replace(/\//g, '-') || 'default'}`

  const formatTime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600)
    const mins = Math.floor((seconds % 3600) / 60)
    const secs = seconds % 60

    if (hours > 0) {
      return `${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault()
    window.postMessage({
      type: 'youtube-seek',
      targetId: uniqueId,
      time: time
    }, window.location.origin)
  }

  return (
    <a
      href="#"
      onClick={handleClick}
      className="inline-flex items-center gap-2 text-primary hover:text-primary/80 hover:underline cursor-pointer"
    >
      <span className="font-mono text-sm bg-muted px-1.5 py-0.5 rounded">
        {formatTime(time)}
      </span>
      <span>{label}</span>
    </a>
  )
}
