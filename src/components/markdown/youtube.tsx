'use client'

import Image from 'next/image'
import { useState, useEffect, useRef, useCallback } from 'react'
import { usePathname } from 'next/navigation'

interface YoutubeProps {
  id?: string
  playlist?: string
  startTime?: number
}

export function Youtube({ id, playlist, startTime }: YoutubeProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
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

  useEffect(() => {
    if (!id) return

    const thumbnailQualities = [
      'maxresdefault.jpg',
      'sddefault.jpg',
      'hqdefault.jpg',
      'mqdefault.jpg',
      'default.jpg'
    ]

    const checkThumbnail = async (index = 0) => {
      if (index >= thumbnailQualities.length) {
        setThumbnailUrl(`https://img.youtube.com/vi/${id}/hqdefault.jpg`)
        setIsLoading(false)
        return
      }

      const url = `https://img.youtube.com/vi/${id}/${thumbnailQualities[index]}`

      try {
        const response = await fetch(url, { method: 'HEAD' })
        if (response.ok) {
          setThumbnailUrl(url)
          setIsLoading(false)
        } else {
          checkThumbnail(index + 1)
        }
      } catch {
        checkThumbnail(index + 1)
      }
    }

    checkThumbnail(0)
  }, [id])

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

  // Early return after all hooks
  if (!id && !playlist) return <div>No video id or playlist provided</div>

  if (!isOpen) {
    return (
      <span className="block my-6">
        <span
          className="relative cursor-pointer aspect-video block rounded-lg overflow-hidden"
          onClick={handleClick}
        >
          {isLoading ? (
            <span className="absolute inset-0 bg-muted animate-pulse flex items-center justify-center">
              <span className="text-muted-foreground">Loading thumbnail...</span>
            </span>
          ) : (
            <span className="absolute inset-0 overflow-hidden">
              <Image
                src={thumbnailUrl || `https://img.youtube.com/vi/${id}/hqdefault.jpg`}
                fill
                sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                alt="YouTube video thumbnail"
                className="object-cover"
                priority
              />
            </span>
          )}
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="bg-black/50 rounded-full p-4 transition-transform hover:scale-110">
              <svg
                className="w-16 h-16 text-white"
                fill="currentColor"
                viewBox="0 0 24 24"
              >
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
      </span>
    )
  }

  return (
    <span className="block my-6">
      <iframe
        ref={iframeRef}
        className="w-full aspect-video rounded-lg"
        src={buildEmbedUrl()}
        title="YouTube Video"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
      />
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
