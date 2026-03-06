'use client'

import React, { useState, useEffect, useLayoutEffect, useRef, useDeferredValue, useCallback, memo, useMemo, type ReactNode } from 'react'
import { compileMarkdown } from '@/lib/markdown-compiler'
import { createMarkdownComponents } from '@/lib/markdown-components'
import { createSkriptFiles, createEmptySkriptFiles, type SkriptFilesData } from '@/lib/skript-files'
import type { VideoInfo } from '@/lib/skript-files'
import { EagerImageLoader } from './eager-image-loader'

interface MarkdownRendererProps {
  content: string
  fileList?: Array<{ id: string; name: string; url?: string; updatedAt?: string | Date; width?: number; height?: number }>
  videoList?: VideoInfo[]
  pageId?: string
  skriptId?: string
  onContentChange?: (newContent: string) => void
  onExcalidrawEdit?: (filename: string, fileId: string) => void
}

// Inner component that does the actual rendering
function MarkdownRendererInner({ content, fileList, videoList, pageId, skriptId, onContentChange, onExcalidrawEdit }: MarkdownRendererProps) {
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

  // Refs for values that change every keystroke — keeps the components memo stable
  const contentRef = useRef(deferredContent)
  const onContentChangeRef = useRef(onContentChange)
  const onExcalidrawEditRef = useRef(onExcalidrawEdit)

  // Sync refs after render (useEffect to satisfy react-hooks/refs lint rule)
  useEffect(() => {
    contentRef.current = deferredContent
    onContentChangeRef.current = onContentChange
    onExcalidrawEditRef.current = onExcalidrawEdit
  })

  // Stable callback: find/replace image markdown in content, then notify parent.
  // Reads from refs so it always sees the latest content and callback.
  const stableOnImageWidthChange = useCallback((srcForMatching: string, newMarkdown: string) => {
    const currentContent = contentRef.current
    const notify = onContentChangeRef.current
    if (!notify || !currentContent || !srcForMatching) return

    const escapedSrc = srcForMatching.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const baseName = srcForMatching.replace(/\.excalidraw$/, '')
    const escapedBaseName = baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

    const imageComponentPattern = new RegExp(`<img[^>]*src="${escapedSrc}"[^>]*/?>`, 'g')
    const excaliPattern = new RegExp(`<excali[^>]*src="${escapedBaseName}"[^>]*/?>`, 'g')
    const markdownPattern = new RegExp(`!\\[([^\\]]*)\\]\\(${escapedSrc}\\)(\\{[^}]*\\})?`, 'g')

    let newContent = currentContent
    if (excaliPattern.test(currentContent)) {
      newContent = currentContent.replace(excaliPattern, newMarkdown)
    } else if (imageComponentPattern.test(currentContent)) {
      newContent = currentContent.replace(imageComponentPattern, newMarkdown)
    } else {
      newContent = currentContent.replace(markdownPattern, newMarkdown)
    }

    if (newContent !== currentContent) {
      notify(newContent)
    }
  }, [])

  const stableOnExcalidrawEdit = useCallback((filename: string, fileId: string) => {
    onExcalidrawEditRef.current?.(filename, fileId)
  }, [])

  // Memoize the components map — only recreated when files or pageId change.
  // Callbacks are stable (empty deps) so they don't bust the memo.
  // The callbacks read refs internally but only when invoked from event handlers,
  // never during the useMemo computation itself.
  const components = useMemo(() => {
    // eslint-disable-next-line react-hooks/refs -- callbacks read refs in event handlers, not during render
    return createMarkdownComponents(files, {
      pageId,
      skriptId,
      onImageWidthChange: stableOnImageWidthChange,
      onExcalidrawEdit: stableOnExcalidrawEdit,
    })
  }, [files, pageId, skriptId, stableOnImageWidthChange, stableOnExcalidrawEdit])

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
  }, [deferredContent, components])

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
            // Dismiss any existing indicator so rapid clicks don't stack
            const existing = document.querySelector('.copied-float-indicator')
            if (existing) existing.remove()

            // Compute position: centre above the heading link
            const rect = headingLink.getBoundingClientRect()

            const indicator = document.createElement('div')
            indicator.className = 'copied-float-indicator'
            indicator.textContent = '✓ Link copied'
            indicator.style.left = `${rect.left + rect.width / 2}px`
            indicator.style.top = `${rect.top - 8}px`
            document.body.appendChild(indicator)

            // Remove after animation completes (matches --copied-float-duration)
            setTimeout(() => indicator.remove(), 1600)
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

  // Re-render when fileList reference changes (refreshFileList creates a new array)
  if (prevProps.fileList !== nextProps.fileList) return false

  // Compare videoList length
  const prevVideoCount = prevProps.videoList?.length ?? 0
  const nextVideoCount = nextProps.videoList?.length ?? 0
  if (prevVideoCount !== nextVideoCount) return false

  return true
}

// Memoized export
export const MarkdownRenderer = memo(MarkdownRendererInner, arePropsEqual)
MarkdownRenderer.displayName = 'MarkdownRenderer'
