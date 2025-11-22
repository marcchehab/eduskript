'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { AlertTriangle } from 'lucide-react'
import { SimpleCanvas, type SimpleCanvasHandle, type DrawMode } from './simple-canvas'
import { AnnotationToolbar, type AnnotationMode } from './annotation-toolbar'
import { useUserData, useCreateVersion } from '@/lib/userdata/hooks'
import type { AnnotationData } from '@/lib/userdata/types'
import { generateContentHash, type HeadingPosition, type StrokeData } from '@/lib/indexeddb/annotations'
import { repositionStrokes } from '@/lib/annotations/reposition-strokes'
import { useLayout } from '@/contexts/layout-context'
import { VersionBrowser } from '@/components/userdata/version-browser'
import { VersionActions } from '@/components/userdata/quick-undo'
import { SnapOverlay, type Snap } from './snap-overlay'
import { SnapsDisplay } from './snaps-display'

interface AnnotationLayerProps {
  pageId: string
  content: string
  children: React.ReactNode
}

export function AnnotationLayer({ pageId, content, children }: AnnotationLayerProps) {
  const { sidebarWidth, viewportWidth, viewportHeight } = useLayout()

  // Use user data service for annotations
  const { data: annotationData, updateData: updateAnnotationData, deleteData: deleteAnnotationData } = useUserData<AnnotationData>(
    pageId,
    'annotations',
    null
  )

  // Version history hooks
  const createVersion = useCreateVersion<AnnotationData>(pageId, 'annotations')
  const [showVersionBrowser, setShowVersionBrowser] = useState(false)
  const strokeCountRef = useRef(0) // Count strokes for version creation

  const [mode, setMode] = useState<AnnotationMode>('view')
  const [pageVersion, setPageVersion] = useState<string>('')
  const [versionMismatch, setVersionMismatch] = useState(false)
  const [hasAnnotations, setHasAnnotations] = useState(false)
  const [canvasData, setCanvasData] = useState<string>('')
  const [headingPositions, setHeadingPositions] = useState<HeadingPosition[]>([])

  // Save state tracking
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
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
  const contentRef = useRef<HTMLDivElement>(null)
  const mainRef = useRef<HTMLElement | null>(null)
  const canvasRef = useRef<SimpleCanvasHandle | null>(null)
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const isClearingRef = useRef(false)
  const [pageHeight, setPageHeight] = useState(0)
  const [orphanedStrokesCount, setOrphanedStrokesCount] = useState(0)
  const [storedHeadingOffsets, setStoredHeadingOffsets] = useState<Record<string, number>>({})
  const [snaps, setSnaps] = useState<Snap[]>([])

  // Canvas width matches paper width exactly
  // Paper is max-w-5xl (64rem = 1024px)
  const PAPER_WIDTH_REM = 64
  const CANVAS_WIDTH_PX = PAPER_WIDTH_REM * 16 // 1024px

  // Track paper padding for canvas alignment
  const [paperPaddingLeft, setPaperPaddingLeft] = useState(0)

  // Measure paper padding when it mounts and when viewport changes
  useEffect(() => {
    const paperElement = document.getElementById('paper')
    if (paperElement) {
      const style = window.getComputedStyle(paperElement)
      const padding = parseFloat(style.paddingLeft) || 0
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPaperPaddingLeft(padding)
    }
  }, [viewportWidth])

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


  // Generate page version hash
  useEffect(() => {
    generateContentHash(content).then(hash => {
      setPageVersion(hash)
    })
  }, [content])

  // Check for version mismatch
  useEffect(() => {
    if (pageVersion && annotationData) {
      const mismatch = annotationData.pageVersion !== pageVersion
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setVersionMismatch(mismatch)
    } else {
       
      setVersionMismatch(false)
    }
  }, [pageVersion, annotationData])

  // Load annotations from user data service
  // Only load if we don't have local data yet (prevents overwriting active drawing)
  useEffect(() => {
    // Don't reload if we're in the middle of clearing
    if (isClearingRef.current) return

    // Don't reload if we already have canvas data (user is drawing)
    if (canvasData) return

    if (annotationData && annotationData.canvasData) {
      try {
        const strokes: StrokeData[] = JSON.parse(annotationData.canvasData)

        if (strokes.length > 0) {
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setHasAnnotations(true)
           
          setCanvasData(annotationData.canvasData)
           
          setStoredHeadingOffsets(annotationData.headingOffsets || {})
        }
      } catch (error) {
        console.error('Error parsing canvas data:', error)
      }
    }
  }, [annotationData, canvasData])

  // Initialize storedHeadingOffsets when heading positions are first available
  useEffect(() => {
    if (headingPositions.length > 0 && Object.keys(storedHeadingOffsets).length === 0) {
      const currentOffsets = Object.fromEntries(
        headingPositions.map(h => [h.sectionId, h.offsetY])
      )
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStoredHeadingOffsets(currentOffsets)
    }
  }, [headingPositions, storedHeadingOffsets])

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
        const result = repositionStrokes(strokes, headingPositions, storedHeadingOffsets)
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setCanvasData(JSON.stringify(result.strokes))
         
        setOrphanedStrokesCount(result.orphanedCount)
        // Update stored offsets so we don't reposition again
         
        setStoredHeadingOffsets(currentOffsets)
      }
    } catch (error) {
      console.error('Error checking repositioning:', error)
    }
  }, [headingPositions, storedHeadingOffsets, canvasData])

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
    if (isClearingRef.current) return

    if (!canvasData || !pageVersion) return

    // Don't save if heading positions haven't been tracked yet
    if (headingPositions.length === 0) return

    try {
      // Parse canvas data to check if we have strokes
      const strokes = JSON.parse(canvasData) as StrokeData[]

      if (strokes.length === 0) return

      // Build heading offsets map
      const headingOffsets = Object.fromEntries(
        headingPositions.map(h => [h.sectionId, h.offsetY])
      )

      const data: AnnotationData = {
        canvasData,
        headingOffsets,
        pageVersion
      }

      setSaveState('saving')

      // Use immediate: true since we're already debouncing at component level
      await updateAnnotationData(data, { immediate: true })

      setSaveState('saved')

      // Reset to idle after showing success briefly
      setTimeout(() => setSaveState('idle'), 2000)
    } catch (error) {
      console.error('Error saving annotations:', error)
      setSaveState('error')

      // Reset to idle after showing error briefly
      setTimeout(() => setSaveState('idle'), 3000)
    }
  }, [canvasData, pageVersion, headingPositions, updateAnnotationData])

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

  // Helper function to create a version snapshot
  const createVersionSnapshot = useCallback(async () => {
    if (!annotationData || !hasAnnotations) return
    if (isClearingRef.current) return

    // Don't create version if annotations are empty/default
    try {
      const strokes: StrokeData[] = JSON.parse(annotationData.canvasData)
      if (strokes.length === 0) {
        strokeCountRef.current = 0
        return
      }
    } catch (error) {
      console.error('Error parsing canvas data for version:', error)
      strokeCountRef.current = 0
      return
    }

    await createVersion(annotationData)
    strokeCountRef.current = 0 // Reset counter after creating version
  }, [annotationData, hasAnnotations, createVersion])

  // Handle canvas annotation update with debounced save
  const handleCanvasUpdate = useCallback((data: string) => {
    // Update local state immediately
    setCanvasData(data)

    // Check if there's actual data
    let hasData = false
    try {
      const strokes = JSON.parse(data) as StrokeData[]
      hasData = strokes && strokes.length > 0

      setHasAnnotations(hasData)

      // Reset clearing flag only when user actually draws something with content
      // Don't reset when canvas is cleared (empty data)
      if (hasData) {
        isClearingRef.current = false
      }

      if (!hasData) return

      // Increment stroke counter and create version every 5 strokes
      strokeCountRef.current++
      if (strokeCountRef.current >= 5) {
        createVersionSnapshot()
      }
    } catch (error) {
      console.error('Error parsing canvas data:', error)
      return
    }

    // Update stored heading offsets to current positions when drawing new strokes
    // This prevents newly drawn strokes from being repositioned when content changes
    if (headingPositions.length > 0) {
      const currentOffsets = Object.fromEntries(
        headingPositions.map(h => [h.sectionId, h.offsetY])
      )
      setStoredHeadingOffsets(currentOffsets)
    }

    // Clear existing timeout
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }

    // Debounce save by 2 seconds
    saveTimeoutRef.current = setTimeout(() => {
      performSave()
    }, 2000)
  }, [performSave, headingPositions, createVersionSnapshot])

  // Handle clear all annotations
  const handleClearAll = useCallback(async () => {
    try {
      // Create a version snapshot before clearing (if we have data to preserve)
      if (annotationData && hasAnnotations) {
        await createVersion(annotationData, { label: 'Before clear' })
      }

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

      // Clear user data
      await deleteAnnotationData()

      // Clear canvas
      if (canvasRef.current) {
        canvasRef.current.clear()
      }
    } catch (error) {
      console.error('Error clearing annotations:', error)
    }
  }, [deleteAnnotationData, annotationData, hasAnnotations, createVersion])

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

  // Handle snap capture
  const handleSnapCapture = useCallback((snap: Snap) => {
    setSnaps(prev => [...prev, snap])
    setMode('view') // Return to view mode after capturing
  }, [])

  // Handle snap removal
  const handleRemoveSnap = useCallback((id: string) => {
    setSnaps(prev => prev.filter(snap => snap.id !== id))
  }, [])


  // Handle stylus detection
  const handleStylusDetected = useCallback(() => {
    if (!stylusModeActive) {
      setStylusModeActive(true)
    }
    // Switch to draw mode only if in view mode (preserve erase mode)
    if (mode === 'view') {
      setMode('draw')
    }
  }, [stylusModeActive, mode])

  // Document-level stylus detection when not in stylus mode
  useEffect(() => {
    if (stylusModeActive) return // Only listen when stylus mode is not active

    const handleDocumentPointer = (e: PointerEvent) => {
      if (e.pointerType === 'pen') {
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

    // Calculate limits in pan space
    // Top limit: content top should not go below viewport top
    const maxPanY = -mainTop / newZoom

    // Bottom limit: content bottom should not go above viewport bottom
    // Allow scrolling to see all content including comments, export buttons, etc.
    const minPanY = (viewportHeight - mainTop - mainHeight * newZoom) / newZoom

    // Clamp panY between limits
    return Math.max(minPanY, Math.min(maxPanY, newPanY))
  }, [zoom, viewportHeight])

  // Calculate horizontal pan limits - measures on-demand for accuracy
  const calculateHorizontalLimit = useCallback((newPanX: number, newZoom: number = zoom) => {
    if (!mainRef.current) return newPanX

    const paperElement = document.getElementById('paper')
    if (!paperElement) return newPanX

    // Remove transform to get natural position
    const currentTransform = mainRef.current.style.transform
    mainRef.current.style.transform = 'none'

    // Measure both main and paper elements
    const mainRect = mainRef.current.getBoundingClientRect()
    const paperRect = paperElement.getBoundingClientRect()

    mainRef.current.style.transform = currentTransform

    // The transform origin is "top center" of the MAIN element, not viewport
    const originX = (mainRect.left + mainRect.right) / 2
    const leftBoundary = sidebarWidth

    const naturalLeft = paperRect.left
    const naturalRight = paperRect.right

    // Calculate where the paper edges WILL BE after zoom transformation
    // With transform-origin at center (originX), edges transform as:
    // transformedPos = originX + (naturalPos - originX) * zoom
    const transformedLeft = originX + (naturalLeft - originX) * newZoom
    const transformedRight = originX + (naturalRight - originX) * newZoom
    const transformedWidth = transformedRight - transformedLeft

    const availableWidth = viewportWidth - leftBoundary

    // If paper fits in viewport, center it and lock panning
    if (transformedWidth <= availableWidth) {
      const transformedCenter = (transformedLeft + transformedRight) / 2
      const desiredCenter = leftBoundary + availableWidth / 2
      // How much do we need to pan to move transformedCenter to desiredCenter?
      // Pan is applied after zoom, so: screenPos = transformedPos + panX * zoom
      const centerPanX = (desiredCenter - transformedCenter) / newZoom
      return centerPanX
    }

    // Paper is wider than viewport - allow panning to see entire paper + buffers
    const leftBuffer = 32
    const rightBuffer = 32

    // Left constraint: Paper left edge should be visible with a small buffer from sidebar
    const leftTarget = leftBoundary + leftBuffer
    // We want: transformedLeft + panX * zoom = leftTarget
    const maxPanX = (leftTarget - transformedLeft) / newZoom

    // Right constraint: Paper right edge should be visible with a small buffer from viewport edge
    const rightTarget = viewportWidth - rightBuffer
    // We want: transformedRight + panX * zoom = rightTarget
    const minPanX = (rightTarget - transformedRight) / newZoom

    return Math.max(minPanX, Math.min(maxPanX, newPanX))
  }, [zoom, viewportWidth, sidebarWidth])

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
      let newPanX = singleTouchStartRef.current.panX + deltaX / zoom
      let newPanY = singleTouchStartRef.current.panY + deltaY / zoom

      // Apply limits
      newPanX = calculateHorizontalLimit(newPanX)
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

      // Zoom around the initial pinch center point, accounting for transform-origin: top center of main
      // We need to get the main element's center as the origin
      if (!mainRef.current) return

      // Get natural (untransformed) position of main element
      const currentTransform = mainRef.current.style.transform
      mainRef.current.style.transform = 'none'
      const mainRect = mainRef.current.getBoundingClientRect()
      mainRef.current.style.transform = currentTransform

      const originX = (mainRect.left + mainRect.right) / 2
      const originY = mainRect.top

      const initialCenterX = initialPinchCenterRef.current.x
      const initialCenterY = initialPinchCenterRef.current.y
      const zoomPanX = (initialCenterX - originX) * (1 / newZoom - 1 / initialZoomRef.current) + initialPanRef.current.x
      const zoomPanY = (initialCenterY - originY) * (1 / newZoom - 1 / initialZoomRef.current) + initialPanRef.current.y

      // Add pan from finger movement
      const deltaCenterX = currentCenterX - initialCenterX
      const deltaCenterY = currentCenterY - initialCenterY
      let newPanX = zoomPanX + deltaCenterX / newZoom
      let newPanY = zoomPanY + deltaCenterY / newZoom

      // Apply limits
      newPanX = calculateHorizontalLimit(newPanX, newZoom)
      newPanY = calculateScrollLimits(newPanY, newZoom)

      setZoom(newZoom)
      setPanX(newPanX)
      setPanY(newPanY)
    }
  }, [zoom, calculateScrollLimits, calculateHorizontalLimit])

  const handleTouchEnd = useCallback((e: TouchEvent) => {
    // Remove ended touches
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i]
      touchesRef.current.delete(touch.identifier)
    }

    // Clear single touch pan
    if (e.touches.length === 0) {
      singleTouchStartRef.current = null
    }

    // Reset pinch state when less than 2 touches remain
    if (e.touches.length < 2) {
      initialPinchDistanceRef.current = null
      initialPinchCenterRef.current = null
    }
  }, [])

  // Handle trackpad/mousepad pinch zoom and pan
  const handleWheel = useCallback((e: WheelEvent) => {
    // Trackpad pinch zoom comes through as wheel events with ctrlKey
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()

      if (!mainRef.current) return

      // Calculate zoom delta (negative deltaY means zoom in)
      const delta = -e.deltaY * 0.01
      const newZoom = Math.max(0.5, Math.min(3.0, zoom * (1 + delta)))

      // Get natural (untransformed) position of main element
      const currentTransform = mainRef.current.style.transform
      mainRef.current.style.transform = 'none'
      const mainRect = mainRef.current.getBoundingClientRect()
      mainRef.current.style.transform = currentTransform

      // Zoom around cursor position, accounting for transform-origin: top center of main element
      const originX = (mainRect.left + mainRect.right) / 2
      const originY = mainRect.top

      const mouseX = e.clientX
      const mouseY = e.clientY
      let newPanX = (mouseX - originX) * (1 / newZoom - 1 / zoom) + panX
      let newPanY = (mouseY - originY) * (1 / newZoom - 1 / zoom) + panY

      // Apply limits
      newPanX = calculateHorizontalLimit(newPanX, newZoom)
      newPanY = calculateScrollLimits(newPanY, newZoom)

      setZoom(newZoom)
      setPanX(newPanX)
      setPanY(newPanY)
    }
    // Trackpad two-finger pan / mousewheel scroll (no ctrl key)
    else {
      e.preventDefault()

      // Convert scroll to pan (deltaX and deltaY are in pixels)
      // This handles both trackpad pan and regular mousewheel scroll
      let newPanX = panX - e.deltaX / zoom
      let newPanY = panY - e.deltaY / zoom

      // Apply limits
      newPanX = calculateHorizontalLimit(newPanX)
      newPanY = calculateScrollLimits(newPanY)

      setPanX(newPanX)
      setPanY(newPanY)
    }
  }, [zoom, panX, panY, calculateScrollLimits, calculateHorizontalLimit])

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
    }
  }, [panX, panY])

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (middleMouseDragRef.current) {
      const deltaX = e.clientX - middleMouseDragRef.current.x
      const deltaY = e.clientY - middleMouseDragRef.current.y
      let newPanX = middleMouseDragRef.current.panX + deltaX / zoom
      let newPanY = middleMouseDragRef.current.panY + deltaY / zoom

      // Apply limits
      newPanX = calculateHorizontalLimit(newPanX)
      newPanY = calculateScrollLimits(newPanY)

      setPanX(newPanX)
      setPanY(newPanY)
    }
  }, [zoom, calculateScrollLimits, calculateHorizontalLimit])

  const handleMouseUp = useCallback((e: MouseEvent) => {
    if (middleMouseDragRef.current && e.button === 1) {
      middleMouseDragRef.current = null
      document.body.style.cursor = ''
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
              left: `-${paperPaddingLeft}px`,
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
      />

      {/* Save state indicator - subtle, fixed to viewport, left of toolbar */}
      {saveState !== 'idle' && (
        <div
          className="fixed bottom-6 right-24 z-50 opacity-50 hover:opacity-100 transition-opacity"
          title={
            saveState === 'saving' ? 'Saving annotations...' :
            saveState === 'saved' ? 'Annotations saved' :
            'Error saving annotations'
          }
        >
          {saveState === 'saving' && (
            <div className="w-5 h-5 border-2 border-gray-400 dark:border-gray-500 border-t-transparent rounded-full animate-spin" />
          )}
          {saveState === 'saved' && (
            <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          )}
          {saveState === 'error' && (
            <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          )}
        </div>
      )}

      {/* Version Actions - Quick undo and history buttons */}
      {hasAnnotations && (
        <div className="fixed bottom-6 right-16 z-50">
          <VersionActions
            pageId={pageId}
            componentId="annotations"
            onViewHistory={() => setShowVersionBrowser(true)}
          />
        </div>
      )}

      {/* Version Browser Dialog */}
      <VersionBrowser
        pageId={pageId}
        componentId="annotations"
        open={showVersionBrowser}
        onOpenChange={setShowVersionBrowser}
      />

      {/* Snap overlay - shown when in snap mode */}
      {mode === 'snap' && (
        <SnapOverlay
          onCapture={handleSnapCapture}
          onCancel={() => setMode('view')}
        />
      )}

      {/* Snaps display - shows all captured snaps */}
      <SnapsDisplay
        snaps={snaps}
        onRemoveSnap={handleRemoveSnap}
      />
    </>
  )
}
