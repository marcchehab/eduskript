import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import { compileMarkdown } from '@/lib/markdown-compiler'

/**
 * A `>` inside a quoted attribute value must not end the tag scan. Teachers hit
 * this with reaction arrows ("O2 -> CO2") and comparisons ("x > 0") in
 * ai-feedback prompts and answer feedback.
 */
async function html(md: string): Promise<string> {
  const tree = (await compileMarkdown(md)) as ReactNode
  return renderToStaticMarkup(tree)
}

function childrenOf(out: string, tag: string): string {
  return new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`).exec(out)?.[1] ?? ''
}

describe('> inside an attribute value', () => {
  it('does not swallow the rest of the page after a self-closing tag', async () => {
    const out = await html('<ai-feedback prompt="C3H8 + 5 O2 -> 3 CO2" id="x" />\n\n## Danach\n\nText.')
    // The heading must be a sibling, not a child of the (children-less) component.
    expect(childrenOf(out, 'ai-feedback')).toBe('')
    expect(out).toMatch(/<h2[^>]*>[\s\S]*Danach/)
  })

  it('keeps working for the plain case', async () => {
    const out = await html('<ai-feedback prompt="Ganz normal" id="y" />\n\n## Danach')
    expect(childrenOf(out, 'ai-feedback')).toBe('')
  })

  it('still collapses blank lines in a question whose attribute holds a >', async () => {
    const out = await html(
      '<question id="q" type="single" showFeedback="true">\nWann gilt $x > 0$?\n\n<answer correct="true">immer</answer>\n\n<answer feedback="Nein, denn 2 > 1.">nie</answer>\n</question>'
    )
    // Answers stay direct children — no <p> wrapper detaching them.
    expect(out).not.toMatch(/<p[^>]*>\s*<answer/)
    // `<answer` alone would also count the <answer-feedback> children.
    expect((out.match(/<answer(?![-\w])/g) || []).length).toBe(2)
  })

  it('still separates a container tag whose attribute holds a >', async () => {
    const out = await html('<stickme id="a > b">\nInhalt\n</stickme>\n## Danach')
    expect(out).toMatch(/<h2[^>]*>[\s\S]*Danach/)
  })

  it('leaves void elements self-closing', async () => {
    const out = await html('<img src="x.png" alt="a > b" />')
    expect(out).not.toContain('</img>')
  })
})
