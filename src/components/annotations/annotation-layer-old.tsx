'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { AnnotationToolbar, type AnnotationMode } from './annotation-toolbar'
import { SectionCanvas, type SectionCanvasHandle } from './section-canvas'
import {
  getPageAnnotations,
  updateSectionAnnotation,
  clearPageAnnotations,
  generateContentHash,
  checkVersionMismatch,
  type SectionAnnotation
} from '@/lib/indexeddb/annotations'

interface ContentSection {
  id: string
  headingText: string
  element: Element
  top: number
  height: number
}

interface AnnotationLayerProps {
  pageId: string
  content: string
  children: React.ReactNode
}

export function AnnotationLayer({ pageId, content, children }: AnnotationLayerProps) {
  const [mode, setMode] = useState<AnnotationMode>('view')
  const [sections, setSections] = useState<ContentSection[]>([])
  const [annotations, setAnnotations] = useState<Map<string, string>>(new Map())
  const [pageVersion, setPageVersion] = useState<string>('')
  const [versionMismatch, setVersionMismatch] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)
  const canvasRefs = useRef<Map<string, React.RefObject<SectionCanvasHandle | null>>>(new Map())
  const observerRef = useRef<ResizeObserver | null>(null)

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

    getPageAnnotations(pageId).then(pageAnnotation => {
      if (pageAnnotation) {
        const annotationMap = new Map<string, string>()
        pageAnnotation.sections.forEach(section => {
          annotationMap.set(section.sectionId, section.canvasData)
        })
        setAnnotations(annotationMap)
      }
    })
  }, [pageId])

  // Parse content into sections based on headings
  const parseContentSections = useCallback(() => {
    if (!contentRef.current) return

    const headings = contentRef.current.querySelectorAll('h1, h2, h3, h4')
    const newSections: ContentSection[] = []
    const containerRect = contentRef.current.getBoundingClientRect()

    headings.forEach((heading, index) => {
      const headingRect = heading.getBoundingClientRect()
      const nextHeading = headings[index + 1]

      // Calculate section boundaries
      const top = headingRect.top - containerRect.top
      let height: number

      if (nextHeading) {
        const nextRect = nextHeading.getBoundingClientRect()
        height = nextRect.top - headingRect.top
      } else {
        // Last section: extend to end of content
        const contentBottom = containerRect.bottom
        height = contentBottom - headingRect.top
      }

      // Generate stable section ID from heading text
      const headingText = heading.textContent || `section-${index}`
      const sectionId = `${heading.tagName.toLowerCase()}-${slugify(headingText)}-${index}`

      newSections.push({
        id: sectionId,
        headingText,
        element: heading,
        top,
        height: Math.max(height, 100) // Minimum height
      })

      // Create canvas ref if it doesn't exist
      if (!canvasRefs.current.has(sectionId)) {
        canvasRefs.current.set(sectionId, { current: null })
      }
    })

    setSections(newSections)
  }, [])

  // Set up ResizeObserver to update sections when content changes
  useEffect(() => {
    if (!contentRef.current) return

    parseContentSections()

    observerRef.current = new ResizeObserver(() => {
      parseContentSections()
    })

    observerRef.current.observe(contentRef.current)

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect()
      }
    }
  }, [parseContentSections])

  // Handle section annotation update
  const handleSectionUpdate = useCallback(async (sectionId: string, canvasData: string) => {
    const section = sections.find(s => s.id === sectionId)
    if (!section) return

    try {
      await updateSectionAnnotation(
        pageId,
        pageVersion,
        sectionId,
        section.headingText,
        canvasData
      )

      // Update local state
      setAnnotations(prev => new Map(prev).set(sectionId, canvasData))
    } catch (error) {
      console.error('Error updating section annotation:', error)
    }
  }, [pageId, pageVersion, sections])

  // Handle clear all annotations
  const handleClearAll = useCallback(async () => {
    try {
      await clearPageAnnotations(pageId)

      // Clear all canvases
      for (const [sectionId, canvasRef] of canvasRefs.current.entries()) {
        if (canvasRef.current) {
          await canvasRef.current.clear()
        }
      }

      setAnnotations(new Map())
      setVersionMismatch(false)
    } catch (error) {
      console.error('Error clearing annotations:', error)
    }
  }, [pageId])

  const hasAnnotations = annotations.size > 0

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
                <strong>Content Updated:</strong> This page has been modified since you last annotated it. Your annotations may no longer align perfectly with the content.
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

      {/* Content with annotation overlay */}
      <div ref={contentRef} className="relative">
        {children}

        {/* Canvas overlays for each section */}
        {sections.map(section => {
          const canvasRef = canvasRefs.current.get(section.id) || { current: null }

          return (
            <div
              key={section.id}
              className="absolute left-0 right-0"
              style={{
                top: `${section.top}px`,
                height: `${section.height}px`,
                pointerEvents: mode === 'view' ? 'none' : 'auto'
              }}
            >
              <SectionCanvas
                ref={canvasRef as React.RefObject<SectionCanvasHandle | null>}
                sectionId={section.id}
                mode={mode}
                initialData={annotations.get(section.id)}
                onUpdate={handleSectionUpdate}
                height={section.height}
              />
            </div>
          )
        })}
      </div>

      {/* Toolbar */}
      <AnnotationToolbar
        mode={mode}
        onModeChange={setMode}
        onClear={handleClearAll}
        hasAnnotations={hasAnnotations}
      />
    </>
  )
}

// Helper function to slugify heading text
function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
