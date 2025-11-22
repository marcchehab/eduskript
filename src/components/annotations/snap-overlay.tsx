'use client'

import { useState, useCallback, useRef } from 'react'
import html2canvas from 'html2canvas'

export interface Snap {
  id: string
  imageUrl: string
  top: number
  width: number
  height: number
}

interface SnapOverlayProps {
  onCapture: (snap: Snap) => void
  onCancel: () => void
}

export function SnapOverlay({ onCapture, onCancel }: SnapOverlayProps) {
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
    setStartPos({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    })
    setCurrentPos({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    })
  }, [])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging || !startPos) return

    const rect = overlayRef.current?.getBoundingClientRect()
    if (!rect) return

    setCurrentPos({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    })
  }, [isDragging, startPos])

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

      // Capture the entire paper element
      const canvas = await html2canvas(paperElement, {
        backgroundColor: null,
        scale: 2, // Higher quality
        logging: false,
        useCORS: true,
        allowTaint: true
      })

      // Get the paper element's position relative to the viewport
      const paperRect = paperElement.getBoundingClientRect()

      // Calculate the selection relative to the paper element
      // The overlay is positioned relative to the viewport, so we need to adjust
      const scrollTop = window.scrollY || document.documentElement.scrollTop
      const scrollLeft = window.scrollX || document.documentElement.scrollLeft

      // Convert overlay coordinates to paper coordinates
      const overlayRect = overlayRef.current?.getBoundingClientRect()
      if (!overlayRect) {
        onCancel()
        return
      }

      const selectionLeft = left + overlayRect.left - paperRect.left
      const selectionTop = top + overlayRect.top - paperRect.top + scrollTop

      // Create a new canvas for the cropped region
      const croppedCanvas = document.createElement('canvas')
      const scale = canvas.width / paperRect.width
      croppedCanvas.width = width * scale
      croppedCanvas.height = height * scale

      const ctx = croppedCanvas.getContext('2d')
      if (!ctx) {
        console.error('Could not get canvas context')
        onCancel()
        return
      }

      // Draw the cropped portion
      ctx.drawImage(
        canvas,
        selectionLeft * scale,
        selectionTop * scale,
        width * scale,
        height * scale,
        0,
        0,
        croppedCanvas.width,
        croppedCanvas.height
      )

      // Convert to data URL
      const imageUrl = croppedCanvas.toDataURL('image/png')

      // Create snap object
      const snap: Snap = {
        id: Date.now().toString(),
        imageUrl,
        top: selectionTop + paperRect.top, // Absolute position on page
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
  }, [isDragging, startPos, currentPos, onCapture, onCancel])

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
