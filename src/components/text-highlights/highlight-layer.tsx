'use client'

import { useRef, useEffect, useCallback, useState, forwardRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { nanoid } from 'nanoid'
import { Highlighter, Trash2 } from 'lucide-react'
import { useSyncedUserData } from '@/lib/userdata'
import type { TextHighlightsData, TextHighlightColor, TextHighlight } from '@/lib/text-highlights/types'
import { anchorHighlight, extractContext, findSectionId } from '@/lib/text-highlights/anchoring'
import { applyHighlightMark, removeHighlightMark, clearAllHighlightMarks } from '@/lib/text-highlights/rendering'
import { createLogger } from '@/lib/logger'

const log = createLogger('text-highlights:layer')

const HIGHLIGHT_COLORS: TextHighlightColor[] = ['yellow', 'red', 'green', 'blue', 'purple']

/** CSS class for the toolbar swatch dots (matches CSS variables in globals.css) */
const COLOR_SWATCH_CLASSES: Record<TextHighlightColor, string> = {
  yellow: 'bg-[--text-highlight-swatch-yellow]',
  red: 'bg-[--text-highlight-swatch-red]',
  green: 'bg-[--text-highlight-swatch-green]',
  blue: 'bg-[--text-highlight-swatch-blue]',
  purple: 'bg-[--text-highlight-swatch-purple]',
}

interface HighlightLayerProps {
  pageId: string
  children: ReactNode
}

/** Panel mode: creating a new highlight or editing an existing one */
type PanelMode =
  | { type: 'create' }
  | { type: 'edit'; highlightId: string; currentColor: TextHighlightColor }
  | null

/**
 * Text highlighting layer. Sits inside AnnotationWrapper and adds
 * the ability to select prose text and highlight it with colored marks.
 * Data persists via useSyncedUserData (IndexedDB + server sync).
 *
 * The color panel is pinned to the right edge of the viewport to avoid
 * fighting with native selection UI (iOS copy menu, Firefox context menu).
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

  const [panel, setPanel] = useState<PanelMode>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const savedRangeRef = useRef<Range | null>(null)

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
      if (tag === 'PRE' || tag === 'CODE' || el.classList.contains('cm-editor')) return true
      el = el.parentElement
    }
    return false
  }, [])

  // Detect text selection via selectionchange (works for all input methods
  // including iOS long-press, which finalizes the selection AFTER pointerup).
  const selectionDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const handleSelectionChange = () => {
      if (selectionDebounceRef.current) clearTimeout(selectionDebounceRef.current)

      selectionDebounceRef.current = setTimeout(() => {
        const selection = window.getSelection()
        if (!selection || selection.isCollapsed || !selection.rangeCount) {
          // Don't dismiss if panel is already showing — user might be
          // tapping a color (which clears the selection on touch devices).
          return
        }

        const range = selection.getRangeAt(0)
        const selectedText = range.toString().trim()
        if (!selectedText) return

        // Refuse to highlight inside code blocks
        if (isInsideCodeBlock(range.startContainer) || isInsideCodeBlock(range.endContainer)) return

        // Make sure selection is within our container
        if (!containerRef.current?.contains(range.commonAncestorContainer)) return

        // Save the range — on touch devices, tapping a color button clears the
        // selection before onClick fires, so we need the range preserved.
        savedRangeRef.current = range.cloneRange()
        log('selection captured', {
          text: selectedText,
          startContainerName: (range.startContainer as Element).tagName ?? '#text',
          startContainerNodeType: range.startContainer.nodeType,
          startOffset: range.startOffset,
          endContainerName: (range.endContainer as Element).tagName ?? '#text',
          endContainerNodeType: range.endContainer.nodeType,
          endOffset: range.endOffset,
          crossNode: range.startContainer !== range.endContainer,
          commonAncestorName: (range.commonAncestorContainer as Element).tagName ?? '#text',
        })
        setPanel({ type: 'create' })
      }, 200)
    }

    // Dismiss panel when tapping/clicking outside it
    const handlePointerDown = (e: PointerEvent) => {
      if (panelRef.current?.contains(e.target as Node)) return

      // Clicking an existing highlight mark → show edit panel
      const mark = (e.target as HTMLElement).closest?.('mark.text-highlight') as HTMLElement | null
      if (mark) {
        const highlightId = mark.dataset.highlightId
        if (highlightId) {
          const highlight = dataRef.current?.highlights.find((h) => h.id === highlightId)
          if (highlight) {
            setPanel({
              type: 'edit',
              highlightId,
              currentColor: highlight.color,
            })
            return
          }
        }
      }

      // Only dismiss if no text is being selected (let selectionchange handle new selections)
      const selection = window.getSelection()
      if (!selection || selection.isCollapsed) {
        savedRangeRef.current = null
        setPanel(null)
      }
    }

    document.addEventListener('selectionchange', handleSelectionChange)
    document.addEventListener('pointerdown', handlePointerDown)
    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange)
      document.removeEventListener('pointerdown', handlePointerDown)
      if (selectionDebounceRef.current) clearTimeout(selectionDebounceRef.current)
    }
  }, [isInsideCodeBlock])

  // Dismiss panel on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPanel(null)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Create a highlight from the current selection
  const createHighlight = useCallback(
    (color: TextHighlightColor) => {
      // Use saved range — on touch devices the selection is cleared before onClick fires
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

      log('createHighlight', { id: highlight.id, color, text, prefix, suffix, sectionId })

      const current = dataRef.current ?? { highlights: [] }
      updateData({ highlights: [...current.highlights, highlight] })

      // Apply immediately
      const newRange = anchorHighlight(highlight, articleRoot)
      if (newRange) {
        applyHighlightMark(newRange, highlight)
      } else {
        log.warn('createHighlight: re-anchoring returned null — mark not applied', { id: highlight.id })
      }

      window.getSelection()?.removeAllRanges()
      savedRangeRef.current = null
      setPanel(null)
    },
    [getArticleRoot, updateData],
  )

  // Change a highlight's color
  const updateHighlightColor = useCallback(
    (id: string, color: TextHighlightColor) => {
      const current = dataRef.current ?? { highlights: [] }
      updateData({
        highlights: current.highlights.map((h) =>
          h.id === id ? { ...h, color } : h,
        ),
      })
      // Update mark classes in the DOM immediately
      const marks = document.querySelectorAll(`mark[data-highlight-id="${CSS.escape(id)}"]`)
      marks.forEach((mark) => {
        HIGHLIGHT_COLORS.forEach((c) => mark.classList.remove(`text-highlight-${c}`))
        mark.classList.add(`text-highlight-${color}`)
      })
      setPanel(null)
    },
    [updateData],
  )

  // Remove a highlight
  const deleteHighlight = useCallback(
    (id: string) => {
      removeHighlightMark(id)
      const current = dataRef.current ?? { highlights: [] }
      updateData({
        highlights: current.highlights.filter((h) => h.id !== id),
      })
      setPanel(null)
    },
    [updateData],
  )

  return (
    <div ref={containerRef}>
      {children}
      {panel &&
        createPortal(
          panel.type === 'create' ? (
            <SidePanel
              ref={panelRef}
              getSourceRect={() => savedRangeRef.current?.getBoundingClientRect() ?? null}
              onSelectColor={createHighlight}
            />
          ) : (
            <SidePanel
              ref={panelRef}
              getSourceRect={() => {
                const mark = document.querySelector(`mark[data-highlight-id="${CSS.escape(panel.highlightId)}"]`)
                return mark?.getBoundingClientRect() ?? null
              }}
              currentColor={panel.currentColor}
              onSelectColor={(color) => updateHighlightColor(panel.highlightId, color)}
              onDelete={() => deleteHighlight(panel.highlightId)}
            />
          ),
          document.body,
        )}
    </div>
  )
}

// --- Side panel (vertical color picker, in #paper's right gutter when visible) ---
//
// Horizontal: aim for the visual center of #paper's right padding (96px from
// paper's right edge in unscaled coords, multiplied by the current paper
// scale). When the gutter center falls outside the viewport — i.e. the user
// has zoomed in far enough that the right padding is offscreen — the same
// clamp pins the panel to the viewport's right edge.
// Vertical: track the selection's center, clamped to keep the panel in view.
// `position: fixed` + portal to document.body keeps it in real viewport
// coords regardless of the `transform: scale()` on #paper.

const PAPER_PADDING_X = 192 // matches `.paper-responsive { @apply px-48 }` in globals.css
const VIEWPORT_MARGIN = 8

interface SidePanelProps {
  /** Function that returns the current bounding rect of the source element (selection or mark) */
  getSourceRect: () => DOMRect | null
  currentColor?: TextHighlightColor
  onSelectColor: (color: TextHighlightColor) => void
  onDelete?: () => void
}

