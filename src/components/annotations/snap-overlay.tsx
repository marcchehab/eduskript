'use client'

import { useState, useCallback, useRef } from 'react'
import { toSvg, getFontEmbedCSS } from 'html-to-image'

export interface Snap {
  id: string
  name: string
  imageUrl: string
  top: number
  left: number
  width: number
  height: number
}

interface SnapOverlayProps {
  onCapture: (snap: Snap) => void
  onCancel: () => void
  nextSnapNumber: number
  zoom: number
}

export function SnapOverlay({ onCapture, onCancel, nextSnapNumber, zoom }: SnapOverlayProps) {
  const [isDragging, setIsDragging] = useState(false)
  const [startPos, setStartPos] = useState<{ x: number; y: number } | null>(null)
  const [currentPos, setCurrentPos] = useState<{ x: number; y: number } | null>(null)
  const overlayRef = useRef<HTMLDivElement>(null)

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Only start dragging on left click
    if (e.button !== 0) return

    const rect = overlayRef.current?.getBoundingClientRect()
    if (!rect) return

    setIsDragging(true)
    // Account for zoom transform - divide by zoom to get logical coordinates
    setStartPos({
      x: (e.clientX - rect.left) / zoom,
      y: (e.clientY - rect.top) / zoom
    })
    setCurrentPos({
      x: (e.clientX - rect.left) / zoom,
      y: (e.clientY - rect.top) / zoom
    })
  }, [zoom])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging || !startPos) return

    const rect = overlayRef.current?.getBoundingClientRect()
    if (!rect) return

    // Account for zoom transform - divide by zoom to get logical coordinates
    setCurrentPos({
      x: (e.clientX - rect.left) / zoom,
      y: (e.clientY - rect.top) / zoom
    })
  }, [isDragging, startPos, zoom])

  const handleMouseUp = useCallback(async (e: React.MouseEvent) => {
    if (!isDragging || !startPos || !currentPos) {
      setIsDragging(false)
      setStartPos(null)
      setCurrentPos(null)
      return
    }

    // Calculate selection rectangle
    const left = Math.min(startPos.x, currentPos.x)
    const top = Math.min(startPos.y, currentPos.y)
    const width = Math.abs(currentPos.x - startPos.x)
    const height = Math.abs(currentPos.y - startPos.y)

    // Ignore very small selections (likely accidental clicks)
    if (width < 20 || height < 20) {
      setIsDragging(false)
      setStartPos(null)
      setCurrentPos(null)
      return
    }

    try {
      // Get the paper element (the main content area)
      const paperElement = document.getElementById('paper')
      if (!paperElement) {
        console.error('Could not find paper element')
        onCancel()
        return
      }

      // Hide the selection rectangle before capturing
      const savedCurrentPos = currentPos
      setCurrentPos(null)

      // Wait a tick for React to update
      await new Promise(resolve => setTimeout(resolve, 0))

      // Get the paper element's position relative to the viewport
      const paperRect = paperElement.getBoundingClientRect()

      // Get natural (unzoomed) dimensions of the paper element
      const naturalWidth = paperElement.offsetWidth
      const naturalHeight = paperElement.offsetHeight

      // Calculate the selection relative to the paper element
      const scrollTop = window.scrollY || document.documentElement.scrollTop

      // Convert overlay coordinates to paper coordinates
      const overlayRect = overlayRef.current?.getBoundingClientRect()
      if (!overlayRect) {
        onCancel()
        return
      }

      // Calculate selection position relative to paper in logical coordinates
      const logicalLeft = left + (overlayRect.left - paperRect.left) / zoom
      const logicalTop = top + (overlayRect.top - paperRect.top) / zoom

      // For snap positioning: offset from selection
      const snapLeft = logicalLeft + width + 20
      const snapTop = logicalTop + height + 20

      // Create a temporary wrapper to capture only the selected region
      const wrapper = document.createElement('div')
      wrapper.style.position = 'absolute'
      wrapper.style.left = '0'
      wrapper.style.top = '0'
      wrapper.style.width = `${width}px`
      wrapper.style.height = `${height}px`
      wrapper.style.overflow = 'hidden'
      wrapper.style.pointerEvents = 'none'

      // Copy theme classes from html/body to preserve theme in capture
      const htmlClasses = document.documentElement.className
      const bodyClasses = document.body.className
      wrapper.className = `${htmlClasses} ${bodyClasses}`

      // Clone the paper element
      const paperClone = paperElement.cloneNode(true) as HTMLElement
      paperClone.style.position = 'absolute'
      paperClone.style.left = `${-logicalLeft}px`
      paperClone.style.top = `${-logicalTop}px`
      // Preserve natural dimensions to prevent reflow
      paperClone.style.width = `${naturalWidth}px`
      paperClone.style.height = `${naturalHeight}px`
      paperClone.style.minWidth = `${naturalWidth}px`
      paperClone.style.minHeight = `${naturalHeight}px`

      // Append paper clone to wrapper
      wrapper.appendChild(paperClone)

      // Find and clone the annotation canvas
      const annotationCanvas = document.querySelector('.annotation-canvas') as HTMLCanvasElement
      if (annotationCanvas) {
        const canvasClone = document.createElement('canvas') as HTMLCanvasElement
        const canvasParent = annotationCanvas.parentElement

        // Copy canvas dimensions and class (for dark mode filter)
        canvasClone.width = annotationCanvas.width
        canvasClone.height = annotationCanvas.height
        canvasClone.style.width = annotationCanvas.style.width
        canvasClone.style.height = annotationCanvas.style.height
        canvasClone.className = annotationCanvas.className

        // Copy the canvas content
        const cloneCtx = canvasClone.getContext('2d')
        if (cloneCtx) {
          cloneCtx.drawImage(annotationCanvas, 0, 0)
        }

        if (canvasParent) {
          const canvasParentRect = canvasParent.getBoundingClientRect()

          // Position canvas clone relative to the paper in logical coordinates
          // canvasParentRect is in screen coords, so divide by zoom to get logical offset
          const canvasOffsetLeft = (canvasParentRect.left - paperRect.left) / zoom
          const canvasOffsetTop = (canvasParentRect.top - paperRect.top) / zoom

          canvasClone.style.position = 'absolute'
          canvasClone.style.left = `${canvasOffsetLeft - logicalLeft}px`
          canvasClone.style.top = `${canvasOffsetTop - logicalTop}px`
          canvasClone.style.zIndex = '10'

          wrapper.appendChild(canvasClone)
        }
      }

      // Append wrapper to body
      document.body.appendChild(wrapper)

      // Try to get font CSS, but fall back to skipFonts if it fails
      let captureOptions: any = {
        quality: 1.0,
        pixelRatio: 2,
        preferredFontFormat: 'woff2'
      }

      try {
        const fontEmbedCSS = await getFontEmbedCSS(paperElement)
        captureOptions.fontEmbedCSS = fontEmbedCSS
      } catch (fontError) {
        console.warn('Font embedding failed, using skipFonts:', fontError)
        captureOptions.skipFonts = true
      }

      // Capture the wrapper (which shows only the selected region)
      const svgDataUrl = await toSvg(wrapper, captureOptions)

      // Clean up: remove the temporary wrapper
      document.body.removeChild(wrapper)

      // Restore the selection rectangle
      setCurrentPos(savedCurrentPos)

      // Use the cropped SVG
      const imageUrl = svgDataUrl

      // Create snap with auto-generated name
      const snap: Snap = {
        id: Date.now().toString(),
        name: `snap${nextSnapNumber}`,
        imageUrl,
        top: snapTop,
        left: snapLeft,
        width,
        height
      }

      onCapture(snap)
    } catch (error) {
      console.error('Error capturing screenshot:', error)
      onCancel()
    }

    // Reset state
    setIsDragging(false)
    setStartPos(null)
    setCurrentPos(null)
  }, [isDragging, startPos, currentPos, onCapture, onCancel, nextSnapNumber])

  // Calculate selection rectangle for display
  const selectionRect = startPos && currentPos ? {
    left: Math.min(startPos.x, currentPos.x),
    top: Math.min(startPos.y, currentPos.y),
    width: Math.abs(currentPos.x - startPos.x),
    height: Math.abs(currentPos.y - startPos.y)
  } : null

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 cursor-crosshair"
      style={{
        backgroundColor: 'rgba(0, 0, 0, 0.1)'
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onContextMenu={(e) => {
        e.preventDefault()
        onCancel()
      }}
    >
      {/* Instructions */}
      <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-background/95 backdrop-blur border border-border rounded-lg shadow-lg px-4 py-2">
        <p className="text-sm text-foreground">
          Drag to select an area to capture • Right-click to cancel
        </p>
      </div>

      {/* Selection rectangle */}
      {selectionRect && (
        <div
          className="absolute border-2 border-primary bg-primary/10"
          style={{
            left: selectionRect.left,
            top: selectionRect.top,
            width: selectionRect.width,
            height: selectionRect.height,
            pointerEvents: 'none'
          }}
        >
          {/* Size indicator */}
          <div className="absolute -top-8 left-0 bg-background/95 backdrop-blur border border-border/50 px-2 py-1 rounded text-xs font-mono text-foreground">
            {Math.round(selectionRect.width)} × {Math.round(selectionRect.height)}
          </div>
        </div>
      )}
    </div>
  )
}
