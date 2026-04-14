/**
 * Simple Canvas - Low-Level Drawing Surface
 *
 * This is the core canvas implementation for drawing annotations. It handles:
 * - Pointer events (mouse, touch, stylus with pressure sensitivity)
 * - Stroke rendering via perfect-freehand (outline polygon fill, no stroke() artifacts)
 * - Eraser mode with visual cursor and collision detection
 * - Section tracking for cross-device repositioning
 *
 * ## Architecture
 *
 * ```
 * Pointer Events → Point Collection → Canvas Render → Data Export
 *                                                          ↓
 *                                    Parent (annotation-layer.tsx)
 * ```
 *
 * ## Drawing Pipeline
 *
 * 1. Pointer down: Start new stroke, record mode (draw/erase), capture canvas snapshot
 * 2. Pointer move: Collect points with pressure, render in-progress stroke via snapshot restore
 * 3. Pointer up: Finalize stroke, full redraw of all committed strokes, export data
 *
 * ## Rendering Approach
 *
 * Uses perfect-freehand to compute a variable-width outline polygon from pressure-sensitive
 * input points, then fills it. This eliminates the overlapping round-cap artifacts that occur
 * with per-segment stroke() calls (visible as periodic "blotches" on iPad/Safari).
 *
 * Real-time drawing uses a snapshot approach: on pointer down, the current canvas state
 * (all committed strokes) is saved to an offscreen canvas. On each pointer move, the
 * snapshot is restored and the in-progress stroke is rendered on top via perfect-freehand.
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
 * 4. **Hardware eraser detection**: Uses heuristics (button === 5, pointerType
 *    checks) that may not work on all stylus hardware.
 *
 * ## Performance Optimizations
 *
 * - RAF throttling for eraser operations
 * - Snapshot-based real-time rendering (1 drawImage + 1 getStroke + 1 fill per frame)
 * - Cached bounding rect to avoid layout thrashing
 * - Direct DOM manipulation for eraser cursor (no React re-renders)
 * - Strokes marked for deletion in batch (applied on pointer up)
 *
 * @see annotation-layer.tsx - Parent component managing multiple canvases
 * @see reposition-strokes.ts - Cross-device stroke alignment
 */

'use client'

import { useRef, useEffect, useCallback, forwardRef, useImperativeHandle, useState } from 'react'
import { getStroke } from 'perfect-freehand'
import type { StrokeOptions } from 'perfect-freehand'
import { determineSectionFromY, type HeadingPosition } from '@/lib/annotations/reposition-strokes'
import type { StrokeTelemetry } from '@/lib/userdata/types'

export type DrawMode = 'draw' | 'erase'

// Telemetry sampling rate - collect every Nth stroke
const TELEMETRY_SAMPLE_RATE = 10

// Convert perfect-freehand outline points to a Path2D using quadratic curves for smoothness.
// Same approach as the perfect-freehand README / Excalidraw.
function getPathFromStroke(outlinePoints: number[][]): Path2D {
  const path = new Path2D()
  if (outlinePoints.length < 2) return path

  path.moveTo(outlinePoints[0][0], outlinePoints[0][1])
  for (let i = 1; i < outlinePoints.length - 1; i++) {
    const [x0, y0] = outlinePoints[i]
    const [x1, y1] = outlinePoints[i + 1]
    path.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2)
  }
  const last = outlinePoints[outlinePoints.length - 1]
  path.lineTo(last[0], last[1])
  path.closePath()
  return path
}

// Map our stroke params to perfect-freehand options.
// Our width is radius-like; perfect-freehand size is diameter, hence * 2.
// `last` must be true for finalized strokes — without it the terminus is
// rendered as a wide round cap (visible blob). Pass false for in-progress
// pointermove rendering. `end.taper` cancels the velocity-driven width
// spike when the pen decelerates before lift-off (otherwise leaves a
// clubbed terminus even with last:true). Keep in sync with the SVG
// layer's copy: src/lib/annotations/svg-path.ts.
function getStrokeOptions(width: number, last = false): StrokeOptions {
  return {
    size: width * 2,
    thinning: 0.6,
    smoothing: 0.5,
    streamline: 0.3,
    simulatePressure: false,
    last,
    // See svg-path.ts copy for rationale. t^(1/8) keeps width near
    // full for most of the taper region and drops sharply at the tip.
    end: { taper: true, easing: (t) => Math.pow(t, 1 / 8) },
  }
}

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
  onEraserMarksChange?: (markedIds: Set<string>) => void  // Stroke IDs marked for deletion (eraser preview)
  onTelemetry?: (telemetry: StrokeTelemetry) => void  // Optional telemetry callback (sampled)
  zoom?: number
  headingPositions?: HeadingPosition[]
  readOnly?: boolean  // When true, disables all interaction
  svgHandlesDisplay?: boolean  // When true, skip rendering committed strokes (SVG layer shows them)
  scrollContainer?: HTMLElement | null  // For viewport-sized canvas (svgHandlesDisplay mode)
}

