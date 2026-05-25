import { describe, it, expect } from 'vitest'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import { remarkQuiz } from '@/lib/remark-plugins/quiz'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findNode(tree: any, pred: (n: any) => boolean): any {
  let found: any
  const walk = (n: any) => {
    if (found) return
    if (pred(n)) { found = n; return }
    if (Array.isArray(n.children)) n.children.forEach(walk)
  }
  walk(tree)
  return found
}

function transform(markdown: string): string {
  const processor = unified().use(remarkParse).use(remarkQuiz)
  const tree = processor.parse(markdown)
  processor.runSync(tree)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q = findNode(tree, (n: any) => n.type === 'html' && /<question\b/.test(n.value))
  return q?.value ?? ''
}

describe('remarkQuiz — free-text auto-check', () => {
  it('captures a ```expected block as an encoded data-expected attr (whitespace preserved) and strips it from the prompt', () => {
    const md = `<Question id="predict1" type="text" points="2">
Predict the output:

\`\`\`expected
0
2
4
\`\`\`

</Question>`
    const html = transform(md)
    expect(html).toContain('id="predict1"')
    expect(html).toContain('type="text"')
    expect(html).toContain('points="2"')

    const m = html.match(/data-expected="([^"]*)"/)
    expect(m).toBeTruthy()
    expect(decodeURIComponent(m![1])).toBe('0\n2\n4')

    // The expected block must not leak into the rendered prompt.
    expect(html).toContain('Predict the output:')
    // The bare output lines should not appear as prompt text outside the attr.
    const withoutAttr = html.replace(/data-expected="[^"]*"/, '')
    expect(withoutAttr).not.toContain('\n2\n4')
  })

  it('preserves leading whitespace and internal blank lines in the expected block', () => {
    // A blank line before ```expected is required so markdown ends the
    // <Question> HTML block and parses the fence as its own code node.
    const md = `<Question id="q" type="text">
Prompt

\`\`\`expected
  indented

after-blank
\`\`\`

</Question>`
    const html = transform(md)
    const m = html.match(/data-expected="([^"]*)"/)
    expect(m).toBeTruthy()
    expect(decodeURIComponent(m![1])).toBe('  indented\n\nafter-blank')
  })

  it('parses ignore-case / ignore-whitespace flags', () => {
    const md = `<Question id="q" type="text" ignore-case="true" ignore-whitespace="true">
Prompt
\`\`\`expected
ok
\`\`\`
</Question>`
    const html = transform(md)
    expect(html).toContain('ignore-case="true"')
    expect(html).toContain('ignore-whitespace="true"')
  })
})
