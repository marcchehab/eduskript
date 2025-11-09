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
  const canvasRefs = useRef<Map<string, React.MutableRefObject<SimpleCanvasHandle | null>>>(new Map())
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const isClearingRef = useRef(false)

  // Canvas width is 1.5x content width
  // Content is max-w-3xl (48rem = 768px)
  const CONTENT_WIDTH_REM = 48
  const CANVAS_WIDTH_REM = CONTENT_WIDTH_REM * 1.5 // 72rem = 1152px
  const CANVAS_WIDTH_PX = CANVAS_WIDTH_REM * 16 // 1152px
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

  // Handle stylus detection
  const handleStylusDetected = useCallback(() => {
    if (!stylusModeActive) {
      console.log('Stylus detected - activating stylus mode')
      setStylusModeActive(true)
    }
    // Always switch to draw mode when stylus is detected
    if (mode !== 'draw') {
      console.log('Stylus detected - switching to draw mode')
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

      {/* Content with section canvas portals */}
      <div ref={contentRef}>
        {children}

        {/* Render canvases into section elements using portals */}
        {sections.map(section => {
          const canvasRef = canvasRefs.current.get(section.id)
          if (!canvasRef || !section.element) return null

          const initialData = sectionData.get(section.id)
          console.log('Rendering canvas for section', section.id, 'with initialData:', initialData ? initialData.substring(0, 50) + '...' : 'none')
          return createPortal(
            <div
              key={section.id}
              className="canvas-section-wrapper"
              style={{
                position: 'absolute',
                top: 0,
                left: `-${MARGIN_EXTENSION_REM}rem`,
                width: `${CANVAS_WIDTH_REM}rem`,
                height: '100%',
                pointerEvents: 'none', // Always allow events to pass through to canvas
                zIndex: 10
              }}
            >
              <SimpleCanvas
                ref={canvasRef}
                width={CANVAS_WIDTH_PX}
                height={section.element.offsetHeight}
                mode={mode === 'view' ? 'view' : (mode as DrawMode)}
                onUpdate={(data) => handleSectionUpdate(section.id, data)}
                initialData={initialData}
                strokeColor={penColors[activePen]}
                strokeWidth={penSizes[activePen]}
                stylusModeActive={stylusModeActive}
                onStylusDetected={handleStylusDetected}
                onNonStylusInput={handleNonStylusInput}
              />
            </div>,
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
      />
    </>
  )
}
