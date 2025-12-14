/**
 * Simple Canvas - Low-Level Drawing Surface
 *
 * This is the core canvas implementation for drawing annotations. It handles:
 * - Pointer events (mouse, touch, stylus with pressure sensitivity)
 * - Stroke rendering with configurable color/width
 * - Eraser mode with visual cursor and collision detection
 * - Real-time smoothing of strokes (configurable window size)
 * - Section tracking for cross-device repositioning
 *
 * ## Architecture
 *
 * ```
 * Pointer Events → Point Collection → Smoothing → Canvas Render → Data Export
 *                                                                      ↓
 *                                            Parent (annotation-layer.tsx)
 * ```
 *
 * ## Drawing Pipeline
 *
 * 1. Pointer down: Start new stroke, record mode (draw/erase)
 * 2. Pointer move: Collect points with pressure, apply real-time smoothing
 * 3. Pointer up: Finalize stroke, apply post-stroke smoothing, export data
 *
 * ## Known Limitations
 *
 * 1. **Single canvas**: All strokes render on one canvas. For very large
 *    annotation sets (1000+ strokes), performance may degrade. A tiled or
 *    virtualized canvas approach would scale better.
 *
 * 2. **Eraser collision is O(n*m)**: Each eraser point checks against all
 *    strokes and all points. Large drawings get slower. Could be optimized
 *    with spatial indexing (quadtree).
 *
 * 3. **No partial stroke editing**: Can only delete entire strokes, not
 *    portions. More advanced erasing would require stroke splitting.
 *
 * 4. **Smoothing is post-hoc**: Real-time smoothing has latency. We smooth
 *    again after stroke completion, which can cause visual jumps.
 *
 * 5. **Hardware eraser detection**: Uses heuristics (button === 5, pointerType
 *    checks) that may not work on all stylus hardware.
 *
 * ## Performance Optimizations
 *
 * - RAF throttling for draw operations
 * - Cached bounding rect to avoid layout thrashing
 * - Direct DOM manipulation for eraser cursor (no React re-renders)
 * - Strokes marked for deletion in batch (applied on pointer up)
 *
 * @see annotation-layer.tsx - Parent component managing multiple canvases
 * @see reposition-strokes.ts - Cross-device stroke alignment
 */

'use client'

import { useRef, useEffect, useCallback, forwardRef, useImperativeHandle, useState } from 'react'
import { determineSectionFromY, type HeadingPosition } from '@/lib/annotations/reposition-strokes'
import type { StrokeTelemetry } from '@/lib/userdata/types'

export type DrawMode = 'draw' | 'erase'

// Real-time smoothing window size for drawing
// Higher = smoother but more lag, Lower = more responsive but jittery
// Set to 1 to disable real-time smoothing (raw points)
// 2 = light smoothing (average of current + previous point)
// 3 = moderate smoothing (average of last 3 points)
const REALTIME_SMOOTHING_WINDOW = 3

// A/B testing mode - set to true to cycle through smoothing levels with colors
const SMOOTHING_TEST_MODE = false
const SMOOTHING_TEST_LEVELS = [
  { window: 1, color: '#000000' }, // Black = raw (no smoothing)
  { window: 2, color: '#0066ff' }, // Blue = light smoothing
  { window: 3, color: '#ff0000' }, // Red = moderate smoothing
]

// Telemetry sampling rate - collect every Nth stroke
const TELEMETRY_SAMPLE_RATE = 10

// Generate stable content-based ID for strokes without IDs (backward compat)
function generateStableStrokeId(stroke: {
  points?: Array<{ x: number; y: number; pressure: number }>
  color?: string
  width?: number
  sectionId?: string
}): string {
  const points = stroke.points || []
  const first = points[0]
  const last = points[points.length - 1]

  const parts = [
    first ? `${first.x.toFixed(1)},${first.y.toFixed(1)}` : '0,0',
    last ? `${last.x.toFixed(1)},${last.y.toFixed(1)}` : '0,0',
    points.length,
    stroke.color || 'black',
    stroke.width || 2,
    stroke.sectionId || 'unknown'
  ]

  return `stroke-${parts.join('-')}`
}

