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
  ({ width, height, mode, onUpdate, initialData, strokeWidth = 2, strokeColor = '#000000', stylusModeActive = false, onStylusDetected, onNonStylusInput, zoom = 1.0, headingPositions = [] }, ref) => {
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
    const currentModeRef = useRef<DrawMode>('draw') // Track the effective mode for current stroke
    const strokesMarkedForDeletionRef = useRef<Set<number>>(new Set()) // Track strokes to delete when eraser lifts
    const eraserTrailRef = useRef<Array<{ x: number; y: number }>>([]) // Track eraser position history for tail effect
    const [shouldFadeIn, setShouldFadeIn] = useState(false)
    const isEraserActiveRef = useRef(false) // Track if hardware eraser is actively being used (ref to avoid re-renders)
    const hasLoadedInitialDataRef = useRef(false)
    const activePointersRef = useRef<Set<number>>(new Set())
    const activeTouchPointersRef = useRef<Set<number>>(new Set()) // Track only touch/mouse (not pen) for multi-touch detection
    const eraserRedrawRafRef = useRef<number | null>(null) // RAF ID for throttling eraser redraws

    // Update eraser cursor state and apply styles directly (no React re-render)
    const updateEraserCursor = useCallback((isActive: boolean) => {
      isEraserActiveRef.current = isActive
      const canvas = canvasRef.current
      if (!canvas) return

      // Apply cursor and className directly via DOM
      if (isActive) {
        canvas.style.cursor = 'none'
        canvas.classList.add('eraser-cursor-hidden')
      } else if (mode === 'draw') {
        canvas.style.cursor = 'crosshair'
        canvas.classList.remove('eraser-cursor-hidden')
      } else {
        canvas.style.cursor = 'default'
        canvas.classList.remove('eraser-cursor-hidden')
      }
    }, [mode])

    // Throttled redraw for eraser using RAF to avoid redrawing every single move
    const scheduleEraserRedraw = useCallback(() => {
      if (eraserRedrawRafRef.current === null) {
        eraserRedrawRafRef.current = requestAnimationFrame(() => {
          redrawCanvas()
          eraserRedrawRafRef.current = null
        })
      }
    }, [redrawCanvas])

    // Check if a point is near a stroke (for eraser collision detection)
    const isPointNearStroke = useCallback((px: number, py: number, stroke: typeof pathsRef.current[0], threshold: number = 20): boolean => {
      for (let i = 0; i < stroke.points.length - 1; i++) {
        const p1 = stroke.points[i]
        const p2 = stroke.points[i + 1]

        // Calculate distance from point to line segment
        const dx = p2.x - p1.x
        const dy = p2.y - p1.y
        const lengthSquared = dx * dx + dy * dy

        if (lengthSquared === 0) {
          // Point to point distance
          const dist = Math.sqrt((px - p1.x) ** 2 + (py - p1.y) ** 2)
          if (dist < threshold) return true
        } else {
          // Project point onto line segment
          const t = Math.max(0, Math.min(1, ((px - p1.x) * dx + (py - p1.y) * dy) / lengthSquared))
          const projX = p1.x + t * dx
          const projY = p1.y + t * dy
          const dist = Math.sqrt((px - projX) ** 2 + (py - projY) ** 2)
          if (dist < threshold) return true
        }
      }
      return false
    }, [])

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
      pathsRef.current.forEach((path, index) => {
        if (path.points.length < 2) return

        // Skip strokes that are marked for deletion (they're old erase strokes)
        if (path.mode === 'erase') return

        // Check if this stroke is marked for deletion
        const isMarkedForDeletion = strokesMarkedForDeletionRef.current.has(index)

        // Set opacity for strokes marked for deletion
        ctx.globalAlpha = isMarkedForDeletion ? 0.3 : 1.0

        ctx.strokeStyle = path.color
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.globalCompositeOperation = 'source-over'

        // Apply moving average smoothing to reduce choppiness when zoomed
        const points = smoothPoints(path.points, 3)

        // For very short strokes (2 points), just draw a straight line
        if (points.length === 2) {
          const lineWidth = path.width * (points[1].pressure || 0.5)

          ctx.beginPath()
          ctx.lineWidth = lineWidth
          ctx.moveTo(points[0].x, points[0].y)
          ctx.lineTo(points[1].x, points[1].y)
          ctx.stroke()
          return
        }

        // For longer strokes, use quadratic Bezier curves with pressure-sensitive width
        // Draw with special handling for endpoints to avoid blobs

        const baseWidth = path.width

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

      // Reset globalAlpha
      ctx.globalAlpha = 1.0

      // Draw eraser cursor with tail if in erase mode and we have trail points
      if (currentModeRef.current === 'erase' && eraserTrailRef.current.length > 0) {
        const trail = eraserTrailRef.current
        const trailLength = trail.length

        // Draw tail as progressively smaller circles with fading opacity
        for (let i = 0; i < trailLength; i++) {
          const pos = trail[i]
          const progress = i / (trailLength - 1) // 0 to 1 from oldest to newest

          // Circle size: from 1.5px to 4px
          const radius = 1.5 + progress * 2.5

          // Opacity: from 0.2 to 1.0
          ctx.globalAlpha = 0.2 + progress * 0.8

          ctx.beginPath()
          ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2)
          ctx.fillStyle = '#888888'
          ctx.fill()

          // Add subtle outline only on the current (last) circle
          if (i === trailLength - 1) {
            ctx.strokeStyle = '#666666'
            ctx.lineWidth = 1
            ctx.stroke()
          }
        }

        ctx.globalAlpha = 1.0
      }
    }, [smoothPoints])

    // Set up high-DPI canvas scaling with zoom support
    useEffect(() => {
      const canvas = canvasRef.current
      if (!canvas) return

      const dpr = window.devicePixelRatio || 1
      // Include zoom in resolution calculation for crisp rendering at any zoom level
      const totalScale = dpr * zoom

      // Prevent canvas from exceeding browser limits (typically 32,767 pixels)
      const MAX_CANVAS_DIMENSION = 32767
      const maxScaleX = MAX_CANVAS_DIMENSION / width
      const maxScaleY = MAX_CANVAS_DIMENSION / height
      const maxSafeScale = Math.min(maxScaleX, maxScaleY, totalScale)

      const scaledWidth = width * maxSafeScale
      const scaledHeight = height * maxSafeScale

      // Only reset canvas if dimensions actually changed
      if (canvas.width !== scaledWidth || canvas.height !== scaledHeight) {
        // Set internal canvas resolution (scaled by device pixel ratio AND zoom)
        canvas.width = scaledWidth
        canvas.height = scaledHeight

        // Scale context so drawing coordinates stay in CSS pixels
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.scale(maxSafeScale, maxSafeScale)
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
      // Detect eraser button (button 5 = 32 in bitmask)
      const isEraserButton = isStylusInput && (e.buttons & 32) !== 0

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

      // Auto-detect eraser mode from hardware eraser button
      const effectiveMode = isEraserButton ? 'erase' : mode
      currentModeRef.current = effectiveMode as DrawMode

      // Update eraser active state for cursor visibility (direct DOM update, no re-render)
      updateEraserCursor(currentModeRef.current === 'erase')

      // Clear marked strokes and trail when starting a new erase stroke
      if (currentModeRef.current === 'erase') {
        strokesMarkedForDeletionRef.current.clear()
        eraserTrailRef.current = []
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
    }, [mode, stylusModeActive, onStylusDetected, onNonStylusInput, width, height, updateEraserCursor])

    const draw = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
      // Don't draw if multiple touch/mouse pointers are active (pinch gesture)
      // But always allow stylus to proceed regardless of touch count
      const isStylusInput = e.pointerType === 'pen'
      if (!isStylusInput && activeTouchPointersRef.current.size > 1) {
        return
      }

      // Detect eraser button during hover (even when not drawing)
      const isEraserButton = isStylusInput && (e.buttons & 32) !== 0
      if (isEraserButton && !isDrawingRef.current) {
        // Update cursor visibility for eraser hover (direct DOM update, no re-render)
        updateEraserCursor(true)
        return
      } else if (!isEraserButton && !isDrawingRef.current && isEraserActiveRef.current) {
        // Clear eraser cursor when stylus flips back to pen while hovering (direct DOM update, no re-render)
        updateEraserCursor(false)
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

        // For eraser mode, check for collisions with existing strokes
        if (currentModeRef.current === 'erase') {
          // Update eraser trail (keep last 10 points for tail effect)
          eraserTrailRef.current.push({ x, y })
          if (eraserTrailRef.current.length > 10) {
            eraserTrailRef.current.shift()
          }

          pathsRef.current.forEach((stroke, index) => {
            if (stroke.mode !== 'erase' && isPointNearStroke(x, y, stroke)) {
              strokesMarkedForDeletionRef.current.add(index)
            }
          })
          // Schedule redraw to show marked strokes as transparent and eraser cursor (throttled via RAF)
          scheduleEraserRedraw()
        } else {
          // Draw segment with pressure-sensitive width for draw mode
          const points = currentPathRef.current
          if (points.length >= 2) {
            const lastPoint = points[points.length - 2]
            const currentPoint = points[points.length - 1]

            const lineWidth = strokeWidth * currentPoint.pressure

            ctx.beginPath()
            ctx.strokeStyle = strokeColor
            ctx.lineWidth = lineWidth
            ctx.lineCap = 'round'
            ctx.lineJoin = 'round'
            ctx.globalCompositeOperation = 'source-over'

            ctx.moveTo(lastPoint.x, lastPoint.y)
            ctx.lineTo(currentPoint.x, currentPoint.y)
            ctx.stroke()
          }
        }
      })
    }, [mode, strokeColor, strokeWidth, width, height, isPointNearStroke, scheduleEraserRedraw, updateEraserCursor])

    const stopDrawing = useCallback((e?: React.PointerEvent<HTMLCanvasElement>) => {
      // Remove pointer from tracking
      if (e) {
        activePointersRef.current.delete(e.pointerId)
        activeTouchPointersRef.current.delete(e.pointerId)
      }

      if (!isDrawingRef.current) return

      isDrawingRef.current = false

      // If we just finished an eraser stroke, delete all marked strokes
      if (currentModeRef.current === 'erase') {
        if (strokesMarkedForDeletionRef.current.size > 0) {
          // Filter out strokes that were marked for deletion
          const indicesToDelete = new Set(strokesMarkedForDeletionRef.current)
          pathsRef.current = pathsRef.current.filter((_, index) => !indicesToDelete.has(index))

          // Clear the marked strokes set
          strokesMarkedForDeletionRef.current.clear()

          // Notify parent with updated data
          const data = JSON.stringify(pathsRef.current)
          const totalPoints = pathsRef.current.reduce((sum, path) => sum + path.points.length, 0)
          const sizeKB = (new Blob([data]).size / 1024).toFixed(2)
          console.log(`Canvas data after erase: ${pathsRef.current.length} paths, ${totalPoints} points, ${sizeKB} KB`)
          onUpdate(data)

          // Clear current path for eraser
          currentPathRef.current = []
        }

        // Always clear eraser trail and redraw when lifting eraser
        eraserTrailRef.current = []
        updateEraserCursor(false)
        // Cancel any pending eraser redraw and do final redraw immediately
        if (eraserRedrawRafRef.current !== null) {
          cancelAnimationFrame(eraserRedrawRafRef.current)
          eraserRedrawRafRef.current = null
        }
        redrawCanvas()
        return
      }

      if (currentPathRef.current.length > 0 && mode !== 'view') {
        // Determine which section this stroke belongs to based on first point
        const firstPoint = currentPathRef.current[0]
        const sectionId = determineSectionFromY(firstPoint.y, headingPositions) || 'unknown'
        const sectionOffsetY = headingPositions.find(h => h.sectionId === sectionId)?.offsetY || 0

        // Save the path with all original points and pressure data intact
        // Visual smoothing is handled by Bezier curves during rendering
        pathsRef.current.push({
          points: currentPathRef.current,
          mode: currentModeRef.current,
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
    }, [mode, strokeColor, strokeWidth, onUpdate, headingPositions, redrawCanvas, updateEraserCursor])

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

    // Handle pointer enter to detect eraser hover
    const handlePointerEnter = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
      const isStylusInput = e.pointerType === 'pen'
      const isEraserButton = isStylusInput && (e.buttons & 32) !== 0
      if (isEraserButton) {
        updateEraserCursor(true)
      }
    }, [updateEraserCursor])

    // Cleanup RAF on unmount
    useEffect(() => {
      return () => {
        if (eraserRedrawRafRef.current !== null) {
          cancelAnimationFrame(eraserRedrawRafRef.current)
        }
      }
    }, [])

    return (
      <canvas
        ref={canvasRef}
        onPointerDown={startDrawing}
        onPointerMove={draw}
        onPointerUp={stopDrawing}
        onPointerLeave={stopDrawing}
        onPointerCancel={handlePointerCancel}
        onPointerEnter={handlePointerEnter}
        className={`annotation-canvas ${shouldFadeIn ? 'annotation-fade-in' : ''} ${mode === 'erase' ? 'eraser-cursor-hidden' : ''}`}
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
          cursor: mode === 'erase' ? 'none' : (mode === 'draw' ? 'crosshair' : 'default'),
          // Only receive events when in draw/erase mode OR when stylus mode is active
          // This allows text selection in view mode without stylus mode
          pointerEvents: (mode !== 'view' || stylusModeActive) ? 'auto' : 'none'
        }}
      />
    )
  }
)

SimpleCanvas.displayName = 'SimpleCanvas'
