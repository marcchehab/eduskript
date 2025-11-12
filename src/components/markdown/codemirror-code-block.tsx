'use client'

import { useState, useRef, useEffect, useMemo } from 'react'
import { ChevronDown, Copy, Check } from 'lucide-react'
import { EditorView, Decoration, DecorationSet } from '@codemirror/view'
import { EditorState, Extension, StateEffect, StateField } from '@codemirror/state'
import { useTheme } from 'next-themes'

// Language imports
import { javascript } from '@codemirror/lang-javascript'
import { python } from '@codemirror/lang-python'
import { java } from '@codemirror/lang-java'
import { cpp } from '@codemirror/lang-cpp'
import { rust } from '@codemirror/lang-rust'
import { go } from '@codemirror/lang-go'
import { php } from '@codemirror/lang-php'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { sql } from '@codemirror/lang-sql'
import { xml } from '@codemirror/lang-xml'
import { yaml } from '@codemirror/lang-yaml'

// Theme imports
import { vsCodeDark } from '@fsegurai/codemirror-theme-vscode-dark'
import { vsCodeLight } from '@fsegurai/codemirror-theme-vscode-light'

interface LineAnnotation {
  line: number
  type: 'add' | 'remove' | 'highlight' | 'focus'
}

interface CodeMirrorCodeBlockProps {
  children: string
  className?: string
  language?: string
  lineAnnotations?: LineAnnotation[]
  onLanguageChange?: (newLanguage: string) => void
}

// Language map
const getLanguageExtension = (lang: string): Extension | null => {
  const langMap: Record<string, () => Extension> = {
    javascript: () => javascript(),
    js: () => javascript(),
    typescript: () => javascript({ typescript: true }),
    ts: () => javascript({ typescript: true }),
    jsx: () => javascript({ jsx: true }),
    tsx: () => javascript({ jsx: true, typescript: true }),
    python: () => python(),
    py: () => python(),
    java: () => java(),
    cpp: () => cpp(),
    c: () => cpp(),
    'c++': () => cpp(),
    rust: () => rust(),
    rs: () => rust(),
    go: () => go(),
    php: () => php(),
    html: () => html(),
    css: () => css(),
    json: () => json(),
    markdown: () => markdown(),
    md: () => markdown(),
    sql: () => sql(),
    xml: () => xml(),
    yaml: () => yaml(),
    yml: () => yaml(),
    bash: () => xml(), // Fallback to xml for bash (no dedicated bash extension)
    shell: () => xml(),
    sh: () => xml(),
  }

  const extensionFn = langMap[lang.toLowerCase()]
  return extensionFn ? extensionFn() : null
}

// Line decoration extension
const lineAnnotationEffect = StateEffect.define<LineAnnotation[]>()

const lineAnnotationField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none
  },
  update(decorations, tr) {
    for (const effect of tr.effects) {
      if (effect.is(lineAnnotationEffect)) {
        // Build decorations from annotations
        const decs: any[] = []
        const annotations = effect.value

        for (const annotation of annotations) {
          let className = ''
          switch (annotation.type) {
            case 'add':
              className = 'cm-line-add'
              break
            case 'remove':
              className = 'cm-line-remove'
              break
            case 'highlight':
              className = 'cm-line-highlight'
              break
            case 'focus':
              className = 'cm-line-focus'
              break
          }

          if (className) {
            // Find the line position
            const lineNum = annotation.line - 1 // 0-indexed
            if (lineNum >= 0 && lineNum < tr.state.doc.lines) {
              const line = tr.state.doc.line(lineNum + 1) // doc.line is 1-indexed
              const dec = Decoration.line({ class: className })
              decs.push(dec.range(line.from))
            }
          }
        }

        return Decoration.set(decs, true)
      }
    }
    return decorations
  },
  provide: field => EditorView.decorations.from(field)
})

