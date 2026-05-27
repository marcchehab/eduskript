import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import { remarkQuiz } from '@/lib/remark-plugins/quiz'
import { compileMarkdown } from '@/lib/markdown-compiler'

// Find the emitted <question> html node produced by remarkQuiz.
function emittedQuestion(md: string): string {
  const tree = unified().use(remarkParse).use(remarkQuiz).runSync(
    unified().use(remarkParse).parse(md)
  ) as { children: Array<{ type: string; value?: string }> }
  const node = tree.children.find(
    (c) => c.type === 'html' && typeof c.value === 'string' && c.value.includes('<question')
  )
  return node?.value ?? ''
}

describe('quiz dense element-only indexing', () => {
  it('remarkQuiz emits answers with no whitespace between them', () => {
    const md = `<Question id="q1" type="single">
What?
<Option>A</Option>
<Option correct="true">B</Option>
<Option>C</Option>
</Question>`
    const value = emittedQuestion(md)
    expect(value).toContain('<answer>A</answer><answer correct="true">B</answer><answer>C</answer>')
    // No newline/space between adjacent answers.
    expect(value).not.toMatch(/<\/answer>\s+<answer/)
  })

  it('compiled question keeps answers as direct, ordered children with the correct one flagged', async () => {
    const md = `<question id="q2" type="single">
Pick the right one
<answer>wrong</answer>
<answer correct="true">right</answer>
<answer>nope</answer>
</question>`
    const out = renderToStaticMarkup((await compileMarkdown(md)) as ReactNode)
    // Three answers, in order, the 2nd flagged correct — i.e. dense index 1.
    const answers = [...out.matchAll(/<answer(?:\s+correct="true")?>/g)].map((m) => m[0])
    expect(answers).toEqual(['<answer>', '<answer correct="true">', '<answer>'])
    // Not wrapped in a paragraph.
    expect(out).not.toMatch(/<p[^>]*>\s*<answer/)
  })
})
