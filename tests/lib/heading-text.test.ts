import { describe, it, expect } from 'vitest'
import katex from 'katex'
import { headingText } from '@/lib/heading-text'

function el(html: string): Element {
  const d = document.createElement('div')
  d.innerHTML = html
  return d.firstElementChild!
}

describe('headingText', () => {
  it('reads KaTeX math once, not MathML + annotation + HTML', () => {
    const math = katex.renderToString('a')
    const h = el(`<h2 id="x"><a class="heading-link" href="#x">1.3 Der Koeffizient ${math}</a></h2>`)
    expect(h.textContent).toContain('aaa')
    expect(headingText(h)).toBe('1.3 Der Koeffizient a')
  })

  it('ignores the aria-hidden rainbow shadow of the h1', () => {
    const h = el('<h1><span aria-hidden="true" class="color-title-shadow">Bruchgleichungen</span><span>Bruchgleichungen</span></h1>')
    expect(headingText(h)).toBe('Bruchgleichungen')
  })

  it('collapses whitespace', () => {
    expect(headingText(el('<h2>  Beispiel \n 1 </h2>'))).toBe('Beispiel 1')
  })
})
