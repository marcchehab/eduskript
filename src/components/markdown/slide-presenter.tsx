'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, X, ZoomIn, ZoomOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SlideDrawLayer } from './slide-draw-layer'
import { SlideToolbar, type SlideDrawMode } from './slide-toolbar'

interface SlidePresenterProps {
  /** Pre-compiled slide nodes (server-compiled, passed through PresentButton). */
  slides: ReactNode[]
  /** Slide to open on — the one the reader was scrolled to (see PresentButton). */
  initialIndex?: number
  onExit: () => void
}

/** Default pen colors (match the annotation palette). */
const DEFAULT_PEN_COLORS: [string, string, string] = ['#DD5555', '#5577DD', '#44AA66']
const DEFAULT_PEN_SIZES: [number, number, number] = [2, 2, 2]

/** True when focus sits in something the user types into, so navigation keys
 *  (arrows / space) shouldn't flip the slide — e.g. an embedded code editor. */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    target.isContentEditable ||
    target.closest('.cm-editor') !== null
  )
}

/**
 * Full-screen, one-slide-at-a-time presentation overlay. Reuses the editor's
 * `fixed inset-0` fullscreen idiom. Slides are already compiled React trees, so
 * every interactive component (code editors, quizzes, KaTeX, callouts) hydrates
 * exactly as on the normal page.
 *
 * Layout: slide counter top-left, exit top-right, prev/next on the right edge,
 * and a bottom-center drawing toolbar (SlideToolbar) styled like the page
 * annotation toolbar. Drawing is local + ephemeral (SlideDrawLayer).
 */