export function CodeMirrorCodeBlock({
  children,
  className,
  language: propLanguage,
  lineAnnotations = [],
  onLanguageChange
}: CodeMirrorCodeBlockProps) {
  // Extract language from className (e.g., "language-javascript")
  const languageFromClass = className?.replace('language-', '') || 'text'
  const initialLanguage = propLanguage || languageFromClass

  const [language, setLanguage] = useState(initialLanguage)
  const [isOpen, setIsOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const editorRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const { resolvedTheme } = useTheme()

  // Available languages
  const languages = [
    'bash', 'c', 'cpp', 'css', 'go', 'html', 'java', 'javascript',
    'json', 'markdown', 'php', 'python', 'rust', 'shell', 'sql',
    'text', 'typescript', 'xml', 'yaml'
  ].sort()

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  const handleCopy = async () => {
    await navigator.clipboard.writeText(children)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // Create the editor
  useEffect(() => {
    if (!editorRef.current) return

    // Get language extension
    const langExtension = getLanguageExtension(language)

    // Get theme based on resolved theme
    const themeExtension = resolvedTheme === 'dark' ? vsCodeDark : vsCodeLight

    // Create the editor state
    const startState = EditorState.create({
      doc: children,
      extensions: [
        EditorView.editable.of(false), // Read-only
        EditorState.readOnly.of(true),
        themeExtension,
        ...(langExtension ? [langExtension] : []),
        lineAnnotationField,
        // Custom styling
        EditorView.theme({
          '&': {
            fontSize: '14px',
            borderRadius: '0.375rem',
            overflow: 'hidden'
          },
          '.cm-scroller': {
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
            overflow: 'auto'
          },
          '.cm-line-add': {
            backgroundColor: 'rgba(34, 197, 94, 0.15)',
            borderLeft: '3px solid rgb(34, 197, 94)'
          },
          '.cm-line-remove': {
            backgroundColor: 'rgba(239, 68, 68, 0.15)',
            borderLeft: '3px solid rgb(239, 68, 68)'
          },
          '.cm-line-highlight': {
            backgroundColor: 'rgba(59, 130, 246, 0.15)',
            borderLeft: '3px solid rgb(59, 130, 246)'
          },
          '.cm-line-focus': {
            backgroundColor: 'rgba(168, 85, 247, 0.15)',
            borderLeft: '3px solid rgb(168, 85, 247)'
          },
          '.cm-content': {
            padding: '1rem'
          }
        })
      ]
    })

    // Create the view
    const view = new EditorView({
      state: startState,
      parent: editorRef.current
    })

    viewRef.current = view

    // Apply line annotations
    if (lineAnnotations.length > 0) {
      view.dispatch({
        effects: lineAnnotationEffect.of(lineAnnotations)
      })
    }

    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [children, language, resolvedTheme, lineAnnotations])

  return (
    <div className="relative group my-4">
      {/* Control bar */}
      <div className="absolute top-0 right-0 flex items-center justify-between gap-2 px-3 py-1.5 bg-muted/50 border border-border rounded-md opacity-0 group-hover:opacity-100 transition-opacity z-10">
        {/* Language selector */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setIsOpen(!isOpen)}
            className="flex items-center gap-1.5 px-2 py-1 text-xs font-mono text-muted-foreground hover:text-foreground transition-colors rounded bg-background/50 hover:bg-background"
          >
            {language}
            <ChevronDown className="w-3 h-3" />
          </button>

          {isOpen && (
            <div className="absolute top-full right-0 mt-1 w-36 max-h-48 overflow-y-auto bg-popover border border-border rounded-md shadow-lg z-20">
              {languages.map((lang) => (
                <button
                  key={lang}
                  onClick={() => {
                    setLanguage(lang)
                    setIsOpen(false)
                    onLanguageChange?.(lang)
                  }}
                  className={`block w-full text-left px-3 py-1.5 text-xs font-mono hover:bg-accent transition-colors ${
                    language === lang ? 'bg-accent text-accent-foreground' : 'text-foreground'
                  }`}
                >
                  {lang}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Copy button */}
        <button
          onClick={handleCopy}
          className="p-1 text-muted-foreground hover:text-foreground transition-colors rounded"
          title="Copy code"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* CodeMirror editor */}
      <div ref={editorRef} className="rounded-md overflow-hidden border border-border" />
    </div>
  )
}
