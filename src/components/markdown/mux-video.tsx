'use client'

import { useRef, type ReactElement } from 'react'
import type { SkriptFilesData } from '@/lib/skript-files'
import { resolveUrl, resolveVideo } from '@/lib/skript-files'
import { getVideoPlayback, isVideoPending } from '@/lib/video-playback'
import { useVideoGate, CouplingToggle } from './coupled-video-context'
import { HlsVideo } from './hls-video'
import { StickMe } from './stick-me'

interface MuxVideoProps {
  src: string // Filename (e.g., "video.mp4")
  alt?: string
  /**
   * Optional poster override. Either:
   *   - a filename that exists in the skript's files (resolved via `files`), or
   *   - an absolute URL (`http(s)://` or `/...`) used as-is.
   * When omitted, falls back to the provider's auto-generated poster from the
   * video's metadata.
   */
  poster?: string
  className?: string
  /** Pin the player into a corner overlay once it scrolls off the top. */
  pin?: boolean
  /** Start playing on load. Unmuted autoplay is blocked by browsers — the
   *  player therefore autoplays muted. */
  autoplay?: boolean
  loop?: boolean
  /** Play it like an animated GIF: muted autoplay, looping, no controls, not
   *  clickable. Implies autoplay + loop. */
  gif?: boolean
  // Files data for resolving video metadata (serializable)
  files?: SkriptFilesData
}

function resolvePoster(value: string | undefined, files: SkriptFilesData | undefined): string | undefined {
  if (!value) return undefined
  // Absolute URLs pass through unchanged.
  if (value.startsWith('http://') || value.startsWith('https://') || value.startsWith('/')) {
    return value
  }
  // Otherwise treat as a filename to look up in the skript files.
  return files ? resolveUrl(files, value) : undefined
}

export function MuxVideo({
  src,
  alt = '',
  poster: posterOverride,
  className,
  pin,
  autoplay: autoplayProp,
  loop: loopProp,
  gif: gifProp,
  files,
}: MuxVideoProps): ReactElement {
  // Coupled-video gating: capture the <video> element from its media events
  // (currentTime, pause(), play()).
  // Declared before the early return below so hook order stays stable.
  const playerElRef = useRef<HTMLMediaElement | null>(null)
  const { onTimeUpdate, onManualPlay } = useVideoGate({
    pause: () => playerElRef.current?.pause(),
    play: () => {
      const p = playerElRef.current?.play()
      if (p && typeof p.catch === 'function') p.catch(() => {})
    },
  })

  // Resolve video metadata → provider-specific HLS source (self-hosted or legacy Mux)
  const videoInfo = files ? resolveVideo(files, src) : undefined
  const playback = videoInfo ? getVideoPlayback(videoInfo.provider, videoInfo.metadata) : null

  if (!playback) {
    const processing = isVideoPending(videoInfo?.metadata)
    return (
      <span className="block bg-muted rounded-lg p-4 text-center text-muted-foreground" style={{ aspectRatio: '16/9' }}>
        <span className="block">{processing ? `Video is still processing: ${src}` : `Video not found: ${src}`}</span>
        {!processing && <span className="block text-xs mt-1">Make sure the video has been uploaded</span>}
      </span>
    )
  }

  // Author-supplied poster wins; fall back to the provider's one.
  const poster = resolvePoster(posterOverride, files) ?? playback.poster

  // preload: nothing but the poster loads until the viewer presses play
  // (see hls-video.tsx). The old Mux player pulled 4-6 segment
  // requests on mount, which kept the page tab in "loading" state for seconds
  // on slow connections although most visitors never play the video. gif and
  // autoplay videos load on mount.
  //
  // Playback flags come from the tag (`<muxvideo src="x.mp4" gif />`). Before
  // 2026-07-29 they were keywords in the alt text (`![gif loop](x.mp4)`); that
  // spelling still works so existing pages don't change behaviour, but the
  // attributes are the documented form.
  const gif = gifProp || alt.includes('gif')
  const autoplay = autoplayProp || alt.includes('autoplay')
  const loop = loopProp || alt.includes('loop')

  return (
    <span className="block">
      <StickMe enabled={pin} footer={<CouplingToggle />} storageKey={`coupled-video:${src}`}>
      <HlsVideo
        hlsUrl={playback.hlsUrl}
        poster={poster}
        captions={playback.captions}
        thumbnailsVtt={playback.thumbnailsVtt}
        aspectRatio={playback.aspectRatio}
        className={className}
        gif={gif}
        autoplay={autoplay}
        loop={loop}
        onTimeUpdate={el => {
          playerElRef.current = el
          onTimeUpdate(el.currentTime)
        }}
        onPlay={el => {
          playerElRef.current = el
          onManualPlay()
        }}
      />
      </StickMe>
    </span>
  )
}
