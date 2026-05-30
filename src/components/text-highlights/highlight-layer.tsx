'use client'

import { useRef, useEffect, useCallback, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { nanoid } from 'nanoid'
import { Trash2 } from 'lucide-react'
import { useSyncedUserData } from '@/lib/userdata'
import type { TextHighlightsData, TextHighlight } from '@/lib/text-highlights/types'
import { anchorHighlight, extractContext, findSectionId } from '@/lib/text-highlights/anchoring'
import { applyHighlightMark, removeHighlightMark, clearAllHighlightMarks } from '@/lib/text-highlights/rendering'
import { useHighlightPen } from './highlight-pen-context'
import { highlighterCursor } from '@/lib/text-highlights/cursor'
import { HIGHLIGHT_ERASE_EVENT, HIGHLIGHT_ERASE_END_EVENT, pointHitsRect, type HighlightEraseDetail } from '@/lib/text-highlights/erase-events'
import { createLogger } from '@/lib/logger'

const log = createLogger('text-highlights:layer')

interface HighlightLayerProps {
  pageId: string
  children: ReactNode
}

/**
 * Text highlighting layer. Sits inside AnnotationWrapper and renders saved
 * highlights over prose, anchored by prefix/suffix/sectionId so they survive
 * reflow. Data persists via useSyncedUserData (IndexedDB + server sync).
 *
 * Highlights are created by the **highlighter pen**: when a highlighter pen is
 * active (its colour broadcast via HighlightPenContext), selecting text
 * auto-creates a highlight in that colour — no popup. Removal is a hover-bin on
 * each highlight. (This replaced the old select→colour-panel flow.)
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

  // The active highlighter pen's colour (null when no highlighter is active).
  const activeHighlightColor = useHighlightPen()
  const activeColorRef = useRef(activeHighlightColor)
  useEffect(() => {
    activeColorRef.current = activeHighlightColor
  }, [activeHighlightColor])

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
      if (range) applyHighlightMark(range, highlight)
    }
  }, [data, getArticleRoot])

  // Render highlights after data loads/changes, with delay for hydration
  useEffect(() => {
    const timer = setTimeout(renderHighlights, 200)
    return () => clearTimeout(timer)
  }, [renderHighlights])

  // While a highlighter pen is active, show the tinted highlighter cursor over
  // the content (the drawing canvas is inert in 'highlight' mode, so text is
  // selectable and this cursor shows).
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    el.style.cursor = activeHighlightColor ? highlighterCursor(activeHighlightColor) : ''
    return () => {
      el.style.cursor = ''
    }
  }, [activeHighlightColor])

  // Reject selections that touch a code block or editor.
  const isInsideCodeBlock = useCallback((node: Node): boolean => {
    let el: Element | null =
      node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
    while (el) {
      if (el.tagName === 'PRE' || el.classList.contains('cm-editor')) return true
      el = el.parentElement
    }
    return false
  }, [])

  const savedRangeRef = useRef<Range | null>(null)

  // Create a highlight from a saved range in the given colour.
  const createHighlight = useCallback(
    (color: string) => {
      const range = savedRangeRef.current
      if (!range) return
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
      log('createHighlight', { id: highlight.id, color, text })

      const current = dataRef.current ?? { highlights: [] }
      updateData({ highlights: [...current.highlights, highlight] })

      const newRange = anchorHighlight(highlight, articleRoot)
      if (newRange) applyHighlightMark(newRange, highlight)

      window.getSelection()?.removeAllRanges()
      savedRangeRef.current = null
    },
    [getArticleRoot, updateData],
  )

  // Selection → auto-highlight (only when a highlighter pen is active). We
  // create on pointer-UP — not mid-drag — so the highlight lands only once the
  // selection is finished. A touch fallback covers iOS, where the selection is
  // finalised (via selectionchange) shortly AFTER the finger lifts.
  const isPressedRef = useRef(false)
  const selectionDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    const tryCreate = () => {
      const color = activeColorRef.current
      if (!color) return
      const selection = window.getSelection()
      if (!selection || selection.isCollapsed || !selection.rangeCount) return
      const range = selection.getRangeAt(0)
      if (!range.toString().trim()) return
      if (isInsideCodeBlock(range.startContainer) || isInsideCodeBlock(range.endContainer)) return
      if (!containerRef.current?.contains(range.commonAncestorContainer)) return
      savedRangeRef.current = range.cloneRange()
      createHighlight(color)
    }
    const onPointerDown = () => { isPressedRef.current = true }
    const onPointerUp = () => {
      isPressedRef.current = false
      if (!activeColorRef.current) return
      // Let the browser finalise the selection after the release.
      setTimeout(tryCreate, 0)
    }
    // Touch fallback: selection settles after release; create when not pressed.
    const onSelectionChange = () => {
      if (!activeColorRef.current || isPressedRef.current) return
      if (selectionDebounceRef.current) clearTimeout(selectionDebounceRef.current)
      selectionDebounceRef.current = setTimeout(tryCreate, 50)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('pointerup', onPointerUp, true)
    document.addEventListener('selectionchange', onSelectionChange)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('pointerup', onPointerUp, true)
      document.removeEventListener('selectionchange', onSelectionChange)
      if (selectionDebounceRef.current) clearTimeout(selectionDebounceRef.current)
    }
  }, [isInsideCodeBlock, createHighlight])

  // Remove a highlight
  const deleteHighlight = useCallback(
    (id: string) => {
      removeHighlightMark(id)
      const current = dataRef.current ?? { highlights: [] }
      updateData({ highlights: current.highlights.filter((h) => h.id !== id) })
    },
    [updateData],
  )

  // Eraser support: the annotation eraser broadcasts each sample point along
  // its path, then an end event on lift. Like the stroke eraser, we dim hit
  // highlights during the swipe and commit the deletion on lift.
  const erasingRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    const onErasePoint = (e: Event) => {
      const { x, y, radius } = (e as CustomEvent<HighlightEraseDetail>).detail
      const root = getArticleRoot()
      if (!root) return
      const marks = root.querySelectorAll<HTMLElement>('mark.text-highlight[data-highlight-id]')
      // A highlight crossing inline elements (e.g. a bold word) renders as
      // several fragments sharing one id. Note every newly-hit id...
      marks.forEach((m) => {
        if (!pointHitsRect(x, y, m.getBoundingClientRect(), radius)) return
        const id = m.dataset.highlightId
        if (id) erasingRef.current.add(id)
      })
      // ...then dim ALL fragments of every marked id, so the preview matches
      // what the commit will delete.
      marks.forEach((m) => {
        if (m.dataset.highlightId && erasingRef.current.has(m.dataset.highlightId)) {
          m.style.opacity = '0.3'
        }
      })
    }
    const onEraseEnd = () => {
      const ids = erasingRef.current
      if (ids.size === 0) return
      ids.forEach((id) => removeHighlightMark(id))
      const current = dataRef.current ?? { highlights: [] }
      updateData({ highlights: current.highlights.filter((h) => !ids.has(h.id)) })
      erasingRef.current = new Set()
    }
    window.addEventListener(HIGHLIGHT_ERASE_EVENT, onErasePoint)
    window.addEventListener(HIGHLIGHT_ERASE_END_EVENT, onEraseEnd)
    return () => {
      window.removeEventListener(HIGHLIGHT_ERASE_EVENT, onErasePoint)
      window.removeEventListener(HIGHLIGHT_ERASE_END_EVENT, onEraseEnd)
    }
  }, [getArticleRoot, updateData])

  // Hover-bin removal: hovering a highlight shows a bin at its top-right.
  const [hoverBin, setHoverBin] = useState<{ id: string; top: number; left: number } | null>(null)
  const binHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancelHideBin = () => {
    if (binHideTimer.current) clearTimeout(binHideTimer.current)
    binHideTimer.current = null
  }
  const scheduleHideBin = () => {
    cancelHideBin()
    binHideTimer.current = setTimeout(() => setHoverBin(null), 250)
  }
  const handleMouseOver = (e: React.MouseEvent) => {
    const mark = (e.target as HTMLElement).closest?.('mark.text-highlight') as HTMLElement | null
    const id = mark?.dataset.highlightId
    if (mark && id) {
      cancelHideBin()
      const r = mark.getBoundingClientRect()
      setHoverBin({ id, top: r.top, left: r.right })
    }
  }
  const handleMouseOut = (e: React.MouseEvent) => {
    const to = e.relatedTarget as HTMLElement | null
    if (to?.closest?.('mark.text-highlight') || to?.dataset?.highlightBin) return
    scheduleHideBin()
  }

  return (
    <div ref={containerRef} onMouseOver={handleMouseOver} onMouseOut={handleMouseOut}>
      {children}
      {hoverBin &&
        createPortal(
          <button
            type="button"
            data-highlight-bin="true"
            title="Remove highlight"
            onMouseEnter={cancelHideBin}
            onMouseLeave={scheduleHideBin}
            onClick={() => {
              deleteHighlight(hoverBin.id)
              setHoverBin(null)
            }}
            className="fixed flex h-6 w-6 items-center justify-center rounded-full border border-border bg-popover text-muted-foreground shadow-md transition-colors hover:text-red-500 hover:bg-red-100 dark:hover:bg-red-950/40"
            style={{ top: hoverBin.top, left: hoverBin.left, transform: 'translate(-50%, -50%)', zIndex: 46 }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>,
          document.body,
        )}
    </div>
  )
}
