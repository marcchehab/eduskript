'use client'

import { useEffect, useState, useRef } from 'react'
import { useTheme } from 'next-themes'
import { createRoot } from 'react-dom/client'
import { CodeEditor } from './code-editor'

interface MarkdownRendererProps {
  content: string
  domain?: string
  skriptId?: string
}

export function MarkdownRenderer({ content, domain, skriptId }: MarkdownRendererProps) {
  const [html, setHtml] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const { theme, systemTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)
  const rootsRef = useRef<Map<Element, { root: any, props: any }>>(new Map())
  const fileListRef = useRef<Array<{ id: string, name: string, url?: string, isDirectory?: boolean }>>([])

  // Get the actual theme (resolve 'system' to actual theme)
  const resolvedTheme = theme === 'system' ? systemTheme : theme

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!mounted) return

    const processMarkdown = async () => {
      try {
        // Import processMarkdown from server-side markdown processor
        const { processMarkdown: serverProcessMarkdown } = await import('@/lib/markdown')

        // Fetch files for this skript if skriptId is provided
        let fileList: Array<{ id: string, name: string, url?: string, isDirectory?: boolean }> = []

        if (skriptId) {
          try {
            console.log('[MarkdownRenderer] Fetching files for skriptId:', skriptId)
            const response = await fetch(`/api/upload?skriptId=${skriptId}`)
            console.log('[MarkdownRenderer] Response status:', response.status)
            if (response.ok) {
              const data = await response.json()
              fileList = data.files || []
              fileListRef.current = fileList // Store for lookup during hydration
              console.log('[MarkdownRenderer] Fetched files:', fileList.map(f => ({ name: f.name, url: f.url })))
            } else {
              console.error('[MarkdownRenderer] Failed to fetch files:', response.statusText)
            }
          } catch (error) {
            console.error('Error fetching files for markdown:', error)
          }
        }

        console.log('[MarkdownRenderer] Processing markdown with:', {
          contentLength: content.length,
          fileListCount: fileList.length,
          theme: resolvedTheme,
          hasSkriptId: !!skriptId,
          hasEditorKeyword: content.includes('editor'),
          contentPreview: content.substring(0, 200)
        })

        const result = await serverProcessMarkdown(content, {
          fileList,
          theme: (resolvedTheme as 'light' | 'dark') || 'light'
        })

        console.log('[MarkdownRenderer] Processed result includes code-editor:', result.content.includes('code-editor'))

        console.log('[MarkdownRenderer] Result:', {
          hasContent: !!result.content,
          contentLength: result.content.length,
          contentPreview: result.content.substring(0, 500)
        })

        setHtml(result.content)
      } catch (error) {
        console.error('Error processing markdown:', error)
        setHtml(`<p>Error rendering content</p>`)
      } finally {
        setIsLoading(false)
      }
    }

    processMarkdown()
  }, [content, domain, skriptId, resolvedTheme, mounted])

  // Hydrate code-editor custom elements
  useEffect(() => {
    if (!contentRef.current || !html) return

    // Clean up old roots
    rootsRef.current.forEach(({ root }) => {
      root.unmount()
    })
    rootsRef.current.clear()

    const codeEditorElements = contentRef.current.querySelectorAll('code-editor')
    const newRoots = new Map<Element, { root: ReturnType<typeof createRoot>, props: any }>()

    console.log('[MarkdownRenderer] Hydrating code editors, found:', codeEditorElements.length)

    codeEditorElements.forEach((element) => {
      const language = element.getAttribute('data-language') as 'python' | 'javascript' | 'sql' || 'python'
      const code = element.getAttribute('data-code') || ''
      const id = element.getAttribute('data-id')
      const showCanvas = element.getAttribute('data-show-canvas') !== 'false'
      const db = element.getAttribute('data-db') // Database name for SQL editors

      console.log('[MarkdownRenderer] Hydrating editor:', { language, hasDb: !!db, db })

      // Decode HTML entities
      const decodedCode = decodeHtmlEntities(code)

      // Look up database file URL from file list if db name is provided
      let sqlDatabaseUrl: string | undefined
      if (db && language === 'sql') {
        console.log('[MarkdownRenderer] SQL editor detected, looking up database:', {
          db,
          fileListLength: fileListRef.current.length,
          fileNames: fileListRef.current.map(f => f.name)
        })
        // Try to find file with this name (with or without extension)
        const dbFile = fileListRef.current.find(f => {
          const nameWithoutExt = f.name.replace(/\.(sqlite|db)$/i, '')
          const matches = nameWithoutExt === db || f.name === db
          console.log('[MarkdownRenderer] Checking file:', { fileName: f.name, dbParam: db, nameWithoutExt, matches })
          return matches
        })
        sqlDatabaseUrl = dbFile?.url
        console.log('[MarkdownRenderer] Database lookup result:', { db, found: !!dbFile, url: sqlDatabaseUrl, fileId: dbFile?.id })
      }

      // Create a wrapper div and replace the custom element
      const wrapper = document.createElement('div')
      element.parentNode?.replaceChild(wrapper, element)

      // Render the React component into the wrapper
      const root = createRoot(wrapper)
      const props = {
        id: id || undefined,
        language,
        initialCode: decodedCode,
        showCanvas,
        db: sqlDatabaseUrl  // Pass database URL if found
      }

      root.render(<CodeEditor {...props} />)

      // Store root and props for re-rendering on theme change
      newRoots.set(wrapper, { root, props })
    })

    // Update the ref with new roots
    rootsRef.current = newRoots

    return () => {
      // Clean up on unmount - use the captured newRoots
      newRoots.forEach(({ root }) => {
        root.unmount()
      })
      newRoots.clear()
    }
  }, [html])

  // Add click handlers for collapsible callouts
  useEffect(() => {
    if (!contentRef.current || !html) return

    const callouts = contentRef.current.querySelectorAll('blockquote.callout-foldable')

    const handleClick = (e: MouseEvent) => {
      const blockquote = e.currentTarget as HTMLElement
      const target = e.target as HTMLElement

      // Prevent toggle if clicking inside content
      if (target.closest('.callout-content')) return

      blockquote.classList.toggle('callout-folded')
    }

    callouts.forEach((callout) => {
      callout.addEventListener('click', handleClick as EventListener)
    })

    return () => {
      callouts.forEach((callout) => {
        callout.removeEventListener('click', handleClick as EventListener)
      })
    }
  }, [html])

  // Re-render all code editors when theme changes
  useEffect(() => {
    if (!mounted) return

    rootsRef.current.forEach(({ root, props }) => {
      root.render(<CodeEditor {...props} key={resolvedTheme} />)
    })
  }, [resolvedTheme, mounted])

  if (!mounted || isLoading) {
    return (
      <div className="animate-pulse">
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4 mb-2"></div>
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/2 mb-2"></div>
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-5/6"></div>
      </div>
    )
  }

  return (
    <div
      ref={contentRef}
      className="prose-theme"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

/**
 * Helper function to decode HTML entities
 */
function decodeHtmlEntities(text: string): string {
  const textarea = document.createElement('textarea')
  textarea.innerHTML = text
  return textarea.value
}
