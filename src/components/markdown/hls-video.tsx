'use client'

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactElement } from 'react'
import { Captions, Maximize, Minimize, Pause, Play, Settings, Volume2, VolumeX } from 'lucide-react'
import type { VideoCaption } from '@/lib/video-playback'

/**
 * <video> + hls.js (bundled from npm, loaded on demand — no CDN) with our own
 * controls: play/pause, scrubber with sprite thumbnails on hover/drag, time,
 * mute + volume, captions toggle, settings (quality Auto/1080p/720p/480p, speed),
 * fullscreen. Custom controls because native ones can't host a quality menu
 * or scrub previews. Replaced @mux/mux-player-react (2026-10).
 *
 * Loading:
 *  - preload "none" (default): only the poster loads. A play button overlays
 *    it; clicking imports hls.js, loads the manifest and plays. Trade-off:
 *    hls.js (~150 kB gz) and the first segments load after the click.
 *  - gif/autoplay: loads on mount, muted.
 *  - Safari/iOS without MSE: native HLS via video.src — no quality menu
 *    (Safari picks), captions still work (out-of-band <track> or in-manifest).
 *
 * Captions: out-of-band WebVTT <track>s (self-hosted) or in-manifest (Mux; hls.js
 * exposes them as text tracks and follows their mode). Not "default", so a
 * VTT is fetched only when the viewer turns captions on. crossOrigin
 * "anonymous" is required for cross-origin tracks (S3).
 */

