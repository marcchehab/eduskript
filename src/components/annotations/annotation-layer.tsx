'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { AlertTriangle } from 'lucide-react'
import { SimpleCanvas, type SimpleCanvasHandle, type DrawMode } from './simple-canvas'
import { AnnotationToolbar, type AnnotationMode } from './annotation-toolbar'
import {
  getPageAnnotations,
  savePageAnnotations,
  clearPageAnnotations,
  generateContentHash,
  checkVersionMismatch,
  type HeadingPosition,
  type StrokeData
} from '@/lib/indexeddb/annotations'
import { repositionStrokes } from '@/lib/annotations/reposition-strokes'

interface AnnotationLayerProps {
  pageId: string
  content: string
  children: React.ReactNode
}

export function AnnotationLayer({ pageId, content, children }: AnnotationLayerProps) {
  const [mode, setMode] = useState<AnnotationMode>('view')
  const [pageVersion, setPageVersion] = useState<string>('')
  const [versionMismatch, setVersionMismatch] = useState(false)
  const [hasAnnotations, setHasAnnotations] = useState(false)
  const [canvasData, setCanvasData] = useState<string>('')
  const [headingPositions, setHeadingPositions] = useState<HeadingPosition[]>([])
  const [stylusModeActive, setStylusModeActive] = useState(false)
  const [activePen, setActivePen] = useState(0)
  const [zoom, setZoom] = useState(1.0)
  const [panX, setPanX] = useState(0)
  const [panY, setPanY] = useState(0)
  const touchesRef = useRef<Map<number, { x: number; y: number }>>(new Map())
  const initialPinchDistanceRef = useRef<number | null>(null)
  const initialZoomRef = useRef(1.0)
  const initialPinchCenterRef = useRef<{ x: number; y: number } | null>(null)
  const initialPanRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const singleTouchStartRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null)
  const middleMouseDragRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null)
  const [penColors, setPenColors] = useState<[string, string, string]>(() => {
    // Load pen colors from localStorage
    if (typeof window !== 'undefined') {
      const savedColors = localStorage.getItem('annotation-pen-colors')
      if (savedColors) {
        try {
          const parsed = JSON.parse(savedColors)
          if (Array.isArray(parsed) && parsed.length === 3) {
            return parsed as [string, string, string]
          }
        } catch (e) {
          console.error('Error loading pen colors:', e)
        }
      }
    }
    return ['#000000', '#FF0000', '#0000FF']
  })
  const [penSizes, setPenSizes] = useState<[number, number, number]>(() => {
    // Load pen sizes from localStorage
    if (typeof window !== 'undefined') {
      const savedSizes = localStorage.getItem('annotation-pen-sizes')
      if (savedSizes) {
        try {
          const parsed = JSON.parse(savedSizes)
          if (Array.isArray(parsed) && parsed.length === 3) {
            return parsed as [number, number, number]
          }
        } catch (e) {
          console.error('Error loading pen sizes:', e)
        }
      }
    }
    return [2, 3, 4]
  })
  const [eraserSize, setEraserSize] = useState<number>(() => {
    // Load eraser size from localStorage
    if (typeof window !== 'undefined') {
      const savedSize = localStorage.getItem('annotation-eraser-size')
      if (savedSize) {
        try {
          const parsed = parseFloat(savedSize)
          if (!isNaN(parsed) && parsed > 0) {
            return parsed
          }
        } catch (e) {
          console.error('Error loading eraser size:', e)
        }
      }
    }
    return 100 // Default eraser size
  })
  const contentRef = useRef<HTMLDivElement>(null)
  const mainRef = useRef<HTMLElement | null>(null)
  const canvasRef = useRef<SimpleCanvasHandle | null>(null)
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const isClearingRef = useRef(false)
  const [pageHeight, setPageHeight] = useState(0)
  const [orphanedStrokesCount, setOrphanedStrokesCount] = useState(0)
  const [storedHeadingOffsets, setStoredHeadingOffsets] = useState<Record<string, number>>({})

  // Canvas width is 1.5x content width
  // Content is max-w-5xl (80rem = 1280px)
  const CONTENT_WIDTH_REM = 80
  const CANVAS_WIDTH_REM = CONTENT_WIDTH_REM * 1.5 // 120rem = 1920px
  const CANVAS_WIDTH_PX = CANVAS_WIDTH_REM * 16 // 1920px
  const MARGIN_EXTENSION_REM = (CANVAS_WIDTH_REM - CONTENT_WIDTH_REM) / 2 // 12rem on each side

  // Save pen colors to localStorage whenever they change
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('annotation-pen-colors', JSON.stringify(penColors))
    }
  }, [penColors])

  // Save pen sizes to localStorage whenever they change
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('annotation-pen-sizes', JSON.stringify(penSizes))
    }
  }, [penSizes])

  // Save eraser size to localStorage whenever it changes
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('annotation-eraser-size', eraserSize.toString())
    }
  }, [eraserSize])

  // Generate page version hash
  useEffect(() => {
    generateContentHash(content).then(hash => {
      setPageVersion(hash)
    })
  }, [content])

  // Check for version mismatch
  useEffect(() => {
    if (pageVersion && pageId) {
      checkVersionMismatch(pageId, pageVersion).then(mismatch => {
        setVersionMismatch(mismatch)
      })
    }
  }, [pageId, pageVersion])

  // Load annotations from IndexedDB (only when pageId changes)
  useEffect(() => {
    if (!pageId) return

    console.log('Loading annotations for page:', pageId)
    getPageAnnotations(pageId).then(pageAnnotation => {
      console.log('Loaded page annotation:', pageAnnotation)
      if (pageAnnotation && pageAnnotation.canvasData) {
        try {
          const strokes: StrokeData[] = JSON.parse(pageAnnotation.canvasData)

          if (strokes.length > 0) {
            setHasAnnotations(true)
            setCanvasData(JSON.stringify(strokes))
            setStoredHeadingOffsets(pageAnnotation.headingOffsets || {})
            console.log('Loaded', strokes.length, 'strokes')
          }
        } catch (error) {
          console.error('Error parsing canvas data:', error)
        }
      } else {
        console.log('No annotations found')
        setStoredHeadingOffsets({})
      }
    })
  }, [pageId])

  // Apply repositioning when heading positions change (only if needed)
  useEffect(() => {
    if (!canvasData || headingPositions.length === 0 || Object.keys(storedHeadingOffsets).length === 0) return

    try {
      const strokes: StrokeData[] = JSON.parse(canvasData)
      if (strokes.length === 0) return

      // Check if repositioning is needed
      const currentOffsets = Object.fromEntries(
        headingPositions.map(h => [h.sectionId, h.offsetY])
      )

      // Only reposition if stored offsets differ from current offsets
      const needsReposition = Object.keys(storedHeadingOffsets).some(
        key => storedHeadingOffsets[key] !== currentOffsets[key]
      )

      if (needsReposition) {
        console.log('Content changed - repositioning strokes')
        console.log('Stored offsets:', storedHeadingOffsets)
        console.log('Current offsets:', currentOffsets)

        const result = repositionStrokes(strokes, headingPositions, storedHeadingOffsets)
        setCanvasData(JSON.stringify(result.strokes))
        setOrphanedStrokesCount(result.orphanedCount)
        // Update stored offsets so we don't reposition again
        setStoredHeadingOffsets(currentOffsets)

        if (result.orphanedCount > 0) {
          console.log(`Warning: ${result.orphanedCount} orphaned strokes detected`)
        }
      }
    } catch (error) {
      console.error('Error checking repositioning:', error)
    }
  }, [headingPositions, storedHeadingOffsets])

  // Helper function to recalculate heading positions
  const recalculateHeadingPositions = useCallback(() => {
    if (!contentRef.current) return

    // Get page dimensions
    setPageHeight(contentRef.current.scrollHeight)

    // Query for all headings with data-section-id (from h1, h2, h3 elements)
    const headingElements = contentRef.current.querySelectorAll<HTMLElement>('[data-section-id]')
    const positions: HeadingPosition[] = []

    headingElements.forEach((element) => {
      const sectionId = element.getAttribute('data-section-id')
      const headingText = element.getAttribute('data-heading-text')

      if (sectionId) {
        // Get the heading element's position relative to contentRef
        const rect = element.getBoundingClientRect()
        const parentRect = contentRef.current!.getBoundingClientRect()
        const offsetY = rect.top - parentRect.top + contentRef.current!.scrollTop

        positions.push({
          sectionId,
          offsetY,
          headingText: headingText || ''
        })
      }
    })

    setHeadingPositions(positions)
    console.log('Tracked', positions.length, 'heading positions')
  }, [])

  // Track heading positions and page height (after markdown renders)
  useEffect(() => {
    if (!contentRef.current) return

    const timer = setTimeout(() => {
      recalculateHeadingPositions()
    }, 500) // Wait for markdown to render

    return () => clearTimeout(timer)
  }, [children, recalculateHeadingPositions]) // Re-run when children change (markdown re-renders)

  // EXPERIMENTAL: Track heading positions on window resize for live repositioning
  // This allows real-time annotation repositioning when window width changes and text reflows
  useEffect(() => {
    let rafId: number | null = null
    let isScheduled = false

    const handleResize = () => {
      // Use requestAnimationFrame for smooth updates
      if (!isScheduled) {
        isScheduled = true
        rafId = requestAnimationFrame(() => {
          console.log('Window resized - recalculating heading positions')
          recalculateHeadingPositions()
          isScheduled = false
        })
      }
    }

    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
      if (rafId !== null) cancelAnimationFrame(rafId)
    }
  }, [recalculateHeadingPositions])

  // Function to perform the actual save
  const performSave = useCallback(async () => {
    // Don't save if we're in the middle of clearing
    if (isClearingRef.current) {
      console.log('Skipping save - clearing in progress')
      return
    }

    if (!canvasData || !pageId || !pageVersion) {
      console.log('Skipping save - missing required data')
      return
    }

    // Don't save if heading positions haven't been tracked yet
    if (headingPositions.length === 0) {
      console.log('Skipping save - waiting for heading positions to be tracked')
      return
    }

    try {
      // Parse canvas data to check if we have strokes
      const strokes = JSON.parse(canvasData) as StrokeData[]

      if (strokes.length === 0) {
        console.log('No strokes to save')
        return
      }

      // Build heading offsets map
      const headingOffsets = Object.fromEntries(
        headingPositions.map(h => [h.sectionId, h.offsetY])
      )

      // Calculate statistics
      const totalPoints = strokes.reduce((sum, stroke) => sum + stroke.points.length, 0)
      const sizeKB = (new Blob([canvasData]).size / 1024).toFixed(2)

      console.log(`📊 Saving: ${strokes.length} strokes, ${totalPoints} points, ${sizeKB} KB`)
      console.log(`📍 Tracking ${headingPositions.length} heading positions`)

      await savePageAnnotations(pageId, pageVersion, canvasData, headingOffsets)
      console.log('Save completed successfully')
    } catch (error) {
      console.error('Error saving annotations:', error)
    }
  }, [canvasData, pageId, pageVersion, headingPositions])

  // Save on unmount (navigation away)
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
      // Perform immediate save on unmount
      performSave()
    }
  }, [performSave])

  // Save on page unload (refresh/close)
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
      // Perform immediate save
      performSave()
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [performSave])

  // Handle canvas annotation update with debounced save
  const handleCanvasUpdate = useCallback((data: string) => {
    // Reset clearing flag when user starts drawing again
    isClearingRef.current = false

    // Update local state immediately
    setCanvasData(data)

    // Update stored heading offsets to current positions when drawing new strokes
    // This prevents newly drawn strokes from being repositioned when content changes
    if (headingPositions.length > 0) {
      const currentOffsets = Object.fromEntries(
        headingPositions.map(h => [h.sectionId, h.offsetY])
      )
      setStoredHeadingOffsets(currentOffsets)
    }

    // Check if there's actual data
    try {
      const strokes = JSON.parse(data) as StrokeData[]
      const hasData = strokes && strokes.length > 0

      setHasAnnotations(hasData)

      if (!hasData) return
    } catch (error) {
      console.error('Error parsing canvas data:', error)
      return
    }

    // Clear existing timeout
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }

    // Debounce save by 2 seconds
    saveTimeoutRef.current = setTimeout(() => {
      performSave()
    }, 2000)
  }, [performSave, headingPositions])

  // Handle clear all annotations
  const handleClearAll = useCallback(async () => {
    try {
      console.log('Clearing all annotations')

      // Set flag to prevent any saves during/after clear operation
      isClearingRef.current = true

      // Cancel any pending save operations to prevent re-saving old data
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
        saveTimeoutRef.current = null
      }

      // Clear state first to prevent re-initialization
      setCanvasData('')
      setHasAnnotations(false)
      setVersionMismatch(false)
      setOrphanedStrokesCount(0)

      // Clear database
      await clearPageAnnotations(pageId)

      // Clear canvas
      if (canvasRef.current) {
        canvasRef.current.clear()
      }

      console.log('Annotations cleared successfully')
    } catch (error) {
      console.error('Error clearing annotations:', error)
    }
  }, [pageId])

  // Handle removal of orphaned strokes
  const handleRemoveOrphans = useCallback(() => {
    if (!canvasData) return

    try {
      const strokes: StrokeData[] = JSON.parse(canvasData)
      const filtered = strokes.filter(stroke => !stroke.sectionId.endsWith('-ORPHANED'))

      const newData = JSON.stringify(filtered)
      setCanvasData(newData)
      setOrphanedStrokesCount(0)

      // Update canvas
      if (canvasRef.current) {
        // The canvas will reload with filtered data via initialData prop
      }

      // Trigger immediate save
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
      performSave()

      console.log(`Removed ${strokes.length - filtered.length} orphaned strokes`)
    } catch (error) {
      console.error('Error removing orphaned strokes:', error)
    }
  }, [canvasData, performSave])

  // Handle pen change
  const handlePenChange = useCallback((penIndex: number) => {
    setActivePen(penIndex)
  }, [])

  // Handle pen color change
  const handlePenColorChange = useCallback((penIndex: number, color: string) => {
    setPenColors(prev => {
      const newColors: [string, string, string] = [...prev] as [string, string, string]
      newColors[penIndex] = color
      return newColors
    })
  }, [])

  // Handle pen size change
  const handlePenSizeChange = useCallback((penIndex: number, size: number) => {
    setPenSizes(prev => {
      const newSizes: [number, number, number] = [...prev] as [number, number, number]
      newSizes[penIndex] = size
      return newSizes
    })
  }, [])

  // Handle eraser size change
  const handleEraserSizeChange = useCallback((size: number) => {
    setEraserSize(size)
  }, [])

  // Handle stylus detection
  const handleStylusDetected = useCallback(() => {
    if (!stylusModeActive) {
      console.log('Stylus detected - activating stylus mode')
      setStylusModeActive(true)
    }
    // Switch to draw mode only if in view mode (preserve erase mode)
    if (mode === 'view') {
      console.log('Stylus detected - switching from view to draw mode')
      setMode('draw')
    }
  }, [stylusModeActive, mode])

  // Document-level stylus detection when not in stylus mode
  useEffect(() => {
    if (stylusModeActive) return // Only listen when stylus mode is not active

    const handleDocumentPointer = (e: PointerEvent) => {
      if (e.pointerType === 'pen') {
        console.log('Stylus detected on document (hover or touch) - activating stylus mode')
        handleStylusDetected()
      }
    }

    // Listen for both hover (pointermove) and touch (pointerdown)
    document.addEventListener('pointermove', handleDocumentPointer)
    document.addEventListener('pointerdown', handleDocumentPointer)
    return () => {
      document.removeEventListener('pointermove', handleDocumentPointer)
      document.removeEventListener('pointerdown', handleDocumentPointer)
    }
  }, [stylusModeActive, handleStylusDetected])

  // Document-level mouse detection when stylus mode is active
  useEffect(() => {
    if (!stylusModeActive) return // Only listen when stylus mode IS active

    const handleDocumentMouseMove = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') {
        console.log('Mouse detected on document - deactivating stylus mode')
        setStylusModeActive(false)
        setMode('view')
      }
    }

    // Listen for mouse movement
    document.addEventListener('pointermove', handleDocumentMouseMove)
    return () => {
      document.removeEventListener('pointermove', handleDocumentMouseMove)
    }
  }, [stylusModeActive])

  // Handle non-stylus input in stylus mode (switch to view mode and deactivate stylus mode)
  const handleNonStylusInput = useCallback(() => {
    if (stylusModeActive && mode !== 'view') {
      console.log('Non-stylus input detected in stylus mode - switching to view mode and deactivating stylus mode')
      setMode('view')
      setStylusModeActive(false)
    }
  }, [stylusModeActive, mode])

  // Calculate scroll limits based on main content bounds
  const calculateScrollLimits = useCallback((newPanY: number, newZoom: number = zoom) => {
    if (!mainRef.current) return newPanY

    // Remove current transform temporarily to get natural dimensions
    const currentTransform = mainRef.current.style.transform
    mainRef.current.style.transform = 'none'

    // Get the main content element bounds (includes article + everything below it)
    const mainRect = mainRef.current.getBoundingClientRect()
    const mainTop = mainRect.top
    const mainHeight = mainRect.height

    // Restore transform
    mainRef.current.style.transform = currentTransform

    const viewportHeight = window.innerHeight

    // Calculate limits in pan space
    // Top limit: content top should not go below viewport top
    const maxPanY = -mainTop / newZoom

    // Bottom limit: content bottom should not go above viewport bottom
    // Allow scrolling to see all content including comments, export buttons, etc.
    const minPanY = (viewportHeight - mainTop - mainHeight * newZoom) / newZoom

    // Clamp panY between limits
    return Math.max(minPanY, Math.min(maxPanY, newPanY))
  }, [zoom])

  // Custom pinch-zoom and pan handling
  const handleTouchStart = useCallback((e: TouchEvent) => {
    // Track all touches
    for (let i = 0; i < e.touches.length; i++) {
      const touch = e.touches[i]
      touchesRef.current.set(touch.identifier, { x: touch.clientX, y: touch.clientY })
    }

    // Single touch - start pan in view mode (acts as scroll at zoom = 1.0)
    if (e.touches.length === 1 && mode === 'view') {
      const touch = e.touches[0]
      singleTouchStartRef.current = {
        x: touch.clientX,
        y: touch.clientY,
        panX,
        panY
      }
      console.log('Single touch start for pan')
    }

    // Two touches - start pinch zoom and prevent browser zoom
    if (e.touches.length === 2) {
      e.preventDefault() // Prevent browser zoom

      // Clear single touch pan
      singleTouchStartRef.current = null

      const touch1 = e.touches[0]
      const touch2 = e.touches[1]
      const distance = Math.hypot(touch2.clientX - touch1.clientX, touch2.clientY - touch1.clientY)
      const centerX = (touch1.clientX + touch2.clientX) / 2
      const centerY = (touch1.clientY + touch2.clientY) / 2

      initialPinchDistanceRef.current = distance
      initialPinchCenterRef.current = { x: centerX, y: centerY }
      initialZoomRef.current = zoom
      initialPanRef.current = { x: panX, y: panY }

      console.log('Pinch start - distance:', distance, 'center:', centerX, centerY, 'zoom:', zoom)
    }
  }, [zoom, panX, panY, mode])

  const handleTouchMove = useCallback((e: TouchEvent) => {
    // Update touch positions
    for (let i = 0; i < e.touches.length; i++) {
      const touch = e.touches[i]
      touchesRef.current.set(touch.identifier, { x: touch.clientX, y: touch.clientY })
    }

    // Handle single-finger pan when zoomed
    if (e.touches.length === 1 && singleTouchStartRef.current !== null) {
      const touch = e.touches[0]
      const deltaX = touch.clientX - singleTouchStartRef.current.x
      const deltaY = touch.clientY - singleTouchStartRef.current.y
      const newPanX = singleTouchStartRef.current.panX + deltaX / zoom
      let newPanY = singleTouchStartRef.current.panY + deltaY / zoom

      // Apply scroll limits
      newPanY = calculateScrollLimits(newPanY)

      setPanX(newPanX)
      setPanY(newPanY)
    }

    // Handle pinch zoom and pan (2 fingers)
    if (e.touches.length === 2 && initialPinchDistanceRef.current !== null && initialPinchCenterRef.current !== null) {
      e.preventDefault() // Prevent browser zoom during pinch

      const touch1 = e.touches[0]
      const touch2 = e.touches[1]
      const currentDistance = Math.hypot(touch2.clientX - touch1.clientX, touch2.clientY - touch1.clientY)
      const currentCenterX = (touch1.clientX + touch2.clientX) / 2
      const currentCenterY = (touch1.clientY + touch2.clientY) / 2

      // Calculate zoom factor
      const zoomFactor = currentDistance / initialPinchDistanceRef.current
      const newZoom = Math.max(0.5, Math.min(3.0, initialZoomRef.current * zoomFactor))

      // Zoom around the initial pinch center point, accounting for transform-origin: top center
      const originX = window.innerWidth / 2
      const originY = 0
      const initialCenterX = initialPinchCenterRef.current.x
      const initialCenterY = initialPinchCenterRef.current.y
      const zoomPanX = (initialCenterX - originX) * (1 / newZoom - 1 / initialZoomRef.current) + initialPanRef.current.x
      const zoomPanY = (initialCenterY - originY) * (1 / newZoom - 1 / initialZoomRef.current) + initialPanRef.current.y

      // Add pan from finger movement
      const deltaCenterX = currentCenterX - initialCenterX
      const deltaCenterY = currentCenterY - initialCenterY
      const newPanX = zoomPanX + deltaCenterX / newZoom
      let newPanY = zoomPanY + deltaCenterY / newZoom

      // Apply scroll limits
      newPanY = calculateScrollLimits(newPanY, newZoom)

      console.log('Pinch move - zoom:', newZoom, 'pan:', newPanX, newPanY)
      setZoom(newZoom)
      setPanX(newPanX)
      setPanY(newPanY)
    }
  }, [zoom, calculateScrollLimits])

  const handleTouchEnd = useCallback((e: TouchEvent) => {
    // Remove ended touches
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i]
      touchesRef.current.delete(touch.identifier)
    }

    // Clear single touch pan
    if (e.touches.length === 0) {
      singleTouchStartRef.current = null
      console.log('Single touch end')
    }

    // Reset pinch state when less than 2 touches remain
    if (e.touches.length < 2) {
      initialPinchDistanceRef.current = null
      initialPinchCenterRef.current = null
      console.log('Pinch end')
    }
  }, [])

  // Handle trackpad/mousepad pinch zoom and pan
  const handleWheel = useCallback((e: WheelEvent) => {
    // Trackpad pinch zoom comes through as wheel events with ctrlKey
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()

      // Calculate zoom delta (negative deltaY means zoom in)
      const delta = -e.deltaY * 0.01
      const newZoom = Math.max(0.5, Math.min(3.0, zoom * (1 + delta)))

      // Zoom around cursor position, accounting for transform-origin: top center
      const originX = window.innerWidth / 2
      const originY = 0
      const mouseX = e.clientX
      const mouseY = e.clientY
      const newPanX = (mouseX - originX) * (1 / newZoom - 1 / zoom) + panX
      let newPanY = (mouseY - originY) * (1 / newZoom - 1 / zoom) + panY

      // Apply scroll limits
      newPanY = calculateScrollLimits(newPanY, newZoom)

      console.log('Trackpad zoom:', newZoom)
      setZoom(newZoom)
      setPanX(newPanX)
      setPanY(newPanY)
    }
    // Trackpad two-finger pan / mousewheel scroll (no ctrl key)
    else {
      e.preventDefault()

      // Convert scroll to pan (deltaX and deltaY are in pixels)
      // This handles both trackpad pan and regular mousewheel scroll
      const newPanX = panX - e.deltaX / zoom
      let newPanY = panY - e.deltaY / zoom

      // Apply scroll limits
      newPanY = calculateScrollLimits(newPanY)

      console.log('Wheel pan/scroll:', newPanX, newPanY)
      setPanX(newPanX)
      setPanY(newPanY)
    }
  }, [zoom, panX, panY, calculateScrollLimits])

  // Handle middle mouse button drag for desktop
  const handleMouseDown = useCallback((e: MouseEvent) => {
    // Middle mouse button (button = 1)
    if (e.button === 1) {
      e.preventDefault()
      middleMouseDragRef.current = {
        x: e.clientX,
        y: e.clientY,
        panX,
        panY
      }
      document.body.style.cursor = 'grabbing'
      console.log('Middle mouse drag start')
    }
  }, [panX, panY])

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (middleMouseDragRef.current) {
      const deltaX = e.clientX - middleMouseDragRef.current.x
      const deltaY = e.clientY - middleMouseDragRef.current.y
      const newPanX = middleMouseDragRef.current.panX + deltaX / zoom
      let newPanY = middleMouseDragRef.current.panY + deltaY / zoom

      // Apply scroll limits
      newPanY = calculateScrollLimits(newPanY)

      setPanX(newPanX)
      setPanY(newPanY)
    }
  }, [zoom, calculateScrollLimits])

  const handleMouseUp = useCallback((e: MouseEvent) => {
    if (middleMouseDragRef.current && e.button === 1) {
      middleMouseDragRef.current = null
      document.body.style.cursor = ''
      console.log('Middle mouse drag end')
    }
  }, [])

  // Find and store reference to parent <main> element
  useEffect(() => {
    if (contentRef.current) {
      mainRef.current = contentRef.current.closest('main')
    }
  }, [])

  // Apply zoom/pan transform to <main> element
  useEffect(() => {
    if (mainRef.current) {
      mainRef.current.style.transform = `scale(${zoom}) translate(${panX}px, ${panY}px)`
      mainRef.current.style.transformOrigin = 'top center'
      mainRef.current.style.transition = 'none'
    }
  }, [zoom, panX, panY])

  // Set up event listeners on document to capture ALL events (sidebar, main, etc.)
  useEffect(() => {
    // Touch events for touchscreen pinch zoom
    document.addEventListener('touchstart', handleTouchStart, { passive: false })
    document.addEventListener('touchmove', handleTouchMove, { passive: false })
    document.addEventListener('touchend', handleTouchEnd, { passive: false })
    document.addEventListener('touchcancel', handleTouchEnd, { passive: false })

    // Wheel events for trackpad/mousepad pinch zoom
    document.addEventListener('wheel', handleWheel, { passive: false })

    // Mouse events for middle button drag
    document.addEventListener('mousedown', handleMouseDown)
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('touchstart', handleTouchStart)
      document.removeEventListener('touchmove', handleTouchMove)
      document.removeEventListener('touchend', handleTouchEnd)
      document.removeEventListener('touchcancel', handleTouchEnd)
      document.removeEventListener('wheel', handleWheel)
      document.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [handleTouchStart, handleTouchMove, handleTouchEnd, handleWheel, handleMouseDown, handleMouseMove, handleMouseUp])

  return (
    <>
      {/* Version mismatch warning */}
      {versionMismatch && hasAnnotations && (
        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4 mb-6">
          <div className="flex items-start">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3 flex-1">
              <p className="text-sm text-yellow-800 dark:text-yellow-200">
                <strong>Content Updated:</strong> This page has been modified. Your annotations may no longer align with the content.
              </p>
              <button
                onClick={handleClearAll}
                className="mt-2 text-sm text-yellow-800 dark:text-yellow-200 underline hover:no-underline"
              >
                Clear annotations and start fresh
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Orphaned strokes warning banner */}
      {orphanedStrokesCount > 0 && (
        <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50 bg-yellow-100 dark:bg-yellow-900/20 border border-yellow-400 dark:border-yellow-600 rounded-lg shadow-lg px-4 py-2 max-w-md">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-yellow-600 dark:text-yellow-400 flex-shrink-0" />
            <span className="text-sm text-yellow-800 dark:text-yellow-200">
              {orphanedStrokesCount} annotation{orphanedStrokesCount > 1 ? 's are' : ' is'} orphaned (original section{orphanedStrokesCount > 1 ? 's' : ''} deleted)
            </span>
            <button
              onClick={handleRemoveOrphans}
              className="ml-2 px-2 py-1 bg-yellow-200 dark:bg-yellow-800 hover:bg-yellow-300 dark:hover:bg-yellow-700 rounded text-xs text-yellow-900 dark:text-yellow-100 whitespace-nowrap"
            >
              Remove
            </button>
          </div>
        </div>
      )}

      {/* Wrapper for content and canvas overlay */}
      <div ref={contentRef} style={{ position: 'relative' }}>
        {children}

        {/* Single canvas overlay for entire page */}
        {pageHeight > 0 && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: `-${MARGIN_EXTENSION_REM}rem`,
              width: `${CANVAS_WIDTH_PX}px`,
              height: pageHeight,
              pointerEvents: mode === 'view' && !stylusModeActive ? 'none' : 'auto',
              zIndex: 10
            }}
          >
            <SimpleCanvas
              ref={canvasRef}
              width={CANVAS_WIDTH_PX}
              height={pageHeight}
              mode={mode === 'view' ? 'view' : (mode as DrawMode)}
              onUpdate={handleCanvasUpdate}
              initialData={canvasData}
              strokeColor={penColors[activePen]}
              strokeWidth={penSizes[activePen]}
              eraserWidth={eraserSize}
              stylusModeActive={stylusModeActive}
              onStylusDetected={handleStylusDetected}
              onNonStylusInput={handleNonStylusInput}
              zoom={zoom}
              headingPositions={headingPositions}
            />
          </div>
        )}
      </div>

      {/* Toolbar */}
      <AnnotationToolbar
        mode={mode}
        onModeChange={setMode}
        onClear={handleClearAll}
        hasAnnotations={hasAnnotations}
        activePen={activePen}
        onPenChange={handlePenChange}
        penColors={penColors}
        onPenColorChange={handlePenColorChange}
        penSizes={penSizes}
        onPenSizeChange={handlePenSizeChange}
        eraserSize={eraserSize}
        onEraserSizeChange={handleEraserSizeChange}
      />
    </>
  )
}
