'use client'

import { useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react'

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
}

export interface SimpleCanvasHandle {
  clear: () => void
  exportData: () => string
}

export const SimpleCanvas = forwardRef<SimpleCanvasHandle, SimpleCanvasProps>(
  ({ width, height, mode, onUpdate, initialData, strokeWidth = 2, strokeColor = '#000000', eraserWidth = 10, stylusModeActive = false, onStylusDetected, onNonStylusInput }, ref) => {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const isDrawingRef = useRef(false)
    const pathsRef = useRef<Array<{ points: Array<{ x: number; y: number; pressure: number }>; mode: DrawMode; color: string; width: number }>>([])
    const currentPathRef = useRef<Array<{ x: number; y: number; pressure: number }>>([])

    const redrawCanvas = useCallback(() => {
      const canvas = canvasRef.current
      if (!canvas) return

      const ctx = canvas.getContext('2d')
      if (!ctx) return

      // Clear canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      // Redraw all paths with pressure-sensitive line width
      pathsRef.current.forEach(path => {
        if (path.points.length < 2) return

        ctx.strokeStyle = path.mode === 'erase' ? '#FFFFFF' : path.color
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.globalCompositeOperation = path.mode === 'erase' ? 'destination-out' : 'source-over'

        // Draw path with variable width based on pressure
        for (let i = 1; i < path.points.length; i++) {
          const prevPoint = path.points[i - 1]
          const currPoint = path.points[i]

          // Calculate line width based on pressure
          const baseWidth = path.mode === 'erase' ? eraserWidth : path.width
          const lineWidth = baseWidth * (currPoint.pressure || 0.5)

          ctx.beginPath()
          ctx.lineWidth = lineWidth
          ctx.moveTo(prevPoint.x, prevPoint.y)
          ctx.lineTo(currPoint.x, currPoint.y)
          ctx.stroke()
        }
      })
    }, [eraserWidth])

    // Load initial data
    useEffect(() => {
      if (initialData && canvasRef.current) {
        try {
          const paths = JSON.parse(initialData)
          console.log('Loading initial data:', paths.length, 'paths')
          pathsRef.current = paths
          redrawCanvas()
        } catch (error) {
          console.error('Error loading canvas data:', error)
        }
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialData])

    const startDrawing = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
      // Detect stylus input first, before any other checks
      const isStylusInput = e.pointerType === 'pen'
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
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      const pressure = e.pressure || 0.5 // Default to 0.5 for mouse

      currentPathRef.current = [{ x, y, pressure }]
    }, [mode, stylusModeActive, onStylusDetected, onNonStylusInput])

    const draw = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!isDrawingRef.current || mode === 'view') return

      const canvas = canvasRef.current
      if (!canvas) return

      const ctx = canvas.getContext('2d')
      if (!ctx) return

      const rect = canvas.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      const pressure = e.pressure || 0.5 // Default to 0.5 for mouse

      currentPathRef.current.push({ x, y, pressure })

      // Draw current segment with pressure-sensitive width
      const baseWidth = mode === 'erase' ? eraserWidth : strokeWidth
      const lineWidth = baseWidth * pressure

      ctx.beginPath()
      ctx.strokeStyle = mode === 'erase' ? '#FFFFFF' : strokeColor
      ctx.lineWidth = lineWidth
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.globalCompositeOperation = mode === 'erase' ? 'destination-out' : 'source-over'

      const points = currentPathRef.current
      if (points.length >= 2) {
        const lastPoint = points[points.length - 2]
        const currentPoint = points[points.length - 1]
        ctx.moveTo(lastPoint.x, lastPoint.y)
        ctx.lineTo(currentPoint.x, currentPoint.y)
        ctx.stroke()
      }
    }, [mode, strokeColor, strokeWidth, eraserWidth])

    const stopDrawing = useCallback(() => {
      if (!isDrawingRef.current) return

      isDrawingRef.current = false

      if (currentPathRef.current.length > 0 && mode !== 'view') {
        // Save path
        pathsRef.current.push({
          points: [...currentPathRef.current],
          mode: mode as DrawMode,
          color: strokeColor,
          width: strokeWidth
        })

        currentPathRef.current = []

        // Notify parent with debouncing handled at parent level
        const data = JSON.stringify(pathsRef.current)
        onUpdate(data)
      }
    }, [mode, strokeColor, strokeWidth, onUpdate])

    // Expose methods
    useImperativeHandle(ref, () => {
      console.log('SimpleCanvas ref attached')
      return {
        clear: () => {
          console.log('Clear called on SimpleCanvas')
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
        width={width}
        height={height}
        onPointerDown={startDrawing}
        onPointerMove={draw}
        onPointerUp={stopDrawing}
        onPointerLeave={stopDrawing}
        className="annotation-canvas"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          // Always allow touch pan/zoom/pinch in view mode or stylus mode
          // This allows touch gestures to pass through for scrolling
          touchAction: (mode === 'view' || stylusModeActive) ? 'pan-x pan-y pinch-zoom' : 'none',
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
