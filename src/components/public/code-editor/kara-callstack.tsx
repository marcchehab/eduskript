'use client'

/**
 * Call stack overlay for Kara levels with `callstack: on` (recursion week).
 * Drawn over the world canvas in kara-panel.tsx: one retro dialog window per
 * user function frame ('treppe(n=3)', 'treppe(n=2)', …), cascaded in a
 * corner, newest on top. The corner is top-right unless the cascade would
 * cover MOP-7; then the first free one of top-left, bottom-right,
 * bottom-left (kept while it stays free, so it does not jump back and forth;
 * if every corner covers MOP-7 it stays where it is). Only the newest window shows a body
 * (Büroklämmerli's portrait and his line); the others show their title bar.
 *
 * Data: buildCallStacks (world.ts) decodes the per-step `cs` deltas recorded
 * by kara-module.ts. A window opens with a zoom-in; when a single forward
 * step returns from functions, the popped windows close with a zoom-out
 * (they are kept for CLOSE_MS as ghosts). Scrubbing / stepping back just
 * shows the new stack without the close animation.
 *
 * At most MAX_WINDOWS windows (fewer when the world is too low to fit them),
 * the oldest slot then reads '+ N more'. `flood` (the run ended in a
 * RecursionError) fills the whole world with FLOOD_WINDOWS windows, one
 * every FLOOD_STEP_MS; kara-panel.tsx holds back AURORA's result line for
 * FLOOD_MS so it lands after the flood.
 *
 * The × on the newest window hides the overlay (per mount); the chip it
 * leaves behind shows the depth and brings it back. Everything else ignores
 * the pointer, so the world stays clickable under the windows.
 */

import { useEffect, useState, type CSSProperties } from 'react'
import { cn } from '@/lib/utils'
import { karaPortrait } from '@/lib/kara/portraits'
import type { KaraCallStack } from '@/lib/kara/world'

export const MAX_WINDOWS = 12
const FLOOD_WINDOWS = 36
const FLOOD_STEP_MS = 35
/** Time until the flood is complete (kara-panel.tsx shows AURORA's line after it). */
export const FLOOD_MS = FLOOD_WINDOWS * FLOOD_STEP_MS + 400
const CLOSE_MS = 180
/** Büroklämmerli's line on the newest window (course text, German like the AURORA defaults). */
const HELP_LINE = 'Möchten Sie Hilfe zur Hilfe?'

const DX = 8 // cascade offset per window (px)
const DY = 17 // = title bar height + 1
const BODY_H = 34 // body of the newest window
const WIN_H = 3 + 16 + BODY_H + 3 // padding, title bar, body, padding
const MARGIN = 6

type Corner = 'tr' | 'tl' | 'br' | 'bl'
const CORNERS: Corner[] = ['tr', 'tl', 'br', 'bl']

/** Win95-style bevel; fixed colours in light and dark mode (it is a picture of an old OS). */
const BEVEL = 'bg-[#c0c0c0] text-black shadow-[inset_-1px_-1px_#0a0a0a,inset_1px_1px_#ffffff,inset_-2px_-2px_#808080,inset_2px_2px_#dfdfdf,2px_3px_6px_rgba(0,0,0,0.35)]'

function TitleBar({ label, active, onClose }: { label: string; active: boolean; onClose?: () => void }) {
  return (
    <div
      className={cn(
        'flex h-4 items-center gap-1 px-1 text-[11px] font-bold leading-none',
        active ? 'bg-gradient-to-r from-[#000080] to-[#1084d0] text-white' : 'bg-gradient-to-r from-[#808080] to-[#b5b5b5] text-[#dfdfdf]',
      )}
    >
      <span className="min-w-0 flex-1 truncate font-mono">{label}</span>
      <button
        type="button"
        tabIndex={onClose ? 0 : -1}
        onClick={onClose}
        className={cn('flex h-3 w-3.5 shrink-0 items-center justify-center bg-[#c0c0c0] text-[9px] text-black shadow-[inset_-1px_-1px_#0a0a0a,inset_1px_1px_#ffffff]', onClose ? 'pointer-events-auto cursor-pointer' : 'pointer-events-none')}
        title={onClose ? 'Hide the call stack' : undefined}
        aria-label={onClose ? 'Hide the call stack' : undefined}
      >
        ×
      </button>
    </div>
  )
}