const SidePanel = forwardRef<HTMLDivElement, SidePanelProps>(
  function SidePanel({ getSourceRect, currentColor, onSelectColor, onDelete }, ref) {
    const innerRef = useRef<HTMLDivElement>(null)
    const [pos, setPos] = useState({ left: 0, top: 0 })

    const setRefs = useCallback(
      (node: HTMLDivElement | null) => {
        innerRef.current = node
        if (typeof ref === 'function') ref(node)
        else if (ref) ref.current = node
      },
      [ref],
    )

    useEffect(() => {
      const update = () => {
        const sourceRect = getSourceRect()
        if (!sourceRect) return

        const panel = innerRef.current
        const panelW = panel?.offsetWidth ?? 0
        const panelH = panel?.offsetHeight ?? 0
        const vw = window.innerWidth
        const vh = window.innerHeight

        // Horizontal: gutter center, falling back to viewport edge when the
        // gutter is offscreen (zoomed in past it).
        const paper = document.getElementById('paper')
        const viewportRightLimit = vw - VIEWPORT_MARGIN - panelW / 2
        let desiredX = viewportRightLimit
        if (paper && paper.offsetWidth > 0) {
          const paperRect = paper.getBoundingClientRect()
          const scale = paperRect.width / paper.offsetWidth
          const gutterCenter = paperRect.right - (PAPER_PADDING_X / 2) * scale
          desiredX = Math.min(gutterCenter, viewportRightLimit)
        }
        const left = Math.max(VIEWPORT_MARGIN + panelW / 2, desiredX)

        // Vertical: selection center, clamped into viewport.
        const desiredY = sourceRect.top + sourceRect.height / 2
        const top = Math.max(
          VIEWPORT_MARGIN + panelH / 2,
          Math.min(vh - VIEWPORT_MARGIN - panelH / 2, desiredY),
        )

        setPos({ left, top })
      }
      update()

      const scrollContainer = document.getElementById('scroll-container')
      scrollContainer?.addEventListener('scroll', update)
      window.addEventListener('resize', update)
      return () => {
        scrollContainer?.removeEventListener('scroll', update)
        window.removeEventListener('resize', update)
      }
    }, [getSourceRect])

    return (
      <div
        ref={setRefs}
        className="fixed flex flex-col items-center gap-1.5 rounded-lg border border-border bg-popover p-1.5 shadow-lg select-none"
        style={{
          left: pos.left,
          top: pos.top,
          transform: 'translate(-50%, -50%)',
          zIndex: 45,
        }}
      >
        <Highlighter className="h-4 w-4 text-muted-foreground/60" />
        <div className="w-4 h-px bg-border" />
        {HIGHLIGHT_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            className={`h-6 w-6 rounded-full border transition-transform hover:scale-125 focus:outline-none focus:ring-2 focus:ring-ring ${COLOR_SWATCH_CLASSES[color]} ${
              color === currentColor
                ? 'border-foreground/50 scale-110'
                : 'border-black/10 dark:border-white/10'
            }`}
            title={currentColor ? `Change to ${color}` : `Highlight ${color}`}
            onClick={() => onSelectColor(color)}
          />
        ))}
        {onDelete && (
          <>
            <div className="w-4 h-px bg-border" />
            <button
              type="button"
              className="flex items-center justify-center h-6 w-6 rounded-full text-muted-foreground/60 hover:text-red-500 hover:bg-red-100 dark:hover:bg-red-950/40 transition-colors"
              title="Remove highlight"
              onClick={onDelete}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </>
        )}
      </div>
    )
  },
)
