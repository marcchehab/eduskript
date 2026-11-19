/**
 * Collapse each rendered formula into one element that carries KaTeX's markup
 * as an HTML string (<math-html html="…">, rendered by MathHtml).
 *
 * KaTeX emits some 30 nested spans for a formula as small as q_0. As React
 * elements they cost three to four times their HTML in the RSC payload of a
 * page, and a page with many formulas (a transition table has one or two per
 * cell) grew to megabytes. The DOM is the same as before, plus data-tex on the
 * outer span: code that reads the text of React children (quiz option labels,
 * callout titles) finds no children in a formula any more and takes the TeX
 * source from there (mathText in math-html.tsx).
 *
 * Must run after rehypeKatex and rehypeColorClasses, and after rehypeSanitize:
 * the string is injected as HTML, so it may only ever be built from the
 * sanitized tree. A <math-html> written by an author never gets here (the
 * sanitize schema does not allow it).
 */
import { toHtml } from 'hast-util-to-html'
import { toString } from 'hast-util-to-string'
import { EXIT, SKIP, visit } from 'unist-util-visit'
import type { Element, Root } from 'hast'

/** The TeX source, which KaTeX keeps in the MathML annotation. */
function texSource(node: Element): string | undefined {
  let tex: string | undefined
  visit(node, 'element', (child: Element) => {
    if (child.tagName !== 'annotation') return
    tex = toString(child)
    return EXIT
  })
  return tex
}

const hasClass = (node: Element, name: string) => {
  const classes = node.properties?.className
  return Array.isArray(classes) && classes.includes(name)
}

export function rehypeMathHtml() {
  return (tree: Root) => {
    visit(tree, 'element', (node: Element, index, parent) => {
      if (node.tagName !== 'span' || !hasClass(node, 'katex') || !parent || index === undefined) return
      const replacement: Element = {
        type: 'element',
        tagName: 'math-html',
        properties: { html: toHtml(node.children), tex: texSource(node) },
        children: [],
        position: node.position,
      }
      parent.children[index] = replacement
      return SKIP
    })
  }
}
