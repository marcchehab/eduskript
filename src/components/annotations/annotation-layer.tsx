'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { SimpleCanvas, type SimpleCanvasHandle, type DrawMode } from './simple-canvas'
import { AnnotationToolbar, type AnnotationMode } from './annotation-toolbar'
import {
  getPageAnnotations,
  savePageAnnotations,
  clearPageAnnotations,
  generateContentHash,
  checkVersionMismatch,
  type SectionAnnotation
} from '@/lib/indexeddb/annotations'

interface ContentSection {
  id: string
  headingText: string
  element: HTMLElement
}

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
  const [sections, setSections] = useState<ContentSection[]>([])
  const [sectionData, setSectionData] = useState<Map<string, string>>(new Map())
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
  const canvasRefs = useRef<Map<string, React.MutableRefObject<SimpleCanvasHandle | null>>>(new Map())
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const isClearingRef = useRef(false)

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

  // Load annotations from IndexedDB
  useEffect(() => {
    if (!pageId) return

    console.log('Loading annotations for page:', pageId)
    getPageAnnotations(pageId).then(pageAnnotation => {
      console.log('Loaded page annotation:', pageAnnotation)
      if (pageAnnotation && pageAnnotation.sections.length > 0) {
        setHasAnnotations(true)
        const dataMap = new Map<string, string>()
        pageAnnotation.sections.forEach(section => {
          console.log('Loading section:', section.sectionId, 'with data length:', section.canvasData.length)
          dataMap.set(section.sectionId, section.canvasData)
        })
        setSectionData(dataMap)
        console.log('Set section data map with', dataMap.size, 'entries')
      } else {
        console.log('No annotations found')
      }
    })
  }, [pageId])

  // Find section elements in the DOM (after markdown renders)
  useEffect(() => {
    if (!contentRef.current) return

    const timer = setTimeout(() => {
      if (!contentRef.current) return

      // Query for all section elements with data-section-id
      const sectionElements = contentRef.current.querySelectorAll<HTMLElement>('[data-section-id]')
      const newSections: ContentSection[] = []

      sectionElements.forEach((element) => {
        const sectionId = element.getAttribute('data-section-id')
        const headingText = element.getAttribute('data-heading-text')

        if (sectionId) {
          newSections.push({
            id: sectionId,
            headingText: headingText || '',
            element
          })

          // Create canvas ref if it doesn't exist
          if (!canvasRefs.current.has(sectionId)) {
            canvasRefs.current.set(sectionId, { current: null })
          }
        }
      })

      setSections(newSections)
    }, 500) // Wait for markdown to render

    return () => clearTimeout(timer)
  }, [children]) // Re-run when children change (markdown re-renders)

  // Function to perform the actual save
  const performSave = useCallback(async () => {
    // Don't save if we're in the middle of clearing
    if (isClearingRef.current) {
      console.log('Skipping save - clearing in progress')
      return
    }

    try {
      // Collect all section data
      const allSections: SectionAnnotation[] = []

      console.log('Starting save, checking', sections.length, 'sections')
      sections.forEach(section => {
        const data = sectionData.get(section.id)
        console.log('Section', section.id, 'has data:', data ? 'yes (' + data.length + ' chars)' : 'no')
        if (data) {
          try {
            const paths = JSON.parse(data)
            if (paths && paths.length > 0) {
              console.log('Adding section', section.id, 'with', paths.length, 'paths to save')
              allSections.push({
                sectionId: section.id,
                headingText: section.headingText,
                canvasData: data,
                createdAt: Date.now(),
                updatedAt: Date.now()
              })
            }
          } catch (error) {
            console.error('Error parsing section data:', error)
          }
        }
      })

      // Calculate aggregate statistics across all sections
      let totalPaths = 0
      let totalPoints = 0
      let totalSizeBytes = 0

      allSections.forEach(section => {
        try {
          const paths = JSON.parse(section.canvasData)
          totalPaths += paths.length
          paths.forEach((path: { points: Array<unknown> }) => {
            totalPoints += path.points.length
          })
          totalSizeBytes += new Blob([section.canvasData]).size
        } catch (error) {
          console.error('Error calculating section stats:', error)
        }
      })

      const totalSizeKB = (totalSizeBytes / 1024).toFixed(2)
      console.log(`📊 TOTAL across all canvases: ${allSections.length} sections, ${totalPaths} paths, ${totalPoints} points, ${totalSizeKB} KB`)

      console.log('Saving', allSections.length, 'sections to IndexedDB for page', pageId, 'version', pageVersion)
      if (allSections.length > 0) {
        await savePageAnnotations(pageId, pageVersion, allSections)
        console.log('Save completed successfully')
      } else {
        console.log('No sections to save')
      }
    } catch (error) {
      console.error('Error saving annotations:', error)
    }
  }, [pageId, pageVersion, sections, sectionData])

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

  // Handle section annotation update with debounced save
  const handleSectionUpdate = useCallback((sectionId: string, data: string) => {
    // Reset clearing flag when user starts drawing again
    isClearingRef.current = false

    // Update local state immediately
    setSectionData(prev => {
      const newMap = new Map(prev)
      newMap.set(sectionId, data)
      return newMap
    })

    // Check if there's actual data
    try {
      const paths = JSON.parse(data)
      const hasData = paths && paths.length > 0

      // Update hasAnnotations based on whether any section has data
      setSectionData(prev => {
        const hasAnyData = Array.from(prev.values()).some(d => {
          try {
            const p = JSON.parse(d)
            return p && p.length > 0
          } catch {
            return false
          }
        })
        setHasAnnotations(hasAnyData || hasData)
        return prev
      })

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
  }, [pageId, pageVersion, sections, sectionData, performSave])

  // Handle clear all annotations
  const handleClearAll = useCallback(async () => {
    try {
      console.log('Clearing annotations, found', canvasRefs.current.size, 'canvas refs')

      // Set flag to prevent any saves during/after clear operation
      isClearingRef.current = true

      // Cancel any pending save operations to prevent re-saving old data
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
        saveTimeoutRef.current = null
      }

      // Clear state first to prevent re-initialization
      setSectionData(new Map())
      setHasAnnotations(false)
      setVersionMismatch(false)

      // Clear database
      await clearPageAnnotations(pageId)

      // Clear all canvases
      for (const [sectionId, canvasRef] of canvasRefs.current.entries()) {
        console.log('Canvas ref for section', sectionId, ':', canvasRef.current)
        if (canvasRef.current) {
          canvasRef.current.clear()
        }
      }
    } catch (error) {
      console.error('Error clearing annotations:', error)
    }
  }, [pageId])

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

      {/* Wrapper for section detection and main element reference */}
      <div ref={contentRef}>
        {children}

        {/* Render canvases into section elements using portals */}
        {sections.map(section => {
          const canvasRef = canvasRefs.current.get(section.id)
          if (!canvasRef || !section.element) return null

          const initialData = sectionData.get(section.id)
          console.log('Rendering canvas for section', section.id, 'with initialData:', initialData ? initialData.substring(0, 50) + '...' : 'none')
          return createPortal(
            <SimpleCanvas
              key={section.id}
              ref={canvasRef}
              width={CANVAS_WIDTH_PX}
              height={section.element.offsetHeight}
              mode={mode === 'view' ? 'view' : (mode as DrawMode)}
              onUpdate={(data) => handleSectionUpdate(section.id, data)}
              initialData={initialData}
              strokeColor={penColors[activePen]}
              strokeWidth={penSizes[activePen]}
              eraserWidth={eraserSize}
              stylusModeActive={stylusModeActive}
              onStylusDetected={handleStylusDetected}
              onNonStylusInput={handleNonStylusInput}
              zoom={zoom}
            />,
            section.element
          )
        })}
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