export interface SimpleCanvasHandle {
  clear: () => void
  exportData: () => string
}

export const SimpleCanvas = forwardRef<SimpleCanvasHandle, SimpleCanvasProps>(
  ({ width, height, mode, onUpdate, initialData, strokeWidth = 2, strokeColor = '#000000', stylusModeActive = false, onStylusDetected, onNonStylusInput, onPenStateChange, onDrawStart, onEraserMarksChange, onTelemetry, zoom = 1.0, headingPositions = [], readOnly = false, svgHandlesDisplay = false, scrollContainer = null }, ref) => {
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
      avgX?: number  // Average X position of all points (for grouping)
      avgY?: number  // Average Y position of all points (for section detection)
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
    const snapshotCanvasRef = useRef<HTMLCanvasElement | null>(null) // Offscreen canvas snapshot for real-time drawing
    const telemetryStrokeCountRef = useRef(0) // Track stroke count for telemetry sampling
    // Viewport canvas: paper-space rect of the visible area (when svgHandlesDisplay + scrollContainer)
    const viewportRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null)

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

    // Convert screen coordinates to paper-space coordinates.
    // In viewport mode, accounts for the canvas covering only a portion of the page.
    const screenToPaper = useCallback((clientX: number, clientY: number, rect: DOMRect) => {
      const vp = viewportRef.current
      if (vp) {
        return {
          x: vp.x + (clientX - rect.left) * (vp.w / rect.width),
          y: vp.y + (clientY - rect.top) * (vp.h / rect.height),
        }
      }
      return {
        x: (clientX - rect.left) * (width / rect.width),
        y: (clientY - rect.top) * (height / rect.height),
      }
    }, [width, height])

    // Check if a point is near a stroke (for eraser collision detection)
    const isPointNearStroke = useCallback((px: number, py: number, stroke: typeof pathsRef.current[0], threshold: number = 11): boolean => {
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

    const redrawCanvas = useCallback(() => {
      const canvas = canvasRef.current
      if (!canvas) return

      const ctx = canvas.getContext('2d')
      if (!ctx) return

      // Clear canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      // When SVG layer handles display, only clear — don't redraw committed strokes.
      // Canvas still tracks pathsRef for eraser collision and data export.
      if (svgHandlesDisplay) return

      // Redraw all paths using perfect-freehand outline fill
      pathsRef.current.forEach((path, index) => {
        if (path.points.length < 2) return

        // Skip erase-mode strokes (they're historical markers, not visible)
        if (path.mode === 'erase') return

        // Check if this stroke is marked for deletion
        const isMarkedForDeletion = strokesMarkedForDeletionRef.current.has(index)

        // Set opacity (reduced if marked for deletion)
        ctx.globalAlpha = isMarkedForDeletion ? 0.3 : 1

        // Convert {x,y,pressure} objects to [x,y,pressure] arrays for perfect-freehand
        const inputPoints = path.points.map(p => [p.x, p.y, p.pressure])
        const outline = getStroke(inputPoints, getStrokeOptions(path.width, true))
        const pathObj = getPathFromStroke(outline)

        ctx.fillStyle = path.color
        ctx.fill(pathObj)
      })

      // Reset globalAlpha
      ctx.globalAlpha = 1.0
    }, [svgHandlesDisplay])

    // Throttled redraw for eraser using RAF to avoid redrawing every single move
    const scheduleEraserRedraw = useCallback(() => {
      if (eraserRedrawRafRef.current === null) {
        eraserRedrawRafRef.current = requestAnimationFrame(() => {
          redrawCanvas()
          eraserRedrawRafRef.current = null
        })
      }
    }, [redrawCanvas])

    // Set up canvas sizing.
    // Viewport mode (svgHandlesDisplay + scrollContainer): canvas covers only the visible
    // viewport at native screen resolution, staying crisp at any zoom level. Committed
    // strokes are SVG, so the canvas only renders the in-progress stroke.
    // Legacy mode: canvas covers the full page with DPI + zoom scaling (capped by iOS limits).
    useEffect(() => {
      const canvas = canvasRef.current
      if (!canvas) return

      // Viewport mode: canvas tracks the visible area
      if (svgHandlesDisplay && scrollContainer) {
        // Use the canvas's offset parent (nearest positioned ancestor) for rect calculations.
        // The canvas is position:absolute, so its top/left are relative to this element.
        // canvas.parentElement may be an intermediate wrapper with different bounds.
        const paper = (canvas.offsetParent as HTMLElement) || canvas.parentElement
        if (!paper) return

        const dpr = window.devicePixelRatio || 1

        const updateViewport = () => {
          // Don't reposition during active drawing — coordinate system must stay stable
          if (isDrawingRef.current) return

          const paperRect = paper.getBoundingClientRect()
          const containerRect = scrollContainer.getBoundingClientRect()

          // Extend canvas beyond visible area for scroll smoothness
          const pad = 100 // screen pixels
          const visLeft = Math.max(paperRect.left, containerRect.left - pad)
          const visTop = Math.max(paperRect.top, containerRect.top - pad)
          const visRight = Math.min(paperRect.right, containerRect.right + pad)
          const visBottom = Math.min(paperRect.bottom, containerRect.bottom + pad)

          if (visRight <= visLeft || visBottom <= visTop) {
            viewportRef.current = null
            return
          }

          // Screen-to-paper scale (≈ zoom)
          const scale = paperRect.width / paper.offsetWidth

          // Paper-space viewport rect
          const vpX = (visLeft - paperRect.left) / scale
          const vpY = (visTop - paperRect.top) / scale
          const vpW = (visRight - visLeft) / scale
          const vpH = (visBottom - visTop) / scale

          viewportRef.current = { x: vpX, y: vpY, w: vpW, h: vpH }

          // Position canvas in paper-space (parent's scale(zoom) makes it viewport-sized on screen)
          canvas.style.left = `${vpX}px`
          canvas.style.top = `${vpY}px`
          canvas.style.width = `${vpW}px`
          canvas.style.height = `${vpH}px`
          canvas.style.right = 'auto'

          // Internal resolution: visible screen pixels × dpr (always crisp, constant budget)
          const screenW = visRight - visLeft
          const screenH = visBottom - visTop
          const newW = Math.round(screenW * dpr)
          const newH = Math.round(screenH * dpr)

          if (canvas.width !== newW || canvas.height !== newH) {
            canvas.width = newW
            canvas.height = newH
          }
          // Always set transform explicitly — canvas.width/height assignment resets it,
          // and the legacy sizing path may have set a different scale.
          const ctx = canvas.getContext('2d')
          if (ctx) {
            ctx.setTransform(newW / vpW, 0, 0, newH / vpH, 0, 0)
          }
        }

        updateViewport()
        scrollContainer.addEventListener('scroll', updateViewport, { passive: true })
        window.addEventListener('resize', updateViewport)

        return () => {
          scrollContainer.removeEventListener('scroll', updateViewport)
          window.removeEventListener('resize', updateViewport)
        }
      }

      // Legacy full-page mode
      const dpr = window.devicePixelRatio || 1
      const totalScale = dpr * zoom

      const MAX_CANVAS_DIMENSION = 32767
      const maxScaleX = MAX_CANVAS_DIMENSION / width
      const maxScaleY = MAX_CANVAS_DIMENSION / height
      // iOS Safari silently produces a blank canvas when pixel count exceeds ~16M.
      const MAX_CANVAS_AREA = 16_777_216
      const maxScaleArea = Math.sqrt(MAX_CANVAS_AREA / (width * height))
      const maxSafeScale = Math.min(maxScaleX, maxScaleY, maxScaleArea, totalScale)

      const scaledWidth = width * maxSafeScale
      const scaledHeight = height * maxSafeScale

      if (canvas.width !== scaledWidth || canvas.height !== scaledHeight) {
        canvas.width = scaledWidth
        canvas.height = scaledHeight
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.scale(maxSafeScale, maxSafeScale)
        }
        redrawCanvas()
      }
    }, [width, height, zoom, redrawCanvas, svgHandlesDisplay, scrollContainer])

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

      // Capture canvas snapshot for real-time drawing (draw mode only).
      // In viewport mode (svgHandlesDisplay), canvas has no committed strokes — skip snapshot.
      if (currentModeRef.current === 'draw') {
        if (svgHandlesDisplay) {
          snapshotCanvasRef.current = null
        } else {
          const offscreen = document.createElement('canvas')
          offscreen.width = canvas.width
          offscreen.height = canvas.height
          offscreen.getContext('2d')!.drawImage(canvas, 0, 0)
          snapshotCanvasRef.current = offscreen
        }
      }

      // Defer state updates to avoid React re-renders blocking the first pointermove events
      // (causes choppy stroke start if done synchronously)
      requestAnimationFrame(() => {
        // Notify parent that drawing has started (for auto-showing hidden layers)
        onDrawStart?.()

        // Track pen drawing state for touch-action control
        if (isStylusInput) {
          setIsPenDrawing(true)
          onPenStateChange?.(true)
        }
      })

      // Cache bounding rect on pointer down to avoid layout recalculations during move
      const rect = canvas.getBoundingClientRect()
      canvasRectRef.current = rect

      // Convert screen coordinates to paper-space coordinates
      const { x, y } = screenToPaper(e.clientX, e.clientY, rect)
      const pressure = e.pressure || 0.5 // Default to 0.5 for mouse

      currentPathRef.current = [{ x, y, pressure }]
    }, [mode, stylusModeActive, onStylusDetected, onPenStateChange, onDrawStart, screenToPaper, updateEraserCursor, svgHandlesDisplay])

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
          const { x, y } = screenToPaper(e.clientX, e.clientY, rect)
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
      events.forEach((event) => {
        // Convert screen coordinates to paper-space coordinates
        const { x, y } = screenToPaper(event.clientX, event.clientY, rect)
        const pressure = event.pressure || 0.5 // Default to 0.5 for mouse

        // Deduplicate: iOS Safari fires coalesced events twice per pointermove,
        // causing the path to jump backward and retrace — which creates self-intersecting
        // outlines and triangular fill artifacts. Skip if this coordinate matches any
        // of the last 8 points (typical coalesced batch is 4 events).
        const path = currentPathRef.current
        const lookback = Math.min(path.length, 8)
        let isDuplicate = false
        for (let j = path.length - lookback; j < path.length; j++) {
          if (path[j].x === x && path[j].y === y) {
            isDuplicate = true
            break
          }
        }
        if (!isDuplicate) {
          path.push({ x, y, pressure })
        }

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
          if (markedNewStroke) {
            if (svgHandlesDisplay) {
              // SVG layer shows committed strokes — notify parent to update opacity there
              if (onEraserMarksChange) {
                const markedIds = new Set<string>()
                strokesMarkedForDeletionRef.current.forEach(idx => {
                  const stroke = pathsRef.current[idx]
                  if (stroke) markedIds.add(stroke.id)
                })
                onEraserMarksChange(markedIds)
              }
            } else {
              // Canvas shows committed strokes — redraw with reduced opacity
              scheduleEraserRedraw()
            }
          }
        }
      })

      // After processing all coalesced events, render in-progress stroke (draw mode only)
      if (currentModeRef.current !== 'erase') {
        // Clear canvas (and restore snapshot if available)
        if (snapshotCanvasRef.current) {
          ctx.save()
          ctx.setTransform(1, 0, 0, 1, 0, 0)
          ctx.clearRect(0, 0, canvas.width, canvas.height)
          ctx.drawImage(snapshotCanvasRef.current, 0, 0)
          ctx.restore()
        } else {
          // Viewport mode: no snapshot, just clear
          ctx.save()
          ctx.setTransform(1, 0, 0, 1, 0, 0)
          ctx.clearRect(0, 0, canvas.width, canvas.height)
          ctx.restore()
        }

        // Draw current in-progress stroke with perfect-freehand.
        // In viewport mode, offset points to canvas-local coordinates.
        const vp = viewportRef.current
        const inputPoints = vp
          ? currentPathRef.current.map(p => [p.x - vp.x, p.y - vp.y, p.pressure])
          : currentPathRef.current.map(p => [p.x, p.y, p.pressure])
        const outline = getStroke(inputPoints, getStrokeOptions(strokeWidth))
        const pathObj = getPathFromStroke(outline)
        ctx.fillStyle = strokeColor
        ctx.fill(pathObj)
      }
    }, [mode, strokeColor, strokeWidth, isPointNearStroke, scheduleEraserRedraw, updateEraserCursorPosition, updateEraserCursor, screenToPaper])

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

      // If we just finished an eraser stroke, delete all marked strokes
      if (currentModeRef.current === 'erase') {
        if (strokesMarkedForDeletionRef.current.size > 0) {
          // Filter out strokes that were marked for deletion
          const indicesToDelete = new Set(strokesMarkedForDeletionRef.current)
          pathsRef.current = pathsRef.current.filter((_, index) => !indicesToDelete.has(index))

          // Clear the marked strokes set
          strokesMarkedForDeletionRef.current.clear()
          onEraserMarksChange?.(new Set())

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

        // Compute average position for stroke grouping and quick section lookups
        let avgX = 0, avgY = 0
        for (const pt of currentPathRef.current) {
          avgX += pt.x
          avgY += pt.y
        }
        avgX /= pointCount
        avgY /= pointCount

        // Save the path with all original points and pressure data intact
        pathsRef.current.push({
          id: crypto.randomUUID(),
          points: currentPathRef.current,
          mode: currentModeRef.current,
          color: strokeColor,
          width: strokeWidth,
          sectionId,
          sectionOffsetY,
          avgX,
          avgY
        })

        currentPathRef.current = []

        // Discard snapshot and do clean render of all committed strokes
        snapshotCanvasRef.current = null
        redrawCanvas()

        // Notify parent with debouncing handled at parent level
        const data = JSON.stringify(pathsRef.current)
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
        snapshotCanvasRef.current = null
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
