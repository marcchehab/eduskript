'use client'

import { useEffect, useLayoutEffect, useMemo, useRef, useCallback } from 'react'
import { EditorView, basicSetup } from 'codemirror'
import { EditorState } from '@codemirror/state'
import { unifiedMergeView, rejectChunk, getChunks } from '@codemirror/merge'
import { markdown } from '@codemirror/lang-markdown'
import { oneDark } from '@codemirror/theme-one-dark'
import { useTheme } from 'next-themes'
import { Button } from '@/components/ui/button'
import { XCircle, Check } from 'lucide-react'
import { normalizeContent } from '@/lib/ai/normalize-content'

interface MergeEditorProps {
  original: string
  proposed: string
  onChange: (content: string) => void
  className?: string
}

export function MergeEditor({ original, proposed, onChange, className = '' }: MergeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  // Store onChange in a ref to avoid recreating the editor when it changes
  const onChangeRef = useRef(onChange)
  useLayoutEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === 'dark'

  // Normalize defensively — content from older jobs (or any source that
  // bypassed the backend normalization step) might still have CRLF / trailing
  // whitespace / decomposed unicode, which makes the diff explode into
  // spurious chunks.
  const normalizedOriginal = useMemo(() => normalizeContent(original), [original])
  const normalizedProposed = useMemo(() => normalizeContent(proposed), [proposed])
  const isNoop = normalizedOriginal === normalizedProposed

  // Reject all remaining chunks. Defensive loop: if the chunk count stops
  // decreasing (because rejectChunk returned false on a problematic chunk),
  // bail out instead of looping until the safety limit. Same pattern would
  // apply to "accept all" if we surfaced one — but we don't, since the
  // proposed text is the editor's starting state (everything already kept).
  const handleRejectAll = useCallback(() => {
    if (!viewRef.current) return
    const view = viewRef.current

    let lastChunkCount = -1
    let safety = 1000
    while (safety-- > 0) {
      const chunks = getChunks(view.state)
      if (!chunks || chunks.chunks.length === 0) break
      // Non-progress guard: if the chunk count didn't drop after the last
      // reject, the next reject won't either — stop instead of spinning.
      if (chunks.chunks.length === lastChunkCount) break
      lastChunkCount = chunks.chunks.length
      const ok = rejectChunk(view, chunks.chunks[0].fromB)
      if (!ok) break
    }

    onChangeRef.current(view.state.doc.toString())
  }, [])

  useEffect(() => {
    if (!containerRef.current) return

    // Clean up previous view
    if (viewRef.current) {
      viewRef.current.destroy()
      viewRef.current = null
    }

    // Skip building the editor entirely when there's nothing to diff. The
    // "no changes" panel below renders instead.
    if (isNoop) return

    // Create unified merge view.
    //   doc      = proposed (AI's suggested text)
    //   original = current page content (the revert target)
    // The proposed text is the starting state, so by default ALL suggestions
    // are kept. The gutter buttons let the user revert individual chunks.
    const view = new EditorView({
      parent: containerRef.current,
      state: EditorState.create({
        doc: normalizedProposed,
        extensions: [
          basicSetup,
          markdown(),
          isDark ? oneDark : [],
          EditorView.lineWrapping,
          EditorView.theme({
            '&': {
              fontSize: '13px',
              height: '100%',
            },
            '.cm-scroller': {
              fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
              overflow: 'auto',
            },
            '.cm-content': {
              minHeight: '200px',
            },
            '.cm-gutters': {
              backgroundColor: isDark ? '#1e1e1e' : '#f5f5f5',
              borderRight: isDark ? '1px solid #333' : '1px solid #ddd',
            },
          }),
          unifiedMergeView({
            original: normalizedOriginal,
            mergeControls: true,
            highlightChanges: true,
            gutter: true,
            // Default scanLimit (500) makes the Myers diff give up on larger
            // rewrites and fall back to an imprecise algorithm that can clip
            // a few lines off the edges of the deletion block. Markdown pages
            // routinely exceed that in a single AI rewrite. Raise it so the
            // precise diff actually runs. Complexity is quadratic in the
            // scan window, so we don't remove the cap entirely.
            diffConfig: { scanLimit: 10_000 },
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              onChangeRef.current(update.state.doc.toString())
            }
          }),
        ],
      }),
    })

    viewRef.current = view

    return () => {
      view.destroy()
    }
  }, [normalizedOriginal, normalizedProposed, isNoop, isDark])

  // Hand the normalized proposed text up on mount/change so the parent
  // doesn't save the pre-normalization version when there's no diff.
  useEffect(() => {
    if (isNoop) onChangeRef.current(normalizedProposed)
  }, [isNoop, normalizedProposed])

  if (isNoop) {
    return (
      <div className={`flex flex-col ${className}`}>
        <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/30">
          <Check className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
          <span className="text-xs text-muted-foreground">
            No changes — the AI returned content identical to the current page.
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className={`flex flex-col ${className}`}>
      {/* Toolbar — note that "accept" is the *default*: the editor starts
          with the AI's suggested text. The user only needs to act if they
          want to revert something. */}
      <div className="flex items-center gap-2 px-2 py-1.5 border-b bg-muted/30">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleRejectAll}
          className="h-7 text-xs gap-1.5 text-red-600 hover:text-red-700 hover:bg-red-100 dark:text-red-400 dark:hover:bg-red-900/30"
        >
          <XCircle className="h-3.5 w-3.5" />
          Revert all to original
        </Button>
        <span className="text-xs text-muted-foreground ml-auto">
          Suggestions are kept by default — use the gutter buttons to revert individual changes.
        </span>
      </div>

      {/* Editor */}
      <div
        ref={containerRef}
        className="flex-1 overflow-hidden border-0"
      />
    </div>
  )
}

/**
 * Simple editor for new pages (no merge controls needed)
 */
interface SimpleEditorProps {
  content: string
  onChange: (content: string) => void
  className?: string
}

export function SimpleEditor({ content, onChange, className = '' }: SimpleEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  useLayoutEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  const { resolvedTheme } = useTheme()

  const isDark = resolvedTheme === 'dark'

  useEffect(() => {
    if (!containerRef.current) return

    if (viewRef.current) {
      viewRef.current.destroy()
    }

    const view = new EditorView({
      parent: containerRef.current,
      state: EditorState.create({
        doc: content,
        extensions: [
          basicSetup,
          markdown(),
          isDark ? oneDark : [],
          EditorView.lineWrapping,
          EditorView.theme({
            '&': {
              fontSize: '13px',
              height: '100%',
            },
            '.cm-scroller': {
              fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
              overflow: 'auto',
            },
            '.cm-content': {
              minHeight: '200px',
            },
            '.cm-gutters': {
              backgroundColor: isDark ? '#1e1e1e' : '#f5f5f5',
              borderRight: isDark ? '1px solid #333' : '1px solid #ddd',
            },
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              onChangeRef.current(update.state.doc.toString())
            }
          }),
        ],
      }),
    })

    viewRef.current = view

    return () => {
      view.destroy()
    }
  }, [content, isDark])

  return (
    <div className={`flex flex-col ${className}`}>
      <div className="flex items-center gap-2 px-2 py-1.5 border-b bg-green-50 dark:bg-green-900/20">
        <span className="text-xs text-green-700 dark:text-green-300 font-medium">
          New page - edit content below
        </span>
      </div>
      <div
        ref={containerRef}
        className="flex-1 overflow-hidden"
      />
    </div>
  )
}
