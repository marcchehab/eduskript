'use client'

import React, { useState, useEffect, useLayoutEffect, useRef, useDeferredValue, memo, useMemo, type ReactNode } from 'react'
import { compileMarkdown } from '@/lib/markdown-compiler'
import { createMarkdownComponents } from '@/lib/markdown-components'
import { createSkriptFiles, createEmptySkriptFiles, type SkriptFilesData } from '@/lib/skript-files'
import type { VideoInfo } from '@/lib/skript-files'
import { EagerImageLoader } from './eager-image-loader'

interface MarkdownRendererProps {
  content: string
  fileList?: Array<{ id: string; name: string; url?: string }>
  videoList?: VideoInfo[]
  pageId?: string
  skriptId?: string
  onContentChange?: (newContent: string) => void
  onExcalidrawEdit?: (filename: string, fileId: string) => void
}

// Inner component that does the actual rendering
function MarkdownRendererInner({ content, fileList, videoList, pageId, onContentChange, onExcalidrawEdit }: MarkdownRendererProps) {
  // Create SkriptFiles from the file list
  const files: SkriptFilesData = useMemo(() => {
    if (fileList && fileList.length > 0) {
      return createSkriptFiles(fileList, videoList)
    }
    return createEmptySkriptFiles()
  }, [fileList, videoList])

  // Defer content updates so typing doesn't block
  const deferredContent = useDeferredValue(content)

  const [renderedContent, setRenderedContent] = useState<React.ReactNode>(null)
  const [error, setError] = useState<string | null>(null)
  const [isInitialLoad, setIsInitialLoad] = useState(true)
  const scrollPositionRef = useRef(0)
  const hasRestoredScroll = useRef(false)
  const processingRef = useRef(0)

  // Capture scroll position before any DOM changes
  useLayoutEffect(() => {
    const scrollContainer = document.getElementById('markdown-preview-scroll-container')
    if (scrollContainer) {
      scrollPositionRef.current = scrollContainer.scrollTop
    }
  })

  useEffect(() => {
    // Increment generation to cancel any in-flight processing
    const currentGeneration = ++processingRef.current

    const processContent = async () => {
      // Early bail-out if already superseded
      if (currentGeneration !== processingRef.current) return

      // Debounce - wait 150ms and check again
      await new Promise(resolve => setTimeout(resolve, 150))
      if (currentGeneration !== processingRef.current) return

      try {
        setError(null)

        // Create components with files and editor callbacks bound
        const components = createMarkdownComponents(files, {
          pageId,
          onContentChange,
          onExcalidrawEdit,
          content: deferredContent,
        })

        // Compile markdown using safe unified pipeline (no JS execution)
        const rendered = await compileMarkdown(deferredContent, { components })

        // Bail out if a newer generation started
        if (currentGeneration !== processingRef.current) return

        // Set rendered content
        setRenderedContent(rendered as ReactNode)
        setIsInitialLoad(false)
        hasRestoredScroll.current = false
      } catch (err) {
        console.error('Markdown rendering error:', err)
        setError(String(err))
        setIsInitialLoad(false)
      }
    }

    processContent()
  }, [deferredContent, files, pageId, onContentChange, onExcalidrawEdit])

  // Restore scroll position after DOM updates
  useLayoutEffect(() => {
    if (!hasRestoredScroll.current && renderedContent) {
      const scrollContainer = document.getElementById('markdown-preview-scroll-container')
      if (scrollContainer && scrollPositionRef.current > 0) {
        scrollContainer.scrollTop = scrollPositionRef.current
        hasRestoredScroll.current = true
      }
    }
  }, [renderedContent])

  // Add click-to-copy functionality for heading links
  useEffect(() => {
    if (!renderedContent) return

    const handleHeadingClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      const headingLink = target.closest('a.heading-link')

      if (headingLink && headingLink instanceof HTMLAnchorElement) {
        e.preventDefault()

        const headingId = headingLink.getAttribute('href')
        if (headingId) {
          const fullUrl = `${window.location.origin}${window.location.pathname}${headingId}`

          navigator.clipboard.writeText(fullUrl).then(() => {
            const tempSpan = document.createElement('span')
            tempSpan.style.fontSize = '0.8em'
            tempSpan.style.marginLeft = '0.5rem'
            tempSpan.style.color = 'hsl(142.1, 76.2%, 36.3%)'
            tempSpan.textContent = ' ✓ Copied!'
            headingLink.appendChild(tempSpan)

            setTimeout(() => {
              tempSpan.remove()
            }, 2000)
          }).catch((err) => {
            console.error('Failed to copy link:', err)
          })
        }
      }
    }

    document.addEventListener('click', handleHeadingClick)

    return () => {
      document.removeEventListener('click', handleHeadingClick)
    }
  }, [renderedContent])

  if (isInitialLoad && !renderedContent) {
    return (
      <div className="markdown-content prose dark:prose-invert max-w-none">
        <div className="animate-pulse space-y-4">
          <div className="h-4 bg-muted rounded w-3/4"></div>
          <div className="h-4 bg-muted rounded w-1/2"></div>
          <div className="h-4 bg-muted rounded w-5/6"></div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-destructive p-4 border border-destructive rounded-md">
        <p className="font-semibold">Markdown Rendering Error</p>
        <p className="text-sm mt-2">{error}</p>
      </div>
    )
  }

  return (
    <EagerImageLoader>
      <div className="markdown-content prose dark:prose-invert max-w-none">
        {renderedContent}
      </div>
    </EagerImageLoader>
  )
}

// Custom comparison function for memo
function arePropsEqual(prevProps: MarkdownRendererProps, nextProps: MarkdownRendererProps): boolean {
  // Always re-render if content changed
  if (prevProps.content !== nextProps.content) return false

  // Compare context by meaningful fields
  if (prevProps.pageId !== nextProps.pageId) return false
  if (prevProps.skriptId !== nextProps.skriptId) return false

  // Compare fileList length
  const prevFileCount = prevProps.fileList?.length ?? 0
  const nextFileCount = nextProps.fileList?.length ?? 0
  if (prevFileCount !== nextFileCount) return false

  // Compare videoList length
  const prevVideoCount = prevProps.videoList?.length ?? 0
  const nextVideoCount = nextProps.videoList?.length ?? 0
  if (prevVideoCount !== nextVideoCount) return false

  return true
}

// Memoized export
export const MarkdownRenderer = memo(MarkdownRendererInner, arePropsEqual)
MarkdownRenderer.displayName = 'MarkdownRenderer'
