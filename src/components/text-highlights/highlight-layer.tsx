'use client'

import { useRef, useEffect, useCallback, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { nanoid } from 'nanoid'
import { useSyncedUserData } from '@/lib/userdata'
import type { TextHighlightsData, TextHighlightColor, TextHighlight } from '@/lib/text-highlights/types'
import { anchorHighlight, extractContext, findSectionId } from '@/lib/text-highlights/anchoring'
import { applyHighlightMark, removeHighlightMark, clearAllHighlightMarks } from '@/lib/text-highlights/rendering'

const HIGHLIGHT_COLORS: TextHighlightColor[] = ['yellow', 'green', 'blue', 'pink']

/** CSS class for the toolbar swatch dots (matches CSS variables in globals.css) */
const COLOR_SWATCH_CLASSES: Record<TextHighlightColor, string> = {
  yellow: 'bg-[--text-highlight-swatch-yellow]',
  green: 'bg-[--text-highlight-swatch-green]',
  blue: 'bg-[--text-highlight-swatch-blue]',
  pink: 'bg-[--text-highlight-swatch-pink]',
}

interface HighlightLayerProps {
  pageId: string
  children: ReactNode
}

type ToolbarMode =
  | { type: 'create'; x: number; y: number }
  | null

/**
 * Text highlighting layer. Sits inside AnnotationWrapper and adds
 * the ability to select prose text and highlight it with colored marks.
 * Data persists via useSyncedUserData (IndexedDB + server sync).
 */
export function HighlightLayer({ pageId, children }: HighlightLayerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const { data, updateData } = useSyncedUserData<TextHighlightsData>(
    pageId,
    'text-highlights',
    { highlights: [] },
  )
  const dataRef = useRef(data)
  useEffect(() => {
    dataRef.current = data
  }, [data])

  const [toolbar, setToolbar] = useState<ToolbarMode>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const [hoveredHighlightId, setHoveredHighlightId] = useState<string | null>(null)

  // Find the article root (closest article.prose-theme ancestor)
  const getArticleRoot = useCallback((): Element | null => {
    return containerRef.current?.closest('article.prose-theme') ?? containerRef.current
  }, [])

  // Re-anchor and render all highlights
  const renderHighlights = useCallback(() => {
    const root = getArticleRoot()
    if (!root || !data) return

    clearAllHighlightMarks(root)

    for (const highlight of data.highlights) {
      const range = anchorHighlight(highlight, root)
      if (range) {
        applyHighlightMark(range, highlight)
      }
    }
  }, [data, getArticleRoot])

  // Render highlights after data loads/changes, with delay for hydration
  useEffect(() => {
    const timer = setTimeout(renderHighlights, 200)
    return () => clearTimeout(timer)
  }, [renderHighlights])

  // Check if a node is inside a code block or editor
  const isInsideCodeBlock = useCallback((node: Node): boolean => {
    let el: Element | null =
      node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
    while (el) {
      const tag = el.tagName
      if (tag === 'PRE' || tag === 'CODE' || tag === 'CODE-EDITOR') return true
      el = el.parentElement
    }
    return false
  }, [])

  // Handle text selection (pointerup)
  useEffect(() => {
    const handlePointerUp = (e: PointerEvent) => {
      // Ignore clicks on the toolbar itself
      if (toolbarRef.current?.contains(e.target as Node)) return

      const selection = window.getSelection()
      if (!selection || selection.isCollapsed || !selection.rangeCount) {
        setToolbar(null)
        return
      }

      const range = selection.getRangeAt(0)
      const selectedText = range.toString().trim()
      if (!selectedText) {
        setToolbar(null)
        return
      }

      // Refuse to highlight inside code blocks
      if (isInsideCodeBlock(range.startContainer) || isInsideCodeBlock(range.endContainer)) {
        setToolbar(null)
        return
      }

      // Make sure selection is within our container
      if (!containerRef.current?.contains(range.commonAncestorContainer)) {
        setToolbar(null)
        return
      }

      // Position toolbar above the selection
      const rect = range.getBoundingClientRect()
      setToolbar({
        type: 'create',
        x: rect.left + rect.width / 2,
        y: rect.top,
      })
    }

    document.addEventListener('pointerup', handlePointerUp)
    return () => document.removeEventListener('pointerup', handlePointerUp)
  }, [isInsideCodeBlock])

  // Track hover over highlight marks
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleMouseOver = (e: MouseEvent) => {
      const mark = (e.target as HTMLElement).closest?.('mark.text-highlight')
      if (mark) {
        setHoveredHighlightId((mark as HTMLElement).dataset.highlightId ?? null)
      }
    }

    const handleMouseOut = (e: MouseEvent) => {
      const related = e.relatedTarget as HTMLElement | null
      // Only clear if we're not moving to another mark with the same id or to the delete button
      if (related?.closest?.('mark.text-highlight') || related?.closest?.('.highlight-delete-btn')) return
      setHoveredHighlightId(null)
    }

    container.addEventListener('mouseover', handleMouseOver)
    container.addEventListener('mouseout', handleMouseOut)
    return () => {
      container.removeEventListener('mouseover', handleMouseOver)
      container.removeEventListener('mouseout', handleMouseOut)
    }
  }, [])

  // Dismiss toolbar on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setToolbar(null)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Create a highlight from the current selection
  const createHighlight = useCallback(
    (color: TextHighlightColor) => {
      const selection = window.getSelection()
      if (!selection || selection.isCollapsed || !selection.rangeCount) return

      const range = selection.getRangeAt(0)
      const text = range.toString()
      if (!text.trim()) return

      const articleRoot = getArticleRoot()
      if (!articleRoot) return

      const { prefix, suffix } = extractContext(range, articleRoot)
      const sectionId = findSectionId(range.startContainer)

      const highlight: TextHighlight = {
        id: nanoid(),
        text,
        prefix,
        suffix,
        sectionId,
        color,
        createdAt: Date.now(),
      }

      const current = dataRef.current ?? { highlights: [] }
      updateData({ highlights: [...current.highlights, highlight] })

      // Apply immediately
      const newRange = anchorHighlight(highlight, articleRoot)
      if (newRange) {
        applyHighlightMark(newRange, highlight)
      }

      selection.removeAllRanges()
      setToolbar(null)
    },
    [getArticleRoot, updateData],
  )

  // Remove a highlight
  const deleteHighlight = useCallback(
    (id: string) => {
      removeHighlightMark(id)
      const current = dataRef.current ?? { highlights: [] }
      updateData({
        highlights: current.highlights.filter((h) => h.id !== id),
      })
      setToolbar(null)
    },
    [updateData],
  )

  return (
    <div ref={containerRef}>
      {children}
      {toolbar &&
        createPortal(
          <FloatingToolbar
            ref={toolbarRef}
            position={toolbar}
            onSelectColor={createHighlight}
            onDismiss={() => setToolbar(null)}
          />,
          document.body,
        )}
      {hoveredHighlightId &&
        createPortal(
          <HighlightDeleteButton
            highlightId={hoveredHighlightId}
            onDelete={deleteHighlight}
            onMouseEnter={() => setHoveredHighlightId(hoveredHighlightId)}
            onMouseLeave={() => setHoveredHighlightId(null)}
          />,
          document.body,
        )}
    </div>
  )
}

