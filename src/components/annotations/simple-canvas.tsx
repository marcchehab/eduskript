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
}

export interface SimpleCanvasHandle {
  clear: () => void
  exportData: () => string
}

export const SimpleCanvas = forwardRef<SimpleCanvasHandle, SimpleCanvasProps>(
  ({ width, height, mode, onUpdate, initialData, strokeWidth = 2, strokeColor = '#000000', eraserWidth = 10 }, ref) => {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const isDrawingRef = useRef(false)
    const pathsRef = useRef<Array<{ points: Array<{ x: number; y: number }>; mode: DrawMode; color: string; width: number }>>([])
    const currentPathRef = useRef<Array<{ x: number; y: number }>>([])

    // Load initial data
    useEffect(() => {
      if (initialData && canvasRef.current) {
        try {
          pathsRef.current = JSON.parse(initialData)
          redrawCanvas()
        } catch (error) {
          console.error('Error loading canvas data:', error)
        }
      }
    }, [initialData])

    const redrawCanvas = useCallback(() => {
      const canvas = canvasRef.current
      if (!canvas) return

      const ctx = canvas.getContext('2d')
      if (!ctx) return

      // Clear canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      // Redraw all paths
      pathsRef.current.forEach(path => {
        if (path.points.length < 2) return

        ctx.beginPath()
        ctx.strokeStyle = path.mode === 'erase' ? '#FFFFFF' : path.color
        ctx.lineWidth = path.mode === 'erase' ? eraserWidth : path.width
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.globalCompositeOperation = path.mode === 'erase' ? 'destination-out' : 'source-over'

        ctx.moveTo(path.points[0].x, path.points[0].y)
        for (let i = 1; i < path.points.length; i++) {
          ctx.lineTo(path.points[i].x, path.points[i].y)
        }
        ctx.stroke()
      })
    }, [eraserWidth])

    const startDrawing = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
      if (mode === 'view') return

      const canvas = canvasRef.current
      if (!canvas) return

      isDrawingRef.current = true
      const rect = canvas.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top

      currentPathRef.current = [{ x, y }]
    }, [mode])

    const draw = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!isDrawingRef.current || mode === 'view') return

      const canvas = canvasRef.current
      if (!canvas) return

      const ctx = canvas.getContext('2d')
      if (!ctx) return

      const rect = canvas.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top

      currentPathRef.current.push({ x, y })

      // Draw current segment
      ctx.beginPath()
      ctx.strokeStyle = mode === 'erase' ? '#FFFFFF' : strokeColor
      ctx.lineWidth = mode === 'erase' ? eraserWidth : strokeWidth
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
    useImperativeHandle(ref, () => ({
      clear: () => {
        pathsRef.current = []
        redrawCanvas()
        onUpdate(JSON.stringify([]))
      },
      exportData: () => {
        return JSON.stringify(pathsRef.current)
      }
    }))

    return (
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        onPointerDown={startDrawing}
        onPointerMove={draw}
        onPointerUp={stopDrawing}
        onPointerLeave={stopDrawing}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          touchAction: 'none',
          cursor: mode === 'draw' ? 'crosshair' : mode === 'erase' ? 'pointer' : 'default',
          pointerEvents: mode === 'view' ? 'none' : 'auto'
        }}
      />
    )
  }
)

SimpleCanvas.displayName = 'SimpleCanvas'
