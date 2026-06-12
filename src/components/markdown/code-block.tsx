'use client'

import { useEffect, useRef, memo, useState } from 'react'
import { useTheme } from 'next-themes'
import { Check, Copy } from 'lucide-react'
import type { Extension } from '@codemirror/state'

interface CodeBlockProps {
  code: string
  language?: string
  className?: string
  /** Show the copy-to-clipboard button. Default true; callers hide it on exams. */
  showCopy?: boolean
}

function CodeBlockInner({ code, language, className, showCopy = true }: CodeBlockProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<unknown>(null)
  const [isMounted, setIsMounted] = useState(false)
  const [copied, setCopied] = useState(false)
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === 'dark'

  useEffect(() => {
    setIsMounted(true)
  }, [])

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  useEffect(() => {
    if (!isMounted || !containerRef.current) return

    const init = async () => {
      if (!containerRef.current) return

      // Clean up existing
      if (editorRef.current) {
        (editorRef.current as { destroy: () => void }).destroy()
        editorRef.current = null
      }

      const { EditorView } = await import('@codemirror/view')
      const { EditorState } = await import('@codemirror/state')
      const { vsCodeLight } = await import('@fsegurai/codemirror-theme-vscode-light')
      const { vsCodeDark } = await import('@fsegurai/codemirror-theme-vscode-dark')

      // Language support
      let langSupport = null
      const lang = language?.toLowerCase()
      if (lang === 'javascript' || lang === 'js') {
        const { javascript } = await import('@codemirror/lang-javascript')
        langSupport = javascript()
      } else if (lang === 'typescript' || lang === 'ts') {
        const { javascript } = await import('@codemirror/lang-javascript')
        langSupport = javascript({ typescript: true })
      } else if (lang === 'python' || lang === 'py') {
        const { python } = await import('@codemirror/lang-python')
        langSupport = python()
      } else if (lang === 'sql') {
        const { sql } = await import('@codemirror/lang-sql')
        langSupport = sql()
      } else if (lang === 'html') {
        const { html } = await import('@codemirror/lang-html')
        langSupport = html()
      } else if (lang === 'css') {
        const { css } = await import('@codemirror/lang-css')
        langSupport = css()
      } else if (lang === 'json') {
        const { json } = await import('@codemirror/lang-json')
        langSupport = json()
      }

      // Vertical indent guides for Python, where indentation carries meaning.
      // Read-only block, so no active-block highlight (there's no cursor).
      // indentUnit/tabSize MUST be set: the indentation-markers plugin reads
      // getIndentUnit() to place guides, and without it CodeMirror defaults to
      // 2 — drawing a guide every 2 columns over 4-space Python indents (doubled
      // guides). 4 spaces matches the interactive editor (src/components/public/
      // code-editor/index.tsx).
      const indentExtensions: Extension[] = []
      if (lang === 'python' || lang === 'py') {
        const { indentUnit } = await import('@codemirror/language')
        const { indentationMarkers } = await import('@replit/codemirror-indentation-markers')
        indentExtensions.push(
          indentUnit.of('    '),
          EditorState.tabSize.of(4),
          indentationMarkers({
            highlightActiveBlock: false,
            hideFirstIndent: true,
            colors: {
              light: '#c2c8d0',
              dark: '#3b4048',
              activeLight: '#8a93a0',
              activeDark: '#5c6470',
            },
          }),
        )
      }

      if (!containerRef.current) return

      // Clear the placeholder
      const placeholder = containerRef.current.querySelector('pre')
      if (placeholder) placeholder.remove()

      const view = new EditorView({
        state: EditorState.create({
          doc: code,
          extensions: [
            ...(langSupport ? [langSupport] : []),
            ...indentExtensions,
            ...(isDark ? [vsCodeDark] : [vsCodeLight]),
            EditorState.readOnly.of(true),
            EditorView.editable.of(false),
            EditorView.lineWrapping,
            EditorView.theme({
              '&': { fontSize: '14px', borderRadius: '8px' },
              '.cm-content': { padding: '12px', caretColor: 'transparent' },
              '.cm-gutters': { display: 'none' },
              '.cm-cursor, .cm-cursorLayer': { display: 'none !important' },
              '.cm-activeLine': { backgroundColor: 'transparent !important' },
              '.cm-selectionBackground, .cm-selection': { backgroundColor: 'transparent !important' },
              '&.cm-focused': { outline: 'none' },
              '&.cm-focused .cm-selectionBackground': { backgroundColor: 'transparent !important' },
            }),
          ],
        }),
        parent: containerRef.current,
      })

      editorRef.current = view
    }

    init()

    return () => {
      if (editorRef.current) {
        (editorRef.current as { destroy: () => void }).destroy()
        editorRef.current = null
      }
    }
  }, [isMounted, isDark, code, language])

  return (
    <div className={`code-block relative rounded-lg overflow-hidden ${className || ''}`}>
      {showCopy && (
        <button
          onClick={handleCopy}
          className="absolute top-2 right-2 z-10 p-1.5 rounded bg-muted/80 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          title="Copy code"
        >
          {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
        </button>
      )}
      <div ref={containerRef}>
        <pre className="p-3 bg-muted text-sm font-mono"><code>{code}</code></pre>
      </div>
    </div>
  )
}

export const CodeBlock = memo(CodeBlockInner)
