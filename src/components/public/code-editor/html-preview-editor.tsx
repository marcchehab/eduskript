"use client"

import { useEffect, useRef, useState, useCallback, memo } from 'react'
import { useTheme } from 'next-themes'
import { EditorView, keymap } from '@codemirror/view'
import { EditorState, Annotation, Compartment } from '@codemirror/state'
import { indentUnit } from '@codemirror/language'
import { indentWithTab, undo } from '@codemirror/commands'
import { html } from '@codemirror/lang-html'
import { vsCodeDark } from '@fsegurai/codemirror-theme-vscode-dark'
import { vsCodeLight } from '@fsegurai/codemirror-theme-vscode-light'
import { basicSetup } from 'codemirror'
import { Play, RotateCcw, Maximize2, Minimize2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useUserData } from '@/lib/userdata/hooks'
import type { CodeEditorData } from '@/lib/userdata/types'

interface HtmlPreviewEditorProps {
  id: string
  pageId?: string
  initialCode: string
  height?: number
}

const programmaticChange = Annotation.define<boolean>()

// Spec-exact sandbox flags. Deliberately NOT including `allow-same-origin`
// (would let user code reach parent window/Eduskript cookies) or
// `allow-top-navigation` (would let it navigate the host tab away).
const IFRAME_SANDBOX = 'allow-scripts allow-modals allow-forms'
const AUTO_RUN_DEBOUNCE_MS = 500

