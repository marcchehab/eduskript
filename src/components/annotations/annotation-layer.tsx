'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle } from 'lucide-react'
import { SimpleCanvas, type SimpleCanvasHandle, type DrawMode } from './simple-canvas'
import { AnnotationToolbar, type AnnotationMode } from './annotation-toolbar'
import { useSyncedUserData } from '@/lib/userdata/provider'
import type { AnnotationData } from '@/lib/userdata/types'
import type { SnapsData } from '@/lib/userdata/adapters'
import { generateContentHash, type HeadingPosition, type StrokeData } from '@/lib/indexeddb/annotations'
import { repositionStrokes } from '@/lib/annotations/reposition-strokes'
import { useLayout } from '@/contexts/layout-context'
import { SnapOverlay, type Snap } from './snap-overlay'
import { SnapsDisplay } from './snaps-display'

interface AnnotationLayerProps {
  pageId: string
  content: string
  children: React.ReactNode
}

export function AnnotationLayer({ pageId, content, children }: AnnotationLayerProps) {
  const { sidebarWidth, viewportWidth, viewportHeight } = useLayout()

  // Use synced user data service for annotations
  const { data: annotationData, updateData: updateAnnotationData, isLoading: annotationLoading } = useSyncedUserData<AnnotationData>(
    pageId,
    'annotations',
    null
  )

  // Use synced user data service for snaps
  // IMPORTANT: initialData must be a stable reference, not an inline object literal
  const emptySnapsData = useMemo(() => ({ snaps: [] } as SnapsData), [])
  const { data: snapsData, updateData: updateSnapsData, isLoading: snapsLoading } = useSyncedUserData<SnapsData>(
    pageId,
    'snaps',
    emptySnapsData
  )

  // Delete function - update with empty/null data
  const deleteAnnotationData = async () => {
    await updateAnnotationData({ canvasData: '', headingOffsets: {}, pageVersion: '' })
  }


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

  // Track if pen is currently hovering or drawing - controls pointer-events on canvas
  const [penActive, setPenActive] = useState(false)
  // Use refs for zoom to avoid re-renders on every gesture
  const zoomRef = useRef(1.0)
  const rafIdRef = useRef<number | null>(null)
  const touchesRef = useRef<Map<number, { x: number; y: number }>>(new Map())
  const initialPinchDistanceRef = useRef<number | null>(null)
  const initialZoomRef = useRef(1.0)
  const initialPinchCenterRef = useRef<{ x: number; y: number } | null>(null)
  // Store the content point under the initial pinch center (in unscaled content coordinates)
  const initialContentPointRef = useRef<{ x: number; y: number } | null>(null)
  // Scroll container ref for zoom-scroll sync
  const scrollContainerRef = useRef<HTMLElement | null>(null)
  // Display-only zoom state (updated on gesture end, not during gesture)
  const [zoom, setZoom] = useState(1.0)
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
    return [4, 8, 14]
  })
  const contentRef = useRef<HTMLDivElement>(null)
  const mainRef = useRef<HTMLElement | null>(null)
  const canvasRef = useRef<SimpleCanvasHandle | null>(null)
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const isClearingRef = useRef(false)
  const [pageHeight, setPageHeight] = useState(0)
  const [orphanedStrokesCount, setOrphanedStrokesCount] = useState(0)
  const [storedHeadingOffsets, setStoredHeadingOffsets] = useState<Record<string, number>>({})
  const [storedPaddingLeft, setStoredPaddingLeft] = useState<number | undefined>(undefined)
  const [currentPaddingLeft, setCurrentPaddingLeft] = useState<number>(0)

  // Derive snaps from synced data (convert SnapData to Snap type)
  // Memoized to prevent unnecessary re-renders of SnapsDisplay
  const snaps: Snap[] = useMemo(() => {
    return (snapsData?.snaps || []).map(snapData => ({
      id: snapData.id,
      name: snapData.name,
      imageUrl: snapData.imageUrl,
      top: snapData.top,
      left: snapData.left,
      width: snapData.width,
      height: snapData.height,
    }))
  }, [snapsData?.snaps])

  // Pen priority: pen always wins, ignore other inputs for 200ms after last pen event
  const lastPenEventTimeRef = useRef<number>(0)

  // Canvas width matches paper width exactly including padding
  // Paper element for portal (canvas renders directly into #paper)
  const [paperElement, setPaperElement] = useState<HTMLElement | null>(null)

  // Main element for snaps portal (snaps need to overflow paper boundaries)
  const [mainElement, setMainElement] = useState<HTMLElement | null>(null)

  const [paperWidth, setPaperWidth] = useState(1280) // Fixed paper width

  // Get paper element for portal and measure its width
  useEffect(() => {
    const paper = document.getElementById('paper')
    if (paper) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Getting DOM element
      setPaperElement(paper)

      setPaperWidth(paper.getBoundingClientRect().width)

      // Ensure paper has position:relative for absolute canvas positioning
      paper.style.position = 'relative'

      // Also get main element for snaps portal (snaps need to overflow paper)
      const main = paper.closest('main')
      if (main) {
        setMainElement(main)
        main.style.position = 'relative'
      }
    }
  }, [viewportWidth])

  // Track annotating state in ref for event handlers (avoids stale closure issues)
  const isAnnotatingRef = useRef(false)
  useEffect(() => {
    isAnnotatingRef.current = mode !== 'view' || stylusModeActive
  }, [mode, stylusModeActive])

  // Add annotation-active class to paper when in draw/erase mode (prevents text selection on iOS Safari)
  useEffect(() => {
    const paper = document.getElementById('paper')
    if (!paper) return

    const isAnnotating = mode !== 'view' || stylusModeActive

    if (isAnnotating) {
      paper.classList.add('annotation-active')
    } else {
      paper.classList.remove('annotation-active')
    }

    return () => {
      paper.classList.remove('annotation-active')
    }
  }, [mode, stylusModeActive])

  // Prevent selection globally when annotating (capture phase for all touch/pointer events)
  useEffect(() => {
    const preventSelection = (e: Event) => {
      if (isAnnotatingRef.current) {
        e.preventDefault()
        return false
      }
    }

    // Track pen events to block associated touch events
    // On iOS Safari, pen input triggers BOTH pointer AND touch events
    // We need to block the touch events that occur immediately after pen events
    const preventDefaultForPen = (e: PointerEvent) => {
      if (!isAnnotatingRef.current) return

      // Update pen timestamp when pen is used
      if (e.pointerType === 'pen') {
        lastPenEventTimeRef.current = Date.now()
      }

      // Only prevent for pen/stylus, allow touch/mouse through for scrolling
      if (e.pointerType !== 'pen') return

      const target = e.target as Element
      // Only prevent on canvas or when target is inside paper
      if (target?.tagName === 'CANVAS' || target?.closest('#paper')) {
        e.preventDefault()
      }
    }

    // Block touch events that occur immediately after pen events
    // This prevents the "phantom scroll" when pen touches the screen
    const preventTouchDuringPen = (e: TouchEvent) => {
      if (!isAnnotatingRef.current) return

      const timeSinceLastPen = Date.now() - lastPenEventTimeRef.current
      // If a touch event happens within 300ms of pen activity, block it
      // This is likely a touch event triggered by the pen itself, not a finger
      if (timeSinceLastPen < 300) {
        const target = e.target as Element
        if (target?.tagName === 'CANVAS' || target?.closest('#paper')) {
          e.preventDefault()
        }
      }
    }

    document.addEventListener('selectstart', preventSelection, true)
    document.addEventListener('pointerdown', preventDefaultForPen, { capture: true, passive: false })
    document.addEventListener('pointermove', preventDefaultForPen, { capture: true, passive: false })
    document.addEventListener('pointerup', preventDefaultForPen, { capture: true, passive: false })
    // Block touch events that occur during/after pen events to prevent scroll
    document.addEventListener('touchstart', preventTouchDuringPen, { capture: true, passive: false })
    document.addEventListener('touchmove', preventTouchDuringPen, { capture: true, passive: false })

    return () => {
      document.removeEventListener('selectstart', preventSelection, true)
      document.removeEventListener('pointerdown', preventDefaultForPen, true)
      document.removeEventListener('pointermove', preventDefaultForPen, true)
      document.removeEventListener('pointerup', preventDefaultForPen, true)
      document.removeEventListener('touchstart', preventTouchDuringPen, true)
      document.removeEventListener('touchmove', preventTouchDuringPen, true)
    }
  }, [])

  // Handle pen state changes from canvas - this is more reliable than document-level listeners
  // because pen events are captured by the canvas via setPointerCapture
  const handlePenStateChange = useCallback((active: boolean) => {
    setPenActive(active)
  }, [])


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
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Loading stored state
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
          // eslint-disable-next-line react-hooks/set-state-in-effect -- Loading stored state
          setHasAnnotations(true)

          setCanvasData(annotationData.canvasData)

          setStoredHeadingOffsets(annotationData.headingOffsets || {})
          setStoredPaddingLeft(annotationData.paddingLeft)
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
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Initializing state
      setStoredHeadingOffsets(currentOffsets)
    }
  }, [headingPositions, storedHeadingOffsets])

  // Apply repositioning when heading positions or padding change (only if needed)
  useEffect(() => {
    if (!canvasData || headingPositions.length === 0 || Object.keys(storedHeadingOffsets).length === 0) return

    try {
      const strokes: StrokeData[] = JSON.parse(canvasData)
      if (strokes.length === 0) return

      // Check if repositioning is needed
      const currentOffsets = Object.fromEntries(
        headingPositions.map(h => [h.sectionId, h.offsetY])
      )

      // Only reposition if stored offsets differ from current offsets OR padding changed
      const needsVerticalReposition = Object.keys(storedHeadingOffsets).some(
        key => storedHeadingOffsets[key] !== currentOffsets[key]
      )
      const needsHorizontalReposition = storedPaddingLeft !== undefined &&
        Math.abs(currentPaddingLeft - storedPaddingLeft) > 1 // Allow 1px tolerance

      if (needsVerticalReposition || needsHorizontalReposition) {
        const result = repositionStrokes(
          strokes,
          headingPositions,
          storedHeadingOffsets,
          currentPaddingLeft,
          storedPaddingLeft
        )
        // eslint-disable-next-line react-hooks/set-state-in-effect -- Repositioning stored data
        setCanvasData(JSON.stringify(result.strokes))

        setOrphanedStrokesCount(result.orphanedCount)
        // Update stored values so we don't reposition again

        setStoredHeadingOffsets(currentOffsets)
        setStoredPaddingLeft(currentPaddingLeft)
      }
    } catch (error) {
      console.error('Error checking repositioning:', error)
    }
  }, [headingPositions, storedHeadingOffsets, canvasData, currentPaddingLeft, storedPaddingLeft])

  // Helper function to recalculate heading positions and paper dimensions
  const recalculateHeadingPositions = useCallback(() => {
    if (!contentRef.current) return

    // Get full paper dimensions including padding
    const paperElement = document.getElementById('paper')
    if (paperElement) {
      setPageHeight(paperElement.offsetHeight)

      // Also recalculate paper dimensions when content changes
      const paperRect = paperElement.getBoundingClientRect()
      const style = window.getComputedStyle(paperElement)

      const paddingLeft = parseFloat(style.paddingLeft) || 0

      // Track current padding for horizontal repositioning
      setCurrentPaddingLeft(paddingLeft)

      setPaperWidth(paperRect.width)
    }

    // Query for all headings with data-section-id (from h1, h2, h3 elements)
    const headingElements = contentRef.current.querySelectorAll<HTMLElement>('[data-section-id]')
    const positions: HeadingPosition[] = []

    headingElements.forEach((element) => {
      const sectionId = element.getAttribute('data-section-id')
      const headingText = element.getAttribute('data-heading-text')

      if (sectionId) {
        // Get the heading element's position relative to paper element (not contentRef)
        const rect = element.getBoundingClientRect()
        const paperRect = paperElement!.getBoundingClientRect()
        // Offset from top of paper (including top padding)
        const offsetY = rect.top - paperRect.top

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
        pageVersion,
        paddingLeft: currentPaddingLeft
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
  }, [canvasData, pageVersion, headingPositions, currentPaddingLeft, updateAnnotationData])

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
  }, [performSave, headingPositions])

  // Handle clear all annotations
  const handleClearAll = useCallback(async () => {
    try {
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
  }, [deleteAnnotationData])

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

  // Handle snap capture - save directly with base64 URL
  // The sync service will persist to IndexedDB/PostgreSQL
  // S3 upload can be added later as background optimization
  const handleSnapCapture = useCallback((snap: Snap) => {
    setMode('view') // Return to view mode immediately

    // Save snap directly - imageUrl is already base64 from canvas capture
    const newSnap = {
      id: snap.id,
      name: snap.name,
      imageUrl: snap.imageUrl, // base64 data URL
      top: snap.top,
      left: snap.left,
      width: snap.width,
      height: snap.height,
    }
    const currentSnaps = snapsData?.snaps || []
    updateSnapsData({ snaps: [...currentSnaps, newSnap] })
  }, [snapsData, updateSnapsData])

  // Handle snap removal - just remove from synced data
  const handleRemoveSnap = useCallback((id: string) => {
    const currentSnaps = snapsData?.snaps || []

    // Remove from synced data
    updateSnapsData({ snaps: currentSnaps.filter(snap => snap.id !== id) })
  }, [snapsData, updateSnapsData])

  // Handle snap rename
  const handleRenameSnap = useCallback((id: string, newName: string) => {
    const currentSnaps = snapsData?.snaps || []
    updateSnapsData({
      snaps: currentSnaps.map(snap =>
        snap.id === id ? { ...snap, name: newName } : snap
      )
    })
  }, [snapsData, updateSnapsData])

  // Handle snap reorder
  const handleReorderSnaps = useCallback((reorderedSnaps: Snap[]) => {
    // Convert Snap[] to SnapData[]
    const reorderedSnapData = reorderedSnaps.map(snap => ({
      id: snap.id,
      name: snap.name,
      imageUrl: snap.imageUrl,
      top: snap.top,
      left: snap.left,
      width: snap.width,
      height: snap.height,
    }))
    updateSnapsData({ snaps: reorderedSnapData })
  }, [updateSnapsData])

  // Handle stylus detection
  const handleStylusDetected = useCallback(() => {
    // Update pen timestamp for priority system
    lastPenEventTimeRef.current = Date.now()

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
        lastPenEventTimeRef.current = Date.now()
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

  // Keep updating pen timestamp while drawing (stylus mode active)
  // This is handled directly in the canvas event handlers for better performance
  // Removed document-level listener to avoid overhead on every pointermove event

  // Document-level mouse detection when stylus mode is active
  useEffect(() => {
    if (!stylusModeActive) return // Only listen when stylus mode IS active

    let hasSwitched = false

    const handleDocumentMouseMove = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') {
        const now = Date.now()
        const timeSinceLastPen = now - lastPenEventTimeRef.current

        // Pen has priority - ignore mouse events for 500ms after last pen event
        // (increased from 200ms for better iPad Safari compatibility)
        if (timeSinceLastPen < 500) {
          return
        }

        // Pen cooldown expired - allow mouse to switch mode (only once)
        if (!hasSwitched) {
          hasSwitched = true
          setStylusModeActive(false)
          setMode('view')
        }
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
  // Helper function to apply zoom transform using RAF (no re-renders)
  // With native scroll, we only need to handle zoom - scroll is handled by browser
  const applyZoom = useCallback((newZoom: number, focalX?: number, focalY?: number) => {
    const oldZoom = zoomRef.current
    zoomRef.current = newZoom

    // Cancel any pending RAF
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current)
    }

    // Apply transform in next frame
    rafIdRef.current = requestAnimationFrame(() => {
      if (mainRef.current) {
        mainRef.current.style.transform = `scale(${newZoom})`
      }

      // Adjust scroll position to keep focal point stationary
      if (scrollContainerRef.current && focalX !== undefined && focalY !== undefined) {
        const container = scrollContainerRef.current
        const containerRect = container.getBoundingClientRect()

        // Convert client coordinates to container-relative coordinates
        const relativeX = focalX - containerRect.left
        const relativeY = focalY - containerRect.top

        // Find the content point under the focal point (in unscaled coordinates)
        const contentX = (relativeX + container.scrollLeft) / oldZoom
        const contentY = (relativeY + container.scrollTop) / oldZoom

        // Calculate new scroll so the same content point stays under the focal point
        const newScrollX = contentX * newZoom - relativeX
        const newScrollY = contentY * newZoom - relativeY

        container.scrollLeft = Math.max(0, newScrollX)
        container.scrollTop = Math.max(0, newScrollY)
      }

      rafIdRef.current = null
    })
  }, [])

  // Handle zoom reset
  const handleResetZoom = useCallback(() => {
    applyZoom(1.0)
    setZoom(1.0)
    // Scroll to top
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0
    }
  }, [applyZoom])

  // Custom pinch-zoom handling (native scroll handles single-finger pan)
  const handleTouchStart = useCallback((e: TouchEvent) => {
    // Track all touches
    for (let i = 0; i < e.touches.length; i++) {
      const touch = e.touches[i]
      touchesRef.current.set(touch.identifier, { x: touch.clientX, y: touch.clientY })
    }

    // Two touches - start pinch zoom and prevent browser zoom
    if (e.touches.length === 2) {
      e.preventDefault() // Prevent browser zoom

      const container = scrollContainerRef.current
      if (!container) return

      const containerRect = container.getBoundingClientRect()
      const touch1 = e.touches[0]
      const touch2 = e.touches[1]
      const distance = Math.hypot(touch2.clientX - touch1.clientX, touch2.clientY - touch1.clientY)
      const centerX = (touch1.clientX + touch2.clientX) / 2
      const centerY = (touch1.clientY + touch2.clientY) / 2

      // Convert pinch center to container-relative coordinates
      const relativeX = centerX - containerRect.left
      const relativeY = centerY - containerRect.top

      // Calculate the content point under the initial pinch center (in unscaled coordinates)
      // This point should stay under the fingers throughout the gesture
      const contentX = (relativeX + container.scrollLeft) / zoomRef.current
      const contentY = (relativeY + container.scrollTop) / zoomRef.current

      initialPinchDistanceRef.current = distance
      initialPinchCenterRef.current = { x: centerX, y: centerY }
      initialContentPointRef.current = { x: contentX, y: contentY }
      initialZoomRef.current = zoomRef.current
    }
  }, [])

  const handleTouchMove = useCallback((e: TouchEvent) => {
    // Update touch positions
    for (let i = 0; i < e.touches.length; i++) {
      const touch = e.touches[i]
      touchesRef.current.set(touch.identifier, { x: touch.clientX, y: touch.clientY })
    }

    // Handle pinch zoom (2 fingers) - single-finger is handled by native scroll
    if (e.touches.length === 2 && initialPinchDistanceRef.current !== null && initialContentPointRef.current !== null) {
      e.preventDefault() // Prevent browser zoom during pinch

      const container = scrollContainerRef.current
      if (!container) return

      const containerRect = container.getBoundingClientRect()
      const touch1 = e.touches[0]
      const touch2 = e.touches[1]
      const currentDistance = Math.hypot(touch2.clientX - touch1.clientX, touch2.clientY - touch1.clientY)
      const currentCenterX = (touch1.clientX + touch2.clientX) / 2
      const currentCenterY = (touch1.clientY + touch2.clientY) / 2

      // Calculate zoom factor relative to initial state
      const zoomFactor = currentDistance / initialPinchDistanceRef.current
      const newZoom = Math.max(0.5, Math.min(2.5, initialZoomRef.current * zoomFactor))

      // Convert current pinch center to container-relative coordinates
      const relativeX = currentCenterX - containerRect.left
      const relativeY = currentCenterY - containerRect.top

      // Calculate scroll position to keep the initial content point under the current pinch center
      // Formula: contentPoint * newZoom - relativePosition = newScroll
      const newScrollX = initialContentPointRef.current.x * newZoom - relativeX
      const newScrollY = initialContentPointRef.current.y * newZoom - relativeY

      // Apply transform and scroll synchronously (no RAF) for smooth gesture handling
      zoomRef.current = newZoom
      if (mainRef.current) {
        mainRef.current.style.transform = `scale(${newZoom})`
      }
      container.scrollLeft = Math.max(0, newScrollX)
      container.scrollTop = Math.max(0, newScrollY)
    }
  }, [])

  const handleTouchEnd = useCallback((e: TouchEvent) => {
    // Remove ended touches
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i]
      touchesRef.current.delete(touch.identifier)
    }

    // Reset pinch state when less than 2 touches remain
    if (e.touches.length < 2) {
      // Update display zoom state when pinch gesture ends
      if (initialPinchDistanceRef.current !== null) {
        setZoom(zoomRef.current)
      }
      initialPinchDistanceRef.current = null
      initialPinchCenterRef.current = null
      initialContentPointRef.current = null
    }
  }, [])

  // Track whether Ctrl/Cmd is pressed for conditional wheel capture
  const ctrlPressedRef = useRef(false)

  // Handle trackpad pinch zoom (Ctrl+wheel) - only active when Ctrl is pressed
  const handleZoomWheel = useCallback((e: WheelEvent) => {
    e.preventDefault()

    // Calculate zoom delta (negative deltaY means zoom in)
    const delta = -e.deltaY * 0.01
    const newZoom = Math.max(0.5, Math.min(2.5, zoomRef.current * (1 + delta)))

    // Apply zoom with focal point at cursor position
    applyZoom(newZoom, e.clientX, e.clientY)

    // Update display state for child components
    setZoom(newZoom)
  }, [applyZoom])

  // Dynamically attach/detach wheel handler based on Ctrl key state
  // This allows normal scroll to be completely passive (no jank)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !ctrlPressedRef.current) {
        ctrlPressedRef.current = true
        document.addEventListener('wheel', handleZoomWheel, { passive: false })
      }
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey && ctrlPressedRef.current) {
        ctrlPressedRef.current = false
        document.removeEventListener('wheel', handleZoomWheel)
      }
    }

    // Also handle blur (user switches windows while Ctrl pressed)
    const handleBlur = () => {
      if (ctrlPressedRef.current) {
        ctrlPressedRef.current = false
        document.removeEventListener('wheel', handleZoomWheel)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', handleBlur)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', handleBlur)
      document.removeEventListener('wheel', handleZoomWheel)
    }
  }, [handleZoomWheel])

  // Find and store reference to parent <main> element, scroll container, and initialize transform
  useEffect(() => {
    if (!contentRef.current) return

    mainRef.current = contentRef.current.closest('main')
    scrollContainerRef.current = document.getElementById('scroll-container')

    if (!mainRef.current) return

    // Set transform properties once - scale only, no translate (scroll handles panning)
    mainRef.current.style.transformOrigin = 'top left'
    mainRef.current.style.transition = 'none'
    mainRef.current.style.transform = `scale(${zoomRef.current})`
  }, [])


  // Set up event listeners for touch pinch zoom (wheel zoom is handled via Ctrl key listener)
  useEffect(() => {
    // Touch events for touchscreen pinch zoom
    document.addEventListener('touchstart', handleTouchStart, { passive: false })
    document.addEventListener('touchmove', handleTouchMove, { passive: false })
    document.addEventListener('touchend', handleTouchEnd, { passive: false })
    document.addEventListener('touchcancel', handleTouchEnd, { passive: false })

    return () => {
      document.removeEventListener('touchstart', handleTouchStart)
      document.removeEventListener('touchmove', handleTouchMove)
      document.removeEventListener('touchend', handleTouchEnd)
      document.removeEventListener('touchcancel', handleTouchEnd)
    }
  }, [handleTouchStart, handleTouchMove, handleTouchEnd])

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

      {/* Content wrapper */}
      <div ref={contentRef} style={{ position: 'relative' }}>
        {children}
      </div>

      {/* Canvas portaled directly into #paper - always matches paper bounds */}
      {paperElement && pageHeight > 0 && createPortal(
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            // Width is determined by left:0 + right:0, not explicit value
            height: pageHeight,
            // Always capture events when in draw/erase mode or stylus mode
            pointerEvents: (mode !== 'view' || stylusModeActive) ? 'auto' : 'none',
            // CRITICAL: When pen is actively drawing, disable touch actions to prevent scroll
            // When pen is not drawing, allow touch scrolling
            touchAction: penActive ? 'none' : 'auto',
            zIndex: 10
          }}
        >
          <SimpleCanvas
            ref={canvasRef}
            width={paperWidth}
            height={pageHeight}
            mode={mode === 'view' ? 'view' : (mode as DrawMode)}
            onUpdate={handleCanvasUpdate}
            initialData={canvasData}
            strokeColor={penColors[activePen]}
            strokeWidth={penSizes[activePen]}
            stylusModeActive={stylusModeActive}
            onStylusDetected={handleStylusDetected}
            onNonStylusInput={handleNonStylusInput}
            onPenStateChange={handlePenStateChange}
            zoom={zoom}
            headingPositions={headingPositions}
          />
        </div>,
        paperElement
      )}

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
        onResetZoom={handleResetZoom}
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

      {/* Snap overlay - shown when in snap mode */}
      {mode === 'snap' && (
        <SnapOverlay
          onCapture={handleSnapCapture}
          onCancel={() => setMode('view')}
          nextSnapNumber={snaps.length + 1}
          zoom={zoom}
        />
      )}

      {/* Snaps display - portaled into main so snaps can overflow paper boundaries */}
      {mainElement && createPortal(
        <SnapsDisplay
          snaps={snaps}
          onRemoveSnap={handleRemoveSnap}
          onRenameSnap={handleRenameSnap}
          onReorderSnaps={handleReorderSnaps}
          zoom={zoom}
        />,
        mainElement
      )}
    </>
  )
}