export interface HlsVideoProps {
  hlsUrl: string
  poster?: string
  captions?: VideoCaption[]
  /** WebVTT with `sprite.jpg#xywh=x,y,w,h` cues for scrub previews. */
  thumbnailsVtt?: string
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

interface HlsLike {
  destroy(): void
  levels: Array<{ height: number; width: number; bitrate: number }>
  currentLevel: number
  nextLevel: number
  autoLevelEnabled: boolean
  on(event: string, cb: (...args: unknown[]) => void): void
}

interface ThumbCue { start: number; end: number; url: string; x: number; y: number; w: number; h: number }

const SPEEDS = [0.75, 1, 1.25, 1.5, 2]

function parseVttTime(t: string): number {
  const parts = t.trim().split(':').map(Number)
  return parts.reduce((acc, p) => acc * 60 + p, 0)
}

/** Parse a thumbnails VTT (sprite#xywh cues). Exported for tests. */
export function parseThumbnailsVtt(text: string, baseUrl: string): ThumbCue[] {
  const cues: ThumbCue[] = []
  const blocks = text.replace(/\r/g, '').split('\n\n')
  for (const block of blocks) {
    const lines = block.trim().split('\n')
    const timing = lines.find(l => l.includes('-->'))
    const target = lines[lines.indexOf(timing ?? '') + 1]
    if (!timing || !target) continue
    const [a, b] = timing.split('-->')
    const m = target.match(/^(.*)#xywh=(\d+),(\d+),(\d+),(\d+)$/)
    if (!m) continue
    cues.push({
      start: parseVttTime(a),
      end: parseVttTime(b),
      url: new URL(m[1], baseUrl).toString(),
      x: Number(m[2]), y: Number(m[3]), w: Number(m[4]), h: Number(m[5]),
    })
  }
  return cues
}

function fmt(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const s = Math.floor(seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

function subtitleTracks(video: HTMLVideoElement | null): TextTrack[] {
  if (!video) return []
  return Array.from(video.textTracks).filter(t => t.kind === 'subtitles' || t.kind === 'captions')
}

export function HlsVideo({
  hlsUrl,
  poster,
  captions = [],
  thumbnailsVtt,
  aspectRatio,
  gif = false,
  autoplay = false,
  loop = false,
  className,
  style,
  onTimeUpdate,
  onPlay,
}: HlsVideoProps): ReactElement {
  const wrapRef = useRef<HTMLSpanElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const hlsRef = useRef<HlsLike | null>(null)
  const eager = gif || autoplay
  const [activated, setActivated] = useState(eager)

  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [buffered, setBuffered] = useState(0)
  const [muted, setMuted] = useState(eager)
  const [volume, setVolume] = useState(1)
  const [levels, setLevels] = useState<Array<{ height: number }>>([])
  const [level, setLevel] = useState(-1) // -1 = auto
  const [activeHeight, setActiveHeight] = useState<number | null>(null)
  const [trackCount, setTrackCount] = useState(captions.length)
  const [captionsOn, setCaptionsOn] = useState(false)
  const [rate, setRate] = useState(1)
  const [menu, setMenu] = useState<null | 'main' | 'quality' | 'speed'>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [controlsVisible, setControlsVisible] = useState(true)
  const [hover, setHover] = useState<{ x: number; t: number } | null>(null)
  const [thumbs, setThumbs] = useState<ThumbCue[] | null>(null)
  const draggingRef = useRef(false)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const thumbsRequested = useRef(false)

  // Attach the stream once activated.
  useEffect(() => {
    const video = videoRef.current
    if (!video || !activated) return
    let cancelled = false
    const start = async () => {
      const { default: Hls } = await import('hls.js')
      if (cancelled) return
      if (Hls.isSupported()) {
        const hls = new Hls({
          capLevelToPlayerSize: true,
          // Dev-only: window.__HLS_DEBUG = true logs hls.js internals (diagnostics).
          debug: process.env.NODE_ENV !== 'production' && !!(window as unknown as { __HLS_DEBUG?: boolean }).__HLS_DEBUG,
        }) as unknown as HlsLike
        hls.on(Hls.Events.MANIFEST_PARSED, () => setLevels(hls.levels.map(l => ({ height: Math.min(l.height, l.width) }))))
        hls.on(Hls.Events.LEVEL_SWITCHED, (_e: unknown, data: unknown) => {
          const lvl = hls.levels[(data as { level: number }).level]
          if (lvl) setActiveHeight(Math.min(lvl.height, lvl.width))
        })
        ;(hls as unknown as { loadSource(u: string): void }).loadSource(hlsUrl)
        ;(hls as unknown as { attachMedia(v: HTMLVideoElement): void }).attachMedia(video)
        hlsRef.current = hls
        // Dev-only handle for playback diagnostics (e2e: stalls, level switches).
        if (process.env.NODE_ENV !== 'production') (video as unknown as { __hls?: unknown }).__hls = hls
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

  // Text tracks appear late for in-manifest captions (Mux).
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const update = () => {
      const tracks = subtitleTracks(video)
      setTrackCount(tracks.length)
      setCaptionsOn(tracks.some(t => t.mode === 'showing'))
    }
    video.textTracks.addEventListener?.('addtrack', update)
    video.textTracks.addEventListener?.('change', update)
    return () => {
      video.textTracks.removeEventListener?.('addtrack', update)
      video.textTracks.removeEventListener?.('change', update)
    }
  }, [])

  const activate = useCallback(() => setActivated(true), [])

  const togglePlay = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    if (!activated) {
      setActivated(true)
      return
    }
    if (v.paused) v.play().catch(() => {})
    else v.pause()
  }, [activated])

  const seekTo = useCallback((t: number) => {
    const v = videoRef.current
    if (!v || !Number.isFinite(t)) return
    v.currentTime = Math.max(0, Math.min(t, v.duration || t))
    setTime(v.currentTime)
  }, [])

  const toggleCaptions = useCallback(() => {
    const tracks = subtitleTracks(videoRef.current)
    if (tracks.length === 0) return
    const on = !tracks.some(t => t.mode === 'showing')
    tracks.forEach((t, i) => { t.mode = on && i === 0 ? 'showing' : 'disabled' })
    setCaptionsOn(on)
  }, [])

  const toggleMute = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    v.muted = !v.muted
    setMuted(v.muted)
  }, [])

  const toggleFullscreen = useCallback(() => {
    const wrap = wrapRef.current
    const v = videoRef.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null
    if (!wrap) return
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    else if (wrap.requestFullscreen) wrap.requestFullscreen().catch(() => v?.webkitEnterFullscreen?.())
    else v?.webkitEnterFullscreen?.() // iOS Safari: native fullscreen player
  }, [])

  useEffect(() => {
    const onFs = () => setFullscreen(document.fullscreenElement === wrapRef.current)
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  const chooseLevel = (idx: number) => {
    const hls = hlsRef.current
    if (hls) hls.currentLevel = idx // -1 = auto (ABR)
    setLevel(idx)
    setMenu(null)
  }

  const chooseRate = (r: number) => {
    if (videoRef.current) videoRef.current.playbackRate = r
    setRate(r)
    setMenu(null)
  }

  // Controls auto-hide while playing.
  const poke = useCallback(() => {
    setControlsVisible(true)
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused && !draggingRef.current) setControlsVisible(false)
    }, 2500)
  }, [])
  useEffect(() => () => { if (hideTimer.current) clearTimeout(hideTimer.current) }, [])

  // Scrub previews: fetch the thumbnails VTT on first hover.
  const loadThumbs = useCallback(() => {
    if (!thumbnailsVtt || thumbsRequested.current) return
    thumbsRequested.current = true
    fetch(thumbnailsVtt)
      .then(r => (r.ok ? r.text() : ''))
      .then(text => setThumbs(text ? parseThumbnailsVtt(text, thumbnailsVtt) : []))
      .catch(() => setThumbs([]))
  }, [thumbnailsVtt])

  const pointerTime = (clientX: number) => {
    const bar = barRef.current
    if (!bar || !duration) return null
    const r = bar.getBoundingClientRect()
    const x = Math.max(0, Math.min(clientX - r.left, r.width))
    return { x, t: (x / r.width) * duration }
  }

  const onBarPointerDown = (e: React.PointerEvent) => {
    e.preventDefault()
    draggingRef.current = true
    ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
    loadThumbs()
    const p = pointerTime(e.clientX)
    if (p) { setHover(p); seekTo(p.t) }
  }
  const onBarPointerMove = (e: React.PointerEvent) => {
    loadThumbs()
    const p = pointerTime(e.clientX)
    if (!p) return
    setHover(p)
    if (draggingRef.current) seekTo(p.t)
    poke()
  }
  const onBarPointerUp = (e: React.PointerEvent) => {
    draggingRef.current = false
    ;(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId)
    if (e.pointerType !== 'mouse') setHover(null)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!activated || gif) return
    const v = videoRef.current
    if (!v) return
    const k = e.key.toLowerCase()
    if (k === ' ' || k === 'k') togglePlay()
    else if (k === 'arrowright') seekTo(v.currentTime + 5)
    else if (k === 'arrowleft') seekTo(v.currentTime - 5)
    else if (k === 'f') toggleFullscreen()
    else if (k === 'm') toggleMute()
    else if (k === 'c') toggleCaptions()
    else return
    e.preventDefault()
    poke()
  }

