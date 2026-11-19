import type { ReactElement } from 'react'

/**
 * One element per distinct formula. A page that shows q_0 two hundred times
 * hands React the same element two hundred times, and the RSC payload then
 * holds its markup once and references it from there on.
 */
const elements = new Map<string, ReactElement>()
const MAX_ELEMENTS = 2000

/** A formula rendered by KaTeX; `html` comes from rehypeMathHtml (sanitized tree), never from an author. */
export function MathHtml({ html, tex }: { html?: string; tex?: string }) {
  if (!html) return null
  let element = elements.get(html)
  if (!element) {
    element = <span className="katex" data-tex={tex} dangerouslySetInnerHTML={{ __html: html }} />
    if (elements.size >= MAX_ELEMENTS) elements.clear()
    elements.set(html, element)
  }
  return element
}

/**
 * For code that collects the plain text of React children: the TeX source of a
 * formula element (which has no children to walk into), otherwise undefined.
 */
export function mathText(props: unknown): string | undefined {
  const tex = (props as { 'data-tex'?: unknown; tex?: unknown } | null | undefined)
  if (!tex) return undefined
  if (typeof tex['data-tex'] === 'string') return tex['data-tex']
  return typeof tex.tex === 'string' && 'html' in tex ? tex.tex : undefined
}