export function SlidePresenter({ slides, initialIndex = 0, onExit }: SlidePresenterProps) {
  const [index, setIndex] = useState(() =>
    Math.min(Math.max(initialIndex, 0), Math.max(slides.length - 1, 0)),
  )
  const [mode, setMode] = useState<SlideDrawMode>('view')
  const [activePen, setActivePen] = useState(0)
  const [penColors, setPenColors] = useState<[string, string, string]>(DEFAULT_PEN_COLORS)
  const [penSizes, setPenSizes] = useState<[number, number, number]>(DEFAULT_PEN_SIZES)
  const [clearSignal, setClearSignal] = useState(0)
  const [zoom, setZoom] = useState(1)
  const containerRef = useRef<HTMLDivElement>(null)

  const last = slides.length - 1
  const next = useCallback(() => setIndex((i) => Math.min(i + 1, last)), [last])
  const prev = useCallback(() => setIndex((i) => Math.max(i - 1, 0)), [])

  const setPenColor = (i: number, color: string) =>
    setPenColors((prev) => prev.map((c, j) => (j === i ? color : c)) as [string, string, string])
  const setPenSize = (i: number, size: number) =>
    setPenSizes((prev) => prev.map((s, j) => (j === i ? size : s)) as [number, number, number])

  // Keyboard navigation. Arrows/Space/PageDown advance; Escape clears the
  // draw/erase tool first, then exits the presenter on a second press. Typing
  // in an embedded editor must not steal the keys. Arrows still navigate while
  // drawing (drawing is pointer-driven).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        if (mode !== 'view') setMode('view')
        else onExit()
        return
      }
      if (isEditableTarget(e.target)) return
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
        e.preventDefault()
        next()
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault()
        prev()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [next, prev, onExit, mode])

  // Stylus auto-activates the pen: any pen pointer (hover or touch) while idle
  // promotes 'view' → 'draw', so a hover-capable pen flips the mode before the
  // first stroke even begins. Mirrors annotation-layer.tsx's document-level
  // stylus detection. Skips pen events over buttons or editable surfaces so
  // toolbar / nav / code editors still behave normally.
  useEffect(() => {
    if (mode !== 'view') return
    const onPenPointer = (e: PointerEvent) => {
      if (e.pointerType !== 'pen') return
      const target = e.target as HTMLElement | null
      if (target?.closest('button')) return
      if (isEditableTarget(target)) return
      setMode('draw')
    }
    document.addEventListener('pointermove', onPenPointer)
    document.addEventListener('pointerdown', onPenPointer)
    return () => {
      document.removeEventListener('pointermove', onPenPointer)
      document.removeEventListener('pointerdown', onPenPointer)
    }
  }, [mode])

  // Lock background scroll while presenting; restore on exit. Move focus into
  // the overlay so keyboard nav works immediately, restore it on close.
  useEffect(() => {
    const prevOverflow = document.body.style.overflow
    const prevFocus = document.activeElement as HTMLElement | null
    document.body.style.overflow = 'hidden'
    containerRef.current?.focus()
    return () => {
      document.body.style.overflow = prevOverflow
      prevFocus?.focus?.()
    }
  }, [])

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-label="Slide presentation"
      tabIndex={-1}
      className="fixed inset-0 z-[60] bg-background outline-none"
    >
      {/* Counter — top-left. */}
      <span className="fixed top-4 left-5 z-[61] text-sm text-muted-foreground tabular-nums">
        {index + 1} / {slides.length}
      </span>

      {/* Exit — top-right. */}
      <Button
        variant="ghost"
        size="sm"
        onClick={onExit}
        title="Exit presentation (Esc)"
        className="fixed top-3 right-4 z-[61]"
      >
        <X className="w-4 h-4" />
      </Button>

      {/* Slide body + drawing overlay. Content scrolls if a slide overflows;
          the draw canvas covers the visible region. */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute inset-0 overflow-auto">
          {/* CSS `zoom` (not transform) so the scroll area grows with the
              content — lets you scroll a zoomed-in slide. The draw canvas is a
              sibling, so strokes stay in viewport space. */}
          <div className="mx-auto max-w-4xl px-8 py-16" style={{ zoom }}>
            <article className="prose-theme">
              <div className="markdown-content prose dark:prose-invert max-w-none">
                {slides[index]}
              </div>
            </article>
          </div>
        </div>
        <SlideDrawLayer
          slideIndex={index}
          mode={mode}
          color={penColors[activePen]}
          size={penSizes[activePen]}
          clearSignal={clearSignal}
        />
      </div>

      {/* Prev/next + zoom — right edge, vertically centered. */}
      <div className="fixed right-4 top-1/2 -translate-y-1/2 z-[61] flex flex-col items-center gap-2">
        <Button variant="outline" size="icon" onClick={prev} disabled={index === 0} title="Previous (←)">
          <ChevronLeft className="w-5 h-5" />
        </Button>
        <Button variant="outline" size="icon" onClick={next} disabled={index === last} title="Next (→)">
          <ChevronRight className="w-5 h-5" />
        </Button>
        {/* Compact zoom: an icon-sized pill at rest. The slider is an absolute
            overlay revealed on hover, so expanding causes zero layout shift
            (the pill keeps a fixed footprint). top-full sits flush under the
            pill so the hover area is continuous. */}
        <div className="group relative mt-1 flex flex-col items-center rounded-lg border border-border bg-background/95 p-2 shadow-lg backdrop-blur">
          <span title={`Zoom ${Math.round(zoom * 100)}%`} className="flex">
            <ZoomIn className="w-4 h-4 opacity-70" />
          </span>
          <div className="absolute left-1/2 top-full z-10 hidden -translate-x-1/2 flex-col items-center gap-2 rounded-lg border border-border bg-background/95 p-2 shadow-lg backdrop-blur group-hover:flex">
            <input
              type="range"
              min="0.5"
              max="2"
              step="0.02"
              value={zoom}
              onChange={(e) => setZoom(parseFloat(e.target.value))}
              title={`Zoom ${Math.round(zoom * 100)}%`}
              aria-label="Zoom slide"
              className="h-32 cursor-pointer [writing-mode:vertical-lr] [direction:rtl] slider-vertical"
            />
            <ZoomOut className="w-4 h-4 opacity-60" />
          </div>
        </div>
      </div>

      {/* Drawing toolbar — bottom-center, styled like the page annotation bar. */}
      <SlideToolbar
        mode={mode}
        onModeChange={setMode}
        activePen={activePen}
        onActivePenChange={setActivePen}
        penColors={penColors}
        onPenColorChange={setPenColor}
        penSizes={penSizes}
        onPenSizeChange={setPenSize}
        onClear={() => setClearSignal((n) => n + 1)}
      />
    </div>
  )
}
