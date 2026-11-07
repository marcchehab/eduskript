'use client'

import { useState, useRef, useCallback, useEffect, type ReactNode } from 'react'
import { AlignLeft, AlignCenter, AlignRight, MoveDiagonal2, WrapText } from 'lucide-react'
import { usePrintMode } from '@/lib/print/print-mode'

interface ResizableWrapperProps {
  children: ReactNode
  /** Initial width as percentage (0-100) or from style */
  initialWidth?: number | string
  /** Initial alignment */
  align?: 'left' | 'center' | 'right'
  /** Initial wrap setting */
  wrap?: boolean
  /** Called when width/align/wrap changes. If not provided, gizmos are hidden.
      May resolve false (change not saved): the width then snaps back to
      initialWidth. */
  onLayoutChange?: (layout: { width: number; align: 'left' | 'center' | 'right'; wrap: boolean }) => void | Promise<boolean>
  /** Additional className for the container */
  className?: string
  /** Additional style for the container */
  style?: React.CSSProperties
  /** Data attributes to pass through */
  dataAttributes?: Record<string, string>
  /** Natural content width in px. Applied as max-width ONLY in the default
      state (width 100%, not dragging) so an unresized image renders at its
      original size capped at the pane width — once the user resizes, they are
      free to scale past the natural size and past 100%. */
  naturalMaxWidth?: number
  /** Extra buttons rendered inside the alignment/wrap control group, after a
      divider (e.g. the image invert toggle). Editor mode only — the group is
      hidden without onLayoutChange. */
  extraControls?: ReactNode
  /** Width handle only, no align/wrap buttons (print preview layout editing). */
  widthOnly?: boolean
  /** In the print view, carry the height measured online as
      data-print-online-height, so strokes below move with a print-only size
      change (src/lib/print/stroke-shift.ts). Missing when the page was opened
      with ?print (never laid out online). */
  markOnlineHeight?: boolean
}