function HelpBody({ portrait }: { portrait?: string }) {
  return (
    <div className="flex items-center gap-1.5 overflow-hidden px-1" style={{ height: BODY_H }}>
      {portrait && (
        // eslint-disable-next-line @next/next/no-img-element -- static portrait, sized by CSS; the drawing fills ~half of its square
        <img src={portrait} alt="Büroklämmerli" className="h-8 w-8 shrink-0 scale-150 object-contain" />
      )}
      <span className="text-[11px] leading-tight">{HELP_LINE}</span>
    </div>
  )
}

interface Layout { winW: number; visible: number }

function layout(stack: KaraCallStack, width: number, height: number): Layout {
  const winW = Math.round(Math.min(210, Math.max(120, width * 0.7)))
  const fit = Math.max(1, Math.floor((height - 2 * MARGIN - WIN_H) / DY) + 1)
  return { winW, visible: Math.min(stack.depth, MAX_WINDOWS, fit) }
}

/** The cascade's box in world px: [left, top, right, bottom]. */
function blockRect(lay: Layout, corner: Corner, width: number, height: number): [number, number, number, number] {
  const w = lay.winW + (lay.visible - 1) * DX
  const h = WIN_H + (lay.visible - 1) * DY
  const left = corner[1] === 'l' ? MARGIN : width - MARGIN - w
  const top = corner[0] === 't' ? MARGIN : height - MARGIN - h
  return [left, top, left + w, top + h]
}

function covers(r: [number, number, number, number], kara: { x: number; y: number }, tile: number): boolean {
  // MOP-7's sprite without the outer quarter of its cell (a window edge over the cell border is fine).
  const x0 = kara.x * tile + tile / 4, y0 = kara.y * tile + tile / 4, x1 = x0 + tile / 2, y1 = y0 + tile / 2
  return x0 < r[2] && x1 > r[0] && y0 < r[3] && y1 > r[1]
}

const cornerStyle = (c: Corner): CSSProperties => ({
  [c[0] === 't' ? 'top' : 'bottom']: MARGIN,
  [c[1] === 'l' ? 'left' : 'right']: MARGIN,
})

/** Windows of `stack` from absolute index `from` on, cascaded (slot 0 = oldest shown). */
function Windows({ stack, lay, corner, from, closing, portrait, onClose }: {
  stack: KaraCallStack
  lay: Layout
  corner: Corner
  from: number
  closing?: boolean
  portrait?: string
  onClose?: () => void
}) {
  const { winW, visible } = lay
  const first = stack.depth - visible // absolute index of slot 0
  const more = first > 0 ? first + 1 : 0 // slot 0 becomes the '+ N more' stub
  const blockW = winW + (visible - 1) * DX
  const out = []
  for (let slot = 0; slot < visible; slot++) {
    const abs = first + slot
    if (abs < from) continue
    const top = slot === visible - 1
    const label = more && slot === 0 ? `+ ${more} more` : stack.top[stack.top.length - visible + slot] ?? ''
    out.push(
      <div
        key={`${abs}:${label}`}
        className={cn(
          'absolute p-[3px]', BEVEL,
          closing ? 'animate-out fade-out zoom-out-75 fill-mode-forwards duration-150' : 'animate-in fade-in zoom-in-90 duration-150',
        )}
        style={{ left: slot * DX, top: slot * DY, width: winW }}
      >
        <TitleBar label={label} active={top && !closing} onClose={top && !closing ? onClose : undefined} />
        {top && <HelpBody portrait={portrait} />}
      </div>,
    )
  }
  return <div className="absolute" style={{ ...cornerStyle(corner), width: blockW, height: WIN_H + (visible - 1) * DY }}>{out}</div>
}

