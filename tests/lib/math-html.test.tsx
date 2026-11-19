import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement, ReactNode } from 'react'
import katex from 'katex'
import { compileMarkdown } from '@/lib/markdown-compiler'
import { mathText } from '@/components/markdown/math-html'

const render = async (markdown: string) => renderToStaticMarkup(<>{await compileMarkdown(markdown)}</>)

/** Every element of a React tree, depth first. */
function elements(node: ReactNode, found: ReactElement[] = []): ReactElement[] {
  if (Array.isArray(node)) node.forEach((child) => elements(child, found))
  else if (node && typeof node === 'object' && 'props' in node) {
    found.push(node)
    elements((node.props as { children?: ReactNode }).children, found)
  }
  return found
}

describe('formulas as one element (rehypeMathHtml)', () => {
  it('produces the markup KaTeX produces', async () => {
    const html = await render('Der Zustand $q_{0}$ ist der Start.')
    const expected = katex.renderToString('q_{0}').replace('<span class="katex">', '<span class="katex" data-tex="q_{0}">')
    expect(html).toContain(expected)
  })

  it('keeps display math, roots (SVG) and colours', async () => {
    const html = await render('$$\n\\sqrt{x^2+1}\n$$\n\nund $\\textcolor{cyan}{a}$')
    expect(html).toMatch(/<span class="katex-display"><span class="katex" data-tex="\\sqrt\{x\^2\+1\}">/)
    // SVG attributes keep their case
    expect(html).toMatch(/<svg[^>]* viewBox="0 0 400000 \d+" preserveAspectRatio="xMinYMin slice"/)
    expect(html).toContain('es-color-')
  })

  it('hands React one element for all occurrences of a formula', async () => {
    const tree = await compileMarkdown('| a | b |\n|-|-|\n| $q_0$ | $q_0$ |\n| $q_1$ | $q_0$ |')
    const html = renderToStaticMarkup(<>{tree}</>)
    expect(html.match(/data-tex="q_0"/g)).toHaveLength(3)
    const formulas = elements(tree).filter((el) => mathText(el.props) !== undefined)
    expect(formulas.map((el) => mathText(el.props))).toEqual(['q_0', 'q_0', 'q_1', 'q_0'])
  })

  it('does not let an author inject HTML through <math-html>', async () => {
    const html = await render('<math-html html="<img src=x onerror=alert(1)>"></math-html>\n\n<span class="katex"><img src="x" onerror="alert(1)"></span>')
    expect(html).not.toContain('onerror')
  })

  it('gives text collectors the TeX source', () => {
    expect(mathText({ className: 'katex', 'data-tex': 'x^2', dangerouslySetInnerHTML: { __html: '' } })).toBe('x^2')
    expect(mathText({ html: '<span></span>', tex: 'x^2' })).toBe('x^2')
    expect(mathText({ children: 'x' })).toBeUndefined()
  })
})
