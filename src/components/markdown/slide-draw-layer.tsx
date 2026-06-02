'use client'

import { useCallback, useEffect, useRef } from 'react'
import type { SlideDrawMode } from './slide-toolbar'

/** Points are stored normalized (0–1) to the canvas box, so strokes survive a
 *  viewport resize without rescaling math. */
interface NormPoint {
  x: number
  y: number
}
interface Stroke {
  color: string
  width: number
  points: NormPoint[]
}

interface SlideDrawLayerProps {
  /** Which slide's strokes to show — strokes are kept per slide for the session. */
  slideIndex: number
  mode: SlideDrawMode
  color: string
  /** Brush size on the toolbar's 0.1–5 scale (mapped to px below). */
  size: number
  /** Bumping this clears the current slide's strokes. */
  clearSignal: number
}

/** Map the toolbar's 0.1–5 brush scale to a canvas line width. */
const toPx = (size: number) => Math.max(1.5, size * 2.2)
/** Eraser hit radius in px. */
const ERASE_RADIUS = 16

/**
 * A lightweight freehand drawing overlay for the presenter. Strokes are kept
 * in memory, **per slide**, for the duration of the presentation only — never
 * persisted and completely separate from the page's annotation system. Pen and
 * eraser are driven by the presenter's SlideToolbar state.
 */
export function SlideDrawLayer({ slideIndex, mode, color, size, clearSignal }: SlideDrawLayerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // Per-slide strokes for this session. Ref (not state) — drawing redraws the
  // canvas imperatively, so we don't need React re-renders on every point.
  const strokesBySlide = useRef<Map<number, Stroke[]>>(new Map())
  const drawing = useRef<Stroke | null>(null)
  const erasing = useRef(false)
  // Effective mode for the in-flight stroke. Lets a pen barrel-button press
  // override the toolbar mode to 'erase' for one stroke without flipping the UI.
  const liveModeRef = useRef<SlideDrawMode>('view')

  const redraw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    const strokes = strokesBySlide.current.get(slideIndex) ?? []
    const live = drawing.current ? [...strokes, drawing.current] : strokes
    for (const stroke of live) {
      if (stroke.points.length === 0) continue
      ctx.strokeStyle = stroke.color
      ctx.lineWidth = stroke.width
      ctx.beginPath()
      stroke.points.forEach((p, i) => {
        const x = p.x * canvas.width
        const y = p.y * canvas.height
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      })
      ctx.stroke()
    }
  }, [slideIndex])

  // Size the canvas to its box (and on resize), then redraw. The canvas's
  // backing pixels match its CSS box so normalized points map 1:1.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      canvas.width = rect.width
      canvas.height = rect.height
      redraw()
    }
    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [redraw])

  // Redraw when the slide changes (show that slide's strokes).
  useEffect(() => {
    redraw()
  }, [slideIndex, redraw])

  // Clear current slide's strokes when the parent bumps clearSignal.
  useEffect(() => {
    if (clearSignal === 0) return
    strokesBySlide.current.delete(slideIndex)
    redraw()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearSignal])

  const toNorm = (e: React.PointerEvent): NormPoint => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height }
  }

  /** Remove any stroke passing within ERASE_RADIUS of the given (normalized) point. */
  const eraseAt = (p: NormPoint) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rx = ERASE_RADIUS / canvas.width
    const ry = ERASE_RADIUS / canvas.height
    const list = strokesBySlide.current.get(slideIndex)
    if (!list) return
    const kept = list.filter(
      (s) => !s.points.some((q) => Math.abs(q.x - p.x) <= rx && Math.abs(q.y - p.y) <= ry),
    )
    if (kept.length !== list.length) {
      strokesBySlide.current.set(slideIndex, kept)
      redraw()
    }
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (mode === 'view') return
    // Pen barrel button (bit 5 / value 32) momentarily forces eraser, matching
    // simple-canvas.tsx's behavior on the normal page.
    const isPen = e.pointerType === 'pen'
    const isEraserButton = isPen && (e.buttons & 32) !== 0
    const effective: SlideDrawMode = isEraserButton ? 'erase' : mode
    liveModeRef.current = effective
    canvasRef.current?.setPointerCapture(e.pointerId)
    if (effective === 'erase') {
      erasing.current = true
      eraseAt(toNorm(e))
      return
    }
    drawing.current = { color, width: toPx(size), points: [toNorm(e)] }
    redraw()
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (liveModeRef.current === 'erase') {
      if (erasing.current) eraseAt(toNorm(e))
      return
    }
    if (!drawing.current) return
    drawing.current.points.push(toNorm(e))
    redraw()
  }
  const onPointerUp = () => {
    erasing.current = false
    if (!drawing.current) return
    const stroke = drawing.current
    drawing.current = null
    if (stroke.points.length > 0) {
      const list = strokesBySlide.current.get(slideIndex) ?? []
      list.push(stroke)
      strokesBySlide.current.set(slideIndex, list)
    }
    redraw()
  }

  const active = mode !== 'view'
  return (
    <canvas
      ref={canvasRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
      className="absolute inset-0 h-full w-full"
      style={{
        pointerEvents: active ? 'auto' : 'none',
        cursor: active ? 'crosshair' : 'default',
        touchAction: active ? 'none' : 'auto',
      }}
    />
  )
}