export function KaraCallStackOverlay({ stack, pos, width, height, kara, tile, flood, assets }: {
  stack: KaraCallStack
  /** Replay position; a single forward step that shrinks the stack animates the close. */
  pos: number
  /** World size in px (canvas). */
  width: number
  height: number
  /** MOP-7's cell at `pos` and the tile size: the cascade avoids covering it. */
  kara: { x: number; y: number }
  tile: number
  /** The run ended in a RecursionError and the replay is at its end. */
  flood?: boolean
  assets?: Record<string, string>
}) {
  const [hidden, setHidden] = useState(false)
  const [prev, setPrev] = useState({ pos, stack })
  const [closing, setClosing] = useState<{ stack: KaraCallStack; from: number } | null>(null)
  if (prev.pos !== pos || prev.stack !== stack) {
    setPrev({ pos, stack })
    setClosing(pos === prev.pos + 1 && stack.depth < prev.stack.depth ? { stack: prev.stack, from: stack.depth } : null)
  }
  useEffect(() => {
    if (!closing) return
    const t = setTimeout(() => setClosing(null), CLOSE_MS)
    return () => clearTimeout(t)
  }, [closing])

  const lay = layout(stack, width, height)
  const [corner, setCorner] = useState<Corner>('tr')
  if (stack.depth > 0 && covers(blockRect(lay, corner, width, height), kara, tile)) {
    const free = CORNERS.find(c => !covers(blockRect(lay, c, width, height), kara, tile))
    if (free && free !== corner) setCorner(free)
  }

  const portrait = karaPortrait('bueroklaemmerli', assets)
  if (!width || !height) return null

  if (flood) return <Flood stack={stack} width={width} height={height} portrait={portrait} />

  if (hidden) {
    return stack.depth > 0 ? (
      <button
        type="button"
        onClick={() => setHidden(false)}
        style={cornerStyle(corner)}
        className={cn('pointer-events-auto absolute px-1.5 py-0.5 font-mono text-[11px]', BEVEL)}
        title="Show the call stack"
      >
        Call stack · {stack.depth}
      </button>
    ) : null
  }

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-label={`Call stack, depth ${stack.depth}`}>
      {closing && <Windows stack={closing.stack} lay={layout(closing.stack, width, height)} corner={corner} from={closing.from} closing />}
      {stack.depth > 0 && <Windows stack={stack} lay={lay} corner={corner} from={0} portrait={portrait} onClose={() => setHidden(true)} />}
    </div>
  )
}

/** RecursionError: windows everywhere, appearing one after the other; the last one in the middle. */
function Flood({ stack, width, height, portrait }: { stack: KaraCallStack; width: number; height: number; portrait?: string }) {
  const winW = Math.round(Math.min(210, Math.max(120, width * 0.6)))
  const spanX = Math.max(0, width - winW - 4)
  const spanY = Math.max(0, height - WIN_H - 4)
  const labels = stack.top.length ? stack.top : ['…']
  const wins = []
  for (let k = 0; k < FLOOD_WINDOWS; k++) {
    const last = k === FLOOD_WINDOWS - 1
    // Deterministic scatter: diagonal cascades that restart across the world.
    const run = Math.floor(k / 9), i = k % 9
    const x = last ? spanX / 2 : ((run * 0.27 + i * 0.09) % 1) * spanX
    const y = last ? spanY / 2 : ((run * 0.13 + i * 0.11) % 1) * spanY
    wins.push(
      <div
        key={k}
        className={cn('absolute p-[3px] animate-in fade-in zoom-in-75 fill-mode-backwards duration-100', BEVEL)}
        style={{ left: x, top: y, width: winW, animationDelay: `${k * FLOOD_STEP_MS}ms` }}
      >
        <TitleBar label={last ? 'RecursionError' : labels[labels.length - 1 - (k % labels.length)]} active={last} />
        <HelpBody portrait={portrait} />
      </div>,
    )
  }
  return <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-label="Call stack overflow">{wins}</div>
}