interface SimpleCanvasProps {
  width: number
  height: number
  mode: DrawMode | 'view'
  onUpdate?: (data: string) => void  // Optional - not needed for read-only canvases
  initialData?: string
  strokeWidth?: number
  strokeColor?: string
  stylusModeActive?: boolean
  onStylusDetected?: () => void
  onNonStylusInput?: () => void
  onPenStateChange?: (active: boolean) => void  // Notify parent when pen is actively drawing
  onDrawStart?: () => void  // Called when user starts drawing (pointer down in draw mode)
  onTelemetry?: (telemetry: StrokeTelemetry) => void  // Optional telemetry callback (sampled)
  zoom?: number
  headingPositions?: HeadingPosition[]
  readOnly?: boolean  // When true, disables all interaction
}

export interface SimpleCanvasHandle {
  clear: () => void
  exportData: () => string
}

export const SimpleCanvas = forwardRef<SimpleCanvasHandle, SimpleCanvasProps>(
  ({ width, height, mode, onUpdate, initialData, strokeWidth = 2, strokeColor = '#000000', stylusModeActive = false, onStylusDetected, onNonStylusInput, onPenStateChange, onDrawStart, onTelemetry, zoom = 1.0, headingPositions = [], readOnly = false }, ref) => {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const isDrawingRef = useRef(false)
    const [isPenDrawing, setIsPenDrawing] = useState(false) // Track if pen is actively drawing
    const pathsRef = useRef<Array<{
      id: string  // Unique identifier for per-stroke animations
      points: Array<{ x: number; y: number; pressure: number }>
      mode: DrawMode
      color: string
      width: number
      sectionId: string
      sectionOffsetY: number
    }>>([])
    const currentPathRef = useRef<Array<{ x: number; y: number; pressure: number }>>([])
    const strokeStartTimeRef = useRef<number>(0) // Track when current stroke started for telemetry
    const currentModeRef = useRef<DrawMode>('draw') // Track the effective mode for current stroke
    const strokesMarkedForDeletionRef = useRef<Set<number>>(new Set()) // Track strokes to delete when eraser lifts
    const eraserTrailRef = useRef<Array<{ x: number; y: number }>>([]) // Track eraser position history for tail effect
    const [shouldFadeIn, setShouldFadeIn] = useState(false)
    const isEraserActiveRef = useRef(false) // Track if hardware eraser is actively being used (ref to avoid re-renders)
    const hasLoadedInitialDataRef = useRef(false)
    const activePointersRef = useRef<Set<number>>(new Set())
    const activeTouchPointersRef = useRef<Set<number>>(new Set()) // Track only touch/mouse (not pen) for multi-touch detection
    const eraserRedrawRafRef = useRef<number | null>(null) // RAF ID for throttling eraser redraws
    const eraserCursorRef = useRef<HTMLDivElement>(null) // Ref to eraser cursor element for direct DOM manipulation
    const canvasRectRef = useRef<DOMRect | null>(null) // Cache canvas bounding rect to avoid layout thrashing
    const drawRafRef = useRef<number | null>(null) // RAF ID for throttling draw operations
    const pendingPointsRef = useRef<number>(0) // Track number of points added since last RAF draw
    const lastSmoothedPointRef = useRef<{ x: number; y: number } | null>(null) // Track last rendered smoothed position for real-time smoothing
    const smoothingTestIndexRef = useRef(0) // TEMPORARY: Track which smoothing level we're testing
    const telemetryStrokeCountRef = useRef(0) // Track stroke count for telemetry sampling
    const currentStrokeSmoothingRef = useRef({ window: REALTIME_SMOOTHING_WINDOW, color: '#000000' }) // Current stroke's smoothing settings

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

    // Update eraser cursor position directly (no React re-render, no canvas redraw)
    const updateEraserCursorPosition = useCallback((x: number, y: number) => {
      const cursor = eraserCursorRef.current
      if (!cursor) return

      // Position the cursor at the eraser location
      cursor.style.left = `${x}px`
      cursor.style.top = `${y}px`
      cursor.style.display = 'block'
    }, [])

    // Hide eraser cursor
    const hideEraserCursor = useCallback(() => {
      const cursor = eraserCursorRef.current
      if (cursor) {
        cursor.style.display = 'none'
      }
    }, [])

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

    // Apply pressure floor so light touches still produce visible strokes
    // Maps pressure from [0, 1] to [MIN_PRESSURE, 1]
    const applyPressureFloor = useCallback((pressure: number): number => {
      const MIN_PRESSURE = 0.4
      return MIN_PRESSURE + (1 - MIN_PRESSURE) * pressure
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

    // Get smoothed position for real-time rendering using last N points
    // Optimized to avoid array allocation - just direct index access
    const getSmoothedPosition = useCallback((points: Array<{ x: number; y: number; pressure: number }>, windowSize: number = REALTIME_SMOOTHING_WINDOW): { x: number; y: number; pressure: number } => {
      const len = points.length
      if (len === 0) return { x: 0, y: 0, pressure: 0.5 }
      if (len === 1 || windowSize <= 1) return points[len - 1]

      // Average last windowSize points without allocating arrays
      const start = Math.max(0, len - windowSize)
      const count = len - start
      let sumX = 0, sumY = 0
      for (let i = start; i < len; i++) {
        sumX += points[i].x
        sumY += points[i].y
      }

      return {
        x: sumX / count,
        y: sumY / count,
        pressure: points[len - 1].pressure
      }
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

        // Set opacity (reduced if marked for deletion)
        ctx.globalAlpha = isMarkedForDeletion ? 0.3 : 1

        ctx.strokeStyle = path.color
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.globalCompositeOperation = 'source-over'

        // Apply moving average smoothing to reduce choppiness when zoomed
        const points = smoothPoints(path.points, 3)

        // For very short strokes (2 points), just draw a straight line
        if (points.length === 2) {
          const lineWidth = path.width * applyPressureFloor(points[1].pressure || 0.5)

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
        ctx.lineWidth = baseWidth * applyPressureFloor(points[0].pressure || 0.5)
        ctx.moveTo(points[0].x, points[0].y)

        if (points.length === 3) {
          // For 3-point strokes, draw straight lines to preserve shape
          ctx.lineTo(points[1].x, points[1].y)
          ctx.stroke()

          ctx.beginPath()
          ctx.lineWidth = baseWidth * applyPressureFloor(points[1].pressure || 0.5)
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
            ctx.lineWidth = baseWidth * applyPressureFloor(p0.pressure || 0.5)
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
          ctx.lineWidth = baseWidth * applyPressureFloor(points[lastIdx].pressure || 0.5)
          ctx.moveTo(lastMidX, lastMidY)
          ctx.lineTo(points[lastIdx].x, points[lastIdx].y)
          ctx.stroke()
        }
      })

      // Reset globalAlpha
      ctx.globalAlpha = 1.0
    }, [smoothPoints, applyPressureFloor])

    // Throttled redraw for eraser using RAF to avoid redrawing every single move
    const scheduleEraserRedraw = useCallback(() => {
      if (eraserRedrawRafRef.current === null) {
        eraserRedrawRafRef.current = requestAnimationFrame(() => {
          redrawCanvas()
          eraserRedrawRafRef.current = null
        })
      }
    }, [redrawCanvas])

    // Throttled draw for new strokes using RAF to smooth out Chrome's batched events
    const scheduleIncrementalDraw = useCallback(() => {
      if (drawRafRef.current === null) {
        drawRafRef.current = requestAnimationFrame(() => {
          const canvas = canvasRef.current
          const ctx = canvas?.getContext('2d')
          if (!canvas || !ctx || pendingPointsRef.current === 0) {
            drawRafRef.current = null
            return
          }

          // Draw all pending segments since last RAF
          const points = currentPathRef.current
          const startIdx = Math.max(0, points.length - pendingPointsRef.current - 1)

          // Set context properties once
          ctx.strokeStyle = strokeColor
          ctx.lineCap = 'round'
          ctx.lineJoin = 'round'
          ctx.globalCompositeOperation = 'source-over'

          // Draw all pending segments
          for (let i = startIdx + 1; i < points.length; i++) {
            const lastPoint = points[i - 1]
            const currentPoint = points[i]
            const lineWidth = strokeWidth * applyPressureFloor(currentPoint.pressure)

            ctx.lineWidth = lineWidth
            ctx.beginPath()
            ctx.moveTo(lastPoint.x, lastPoint.y)
            ctx.lineTo(currentPoint.x, currentPoint.y)
            ctx.stroke()
          }

          pendingPointsRef.current = 0
          drawRafRef.current = null
        })
      }
    }, [strokeColor, strokeWidth, applyPressureFloor])

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

    // Load initial data (or clear canvas when initialData becomes empty)
    useEffect(() => {
      if (!canvasRef.current) return

      // Handle empty initialData - clear the canvas
      if (!initialData || initialData === '' || initialData === '[]') {
        pathsRef.current = []
        redrawCanvas()
        return
      }

      try {
        const paths = JSON.parse(initialData)
        // Ensure all strokes have stable IDs (backward compatibility for existing data)
        pathsRef.current = paths.map((stroke: typeof pathsRef.current[0]) => ({
          ...stroke,
          id: stroke.id || generateStableStrokeId(stroke)
        }))
        // Only trigger fade-in animation on initial page load:
        // - Must be first load (!hasLoadedInitialDataRef.current)
        // - Must have data (paths.length > 0)
        // - Must NOT be a readOnly canvas (those update frequently via SSE)
        // - Must have significant data (> 5 strokes) to avoid fade-in on user's first few strokes
        //   when their data syncs back from server
        if (paths.length > 5 && !hasLoadedInitialDataRef.current && !readOnly) {
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

      // Prevent default only for stylus to stop iOS Safari from initiating text selection
      // Don't prevent for finger touches - let them scroll
      if (isStylusInput) {
        e.preventDefault()
      }

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
      // Don't switch modes on non-stylus input (could be palm touch on iPad)
      // User can manually switch via toolbar if needed
      if (stylusModeActive && !isStylusInput) {
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

      // Chrome fix: Explicitly capture pointer for pen input to ensure we get all move events
      // Without this, Chrome may stop sending pointermove events after the first few
      if (isStylusInput) {
        canvas.setPointerCapture(e.pointerId)
      }

      isDrawingRef.current = true
      strokeStartTimeRef.current = Date.now() // Track start time for telemetry

      // Notify parent that drawing has started (for auto-showing hidden layers)
      onDrawStart?.()

      // Track pen drawing state for touch-action control
      if (isStylusInput) {
        setIsPenDrawing(true)
        onPenStateChange?.(true)
      }

      // Cache bounding rect on pointer down to avoid layout recalculations during move
      const rect = canvas.getBoundingClientRect()
      canvasRectRef.current = rect

      // Convert screen coordinates to canvas coordinates
      // The canvas CSS size matches the scaled section size, so we need to scale down to internal coordinates
      const x = (e.clientX - rect.left) * (width / rect.width)
      const y = (e.clientY - rect.top) * (height / rect.height)
      const pressure = e.pressure || 0.5 // Default to 0.5 for mouse

      currentPathRef.current = [{ x, y, pressure }]
      lastSmoothedPointRef.current = { x, y } // Initialize with first point for smooth rendering

      // TEMPORARY: Set smoothing level for this stroke and cycle for next
      if (SMOOTHING_TEST_MODE && currentModeRef.current === 'draw') {
        currentStrokeSmoothingRef.current = SMOOTHING_TEST_LEVELS[smoothingTestIndexRef.current]
        smoothingTestIndexRef.current = (smoothingTestIndexRef.current + 1) % SMOOTHING_TEST_LEVELS.length
      } else {
        currentStrokeSmoothingRef.current = { window: REALTIME_SMOOTHING_WINDOW, color: strokeColor }
      }
    }, [mode, stylusModeActive, onStylusDetected, onPenStateChange, onDrawStart, width, height, updateEraserCursor, strokeColor])

    const draw = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
      // Don't draw if multiple touch/mouse pointers are active (pinch gesture)
      // But always allow stylus to proceed regardless of touch count
      const isStylusInput = e.pointerType === 'pen'

      // Prevent default only for stylus to stop iOS Safari from initiating text selection during drawing
      // Don't prevent for finger touches - let them scroll
      if (isStylusInput) {
        e.preventDefault()
      }

      // Note: We no longer call onStylusDetected here on every move event
      // It's only called once in startDrawing, reducing React re-render overhead

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

      // Show eraser cursor when hovering in erase mode (not drawing yet)
      if (mode === 'erase' && !isDrawingRef.current) {
        const canvas = canvasRef.current
        if (canvas) {
          const rect = canvas.getBoundingClientRect()
          const x = (e.clientX - rect.left) * (width / rect.width)
          const y = (e.clientY - rect.top) * (height / rect.height)
          updateEraserCursorPosition(x, y)
        }
        return
      }

      if (!isDrawingRef.current || mode === 'view') return

      const canvas = canvasRef.current
      if (!canvas) return

      const ctx = canvas.getContext('2d')
      if (!ctx) return

      // Use cached rect to avoid layout thrashing (rect cached in startDrawing)
      const rect = canvasRectRef.current || canvas.getBoundingClientRect()

      // Get all coalesced events for higher sampling rate
      // Falls back to single event if getCoalescedEvents is not supported
      // Chrome fix: getCoalescedEvents sometimes returns empty array, so ensure we have at least the main event
      const coalescedEvents = e.nativeEvent.getCoalescedEvents?.() || []
      const events = coalescedEvents.length > 0 ? coalescedEvents : [e.nativeEvent]


      // Process each coalesced event to capture all intermediate points
      events.forEach((event, index) => {
        // Convert screen coordinates to canvas coordinates
        // The canvas CSS size matches the scaled section size, so we need to scale down to internal coordinates
        const x = (event.clientX - rect.left) * (width / rect.width)
        const y = (event.clientY - rect.top) * (height / rect.height)
        const pressure = event.pressure || 0.5 // Default to 0.5 for mouse

        currentPathRef.current.push({ x, y, pressure })

        // For eraser mode, check for collisions with existing strokes
        if (currentModeRef.current === 'erase') {
          // Update eraser cursor position (direct DOM manipulation, no re-render)
          updateEraserCursorPosition(x, y)

          // Check for stroke collisions and only redraw when marking NEW strokes
          let markedNewStroke = false
          pathsRef.current.forEach((stroke, strokeIndex) => {
            if (stroke.mode !== 'erase' && isPointNearStroke(x, y, stroke)) {
              // Only mark as new if it wasn't already marked
              if (!strokesMarkedForDeletionRef.current.has(strokeIndex)) {
                strokesMarkedForDeletionRef.current.add(strokeIndex)
                markedNewStroke = true
              }
            }
          })
          // Only redraw canvas when we mark a NEW stroke (to show it as transparent)
          if (markedNewStroke) {
            scheduleEraserRedraw()
          }
        } else {
          // For draw mode: Draw with real-time smoothing
          // Raw points are stored in currentPathRef, but we render smoothed positions
          const { window: smoothingWindow, color: testColor } = currentStrokeSmoothingRef.current
          const smoothedPoint = getSmoothedPosition(currentPathRef.current, smoothingWindow)
          const fromPoint = lastSmoothedPointRef.current

          if (fromPoint) {
            const lineWidth = strokeWidth * applyPressureFloor(smoothedPoint.pressure)
            ctx.strokeStyle = SMOOTHING_TEST_MODE ? testColor : strokeColor
            ctx.lineCap = 'round'
            ctx.lineJoin = 'round'
            ctx.lineWidth = lineWidth
            ctx.beginPath()
            ctx.moveTo(fromPoint.x, fromPoint.y)
            ctx.lineTo(smoothedPoint.x, smoothedPoint.y)
            ctx.stroke()
          }

          // Update last smoothed position for next segment
          lastSmoothedPointRef.current = { x: smoothedPoint.x, y: smoothedPoint.y }
        }
      })
    }, [mode, width, height, strokeColor, strokeWidth, isPointNearStroke, applyPressureFloor, scheduleEraserRedraw, updateEraserCursorPosition, updateEraserCursor, getSmoothedPosition])

    const stopDrawing = useCallback((e?: React.PointerEvent<HTMLCanvasElement>) => {
      // Remove pointer from tracking
      if (e) {
        activePointersRef.current.delete(e.pointerId)
        activeTouchPointersRef.current.delete(e.pointerId)

        // Chrome fix: Release pointer capture if we captured it
        const canvas = canvasRef.current
        if (canvas && e.pointerType === 'pen') {
          try {
            canvas.releasePointerCapture(e.pointerId)
          } catch (err) {
            // Ignore errors if pointer wasn't captured
          }

          // Clear pen drawing state after a brief delay to allow final stroke to complete
          // The delay gives the browser time to process the pen-up before allowing touch scrolling
          setTimeout(() => {
            setIsPenDrawing(false)
            onPenStateChange?.(false)
          }, 100)
        }
      }

      // Always hide eraser cursor on pointer leave/up, even if not actively drawing
      if (currentModeRef.current === 'erase') {
        hideEraserCursor()
        updateEraserCursor(false)
      }

      if (!isDrawingRef.current) return

      isDrawingRef.current = false

      // Reset pending points counter
      pendingPointsRef.current = 0

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
          onUpdate?.(data)

          // Clear current path for eraser
          currentPathRef.current = []
        }

        // Hide eraser cursor and do final redraw when lifting eraser
        hideEraserCursor()
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
        // Calculate stroke telemetry for analysis
        const points = currentPathRef.current
        const pointCount = points.length

        // Calculate total stroke length (sum of distances between consecutive points)
        let totalLength = 0
        for (let i = 1; i < points.length; i++) {
          const dx = points[i].x - points[i-1].x
          const dy = points[i].y - points[i-1].y
          totalLength += Math.sqrt(dx * dx + dy * dy)
        }

        // Calculate stroke duration using tracked start time
        const strokeEndTime = Date.now()
        const durationMs = strokeEndTime - strokeStartTimeRef.current

        const lengthPerPoint = pointCount > 1 ? totalLength / (pointCount - 1) : 0
        const durationPerPoint = pointCount > 1 ? durationMs / (pointCount - 1) : 0



        // Determine which section this stroke belongs to based on first point
        const firstPoint = currentPathRef.current[0]
        const sectionId = determineSectionFromY(firstPoint.y, headingPositions) || 'unknown'
        const sectionOffsetY = headingPositions.find(h => h.sectionId === sectionId)?.offsetY || 0

        // Telemetry: sample every Nth stroke
        telemetryStrokeCountRef.current++
        if (onTelemetry && telemetryStrokeCountRef.current % TELEMETRY_SAMPLE_RATE === 0) {
          onTelemetry({
            timestamp: strokeEndTime,
            pointCount,
            totalLengthPx: totalLength,
            durationMs,
            lengthPerPoint,
            durationPerPoint,
            sectionId,
            mode: currentModeRef.current
          })
        }

        // Save the path with all original points and pressure data intact
        // Visual smoothing is handled by Bezier curves during rendering
        pathsRef.current.push({
          id: crypto.randomUUID(),
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

        onUpdate?.(data)
      }
    }, [mode, strokeColor, strokeWidth, onUpdate, onPenStateChange, onTelemetry, headingPositions, redrawCanvas, updateEraserCursor, hideEraserCursor])

    const handlePointerCancel = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
      // Clean up when pointer is cancelled
      activePointersRef.current.delete(e.pointerId)
      activeTouchPointersRef.current.delete(e.pointerId)

      // Chrome fix: Release pointer capture if we captured it
      const canvas = canvasRef.current
      if (canvas && e.pointerType === 'pen') {
        try {
          canvas.releasePointerCapture(e.pointerId)
        } catch (err) {
          // Ignore errors if pointer wasn't captured
        }
      }

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
          onUpdate?.(JSON.stringify([]))
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
        if (drawRafRef.current !== null) {
          cancelAnimationFrame(drawRafRef.current)
        }
      }
    }, [])

    return (
      <>
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
            right: 0,
            // Width determined by left:0 + right:0; height from prop
            height: `${height}px`,
            // CRITICAL: When pen is actively drawing, use 'none' to prevent scroll
            // When pen is not drawing, use 'auto' to allow finger scrolling
            touchAction: isPenDrawing ? 'none' : 'auto',
            cursor: mode === 'erase' ? 'none' : (mode === 'draw' ? 'crosshair' : 'default'),
            // Capture events in draw/erase mode OR stylus mode (to prevent selection)
            pointerEvents: (mode !== 'view' || stylusModeActive) ? 'auto' : 'none'
          }}
        />
        {/* Eraser cursor element - positioned via direct DOM manipulation */}
        <div
          ref={eraserCursorRef}
          className="eraser-cursor"
          style={{
            position: 'absolute',
            display: 'none',
            width: '20px',
            height: '20px',
            borderRadius: '50%',
            backgroundColor: 'rgba(136, 136, 136, 0.8)',
            border: '2px solid rgba(102, 102, 102, 0.8)',
            pointerEvents: 'none',
            transform: 'translate(-50%, -50%)',
            zIndex: 1000
          }}
        />
      </>
    )
  }
)

SimpleCanvas.displayName = 'SimpleCanvas'
