'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { CodeBlock } from '@/components/markdown/code-block'
import { usePrintMode } from '@/lib/print/print-mode'

/**
 * Code editors on paper: the author's starter code as static, highlighted code
 * blocks (CodeBlock, like a plain ```lang fence), never the student's saved
 * code. A printout is a blank worksheet, like the blank quiz cards (quiz.tsx).
 *
 * Display-only: the live editor stays mounted (display:none) or unmounted
 * (DeferredMount with printMount={false}), so nothing is written while
 * printing and leaving the print view shows the student's code again.
 *
 * @see src/lib/markdown-components.tsx (CodeEditorComponent)
 * @see src/components/public/code-editor/index.tsx (output-only editors)
 */

const EXT_LANGUAGE: Record<string, string> = {
  py: 'python',
  js: 'javascript',
  mjs: 'javascript',
  ts: 'typescript',
  sql: 'sql',
  html: 'html',
  htm: 'html',
  css: 'css',
  json: 'json',
}

/** CodeBlock language for a file: from its extension, else the editor's language
 *  for an extension-less name; data files (.csv, .txt) get none. */
export function languageForFile(name: string, editorLanguage: string): string | undefined {
  const dot = name.lastIndexOf('.')
  if (dot < 0) return editorLanguage
  return EXT_LANGUAGE[name.slice(dot + 1).toLowerCase()]
}

/** One block per file; file names as title bars only with several files. */
export function PrintCode({ files, language }: { files: { name: string; content: string }[]; language: string }) {
  const multi = files.length > 1
  return (
    <>
      {files.map((f, i) => (
        <CodeBlock
          key={`${i}-${f.name}`}
          code={f.content.replace(/\n+$/, '')}
          language={languageForFile(f.name, language)}
          filename={multi ? f.name : undefined}
          showCopy={false}
        />
      ))}
    </>
  )
}

/**
 * Wraps an editor block. In the print view with `staticPrint`, prints `paper`
 * (PrintCode, plus e.g. a schema image) instead of the editor, which stays
 * mounted but hidden. Records its online height and carries it as
 * data-print-online-height in print, so strokes anchored below move by the
 * height difference (stroke-shift.ts), as PrintFallback does. Opened directly
 * with ?print there is no online height, so no correction.
 */
export function EditorPrintFrame({ staticPrint, paper, children }: { staticPrint: boolean; paper: ReactNode; children: ReactNode }) {
  const printing = usePrintMode()
  const ref = useRef<HTMLDivElement>(null)
  const [onlineHeight, setOnlineHeight] = useState<number | null>(null)

  useEffect(() => {
    const el = ref.current
    if (printing || !el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setOnlineHeight(el.offsetHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [printing])

  const showPaper = printing && staticPrint
  return (
    // flow-root: margins of the children (CodeBlock my-4) stay inside, so the
    // measured height is what the block takes in the page.
    <div ref={ref} className="flow-root" data-editor-print-frame="" data-print-online-height={printing && onlineHeight != null ? onlineHeight : undefined}>
      {showPaper && paper}
      <div style={showPaper ? { display: 'none' } : undefined}>{children}</div>
    </div>
  )
}
