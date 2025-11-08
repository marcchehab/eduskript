'use client'

import { useTheme } from 'next-themes'
import { useState, useRef, useCallback, useEffect } from 'react'
import { AlignLeft, AlignCenter, AlignRight, WrapText } from 'lucide-react'

interface ExcalidrawImageProps {
  lightSrc: string
  darkSrc: string
  alt?: string
  filename: string
  style?: React.CSSProperties
  onWidthChange?: (markdown: string) => void
  align?: 'left' | 'center' | 'right'
  wrap?: boolean
}

export function ExcalidrawImage({ lightSrc, darkSrc, alt, filename, style, onWidthChange, align = 'center', wrap = false }: ExcalidrawImageProps) {
  const { resolvedTheme } = useTheme()
  const [imageLoaded, setImageLoaded] = useState(false)
  const containerRef = useRef<HTMLElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [currentAlign, setCurrentAlign] = useState<'left' | 'center' | 'right'>(align)
  const [currentWrap, setCurrentWrap] = useState(wrap)

  // Track width - can be either a percentage number (for UI controls) or null (use style prop directly)
  const [currentWidth, setCurrentWidth] = useState<number | null>(() => {
    // Parse initial width from style
    if (style?.width && typeof style.width === 'string' && style.width.includes('%')) {
      return parseFloat(style.width)
    }
    return 100
  })

  // Track initial drag state
  const dragStartRef = useRef<{ startX: number; startWidth: number; parentWidth: number } | null>(null)

  // Update width when style prop changes (e.g., when markdown is edited)
  useEffect(() => {
    // Handle style as object (React CSSProperties)
    if (style && typeof style === 'object' && style.width) {
      const widthStr = String(style.width)
      if (widthStr.includes('%')) {
        setCurrentWidth(parseFloat(widthStr))
      } else {
        // For non-percentage values (px, rem, etc), set to null so we use style prop directly
        setCurrentWidth(null)
      }
    }
    // Handle style as string (from markdown processor)
    else if (typeof style === 'string' && style.includes('width:')) {
      const widthMatch = style.match(/width:\s*([^;]+)/)
      if (widthMatch) {
        const widthValue = widthMatch[1].trim()
        if (widthValue.includes('%')) {
          setCurrentWidth(parseFloat(widthValue))
        } else {
          // For non-percentage values, set to null so we use style prop directly
          setCurrentWidth(null)
        }
      }
    }
    else if (!style || (typeof style === 'object' && !style.width)) {
      setCurrentWidth(100)
    }
  }, [style])

  // Update align and wrap when props change
  useEffect(() => {
    setCurrentAlign(align)
  }, [align])

  useEffect(() => {
    setCurrentWrap(wrap)
  }, [wrap])

  // Use dark src if theme is dark, otherwise use light
  const src = resolvedTheme === 'dark' ? darkSrc : lightSrc

  const caption = alt || ''

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()

    if (!containerRef.current) return
    const parent = containerRef.current.parentElement
    if (!parent) return

    // Store initial state when drag starts
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

    // Calculate the delta from where we started dragging
    const deltaX = e.clientX - startX

    // Convert delta pixels to percentage change
    // For right-aligned images, invert the delta since we're dragging from the left
    const deltaPercent = (deltaX / parentWidth) * 100 * (currentAlign === 'right' ? -1 : 1)

    // Apply the delta to the starting width
    const newWidthPercent = Math.max(10, Math.min(100, startWidth + deltaPercent))

    setCurrentWidth(Math.round(newWidthPercent))
  }, [isDragging, currentAlign])

  // Get the effective width for display (convert null to 100 for percentage display)
  const effectiveWidth = currentWidth ?? 100

  const updateMarkdown = useCallback((width: number, alignment: 'left' | 'center' | 'right', wrapEnabled: boolean) => {
    if (!onWidthChange) return

    // Build attributes string
    let attributes = `width=${Math.round(width)}%`
    if (alignment !== 'center') {
      attributes += `;align=${alignment}`
    }
    if (wrapEnabled) {
      attributes += `;wrap=true`
    }

    onWidthChange(`![${alt || ''}](${filename}){${attributes}}`)
  }, [alt, filename, onWidthChange])

  const handleMouseUp = useCallback(() => {
    if (isDragging && onWidthChange) {
      updateMarkdown(effectiveWidth, currentAlign, currentWrap)
    }
    setIsDragging(false)
    dragStartRef.current = null // Clear drag state
  }, [isDragging, effectiveWidth, currentAlign, currentWrap, onWidthChange, updateMarkdown])

  const handleAlignChange = useCallback((alignment: 'left' | 'center' | 'right') => {
    setCurrentAlign(alignment)
    updateMarkdown(effectiveWidth, alignment, currentWrap)
  }, [effectiveWidth, currentWrap, updateMarkdown])

  const handleWrapToggle = useCallback(() => {
    const newWrap = !currentWrap
    setCurrentWrap(newWrap)
    updateMarkdown(effectiveWidth, currentAlign, newWrap)
  }, [currentWrap, effectiveWidth, currentAlign, updateMarkdown])

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

  // Calculate alignment classes and styles
  const alignmentClasses = currentWrap
    ? currentAlign === 'left'
      ? 'float-left mr-4 mb-4'
      : currentAlign === 'right'
      ? 'float-right ml-4 mb-4'
      : 'mx-auto' // center doesn't make sense with wrap
    : currentAlign === 'left'
    ? 'mr-auto'
    : currentAlign === 'right'
    ? 'ml-auto'
    : 'mx-auto'

  return (
    <figure
      ref={containerRef}
      className={`excalidraw-wrapper relative my-4 group ${alignmentClasses}`}
      data-excalidraw={filename}
      style={currentWidth !== null ? { ...style, width: `${currentWidth}%` } : style}
    >
      <img
        src={src}
        alt={caption}
        loading="lazy"
        decoding="async"
        onLoad={() => setImageLoaded(true)}
        className={`w-full h-auto rounded-md transition-opacity duration-200 ${
          imageLoaded ? 'opacity-100' : 'opacity-0'
        }`}
      />
      {caption && (
        <figcaption className="mt-2 text-sm text-center text-muted-foreground italic">
          {caption}
        </figcaption>
      )}

      {/* Resize handle - only show if onWidthChange is provided (editor mode) */}
      {onWidthChange && (
        <>
          <div
            onMouseDown={handleMouseDown}
            className={`absolute top-0 bottom-0 ${currentAlign === 'right' ? 'left-0' : 'right-0'} w-2 cursor-ew-resize opacity-0 group-hover:opacity-100 hover:bg-primary/20 transition-all ${
              isDragging ? 'opacity-100 bg-primary/30' : ''
            }`}
          >
            {/* Visual indicator */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1.5 h-8 bg-white dark:bg-black rounded-full transition-colors shadow-[0_0_0_2px_rgba(0,0,0,0.4)] dark:shadow-[0_0_0_2px_rgba(255,255,255,0.4)]" />
          </div>

          {/* Width indicator - centered above image, shown on hover or when dragging */}
          {(isDragging || effectiveWidth < 100) && (
            <div className={`absolute -top-8 left-1/2 -translate-x-1/2 bg-background/95 backdrop-blur border border-border/50 px-2 py-1 rounded text-[10px] font-mono text-foreground z-10 pointer-events-none transition-opacity ${
              isDragging ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
            }`}>
              {Math.round(effectiveWidth)}%
            </div>
          )}

          {/* Alignment and wrap controls */}
          <div className="absolute top-2 right-2 bg-background/95 backdrop-blur border border-border/50 rounded opacity-0 group-hover:opacity-100 transition-opacity z-10 flex gap-0.5 p-0.5">
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
            <div className="w-px bg-border mx-0.5" />
            <button
              onClick={handleWrapToggle}
              className={`p-1.5 rounded hover:bg-accent transition-colors ${
                currentWrap ? 'bg-accent text-accent-foreground' : 'text-muted-foreground'
              }`}
              title="Text wrap"
            >
              <WrapText className="w-3.5 h-3.5" />
            </button>
          </div>
        </>
      )}
    </figure>
  )
}