  const thumb = hover && thumbs ? thumbs.find(c => hover.t >= c.start && hover.t < c.end) ?? thumbs[thumbs.length - 1] : null
  const barWidth = barRef.current?.getBoundingClientRect().width ?? 0
  const previewW = thumb?.w ?? 0
  const previewLeft = hover ? Math.max(0, Math.min(hover.x - previewW / 2, barWidth - previewW)) : 0
  const showControls = activated && !gif
  const qualityLabel = level === -1 ? `Auto${activeHeight ? ` (${activeHeight}p)` : ''}` : `${levels[level]?.height ?? ''}p`

  return (
    <span
      ref={wrapRef}
      tabIndex={showControls ? 0 : -1}
      onKeyDown={onKeyDown}
      onPointerMove={showControls ? poke : undefined}
      onMouseLeave={() => { setHover(null); if (playing) setControlsVisible(false) }}
      className={`relative block bg-black rounded-lg overflow-hidden outline-hidden select-none ${fullscreen ? 'flex items-center' : ''} ${className ?? ''}`}
      style={{ aspectRatio: fullscreen ? undefined : aspectRatio ?? 16 / 9, ...(gif ? { pointerEvents: 'none' as const } : {}), ...style }}
      data-hls-video=""
    >
      <video
        ref={videoRef}
        className="block w-full h-full object-contain"
        poster={poster}
        preload={eager ? 'auto' : 'none'}
        crossOrigin="anonymous"
        muted={eager}
        autoPlay={eager}
        playsInline
        loop={gif || loop}
        onClick={showControls ? togglePlay : undefined}
        onDoubleClick={showControls ? toggleFullscreen : undefined}
        onTimeUpdate={e => {
          const v = e.currentTarget
          if (!draggingRef.current) setTime(v.currentTime)
          if (v.buffered.length) setBuffered(v.buffered.end(v.buffered.length - 1))
          onTimeUpdate?.(v)
        }}
        onDurationChange={e => setDuration(e.currentTarget.duration)}
        onLoadedMetadata={e => setDuration(e.currentTarget.duration)}
        onPlay={e => {
          setPlaying(true)
          poke()
          onPlay?.(e.currentTarget)
        }}
        onPause={() => { setPlaying(false); setControlsVisible(true) }}
        onVolumeChange={e => { setMuted(e.currentTarget.muted); setVolume(e.currentTarget.volume) }}
      >
        {captions.map(c => (
          <track key={c.src} kind="subtitles" src={c.src} srcLang={c.lang} label={c.label} />
        ))}
      </video>

      {!activated && (
        <button type="button" onClick={activate} aria-label="Play video" className="absolute inset-0 flex items-center justify-center group">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-black/60 text-white transition-transform group-hover:scale-110">
            <Play className="h-7 w-7 translate-x-0.5" fill="currentColor" />
          </span>
        </button>
      )}

      {showControls && (
        <span
          className={`absolute inset-x-0 bottom-0 block bg-linear-to-t from-black/75 to-transparent px-2 pt-6 pb-1 text-white transition-opacity ${
            controlsVisible || !playing || menu ? 'opacity-100' : 'opacity-0'
          }`}
          data-controls=""
        >
          {/* Scrubber */}
          <div
            ref={barRef}
            role="slider"
            aria-label="Seek"
            aria-valuemin={0}
            aria-valuemax={Math.round(duration)}
            aria-valuenow={Math.round(time)}
            className="relative h-4 cursor-pointer touch-none"
            onPointerDown={onBarPointerDown}
            onPointerMove={onBarPointerMove}
            onPointerUp={onBarPointerUp}
            onPointerEnter={loadThumbs}
            onPointerLeave={() => { if (!draggingRef.current) setHover(null) }}
            data-scrubber=""
          >
            <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded bg-white/25">
              <div className="absolute inset-y-0 left-0 rounded bg-white/40" style={{ width: duration ? `${(buffered / duration) * 100}%` : 0 }} />
              <div className="absolute inset-y-0 left-0 rounded bg-primary" style={{ width: duration ? `${(time / duration) * 100}%` : 0 }} />
            </div>
            {hover && (
              <div className="pointer-events-none absolute bottom-5 flex flex-col items-center" style={{ left: thumb ? previewLeft : hover.x, transform: thumb ? undefined : 'translateX(-50%)' }} data-scrub-preview="">
                {thumb && (
                  <div
                    className="rounded border border-white/60 shadow"
                    style={{ width: thumb.w, height: thumb.h, backgroundImage: `url("${thumb.url}")`, backgroundPosition: `-${thumb.x}px -${thumb.y}px` }}
                    data-scrub-thumb=""
                  />
                )}
                <span className="mt-0.5 rounded bg-black/70 px-1 text-[11px] tabular-nums">{fmt(hover.t)}</span>
              </div>
            )}
          </div>

          <span className="flex items-center gap-1 text-xs">
            <button type="button" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'} className="p-1.5 rounded hover:bg-white/15">
              {playing ? <Pause className="h-4 w-4" fill="currentColor" /> : <Play className="h-4 w-4" fill="currentColor" />}
            </button>
            <button type="button" onClick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'} className="p-1.5 rounded hover:bg-white/15">
              {muted || volume === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </button>
            <input
              type="range" min={0} max={1} step={0.05} value={muted ? 0 : volume} aria-label="Volume"
              onChange={e => {
                const v = videoRef.current
                if (!v) return
                v.volume = Number(e.target.value)
                v.muted = v.volume === 0
              }}
              className="hidden sm:block w-16 accent-white"
            />
            <span className="ml-1 tabular-nums">{fmt(time)} / {fmt(duration)}</span>
            <span className="flex-1" />
            {trackCount > 0 && (
              <button type="button" onClick={toggleCaptions} aria-label="Captions" aria-pressed={captionsOn} className={`p-1.5 rounded hover:bg-white/15 ${captionsOn ? 'text-primary' : ''}`}>
                <Captions className="h-4 w-4" />
              </button>
            )}
            <span className="relative">
              <button type="button" onClick={() => setMenu(m => (m ? null : 'main'))} aria-label="Settings" aria-expanded={!!menu} className="p-1.5 rounded hover:bg-white/15">
                <Settings className="h-4 w-4" />
              </button>
              {menu && (
                <span className="absolute bottom-9 right-0 z-10 block min-w-36 rounded-md bg-black/90 py-1 text-xs shadow-lg" role="menu">
                  {menu === 'main' && (
                    <>
                      {levels.length > 1 && (
                        <button type="button" role="menuitem" onClick={() => setMenu('quality')} className="flex w-full justify-between gap-3 px-3 py-1.5 hover:bg-white/15">
                          <span>Quality</span><span className="text-white/70">{qualityLabel}</span>
                        </button>
                      )}
                      <button type="button" role="menuitem" onClick={() => setMenu('speed')} className="flex w-full justify-between gap-3 px-3 py-1.5 hover:bg-white/15">
                        <span>Speed</span><span className="text-white/70">{rate === 1 ? 'Normal' : `${rate}×`}</span>
                      </button>
                    </>
                  )}
                  {menu === 'quality' && (
                    <>
                      <button type="button" role="menuitemradio" aria-checked={level === -1} onClick={() => chooseLevel(-1)} className={`block w-full px-3 py-1.5 text-left hover:bg-white/15 ${level === -1 ? 'text-primary' : ''}`}>
                        Auto{activeHeight ? ` (${activeHeight}p)` : ''}
                      </button>
                      {levels.map((l, i) => ({ l, i })).sort((a, b) => b.l.height - a.l.height).map(({ l, i }) => (
                        <button key={i} type="button" role="menuitemradio" aria-checked={level === i} onClick={() => chooseLevel(i)} className={`block w-full px-3 py-1.5 text-left hover:bg-white/15 ${level === i ? 'text-primary' : ''}`}>
                          {l.height}p
                        </button>
                      ))}
                    </>
                  )}
                  {menu === 'speed' && SPEEDS.map(s => (
                    <button key={s} type="button" role="menuitemradio" aria-checked={rate === s} onClick={() => chooseRate(s)} className={`block w-full px-3 py-1.5 text-left hover:bg-white/15 ${rate === s ? 'text-primary' : ''}`}>
                      {s === 1 ? 'Normal' : `${s}×`}
                    </button>
                  ))}
                </span>
              )}
            </span>
            <button type="button" onClick={toggleFullscreen} aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'} className="p-1.5 rounded hover:bg-white/15">
              {fullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
            </button>
          </span>
        </span>
      )}
    </span>
  )
}