// --- Floating Toolbar (color picker on text selection) ---

import { forwardRef } from 'react'

interface FloatingToolbarProps {
  position: { x: number; y: number }
  onSelectColor: (color: TextHighlightColor) => void
  onDismiss: () => void
}

const FloatingToolbar = forwardRef<HTMLDivElement, FloatingToolbarProps>(
  function FloatingToolbar({ position, onSelectColor, onDismiss }, ref) {
    const style: React.CSSProperties = {
      position: 'fixed',
      left: position.x,
      top: position.y - 8,
      transform: 'translate(-50%, -100%)',
      zIndex: 9999,
    }

    return (
      <div
        role="presentation"
        className="fixed inset-0 z-[9998]"
        onClick={(e) => {
          if (e.target === e.currentTarget) onDismiss()
        }}
      >
        <div
          ref={ref}
          style={style}
          className="flex items-center gap-1.5 rounded-lg border border-border bg-popover px-2 py-1.5 shadow-lg"
        >
          {HIGHLIGHT_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              className={`h-5 w-5 rounded-full border border-black/10 dark:border-white/10 transition-transform hover:scale-125 focus:outline-none focus:ring-2 focus:ring-ring ${COLOR_SWATCH_CLASSES[color]}`}
              title={`Highlight ${color}`}
              onClick={() => onSelectColor(color)}
            />
          ))}
        </div>
      </div>
    )
  },
)

// --- Delete button (appears on highlight hover) ---

interface HighlightDeleteButtonProps {
  highlightId: string
  onDelete: (id: string) => void
  onMouseEnter: () => void
  onMouseLeave: () => void
}

function HighlightDeleteButton({ highlightId, onDelete, onMouseEnter, onMouseLeave }: HighlightDeleteButtonProps) {
  // Find the first mark element for this highlight to position the button
  const mark = document.querySelector(`mark[data-highlight-id="${CSS.escape(highlightId)}"]`)
  if (!mark) return null

  const rect = mark.getBoundingClientRect()

  return (
    <button
      type="button"
      className="highlight-delete-btn fixed flex items-center justify-center h-4 w-4 rounded-full border border-muted-foreground/30 bg-background/80 text-muted-foreground/50 hover:border-red-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors shadow-sm"
      style={{
        left: rect.right - 4,
        top: rect.top - 4,
        zIndex: 9997,
      }}
      title="Remove highlight"
      onClick={() => onDelete(highlightId)}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <line x1="1.5" y1="1.5" x2="6.5" y2="6.5" />
        <line x1="6.5" y1="1.5" x2="1.5" y2="6.5" />
      </svg>
    </button>
  )
}
