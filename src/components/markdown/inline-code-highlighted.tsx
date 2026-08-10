'use client'

import { useEffect, useState, memo } from 'react'
import type { Language } from '@codemirror/language'

// Same language set as CodeBlock (src/components/markdown/code-block.tsx) and
// the dashboard source editor — parser-only imports, no editor view, so this
// stays cheap even though it's statically reachable from every prose page.
async function loadParser(lang: string): Promise<Language | null> {
  switch (lang) {
    case 'javascript':
    case 'js':
      return (await import('@codemirror/lang-javascript')).javascript().language
    case 'typescript':
    case 'ts':
      return (await import('@codemirror/lang-javascript')).javascript({ typescript: true }).language
    case 'python':
    case 'py':
      return (await import('@codemirror/lang-python')).python().language
    case 'sql':
      return (await import('@codemirror/lang-sql')).sql().language
    case 'php':
      return (await import('@codemirror/lang-php')).php().language
    case 'java':
      return (await import('@codemirror/lang-java')).java().language
    case 'cpp':
    case 'c++':
      return (await import('@codemirror/lang-cpp')).cpp().language
    case 'rust':
    case 'rs':
      return (await import('@codemirror/lang-rust')).rust().language
    case 'go':
      return (await import('@codemirror/lang-go')).go().language
    case 'html':
      return (await import('@codemirror/lang-html')).html().language
    case 'css':
      return (await import('@codemirror/lang-css')).css().language
    case 'json':
      return (await import('@codemirror/lang-json')).json().language
    case 'xml':
      return (await import('@codemirror/lang-xml')).xml().language
    case 'yaml':
    case 'yml':
      return (await import('@codemirror/lang-yaml')).yaml().language
    default:
      return null
  }
}

interface Token {
  text: string
  className: string
}

interface InlineCodeHighlightedProps {
  code: string
  lang: string
}

// Renders `` `code`{:python} `` with real per-token colors. Tokenizes once,
// client-side, via the same Lezer parsers CodeBlock uses for fenced blocks —
// but no EditorView/DOM editor is mounted, just a static span walk, so this
// stays cheap even with many inline snippets on one page (unlike CodeBlock,
// which is deliberately kept off the initial mount path for exactly that
// reason — see the perf/many-editors work).
function InlineCodeHighlightedInner({ code, lang }: InlineCodeHighlightedProps) {
  const [tokens, setTokens] = useState<Token[] | null>(null)

  useEffect(() => {
    let cancelled = false
    setTokens(null)

    async function run() {
      const [{ highlightTree, classHighlighter }, language] = await Promise.all([
        import('@lezer/highlight'),
        loadParser(lang),
      ])
      if (cancelled || !language) return

      const tree = language.parser.parse(code)
      const parts: Token[] = []
      let pos = 0
      highlightTree(tree, classHighlighter, (from, to, className) => {
        if (from > pos) parts.push({ text: code.slice(pos, from), className: '' })
        parts.push({ text: code.slice(from, to), className })
        pos = to
      })
      if (pos < code.length) parts.push({ text: code.slice(pos), className: '' })

      if (!cancelled) setTokens(parts)
    }

    run()
    return () => {
      cancelled = true
    }
  }, [code, lang])

  return (
    <code className="px-[0.4em] py-[0.2em] rounded bg-muted font-mono text-[0.9em]">
      {tokens
        ? tokens.map((t, i) => (t.className ? <span key={i} className={t.className}>{t.text}</span> : t.text))
        : code}
    </code>
  )
}

export const InlineCodeHighlighted = memo(InlineCodeHighlightedInner)
