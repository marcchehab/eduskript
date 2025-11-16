'use client'

import { useRef, useEffect, useCallback, forwardRef, useImperativeHandle, useState } from 'react'
import { determineSectionFromY, type HeadingPosition } from '@/lib/annotations/reposition-strokes'

export type DrawMode = 'draw' | 'erase'

interface SimpleCanvasProps {
  width: number
  height: number
  mode: DrawMode | 'view'
  onUpdate: (data: string) => void
  initialData?: string
  strokeWidth?: number
  strokeColor?: string
  eraserWidth?: number
  stylusModeActive?: boolean
  onStylusDetected?: () => void
  onNonStylusInput?: () => void
  zoom?: number
  headingPositions?: HeadingPosition[]
}

export interface SimpleCanvasHandle {
  clear: () => void
  exportData: () => string
}

export const SimpleCanvas = forwardRef<SimpleCanvasHandle, SimpleCanvasProps>(
  ({ width, height, mode, onUpdate, initialData, strokeWidth = 2, strokeColor = '#000000', eraserWidth = 100, stylusModeActive = false, onStylusDetected, onNonStylusInput, zoom = 1.0, headingPositions = [] }, ref) => {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const isDrawingRef = useRef(false)
    const pathsRef = useRef<Array<{
      points: Array<{ x: number; y: number; pressure: number }>
      mode: DrawMode
      color: string
      width: number
      sectionId: string
      sectionOffsetY: number
    }>>([])
    const currentPathRef = useRef<Array<{ x: number; y: number; pressure: number }>>([])
    const [shouldFadeIn, setShouldFadeIn] = useState(false)
    const hasLoadedInitialDataRef = useRef(false)
    const activePointersRef = useRef<Set<number>>(new Set())
    const activeTouchPointersRef = useRef<Set<number>>(new Set()) // Track only touch/mouse (not pen) for multi-touch detection

    // Apply moving average smoothing to point positions while preserving pressure
    const smoothPoints = useCallback((points: Array<{ x: number; y: number; pressure: number }>, windowSize: number = 3): Array<{ x: number; y: number; pressure: number }> => {
      if (points.length < windowSize) return points

      const smoothed: Array<{ x: number; y: number; pressure: number }> = []
      const halfWindow = Math.floor(windowSize / 2)

      for (let i = 0; i < points.length; i++) {
        const start = Math.max(0, i - halfWindow)
        const end = Math.min(points.length, i + halfWindow + 1)
        const window = points.slice(start, end)

        smoothed.push({
          x: window.reduce((sum, p) => sum + p.x, 0) / window.length,
          y: window.reduce((sum, p) => sum + p.y, 0) / window.length,
          pressure: points[i].pressure // Keep original pressure
        })
      }
      return smoothed
    }, [])

    const redrawCanvas = useCallback(() => {
      const canvas = canvasRef.current
      if (!canvas) return

      const ctx = canvas.getContext('2d')
      if (!ctx) return

      // Clear canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      // Redraw all paths with pressure-sensitive line width and Bezier smoothing
      pathsRef.current.forEach(path => {
        if (path.points.length < 2) return

        ctx.strokeStyle = path.mode === 'erase' ? '#FFFFFF' : path.color
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.globalCompositeOperation = path.mode === 'erase' ? 'destination-out' : 'source-over'

        // Apply moving average smoothing to reduce choppiness when zoomed
        const points = smoothPoints(path.points, 3)

        // For very short strokes (2 points), just draw a straight line
        if (points.length === 2) {
          const baseWidth = path.mode === 'erase' ? eraserWidth : path.width
          const lineWidth = baseWidth * (points[1].pressure || 0.5)

          ctx.beginPath()
          ctx.lineWidth = lineWidth
          ctx.moveTo(points[0].x, points[0].y)
          ctx.lineTo(points[1].x, points[1].y)
          ctx.stroke()
          return
        }

        // For longer strokes, use quadratic Bezier curves with pressure-sensitive width
        // Draw with special handling for endpoints to avoid blobs

        const baseWidth = path.mode === 'erase' ? eraserWidth : path.width

        // Draw first segment as a straight line to preserve pen-down appearance
        ctx.beginPath()
        ctx.lineWidth = baseWidth * (points[0].pressure || 0.5)
        ctx.moveTo(points[0].x, points[0].y)

        if (points.length === 3) {
          // For 3-point strokes, draw straight lines to preserve shape
          ctx.lineTo(points[1].x, points[1].y)
          ctx.stroke()

          ctx.beginPath()
          ctx.lineWidth = baseWidth * (points[1].pressure || 0.5)
          ctx.moveTo(points[1].x, points[1].y)
          ctx.lineTo(points[2].x, points[2].y)
          ctx.stroke()
        } else {
          // For 4+ points, use smooth curves in the middle but preserve endpoints
          const firstMidX = (points[0].x + points[1].x) / 2
          const firstMidY = (points[0].y + points[1].y) / 2
          ctx.lineTo(firstMidX, firstMidY)
          ctx.stroke()

          // Draw middle segments with quadratic curves
          for (let i = 1; i < points.length - 2; i++) {
            const p0 = points[i]
            const p1 = points[i + 1]

            const midX0 = (points[i - 1].x + p0.x) / 2
            const midY0 = (points[i - 1].y + p0.y) / 2
            const midX1 = (p0.x + p1.x) / 2
            const midY1 = (p0.y + p1.y) / 2

            ctx.beginPath()
            ctx.lineWidth = baseWidth * (p0.pressure || 0.5)
            ctx.moveTo(midX0, midY0)
            ctx.quadraticCurveTo(p0.x, p0.y, midX1, midY1)
            ctx.stroke()
          }

          // Draw last segment as a straight line to preserve pen-up appearance
          const lastIdx = points.length - 1
          const secondLastIdx = lastIdx - 1
          const lastMidX = (points[secondLastIdx].x + points[lastIdx].x) / 2
          const lastMidY = (points[secondLastIdx].y + points[lastIdx].y) / 2

          ctx.beginPath()
          ctx.lineWidth = baseWidth * (points[lastIdx].pressure || 0.5)
          ctx.moveTo(lastMidX, lastMidY)
          ctx.lineTo(points[lastIdx].x, points[lastIdx].y)
          ctx.stroke()
        }
      })
    }, [eraserWidth, zoom, smoothPoints])

    // Set up high-DPI canvas scaling with zoom support
    useEffect(() => {
      const canvas = canvasRef.current
      if (!canvas) return

      const dpr = window.devicePixelRatio || 1
      // Include zoom in resolution calculation for crisp rendering at any zoom level
      const totalScale = dpr * zoom
      const scaledWidth = width * totalScale
      const scaledHeight = height * totalScale

      // Only reset canvas if dimensions actually changed
      if (canvas.width !== scaledWidth || canvas.height !== scaledHeight) {
        // Set internal canvas resolution (scaled by device pixel ratio AND zoom)
        canvas.width = scaledWidth
        canvas.height = scaledHeight

        // Scale context so drawing coordinates stay in CSS pixels
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.scale(totalScale, totalScale)
        }

        // Redraw existing paths at new resolution
        redrawCanvas()
      }
    }, [width, height, zoom, redrawCanvas])

    // Load initial data
    useEffect(() => {
      if (initialData && canvasRef.current) {
        try {
          const paths = JSON.parse(initialData)
          pathsRef.current = paths
          // Only trigger fade-in animation on the FIRST load, not on subsequent updates
          if (paths.length > 0 && !hasLoadedInitialDataRef.current) {
            setShouldFadeIn(true)
            // Remove the fade-in class after animation completes (0.5s)
            setTimeout(() => {
              setShouldFadeIn(false)
            }, 500)
          }
          redrawCanvas()
        } catch (error) {
          console.error('Error loading canvas data:', error)
        }
      }
      // Mark as initialized after first load attempt, regardless of whether there was data
      if (!hasLoadedInitialDataRef.current) {
        hasLoadedInitialDataRef.current = true
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialData])

    const startDrawing = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
      // Detect stylus input first
      const isStylusInput = e.pointerType === 'pen'

      // Track active pointers for multi-touch detection
      activePointersRef.current.add(e.pointerId)
      // Only track touch/mouse for multi-touch gestures (exclude stylus)
      if (!isStylusInput) {
        activeTouchPointersRef.current.add(e.pointerId)
      }

      // Don't draw if multiple touch/mouse pointers are active (pinch gesture)
      // But always allow stylus to proceed regardless of touch count
      if (!isStylusInput && activeTouchPointersRef.current.size > 1) {
        return
      }

      // Stylus detection callback
      if (isStylusInput && onStylusDetected) {
        onStylusDetected()
      }

      // In stylus mode, only allow pen input for drawing
      if (stylusModeActive && !isStylusInput) {
        // Switch to view mode when non-stylus input is detected
        if (onNonStylusInput) {
          onNonStylusInput()
        }
        return
      }

      // If we're in view mode but just detected stylus, allow it to proceed
      // (the mode will switch to draw, but that happens asynchronously)
      if (mode === 'view' && !isStylusInput) {
        return
      }

      const canvas = canvasRef.current
      if (!canvas) {
        return
      }

      isDrawingRef.current = true
      const rect = canvas.getBoundingClientRect()
      // Convert screen coordinates to canvas coordinates
      // The canvas CSS size matches the scaled section size, so we need to scale down to internal coordinates
      const x = (e.clientX - rect.left) * (width / rect.width)
      const y = (e.clientY - rect.top) * (height / rect.height)
      const pressure = e.pressure || 0.5 // Default to 0.5 for mouse

      currentPathRef.current = [{ x, y, pressure }]
    }, [mode, stylusModeActive, onStylusDetected, onNonStylusInput, zoom, width, height])

    const draw = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
      // Don't draw if multiple touch/mouse pointers are active (pinch gesture)
      // But always allow stylus to proceed regardless of touch count
      const isStylusInput = e.pointerType === 'pen'
      if (!isStylusInput && activeTouchPointersRef.current.size > 1) {
        return
      }

      if (!isDrawingRef.current || mode === 'view') return

      const canvas = canvasRef.current
      if (!canvas) return

      const ctx = canvas.getContext('2d')
      if (!ctx) return

      const rect = canvas.getBoundingClientRect()

      // Get all coalesced events for higher sampling rate
      // Falls back to single event if getCoalescedEvents is not supported
      const events = e.nativeEvent.getCoalescedEvents?.() || [e.nativeEvent]

      // Process each coalesced event to capture all intermediate points
      events.forEach((event) => {
        // Convert screen coordinates to canvas coordinates
        // The canvas CSS size matches the scaled section size, so we need to scale down to internal coordinates
        const x = (event.clientX - rect.left) * (width / rect.width)
        const y = (event.clientY - rect.top) * (height / rect.height)
        const pressure = event.pressure || 0.5 // Default to 0.5 for mouse

        currentPathRef.current.push({ x, y, pressure })

        // Draw segment with pressure-sensitive width
        const points = currentPathRef.current
        if (points.length >= 2) {
          const lastPoint = points[points.length - 2]
          const currentPoint = points[points.length - 1]

          const baseWidth = mode === 'erase' ? eraserWidth : strokeWidth
          const lineWidth = baseWidth * currentPoint.pressure

          ctx.beginPath()
          ctx.strokeStyle = mode === 'erase' ? '#FFFFFF' : strokeColor
          ctx.lineWidth = lineWidth
          ctx.lineCap = 'round'
          ctx.lineJoin = 'round'
          ctx.globalCompositeOperation = mode === 'erase' ? 'destination-out' : 'source-over'

          ctx.moveTo(lastPoint.x, lastPoint.y)
          ctx.lineTo(currentPoint.x, currentPoint.y)
          ctx.stroke()
        }
      })
    }, [mode, strokeColor, strokeWidth, eraserWidth, zoom, width, height])

    const stopDrawing = useCallback((e?: React.PointerEvent<HTMLCanvasElement>) => {
      // Remove pointer from tracking
      if (e) {
        activePointersRef.current.delete(e.pointerId)
        activeTouchPointersRef.current.delete(e.pointerId)
      }

      if (!isDrawingRef.current) return

      isDrawingRef.current = false

      if (currentPathRef.current.length > 0 && mode !== 'view') {
        // Determine which section this stroke belongs to based on first point
        const firstPoint = currentPathRef.current[0]
        const sectionId = determineSectionFromY(firstPoint.y, headingPositions) || 'unknown'
        const sectionOffsetY = headingPositions.find(h => h.sectionId === sectionId)?.offsetY || 0

        // Save the path with all original points and pressure data intact
        // Visual smoothing is handled by Bezier curves during rendering
        pathsRef.current.push({
          points: currentPathRef.current,
          mode: mode as DrawMode,
          color: strokeColor,
          width: strokeWidth,
          sectionId,
          sectionOffsetY
        })

        currentPathRef.current = []

        // Notify parent with debouncing handled at parent level
        const data = JSON.stringify(pathsRef.current)

        // Log storage statistics
        const totalPoints = pathsRef.current.reduce((sum, path) => sum + path.points.length, 0)
        const sizeKB = (new Blob([data]).size / 1024).toFixed(2)

        onUpdate(data)
      }
    }, [mode, strokeColor, strokeWidth, onUpdate, headingPositions])

    const handlePointerCancel = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
      // Clean up when pointer is cancelled
      activePointersRef.current.delete(e.pointerId)
      activeTouchPointersRef.current.delete(e.pointerId)
      if (isDrawingRef.current) {
        isDrawingRef.current = false
        currentPathRef.current = []
      }
    }, [])

    // Expose methods
    useImperativeHandle(ref, () => {
      return {
        clear: () => {
          pathsRef.current = []
          redrawCanvas()
          onUpdate(JSON.stringify([]))
        },
        exportData: () => {
          return JSON.stringify(pathsRef.current)
        }
      }
    })

    return (
      <canvas
        ref={canvasRef}
        onPointerDown={startDrawing}
        onPointerMove={draw}
        onPointerUp={stopDrawing}
        onPointerLeave={stopDrawing}
        onPointerCancel={handlePointerCancel}
        className={`annotation-canvas ${shouldFadeIn ? 'annotation-fade-in' : ''}`}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          // Fixed width and height to match canvas internal dimensions
          width: `${width}px`,
          height: `${height}px`,
          // Always allow pinch-zoom for crisp annotation rendering at any zoom level
          // Multi-touch detection prevents drawing during pinch gestures
          touchAction: 'pan-x pan-y pinch-zoom',
          cursor: mode === 'draw' ? 'crosshair' : mode === 'erase' ? 'pointer' : 'default',
          // Only receive events when in draw/erase mode OR when stylus mode is active
          // This allows text selection in view mode without stylus mode
          pointerEvents: (mode !== 'view' || stylusModeActive) ? 'auto' : 'none'
        }}
      />
    )
  }
)

SimpleCanvas.displayName = 'SimpleCanvas'
