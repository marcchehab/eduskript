'use client'

/**
 * Kara world + replay player, shown under the code in Kara editors
 * (code-editor with a `kara-world` block). The program has already run to
 * completion in the Pyodide worker; this component replays the recorded trace
 * step by step, forward and backward, and reports the current line to the
 * editor via `onLine` (see kara-line-extension.ts), which also shows the
 * step's sensor results and the error message inline in the code.
 *
 * Position p ∈ [0, steps]: the world after p steps (0 = initial). A step is
 * one executed line or one action — a line that makes several actions (a
 * toolbox call like `drei_vor()`) replays as several steps on the same line
 * (step over; see kara-module.ts). The status shows `line 5 · 2/3`, and the
 * editor note names the helper frame (`drei_vor() · befehle.py:3`).
 * Canvas-rendered; on a single forward step Kara slides one cell or turns
 * (horizontal squash between the two direction sprites, ~120 ms). Any other
 * jump (scrubbing, torus wrap) is drawn without animation. World tiles: src/lib/kara/kara-tiles.ts. Kara sprite:
 * built-in default (4 directions); custom per-student sprites are not
 * implemented yet — `sprites` would take 4 image URLs.
 *
 * Story layer: a fixed-height message bar under the world shows story events
 * (terminal read, chip picked up — these pause playback until Continue), the
 * level result once the replay reaches the end, and otherwise the level's
 * `aurora.start` line. Events only trigger when the replay steps onto them
 * (play / step forward); jumping or scrubbing skips them. Results are saved per student (stars,
 * evidence) as soon as a run reaches the goal, see src/lib/kara/progress.ts.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Music, Pause, Play, SkipBack, SkipForward, Star, StepBack, StepForward } from 'lucide-react'
import { cn } from '@/lib/utils'
import { recordKaraResult } from '@/lib/kara/progress'
import { playVoice, stopVoice, ttsLineUrl } from '@/lib/kara/voice'
import { DEFAULT_AURORA } from '@/lib/kara/world'
import { playSfx } from '@/lib/kara/sfx'
import { registerSoundSource, useMuted } from '@/lib/sound'
import { DOOR, ITEM, LASER } from '@/lib/kara/world'
import { karaPortrait } from '@/lib/kara/portraits'
import type { KaraLineTarget } from './kara-line-extension'
import { drawKaraTiles, loadKaraTileset, type KaraTileset } from '@/lib/kara/kara-tiles'
import {
  buildReplay,
  karaStars,
  seekCells,
  type KaraConfig,
  type KaraEvidence,
  type KaraGoal,
  type KaraMessage,
  type KaraPos,
  type KaraStep,
  type KaraTrace,
  type KaraWorld,
} from '@/lib/kara/world'

// ─── Default character (N, E, S, W) ───────────────────────────────────────

const BODY = `
<ellipse cx="24" cy="57" rx="7" ry="4" fill="#9a3412"/>
<ellipse cx="40" cy="57" rx="7" ry="4" fill="#9a3412"/>
<line x1="32" y1="20" x2="32" y2="8" stroke="#9a3412" stroke-width="3" stroke-linecap="round"/>
<circle cx="32" cy="7" r="4" fill="#facc15" stroke="#9a3412" stroke-width="2"/>
<ellipse cx="32" cy="38" rx="22" ry="19" fill="#f97316" stroke="#9a3412" stroke-width="3"/>`

const FACE_SOUTH = `
<circle cx="24" cy="34" r="6" fill="#fff"/><circle cx="24" cy="36" r="3" fill="#1c1917"/>
<circle cx="40" cy="34" r="6" fill="#fff"/><circle cx="40" cy="36" r="3" fill="#1c1917"/>
<path d="M26 46 Q32 51 38 46" stroke="#7c2d12" stroke-width="2.5" fill="none" stroke-linecap="round"/>`

const FACE_NORTH = `
<path d="M18 32 Q32 24 46 32" stroke="#9a3412" stroke-width="2" fill="none" opacity="0.5"/>`

const FACE_EAST = `
<circle cx="44" cy="34" r="6" fill="#fff"/><circle cx="47" cy="35" r="3" fill="#1c1917"/>
<path d="M46 46 Q50 48 53 44" stroke="#7c2d12" stroke-width="2.5" fill="none" stroke-linecap="round"/>`

function svgUrl(inner: string, mirror = false): string {
  const g = mirror ? `<g transform="translate(64 0) scale(-1 1)">${inner}</g>` : inner
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="128" height="128">${g}</svg>`,
  )
}

const DEFAULT_SPRITES = [
  svgUrl(BODY + FACE_NORTH),
  svgUrl(BODY + FACE_EAST),
  svgUrl(BODY + FACE_SOUTH),
  svgUrl(BODY + FACE_EAST, true),
]

/** MOP-7 renders (Blender, own art, in public/kara/); the SVG blob is the fallback. */
const MOP7_SPRITES = ['N', 'E', 'S', 'W'].map(d => `/kara/mop7-${d}.png`)

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