export const HtmlPreviewEditor = memo(function HtmlPreviewEditor({
  id,
  pageId,
  initialCode,
  height = 400,
}: HtmlPreviewEditorProps) {
  const { resolvedTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const [code, setCode] = useState(initialCode)
  const [previewSrc, setPreviewSrc] = useState(initialCode)
  const [editorWidth, setEditorWidth] = useState(50)
  const [isStacked, setIsStacked] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [isDragging, setIsDragging] = useState(false)

  const editorHostRef = useRef<HTMLDivElement | null>(null)
  const editorViewRef = useRef<EditorView | null>(null)
  const themeCompartment = useRef(new Compartment())
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const dragStateRef = useRef<{ startX: number; startWidth: number } | null>(null)

  const componentId = `code-editor-${id}`
  const { data: savedData, updateData: savePersistentData, isLoading } =
    useUserData<CodeEditorData>(pageId || 'no-page', componentId, null)

  useEffect(() => { setMounted(true) }, [])

  // Stack vertically on narrow viewports (< 768px). Re-evaluate on resize.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const mq = window.matchMedia('(max-width: 767px)')
    const update = () => setIsStacked(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])

  // Sync internal `fullscreen` state with the browser's native Fullscreen API.
  // Using requestFullscreen (rather than CSS position:fixed) avoids breakage
  // when an ancestor has transform/filter/will-change — those create a new
  // containing block that stops position:fixed from being viewport-relative.
  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === wrapperRef.current)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement && wrapperRef.current) {
      wrapperRef.current.requestFullscreen().catch(() => {
        // Some browsers reject (iframe sandbox missing allow-fullscreen, etc.) —
        // silently ignore; the user can still resize the splitter.
      })
    } else if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {})
    }
  }, [])

  // Hydrate code from saved data once it loads. Falls back to markdown content.
  useEffect(() => {
    if (isLoading) return
    const stored = savedData?.files?.[0]?.content
    if (typeof stored === 'string' && stored !== code) {
      setCode(stored)
      setPreviewSrc(stored)
      // Also reflect in the open editor view if it's already mounted.
      if (editorViewRef.current) {
        const current = editorViewRef.current.state.doc.toString()
        if (current !== stored) {
          editorViewRef.current.dispatch({
            changes: { from: 0, to: current.length, insert: stored },
            annotations: programmaticChange.of(true),
          })
        }
      }
    }
    if (savedData?.editorWidth && savedData.editorWidth !== editorWidth) {
      setEditorWidth(savedData.editorWidth)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, savedData])

  // Build the editor once mounted + initial data resolved.
  useEffect(() => {
    if (!mounted || isLoading || !editorHostRef.current || editorViewRef.current) return

    const isDark = resolvedTheme === 'dark'
    const startContent = (savedData?.files?.[0]?.content ?? initialCode)

    const view = new EditorView({
      state: EditorState.create({
        doc: startContent,
        extensions: [
          basicSetup,
          keymap.of([indentWithTab, { key: 'Mod-z', run: undo }]),
          html(),
          indentUnit.of('  '),
          EditorState.tabSize.of(2),
          EditorView.lineWrapping,
          EditorView.theme({
            '&': { height: '100%', width: '100%' },
            '.cm-scroller': { overflow: 'auto' },
            '.cm-content': { paddingBottom: '2.5rem' },
          }),
          themeCompartment.current.of(isDark ? vsCodeDark : vsCodeLight),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return
            // Skip programmatic doc changes (e.g. resync from persistence).
            if (update.transactions.some(t => t.annotation(programmaticChange))) return
            const next = update.state.doc.toString()
            setCode(next)
          }),
        ],
      }),
      parent: editorHostRef.current,
    })
    editorViewRef.current = view

    return () => {
      view.destroy()
      editorViewRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, isLoading])

  // Switch CodeMirror theme without rebuilding the editor.
  useEffect(() => {
    const view = editorViewRef.current
    if (!view) return
    const isDark = resolvedTheme === 'dark'
    view.dispatch({
      effects: themeCompartment.current.reconfigure(isDark ? vsCodeDark : vsCodeLight),
    })
  }, [resolvedTheme])

  // Auto-render preview on debounced edits.
  useEffect(() => {
    const handle = window.setTimeout(() => {
      setPreviewSrc(code)
    }, AUTO_RUN_DEBOUNCE_MS)
    return () => window.clearTimeout(handle)
  }, [code])

  // Persist code changes (debounced via the same edit cadence).
  useEffect(() => {
    if (!pageId || isLoading) return
    const handle = window.setTimeout(() => {
      const dataToSave: CodeEditorData = {
        files: [{ name: 'index.html', content: code }],
        activeFileIndex: 0,
        editorWidth,
      }
      savePersistentData(dataToSave)
    }, AUTO_RUN_DEBOUNCE_MS)
    return () => window.clearTimeout(handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, editorWidth, pageId, isLoading])

  const runNow = useCallback(() => {
    setPreviewSrc(code)
  }, [code])

  const reset = useCallback(() => {
    setCode(initialCode)
    setPreviewSrc(initialCode)
    const view = editorViewRef.current
    if (view) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: initialCode },
        annotations: programmaticChange.of(true),
      })
    }
  }, [initialCode])

  const startDrag = useCallback((e: React.MouseEvent) => {
    if (isStacked) return
    e.preventDefault()
    dragStateRef.current = { startX: e.clientX, startWidth: editorWidth }
    setIsDragging(true)
    const onMove = (ev: MouseEvent) => {
      if (!dragStateRef.current || !containerRef.current) return
      const { startX, startWidth } = dragStateRef.current
      const containerWidth = containerRef.current.getBoundingClientRect().width
      if (containerWidth <= 0) return
      const deltaPercent = ((ev.clientX - startX) / containerWidth) * 100
      const next = Math.max(20, Math.min(80, startWidth + deltaPercent))
      setEditorWidth(next)
    }
    const onUp = () => {
      dragStateRef.current = null
      setIsDragging(false)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [editorWidth, isStacked])

  return (
    <div
      ref={wrapperRef}
      className="not-prose my-4 rounded-md border border-border overflow-hidden bg-background flex flex-col"
      style={{ height: fullscreen ? '100vh' : `${height}px` }}
    >
      <div
        ref={containerRef}
        className={`flex-1 flex ${isStacked ? 'flex-col' : 'flex-row'} overflow-hidden min-h-0`}
      >
        {/* Editor pane */}
        <div
          className="relative flex flex-col min-h-0 min-w-0 bg-background"
          style={isStacked ? { flex: '1 1 0', minHeight: 0 } : { width: `${editorWidth}%` }}
        >
          <div ref={editorHostRef} className="flex-1 min-h-0 overflow-hidden" />
        </div>

        {/* Splitter */}
        <div
          role="separator"
          aria-orientation={isStacked ? 'horizontal' : 'vertical'}
          onMouseDown={startDrag}
          className={
            isStacked
              ? 'h-px bg-border'
              : 'w-1 bg-border hover:bg-primary/50 cursor-col-resize transition-colors'
          }
        />

        {/* Preview pane */}
        <div
          className="relative flex flex-col min-h-0 min-w-0 bg-white"
          style={isStacked ? { flex: '1 1 0', minHeight: 0 } : { width: `${100 - editorWidth}%` }}
        >
          <iframe
            title={`HTML preview ${id}`}
            sandbox={IFRAME_SANDBOX}
            srcDoc={previewSrc}
            className="w-full h-full border-0 bg-white"
          />
          {/* Iframes capture mouse events, so mousemove never reaches the window
              listener once the cursor crosses the splitter. Cover the iframe
              while dragging so events flow back through the parent document. */}
          {isDragging && (
            <div className="absolute inset-0 cursor-col-resize" />
          )}
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-end gap-1 border-t border-border bg-muted/40 px-2 py-1">
        <Button variant="ghost" size="sm" onClick={reset} title="Reset to original code">
          <RotateCcw className="w-4 h-4" />
          <span className="ml-1 text-xs">Reset</span>
        </Button>
        <Button variant="ghost" size="sm" onClick={runNow} title="Re-render preview">
          <Play className="w-4 h-4" />
          <span className="ml-1 text-xs">Run</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={toggleFullscreen}
          title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
        >
          {fullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
        </Button>
      </div>
    </div>
  )
})
