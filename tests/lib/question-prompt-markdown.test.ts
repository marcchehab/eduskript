import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import { compileMarkdown } from '@/lib/markdown-compiler'

/**
 * A `<question>` block is one raw HTML block, so its prompt and its `<answer>`
 * labels used to reach the quiz component as literal text — `$x$` stayed a
 * dollar sign, `**bold**` stayed asterisks. rehypeMarkdownChildren now re-parses
 * both. The prompt is wrapped in `<question-prompt>` (NOT a bare `<p>`) because
 * components/markdown/quiz.tsx indexes answers by dense element position: an
 * extra element sibling would be counted as an option.
 */
async function html(md: string): Promise<string> {
  const tree = (await compileMarkdown(md)) as ReactNode
  return renderToStaticMarkup(tree)
}

describe('question prompt + answer markdown', () => {
  it('renders KaTeX in the prompt, inside a question-prompt wrapper', async () => {
    const out = await html(
      `<question id="q1" type="single">\nWelche Steigung hat $f(x) = \\frac{1}{3}x^3$?\n<answer correct="true">$0$</answer>\n<answer>$1$</answer>\n</question>`
    )
    expect(out).toContain('<question-prompt>')
    expect(out).not.toContain('$f(x)')
    // KaTeX ran over the re-parsed math.
    expect(out).toMatch(/<question-prompt>[\s\S]*katex/)
  })

  it('renders KaTeX inside answers without wrapping them in a paragraph', async () => {
    const out = await html(
      `<question id="q2" type="single">\nPick\n<answer correct="true">$0$</answer>\n<answer>$1$</answer>\n</question>`
    )
    expect((out.match(/<answer/g) || []).length).toBe(2)
    expect(out).not.toMatch(/<answer[^>]*>\s*<p>/)
    expect(out).toMatch(/<answer[^>]*>[\s\S]*katex/)
  })

  it('keeps the prompt out of the answer element run', async () => {
    const out = await html(
      `<question id="q3" type="single">\n**Bold** prompt\n<answer>A</answer>\n<answer correct="true">B</answer>\n</question>`
    )
    // Exactly the two answers are element children besides the prompt wrapper.
    expect((out.match(/<answer/g) || []).length).toBe(2)
    expect(out).toMatch(/<question-prompt><strong>Bold<\/strong> prompt<\/question-prompt>/)
  })

  it('leaves a question whose prompt lives outside the tag alone', async () => {
    const out = await html(
      `Prompt above.\n\n<question id="q4" type="single">\n<answer>A</answer>\n<answer correct="true">B</answer>\n</question>`
    )
    expect(out).not.toContain('<question-prompt>')
    expect((out.match(/<answer/g) || []).length).toBe(2)
  })
})
