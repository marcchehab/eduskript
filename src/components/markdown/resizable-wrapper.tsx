'use client'

import { useState, useRef, useCallback, useEffect, type ReactNode } from 'react'
import { AlignLeft, AlignCenter, AlignRight, WrapText } from 'lucide-react'

interface ResizableWrapperProps {
  children: ReactNode
  /** Initial width as percentage (0-100) or from style */
  initialWidth?: number | string
  /** Initial alignment */
  align?: 'left' | 'center' | 'right'
  /** Initial wrap setting */
  wrap?: boolean
  /** Called when width/align/wrap changes. If not provided, gizmos are hidden. */
  onLayoutChange?: (layout: { width: number; align: 'left' | 'center' | 'right'; wrap: boolean }) => void
  /** Additional className for the container */
  className?: string
  /** Additional style for the container */
  style?: React.CSSProperties
  /** Data attributes to pass through */
  dataAttributes?: Record<string, string>
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
}: ResizableWrapperProps) {
  const containerRef = useRef<HTMLSpanElement>(null)
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

  // Track initial drag state
  const dragStartRef = useRef<{ startX: number; startWidth: number; parentWidth: number } | null>(null)

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
    dragStartRef.current = {
      startX: e.clientX,
      startWidth: currentWidth,
      parentWidth: parentRect.width
    }

    setIsDragging(true)
  }, [currentWidth])

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging || !dragStartRef.current) return

    const { startX, startWidth, parentWidth } = dragStartRef.current

    const deltaX = e.clientX - startX
    // For right-aligned, invert the delta since we're dragging from the left
    const deltaPercent = (deltaX / parentWidth) * 100 * (currentAlign === 'right' ? -1 : 1)
    const newWidthPercent = Math.max(10, Math.min(100, startWidth + deltaPercent))

    setCurrentWidth(Math.round(newWidthPercent))
  }, [isDragging, currentAlign])

  const handleMouseUp = useCallback(() => {
    if (isDragging && onLayoutChange) {
      onLayoutChange({ width: currentWidth, align: currentAlign, wrap: currentWrap })
    }
    setIsDragging(false)
    dragStartRef.current = null
  }, [isDragging, currentWidth, currentAlign, currentWrap, onLayoutChange])

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
      className={`block relative my-4 group ${alignmentClasses} ${className}`}
      style={{ ...style, width: `${currentWidth}%` }}
      {...dataProps}
    >
      {/* Content */}
      {children}

      {/* Gizmos - only show when onLayoutChange is provided (editor mode) */}
      {onLayoutChange && (
        <>
          {/* Resize handle */}
          <span
            onMouseDown={handleMouseDown}
            className={`block absolute top-0 bottom-0 ${currentAlign === 'right' ? 'left-0' : 'right-0'} w-2 cursor-ew-resize opacity-0 group-hover:opacity-100 hover:bg-primary/20 transition-all ${
              isDragging ? 'opacity-100 bg-primary/30' : ''
            }`}
          >
            <span className="block absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1.5 h-8 bg-white dark:bg-black rounded-full transition-colors shadow-[0_0_0_2px_rgba(0,0,0,0.4)] dark:shadow-[0_0_0_2px_rgba(255,255,255,0.4)]" />
          </span>

          {/* Width indicator */}
          {(isDragging || currentWidth < 100) && (
            <span className={`block absolute -top-8 left-1/2 -translate-x-1/2 bg-background/95 backdrop-blur border border-border/50 px-2 py-1 rounded text-[10px] font-mono text-foreground z-10 pointer-events-none transition-opacity ${
              isDragging ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
            }`}>
              {Math.round(currentWidth)}%
            </span>
          )}

          {/* Alignment and wrap controls */}
          <span className="absolute top-2 right-2 bg-background/95 backdrop-blur border border-border/50 rounded opacity-0 group-hover:opacity-100 transition-opacity z-10 flex gap-0.5 p-0.5">
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
          </span>
        </>
      )}
    </span>
  )
}