let defaultSpritesPromise: Promise<HTMLImageElement[]> | null = null
function loadDefaultSprites(): Promise<HTMLImageElement[]> {
  defaultSpritesPromise ??= Promise.all(MOP7_SPRITES.map(async (src, i) =>
    (await loadImage(src)) ?? (await loadImage(DEFAULT_SPRITES[i]))!))
  return defaultSpritesPromise
}

// ─── Rendering ────────────────────────────────────────────────────────────

function drawWorld(
  canvas: HTMLCanvasElement,
  world: KaraWorld,
  cells: number[],
  kara: { x: number; y: number; d: number },
  tile: number,
  tileset: KaraTileset,
  sprites: HTMLImageElement[] | null,
  squashX = 1,
) {
  const dpr = window.devicePixelRatio || 1
  const w = world.cols * tile
  const h = world.rows * tile
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
  }
  canvas.style.width = `${w}px`
  canvas.style.height = `${h}px`
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.imageSmoothingQuality = 'high'
  drawKaraTiles(ctx, world, cells, tile, tileset)

  const sprite = sprites?.[kara.d]
  if (sprite && sprite.complete && sprite.naturalWidth) {
    const size = tile * 0.92
    // squashX < 1: mid-turn (the sprites are side views, so a turn reads as a squash).
    const w = size * Math.max(0.05, squashX)
    ctx.drawImage(sprite, kara.x * tile + (tile - w) / 2, kara.y * tile + (tile - size) / 2, w, size)
  }
}

// ─── Component ────────────────────────────────────────────────────────────

/** Editor note for an action made inside a helper module: 'drei_vor() · befehle.py:3'. */
function helperFrame(step: KaraStep): string | undefined {
  if (!step.f) return undefined
  const fn = step.fn && !step.fn.startsWith('<') ? `${step.fn}() · ` : ''
  return `${fn}${step.f}${step.fl ? `:${step.fl}` : ''}`
}

const SPEEDS = [1, 2, 5, 10, 25, 100] // steps per second

const GOAL_TEXT: Record<KaraGoal, string> = {
  exit: 'reach the exit',
  collect: 'collect every barrel',
  boxes: 'push every box onto a target',
  chips: 'pick up every chip',
  logs: 'read every terminal',
  output: 'print the right answer',
}

interface KaraCard {
  message: KaraMessage
  title?: string
  stars?: number
  detail?: string
}

export interface KaraPanelProps {
  world: KaraWorld
  /** New object per run — resets the player and starts playback. */
  trace: KaraTrace | null
  /** Upper bound for the tile size in px (markdown `tile="…"`). */
  maxTile: number
  /** Upper bound for the world's height in px (fullscreen). */
  maxHeight?: number
  onLine: (target: KaraLineTarget | null) => void
  config: KaraConfig
  /** Resolved asset URLs (audio file names, `portrait:<speaker>`). */
  assets?: Record<string, string>
  /** Key for saved progress. */
  levelId: string
  /** Progress is only saved inside a skript. */
  skriptId?: string
  /**
   * Fixed-height mode (side-by-side layout): the panel fills its parent's
   * height; the divider moves height between world and message bar.
   */
  fill?: boolean
}