export function ResizableWrapper({
  children,
  initialWidth,
  align = 'center',
  wrap = false,
  onLayoutChange,
  className = '',
  style,
  dataAttributes,
  naturalMaxWidth,
  extraControls,
  widthOnly = false,
  markOnlineHeight = false,
}: ResizableWrapperProps) {
  const containerRef = useRef<HTMLSpanElement>(null)
  const printing = usePrintMode()
  const [onlineHeight, setOnlineHeight] = useState<number | null>(null)
  // Measured whenever shown online (not only with markOnlineHeight), so a
  // print width set later in the preview still has the online height.
  useEffect(() => {
    const el = containerRef.current
    if (printing || !el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setOnlineHeight(el.offsetHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [printing])
  // widthOnly: distance from the wrapper's bottom to the image's bottom, so
  // the corner handle sits on the image, not below a caption. Visible <img>s
  // only (Excalidraw renders a hidden light/dark twin). Paper px (the print
  // paper may be scaled by a transform).
  const [mediaInset, setMediaInset] = useState(0)
  useEffect(() => {
    const el = containerRef.current
    if (!widthOnly || !el || typeof ResizeObserver === 'undefined') return
    const measure = () => {
      const box = el.getBoundingClientRect()
      const scale = el.offsetHeight ? box.height / el.offsetHeight : 1
      const bottoms = [...el.querySelectorAll('img')].map((img) => img.getBoundingClientRect()).filter((r) => r.height > 0).map((r) => r.bottom)
      setMediaInset(bottoms.length ? Math.max(0, (box.bottom - Math.max(...bottoms)) / (scale || 1)) : 0)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    el.querySelectorAll('img').forEach((img) => ro.observe(img))
    return () => ro.disconnect()
  }, [widthOnly])
  const [isDragging, setIsDragging] = useState(false)
  const [currentAlign, setCurrentAlign] = useState<'left' | 'center' | 'right'>(align)
  const [currentWrap, setCurrentWrap] = useState(wrap)

  // Parse initial width
  const [currentWidth, setCurrentWidth] = useState<number>(() => {
    if (typeof initialWidth === 'number') {
      return initialWidth
    }
    if (typeof initialWidth === 'string' && initialWidth.includes('%')) {
      return parseFloat(initialWidth)
    }
    return 100
  })

  // Track initial drag state. `originalWidth` is the pre-drag state width so a
  // click without movement can restore it instead of committing the measured %.
  const dragStartRef = useRef<{ startX: number; startWidth: number; parentWidth: number; originalWidth: number; moved: boolean } | null>(null)

  // Update width when initialWidth prop changes
  useEffect(() => {
    if (typeof initialWidth === 'number') {
      setCurrentWidth(initialWidth)
    } else if (typeof initialWidth === 'string' && initialWidth.includes('%')) {
      setCurrentWidth(parseFloat(initialWidth))
    } else if (initialWidth === undefined) {
      setCurrentWidth(100)
    }
  }, [initialWidth])

  // Update align and wrap when props change
  useEffect(() => {
    setCurrentAlign(align)
  }, [align])

  useEffect(() => {
    setCurrentWrap(wrap)
  }, [wrap])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()

    if (!containerRef.current) return
    const parent = containerRef.current.parentElement
    if (!parent) return

    const parentRect = parent.getBoundingClientRect()
    // Start from the RENDERED width, not the state width: in the default state
    // (width 100% + naturalMaxWidth cap) the element is visually narrower than
    // 100%, and starting the drag math at 100 makes the element jump to full
    // pane width the moment the cap is lifted for dragging.
    const renderedPercent = (containerRef.current.getBoundingClientRect().width / parentRect.width) * 100
    dragStartRef.current = {
      startX: e.clientX,
      startWidth: renderedPercent,
      parentWidth: parentRect.width,
      originalWidth: currentWidth,
      moved: false
    }
    setCurrentWidth(Math.round(renderedPercent))

    setIsDragging(true)
  }, [currentWidth])

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging || !dragStartRef.current) return

    const { startX, startWidth, parentWidth } = dragStartRef.current

    const deltaX = e.clientX - startX
    if (deltaX !== 0) dragStartRef.current.moved = true
    // For right-aligned, invert the delta since we're dragging from the left
    const deltaPercent = (deltaX / parentWidth) * 100 * (currentAlign === 'right' ? -1 : 1)
    // No upper clamp: the user may scale past the natural size and past 100%.
    const newWidthPercent = Math.max(10, startWidth + deltaPercent)

    setCurrentWidth(Math.round(newWidthPercent))
  }, [isDragging, currentAlign])

  const handleMouseUp = useCallback(() => {
    if (isDragging && dragStartRef.current) {
      if (dragStartRef.current.moved) {
        const saved = onLayoutChange?.({ width: currentWidth, align: currentAlign, wrap: currentWrap })
        if (saved instanceof Promise) {
          void saved.then((ok) => {
            if (!ok) setCurrentWidth(typeof initialWidth === 'number' ? initialWidth : typeof initialWidth === 'string' && initialWidth.includes('%') ? parseFloat(initialWidth) : 100)
          })
        }
      } else {
        // Click without movement: restore the pre-drag width so a naturally
        // capped element (width 100% + naturalMaxWidth) doesn't get its
        // measured % committed by a stray click on the handle.
        setCurrentWidth(dragStartRef.current.originalWidth)
      }
    }
    setIsDragging(false)
    dragStartRef.current = null
  }, [isDragging, currentWidth, currentAlign, currentWrap, onLayoutChange, initialWidth])

  const handleAlignChange = useCallback((alignment: 'left' | 'center' | 'right') => {
    setCurrentAlign(alignment)
    onLayoutChange?.({ width: currentWidth, align: alignment, wrap: currentWrap })
  }, [currentWidth, currentWrap, onLayoutChange])

  const handleWrapToggle = useCallback(() => {
    const newWrap = !currentWrap
    setCurrentWrap(newWrap)
    onLayoutChange?.({ width: currentWidth, align: currentAlign, wrap: newWrap })
  }, [currentWrap, currentWidth, currentAlign, onLayoutChange])

  // Attach mouse listeners when dragging
  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      return () => {
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
      }
    }
  }, [isDragging, handleMouseMove, handleMouseUp])

  // Calculate alignment classes.
  // Floated images get z-10 so they (and their hover resize/align handles) paint
  // above overlapping sibling blocks. Notably a color-title <h1> sets z-index:0
  // (globals.css) and, being later in the DOM, would otherwise cover the float
  // and swallow the group-hover that reveals the handles.
  const alignmentClasses = currentWrap
    ? currentAlign === 'left'
      ? 'float-left mr-4 mb-4 z-10'
      : currentAlign === 'right'
      ? 'float-right ml-4 mb-4 z-10'
      : 'mx-auto'
    : currentAlign === 'left'
    ? 'mr-auto'
    : currentAlign === 'right'
    ? 'ml-auto'
    : 'mx-auto'

  // Build data attributes
  const dataProps: Record<string, string> = {}
  if (dataAttributes) {
    for (const [key, value] of Object.entries(dataAttributes)) {
      dataProps[`data-${key}`] = value
    }
  }

  return (
    <span
      ref={containerRef}
      // While dragging, iframes (YouTube player) would swallow mousemove/mouseup
      // once the cursor crosses them and the drag would stick.
      className={`block relative my-4 group ${alignmentClasses} ${isDragging ? '[&_iframe]:pointer-events-none' : ''} ${className}`}
      style={{
        ...style,
        width: `${currentWidth}%`,
        ...(naturalMaxWidth !== undefined && currentWidth === 100 && !isDragging
          ? { maxWidth: `${naturalMaxWidth}px` }
          : {}),
      }}
      {...dataProps}
      data-print-online-height={markOnlineHeight && printing && onlineHeight !== null ? onlineHeight : undefined}
    >
      {/* Content */}
      {children}

      {/* Gizmos - only show when onLayoutChange is provided (editor mode) */}
      {onLayoutChange && (
        <>
          {/* Resize handle. widthOnly (print preview): a round corner handle at
              the bottom right like <stickme>'s; else a bar along the edge. */}
          {widthOnly ? (
          <span
            onMouseDown={handleMouseDown}
            title="Drag to resize for print"
            style={{ bottom: mediaInset - 12 }}
            className={`print:hidden absolute ${currentAlign === 'right' ? '-left-3 cursor-nesw-resize' : '-right-3 cursor-nwse-resize'} z-10 flex h-7 w-7 items-center justify-center rounded-full border border-background/60 bg-foreground/85 text-background shadow-md transition-opacity ${
              isDragging ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
            }`}
          >
            <MoveDiagonal2 className={`h-3.5 w-3.5 ${currentAlign === 'right' ? 'rotate-90' : ''}`} />
          </span>
          ) : (
          <span
            onMouseDown={handleMouseDown}
            className={`print:hidden block absolute top-0 bottom-0 ${currentAlign === 'right' ? 'left-0' : 'right-0'} w-2 cursor-ew-resize opacity-0 group-hover:opacity-100 hover:bg-primary/20 transition-all ${
              isDragging ? 'opacity-100 bg-primary/30' : ''
            }`}
          >
            <span className="block absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1.5 h-8 bg-white dark:bg-black rounded-full transition-colors shadow-[0_0_0_2px_rgba(0,0,0,0.4)] dark:shadow-[0_0_0_2px_rgba(255,255,255,0.4)]" />
          </span>
          )}

          {/* Width indicator */}
          {(isDragging || currentWidth !== 100) && (
            <span className={`print:hidden block absolute -top-8 left-1/2 -translate-x-1/2 bg-background/95 backdrop-blur-sm border border-border/50 px-2 py-1 rounded text-[10px] font-mono text-foreground z-10 pointer-events-none transition-opacity ${
              isDragging ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
            }`}>
              {Math.round(currentWidth)}%
            </span>
          )}

          {/* Alignment and wrap controls. Components hide their own top-right
              overlays (fullscreen) in editor mode and put editor-only toggles
              here via extraControls instead. */}
          {(!widthOnly || extraControls) && (
          <span className="print:hidden absolute top-2 right-2 bg-background/95 backdrop-blur-sm border border-border/50 rounded opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity z-10 flex items-center gap-0.5 p-0.5">
            {!widthOnly && (<>
            <button
              onClick={() => handleAlignChange('left')}
              className={`p-1.5 rounded hover:bg-accent transition-colors ${
                currentAlign === 'left' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground'
              }`}
              title="Align left"
            >
              <AlignLeft className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => handleAlignChange('center')}
              className={`p-1.5 rounded hover:bg-accent transition-colors ${
                currentAlign === 'center' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground'
              }`}
              title="Align center"
            >
              <AlignCenter className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => handleAlignChange('right')}
              className={`p-1.5 rounded hover:bg-accent transition-colors ${
                currentAlign === 'right' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground'
              }`}
              title="Align right"
            >
              <AlignRight className="w-3.5 h-3.5" />
            </button>
            <span className="w-px bg-border mx-0.5" />
            <button
              onClick={handleWrapToggle}
              className={`p-1.5 rounded hover:bg-accent transition-colors ${
                currentWrap ? 'bg-accent text-accent-foreground' : 'text-muted-foreground'
              }`}
              title="Text wrap"
            >
              <WrapText className="w-3.5 h-3.5" />
            </button>
            </>)}
            {extraControls && (
              <>
                {!widthOnly && <span className="w-px bg-border mx-0.5" />}
                {extraControls}
              </>
            )}
          </span>
          )}
        </>
      )}
    </span>
  )
}
