'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
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
  const [canvasSize, setCanvasSize] = useState<{ width: number; height: number } | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<SimpleCanvasHandle>(null)
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const initialDataRef = useRef<string | undefined>(undefined)

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

  // Load annotations from IndexedDB (once)
  useEffect(() => {
    if (!pageId) return

    getPageAnnotations(pageId).then(pageAnnotation => {
      if (pageAnnotation && pageAnnotation.sections.length > 0) {
        setHasAnnotations(true)
        const firstSection = pageAnnotation.sections[0]
        if (firstSection && firstSection.canvasData) {
          initialDataRef.current = firstSection.canvasData
        }
      }
    })
  }, [pageId])

  // Measure content size once after mount
  useEffect(() => {
    if (!contentRef.current) return

    // Wait for content to render
    const timer = setTimeout(() => {
      if (contentRef.current) {
        const rect = contentRef.current.getBoundingClientRect()
        setCanvasSize({
          width: Math.ceil(rect.width),
          height: Math.ceil(contentRef.current.scrollHeight)
        })
      }
    }, 100)

    return () => clearTimeout(timer)
  }, []) // Only run once on mount

  // Handle canvas updates with debounced save
  const handleCanvasUpdate = useCallback((data: string) => {
    // Clear existing timeout
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }

    // Check if there's actual data
    try {
      const paths = JSON.parse(data)
      if (!paths || paths.length === 0) {
        setHasAnnotations(false)
        return
      }

      setHasAnnotations(true)

      // Debounce save by 2 seconds
      saveTimeoutRef.current = setTimeout(async () => {
        try {
          const section: SectionAnnotation = {
            sectionId: 'full-page',
            headingText: 'Full Page',
            canvasData: data,
            createdAt: Date.now(),
            updatedAt: Date.now()
          }

          await savePageAnnotations(pageId, pageVersion, [section])
        } catch (error) {
          console.error('Error saving annotations:', error)
        }
      }, 2000)
    } catch (error) {
      console.error('Error parsing canvas data:', error)
    }
  }, [pageId, pageVersion])

  // Handle clear all annotations
  const handleClearAll = useCallback(async () => {
    try {
      await clearPageAnnotations(pageId)
      canvasRef.current?.clear()
      setHasAnnotations(false)
      setVersionMismatch(false)
    } catch (error) {
      console.error('Error clearing annotations:', error)
    }
  }, [pageId])

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

      {/* Content with canvas overlay */}
      <div ref={contentRef} className="relative">
        {children}

        {/* Canvas overlay */}
        {canvasSize && (
          <SimpleCanvas
            ref={canvasRef}
            width={canvasSize.width}
            height={canvasSize.height}
            mode={mode === 'view' ? 'view' : (mode as DrawMode)}
            onUpdate={handleCanvasUpdate}
            initialData={initialDataRef.current}
          />
        )}
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
