'use client'

import { useEffect, useId, useState } from 'react'
import { useTheme } from 'next-themes'

export function MermaidDiagram({ definition }: { definition: string }) {
  const { resolvedTheme } = useTheme()
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const rawId = useId()
  const id = `m-${rawId.replace(/[^a-z0-9]/gi, '')}`

  useEffect(() => {
    let cancelled = false
    import('mermaid').then(async ({ default: mermaid }) => {
      mermaid.initialize({
        startOnLoad: false,
        theme: resolvedTheme === 'dark' ? 'dark' : 'default',
        securityLevel: 'loose',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      })
      try {
        const { svg } = await mermaid.render(id, definition)
        if (!cancelled) {
          setSvg(svg)
          setError(null)
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      }
    }).catch((e) => {
      if (!cancelled) setError(e instanceof Error ? e.message : String(e))
    })
    return () => {
      cancelled = true
    }
  }, [definition, resolvedTheme, id])

  if (error) {
    return (
      <pre className="mermaid-error text-sm text-red-600 dark:text-red-400 whitespace-pre-wrap border border-red-200 dark:border-red-900 rounded p-3 my-4">
        {error}
      </pre>
    )
  }

  if (!svg) {
    return <div className="mermaid-loading my-4 h-24" aria-busy="true" />
  }

  return <div className="mermaid my-4 flex justify-center" dangerouslySetInnerHTML={{ __html: svg }} />
}