export function KaraPanel({ world, trace, maxTile, maxHeight, onLine, config, assets, levelId, skriptId, fill }: KaraPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const outputRef = useRef<HTMLPreElement>(null)
  const [width, setWidth] = useState(0)
  const [height, setHeight] = useState(0)
  const [sprites, setSprites] = useState<HTMLImageElement[] | null>(null)
  const [tileset, setTileset] = useState<KaraTileset>(() => new Map())
  const [pos, setPos] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(5)
  const [cards, setCards] = useState<KaraCard[]>([])
  const [resume, setResume] = useState(false)
  const [musicOn, setMusicOn] = useState(false)
  const [outputHeight, setOutputHeight] = useState(80)
  const [barHeight, setBarHeight] = useState(150)
  /** Drag handle above a box: dragging up makes the box below taller. */
  const dragAbove = (h0: number, set: (h: number) => void, min: number, max: number) => (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault()
    const y0 = 'touches' in e ? e.touches[0]?.clientY ?? 0 : e.clientY
    const move = (ev: MouseEvent | TouchEvent) => {
      const y = 'touches' in ev ? ev.touches[0]?.clientY ?? y0 : ev.clientY
      set(Math.max(min, Math.min(max, h0 - (y - y0))))
    }
    const up = () => {
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', up)
      document.removeEventListener('touchmove', move)
      document.removeEventListener('touchend', up)
    }
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', up)
    document.addEventListener('touchmove', move, { passive: false })
    document.addEventListener('touchend', up)
  }
  const musicRef = useRef<HTMLAudioElement>(null)

  const steps = useMemo(() => trace?.steps ?? [], [trace])
  const replay = useMemo(() => (trace ? buildReplay(world, trace) : null), [world, trace])
  const total = replay?.length ?? 0

  // Cell state tracks the drawn position incrementally (see seekCells).
  const cellsRef = useRef<{ cells: number[]; pos: number; trace: KaraTrace | null; world: KaraWorld } | null>(null)
  const drawnRef = useRef<{ pos: number; trace: KaraTrace | null }>({ pos: 0, trace: null })

  useEffect(() => { void loadDefaultSprites().then(setSprites) }, [])
  useEffect(() => { void loadKaraTileset().then(setTileset) }, [])

  useEffect(() => {
    const el = wrapRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(entries => {
      setWidth(entries[0]?.contentRect.width ?? el.clientWidth)
      setHeight(entries[0]?.contentRect.height ?? el.clientHeight)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // New run → rewind and play (state adjusted during render, not in an effect).
  const [prevTrace, setPrevTrace] = useState(trace)
  if (trace !== prevTrace) {
    setPrevTrace(trace)
    setPos(0)
    setCards([])
    setPlaying(!!trace && trace.steps.length > 0)
  }

  const stars = trace ? karaStars(trace, config) : 0

  /** Story events on a single forward step (pause until Continue). */
  const eventCards = useCallback((from: number, to: number): KaraCard[] => {
    if (!trace || to <= from) return []
    const out: KaraCard[] = []
    if (to === from + 1) for (const [kind, i] of steps[to - 1]?.v ?? []) {
      if (kind === 'log' && config.logs[i]) out.push({ message: config.logs[i], title: 'Log' })
      if (kind === 'chip' && config.chips[i]) out.push({ message: config.chips[i], title: `Evidence: ${config.chips[i].title}` })
    }
    return out
  }, [trace, steps, config])

  /** Result message, shown (without blocking) once the replay reaches the end. */
  const finalCard = useMemo((): KaraCard | null => {
    if (!trace) return null
    const a = (key: string): KaraMessage | undefined =>
      config.aurora[key] ?? (DEFAULT_AURORA[key] ? { text: DEFAULT_AURORA[key], speaker: 'AURORA' } : undefined)
    const limits = [
      config.memory ? `Memory ${trace.memory}/${config.memory}` : `Memory ${trace.memory}`,
      config.energy ? `Energy ${trace.energy}/${config.energy}` : `Energy ${trace.energy}`,
    ].join(' · ')
    if (trace.error?.kind === 'loop') { const m = a('loop'); return m ? { message: m } : null }
    if (trace.error) return config.aurora.error ? { message: config.aurora.error } : null
    if (!config.goals.length || !trace.goal) return null
    if (trace.goal.reached) return { message: a('win')!, stars, detail: limits }
    // A level-specific fail text replaces the generic (English) goal list.
    return {
      message: a('fail')!,
      detail: config.aurora.fail ? undefined : `Still to do: ${trace.goal.missing.map(g => GOAL_TEXT[g]).join(', ')}`,
    }
  }, [trace, config, stars])

  /** Sound effects for stepping from `to - 1` to `to` (and the result at the end). */
  const stepSfx = useCallback((to: number) => {
    if (!trace || !replay) return
    const step = steps[to - 1]
    const a = replay.kara[to - 1], b = replay.kara[to]
    if (step) {
      let door = false, laser = false, barrel = false
      for (const [, , before, after] of step.m ?? []) {
        if ((before ^ after) & DOOR) door = true
        if ((before ^ after) & LASER) laser = true
        if ((before ^ after) & ITEM) barrel = true
      }
      if (door || laser) playSfx('switch')
      if (door) playSfx('door')
      if (barrel) playSfx('barrel')
      for (const [kind] of step.v ?? []) playSfx(kind === 'chip' ? 'chip' : 'log')
      if (a && b && (a.x !== b.x || a.y !== b.y)) playSfx('move')
      else if (a && b && a.d !== b.d) playSfx('turn')
    }
    if (to === total) {
      if (trace.error?.kind === 'kara') playSfx(/acid/i.test(trace.error.message) ? 'acid' : 'bump')
      else if (!trace.error && config.goals.length && trace.goal) playSfx(trace.goal.reached ? 'win' : 'fail')
    }
  }, [trace, replay, steps, total, config])

  /** Move the replay; pauses on story events (resuming afterwards if it was playing). */
  const advance = useCallback((from: number, to: number, wasPlaying: boolean) => {
    setPos(to)
    if (to === from + 1) stepSfx(to)
    const next = eventCards(from, to)
    if (next.length) {
      setCards(next)
      setResume(wasPlaying && to < total)
      setPlaying(false)
    }
  }, [eventCards, total, stepSfx])

  const closeCard = useCallback(() => {
    const rest = cards.slice(1)
    setCards(rest)
    if (!rest.length && resume) setPlaying(true)
  }, [cards, resume])

  // Save progress: evidence found in this run (chips picked up, terminal logs
  // read — even if the level is not solved), stars when solved.
  useEffect(() => {
    if (!skriptId || !trace) return
    const found: KaraEvidence[] = []
    for (const step of trace.steps) {
      for (const [kind, i] of step.v ?? []) {
        if (kind === 'chip' && config.chips[i]) found.push(config.chips[i])
        const log = kind === 'log' ? config.logs[i] : undefined
        if (log) found.push({ ...log, id: `${levelId}-log-${i}`, title: `Log${log.speaker ? `: ${log.speaker}` : ''}` })
      }
    }
    const s = karaStars(trace, config)
    if (s > 0 || found.length) void recordKaraResult(skriptId, levelId, s, found)
  }, [trace, config, skriptId, levelId])

  // Message bar: pending story event, else the result at the end, else the level's `aurora.start` idle line (the `intro:` briefing is KaraIntro above the editor).
  const startCard = useMemo((): KaraCard | null => (config.aurora.start ? { message: config.aurora.start } : null), [config])
  const card = cards[0] ?? (trace && pos === total ? finalCard : null) ?? (pos === 0 ? startCard : null)
  // Voice only for events and results (never on page load).
  const spoken = card && card !== startCard ? card : null
  // A skript audio file wins; otherwise the cached TTS line (speakers with a voice only).
  useEffect(() => {
    if (!spoken) { stopVoice(); return }
    const { audio, speaker, text } = spoken.message
    let cancelled = false
    void (async () => {
      const url = (audio && assets?.[audio]) || (speaker ? await ttsLineUrl(speaker, text) : null)
      if (url && !cancelled) await playVoice(url, speaker).catch(() => {})
    })()
    return () => { cancelled = true }
  }, [spoken, assets])
  useEffect(() => () => stopVoice(), [])

  const musicSrc = config.music ? assets?.[config.music] : undefined
  const muted = useMuted()
  useEffect(() => {
    const el = musicRef.current
    if (!el) return
    if (musicOn && !muted) { el.volume = 0.35; void el.play().catch(() => {}) } else el.pause()
  }, [musicOn, musicSrc, muted])
  // Show the page's mute button while a Kara level is on the page.
  useEffect(() => registerSoundSource(), [])

  // Playback stops by itself at the end.
  const isPlaying = playing && pos < total
  useEffect(() => {
    if (!isPlaying) return
    const t = setTimeout(() => advance(pos, Math.min(pos + 1, total), true), 1000 / speed)
    return () => clearTimeout(t)
  }, [isPlaying, pos, total, speed, advance])

  // Editor line highlight.
  useEffect(() => {
    if (!trace) { onLine(null); return }
    if (pos === total && trace.error) {
      const last = steps[total - 1]
      const line = trace.error.line ?? last?.l
      // The failing line's own sensor calls stay visible next to the error.
      const sensors = last && last.l === line ? last.s : undefined
      onLine(line ? { line, sensors, error: trace.error.message, via: last && last.l === line ? helperFrame(last) : undefined } : null)
    } else if (pos === 0) {
      onLine(null)
    } else {
      const s = steps[pos - 1]
      onLine({ line: s.l, sensors: s.s, via: helperFrame(s) })
    }
  }, [pos, total, trace, steps, onLine])

  const tile = useMemo(() => {
    let t = width ? Math.floor(width / world.cols) : maxTile
    if (maxHeight) t = Math.min(t, Math.floor(maxHeight / world.rows))
    // Fill mode: the world gets whatever height the message bar leaves.
    if (fill && height) t = Math.min(t, Math.floor(height / world.rows))
    return Math.max(8, Math.min(maxTile, t))
  }, [width, height, fill, world.cols, world.rows, maxTile, maxHeight])

  // Draw (one-cell slide or turn on single forward steps).
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let state = cellsRef.current
    if (!state || state.trace !== trace || state.world !== world) {
      state = { cells: [...world.cells], pos: 0, trace, world }
      cellsRef.current = state
    }
    seekCells(state.cells, world.cols, steps, state.pos, pos)
    state.pos = pos

    const to: KaraPos = replay?.kara[pos] ?? world.kara
    const prev = drawnRef.current
    const from: KaraPos | undefined = prev.trace === trace && prev.pos === pos - 1 ? replay?.kara[pos - 1] : undefined
    drawnRef.current = { pos, trace }

    const cells = state.cells
    const slide = !!from && Math.abs(from.x - to.x) + Math.abs(from.y - to.y) === 1
    const turn = !!from && from.x === to.x && from.y === to.y && from.d !== to.d
    if (!from || (!slide && !turn)) {
      drawWorld(canvas, world, cells, to, tile, tileset, sprites)
      return
    }
    const duration = slide ? Math.min(250, 700 / speed) : Math.min(120, 500 / speed)
    const start = performance.now()
    let raf = 0
    const frame = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      if (slide) {
        drawWorld(canvas, world, cells, { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, d: to.d }, tile, tileset, sprites)
      } else {
        // First half: old sprite narrows; second half: new sprite widens.
        drawWorld(canvas, world, cells, t < 0.5 ? from : to, tile, tileset, sprites, Math.abs(1 - 2 * t))
      }
      if (t < 1) raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [pos, trace, world, steps, replay, tile, tileset, sprites, speed])

  const output = replay ? replay.output.slice(0, replay.outputEnd[pos]) : ''
  useEffect(() => {
    if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight
  }, [output])

  const go = useCallback((p: number) => {
    setPlaying(false)
    setCards([])
    advance(pos, Math.max(0, Math.min(total, p)), false)
  }, [total, pos, advance])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (cards.length && (e.key === 'Enter' || e.key === 'Escape')) { e.preventDefault(); closeCard() }
    else if (e.key === 'ArrowRight') { e.preventDefault(); go(pos + 1) }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(pos - 1) }
    else if (e.key === ' ') { e.preventDefault(); togglePlay() }
  }

  const togglePlay = () => {
    if (isPlaying) { setPlaying(false); return }
    if (pos >= total) setPos(0)
    setPlaying(total > 0)
  }

  const btn = 'h-7 w-7 rounded flex items-center justify-center hover:bg-muted disabled:opacity-40 disabled:hover:bg-transparent'

  return (
    <div className="flex h-full flex-col border-t bg-background outline-none" tabIndex={0} onKeyDown={onKeyDown}>
      <div ref={wrapRef} className={cn('relative flex justify-center overflow-hidden', fill ? 'min-h-0 flex-1 items-center' : 'shrink-0 p-2')}>
        <canvas ref={canvasRef} className="block rounded" />
        {musicSrc && <audio ref={musicRef} src={musicSrc} loop preload="none" />}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 px-2 py-1 border-t bg-muted/30 text-xs">
        <div className="flex items-center">
          <button className={btn} onClick={() => go(0)} disabled={!trace || pos === 0} title="To start">
            <SkipBack className="w-3.5 h-3.5" />
          </button>
          <button className={btn} onClick={() => go(pos - 1)} disabled={!trace || pos === 0} title="Step back (←)">
            <StepBack className="w-3.5 h-3.5" />
          </button>
          <button className={btn} onClick={togglePlay} disabled={!trace || total === 0} title={isPlaying ? 'Pause (space)' : 'Play (space)'}>
            {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          </button>
          <button className={btn} onClick={() => go(pos + 1)} disabled={!trace || pos >= total} title="Step forward (→)">
            <StepForward className="w-3.5 h-3.5" />
          </button>
          <button className={btn} onClick={() => go(total)} disabled={!trace || pos >= total} title="To end">
            <SkipForward className="w-3.5 h-3.5" />
          </button>
        </div>
        <input
          type="range"
          min={0}
          max={total}
          value={pos}
          disabled={!trace || total === 0}
          onChange={e => go(Number(e.target.value))}
          className="flex-1 min-w-24 accent-primary"
          aria-label="Step"
        />
        <span className="min-w-[13rem] text-right tabular-nums text-muted-foreground whitespace-nowrap">
          {trace ? `Step ${pos} / ${total}` : 'Press Run'}
          {pos > 0 && steps[pos - 1] ? ` · line ${steps[pos - 1].l}` : ''}
          {pos > 0 && steps[pos - 1]?.sub && replay ? ` · ${steps[pos - 1].sub}/${replay.subTotal[pos - 1]}` : ''}
        </span>
        {trace && pos === total && config.goals.length > 0 && !trace.error && (
          <span className="flex items-center" title={`Memory ${trace.memory}${config.memory ? `/${config.memory}` : ''} · Energy ${trace.energy}${config.energy ? `/${config.energy}` : ''}`}>
            {[1, 2, 3].map(n => (
              <Star key={n} className={cn('w-3.5 h-3.5', n <= stars ? 'fill-amber-400 text-amber-500' : 'text-muted-foreground/40')} />
            ))}
          </span>
        )}
        {musicSrc && (
          <button className={cn(btn, musicOn && 'bg-muted')} onClick={() => setMusicOn(m => !m)} title={musicOn ? 'Music off' : 'Music on'}>
            <Music className="w-3.5 h-3.5" />
          </button>
        )}
        <select
          value={speed}
          onChange={e => setSpeed(Number(e.target.value))}
          className="h-6 rounded border bg-background px-1 text-xs"
          title="Playback speed (steps per second)"
        >
          {SPEEDS.map(s => <option key={s} value={s}>{s}/s</option>)}
        </select>
      </div>

      <div onMouseDown={dragAbove(barHeight, setBarHeight, 60, 500)} onTouchStart={dragAbove(barHeight, setBarHeight, 60, 500)} className="relative h-2 shrink-0 cursor-row-resize border-t bg-border/60 hover:bg-primary/20 touch-none" title="Drag to resize">
        <div className="absolute -top-2 -bottom-2 inset-x-0 md:hidden" />
      </div>
      <MessageBar card={card} assets={assets} onContinue={cards.length ? closeCard : undefined} more={cards.length - 1} minHeight={barHeight} fixed={fill} />

      {/* Sensor results and errors are shown inline in the code (kara-line-extension).
          The output box is reserved for the whole replay once the run printed
          anything, so nothing below the world changes size while stepping. */}
      {replay?.output && (
        <>
          {/* Drag handle: height stays fixed while stepping, the student sets it. */}
          <div onMouseDown={dragAbove(outputHeight, setOutputHeight, 40, 600)} onTouchStart={dragAbove(outputHeight, setOutputHeight, 40, 600)} className="relative h-2 shrink-0 cursor-row-resize border-t bg-border/60 hover:bg-primary/20 touch-none" title="Drag to resize">
            <div className="absolute -top-2 -bottom-2 inset-x-0 md:hidden" />
          </div>
          <pre ref={outputRef} style={{ height: outputHeight }} className="shrink-0 overflow-auto px-2 py-1 text-xs font-mono whitespace-pre-wrap">{output}</pre>
        </>
      )}
    </div>
  )
}

/** Dialogue bar under the world: at least `minHeight` (draggable divider above), grows with long text, fills spare height side by side. */
function MessageBar({ card, assets, onContinue, more, minHeight, fixed }: { card: KaraCard | null; assets?: Record<string, string>; onContinue?: () => void; more: number; minHeight: number; fixed?: boolean }) {
  const speaker = card?.message.speaker
  const portrait = speaker ? karaPortrait(speaker, assets) : undefined
  return (
    <div style={fixed ? { height: minHeight } : { minHeight }} className={cn('flex shrink-0 items-center gap-3 overflow-y-auto px-3 text-sm', onContinue ? 'bg-amber-50 dark:bg-amber-950/30' : 'bg-muted/20')}>
      {card && speaker && (
        portrait
          // eslint-disable-next-line @next/next/no-img-element -- skript file URL, sized by CSS
          ? <img src={portrait} alt={speaker} className="h-14 w-14 shrink-0 rounded-md object-cover" />
          : <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md bg-muted text-lg font-bold">{speaker[0]}</div>
      )}
      <div className="min-w-0 flex-1 py-2">
        {card ? (
          <>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {[card.title, speaker].filter(Boolean).join(' · ')}
            </div>
            <p className="leading-snug whitespace-pre-wrap">{card.message.text}</p>
            {(card.stars !== undefined || card.detail) && (
              <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                {card.stars !== undefined && (
                  <span className="flex">
                    {[1, 2, 3].map(n => (
                      <Star key={n} className={cn('w-3.5 h-3.5', n <= card.stars! ? 'fill-amber-400 text-amber-500' : 'text-muted-foreground/40')} />
                    ))}
                  </span>
                )}
                {card.detail}
              </div>
            )}
          </>
        ) : null}
      </div>
      {onContinue && (
        <button onClick={onContinue} className="shrink-0 rounded bg-primary px-3 py-1 text-xs text-primary-foreground hover:opacity-90">
          {more > 0 ? 'Next' : 'Continue'}
        </button>
      )}
    </div>
  )
}
