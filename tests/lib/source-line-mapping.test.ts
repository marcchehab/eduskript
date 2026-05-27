import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import { compileMarkdown } from '@/lib/markdown-compiler'

/**
 * compileMarkdown preprocesses the source (expand self-closing tags, collapse
 * question spacing, delimit container tags), which adds/removes blank lines.
 * data-source-line-* must still report the EDITOR's ORIGINAL line numbers so
 * the editor↔preview cursor sync works — verified via the lineMap remap.
 */
async function sourceLines(md: string): Promise<Record<string, number>> {
  const html = renderToStaticMarkup((await compileMarkdown(md)) as ReactNode)
  const out: Record<string, number> = {}
  for (const m of html.matchAll(/<(?:h1|h2|h3|p)[^>]*data-source-line-start="(\d+)"[^>]*>([^<]+)/g)) {
    out[m[2].trim()] = parseInt(m[1], 10)
  }
  return out
}

describe('source-line mapping survives preprocessing', () => {
  it('content after a delimited container keeps original line numbers', async () => {
    // 1:# Title 2:blank 3:<flex> 4:<flex-item> 5:hi 6:</flex-item>
    // 7:</flex> 8:blank 9:## After 10:blank 11:Para
    const md = `# Title\n\n<flex>\n<flex-item>\nhi\n</flex-item>\n</flex>\n\n## After\n\nPara`
    const lines = await sourceLines(md)
    expect(lines['Title']).toBe(1)
    expect(lines['After']).toBe(9)
    expect(lines['Para']).toBe(11)
  })

  it('question element carries source-line spanning its original lines', async () => {
    // 1:intro 2:blank 3:<question> 4:Prompt 5:blank 6:<answer>A 7:<answer>B 8:</question>
    // Rendered without components (host element), so data-source-line lands on
    // <question> directly; with components, QuizQuestionComponent forwards it to
    // the card root. Answers intentionally have no source-line — clicks inside
    // bubble up to the question.
    const md = `intro\n\n<question id="q" type="single">\nPrompt\n\n<answer correct="true">A</answer>\n<answer>B</answer>\n</question>`
    const html = renderToStaticMarkup((await compileMarkdown(md)) as ReactNode)
    const q = html.match(/<question[^>]*data-source-line-start="(\d+)"[^>]*data-source-line-end="(\d+)"/)
    expect(q && [q[1], q[2]]).toEqual(['3', '8'])
  })

  it('plain code block <pre> carries source-line at its original lines', async () => {
    // 1:Beispiel: 2:blank 3:```python 4:x=2 5:``` (PreComponent forwards this to
    // the CodeBlock wrapper for cursor-sync).
    const md = 'Beispiel:\n\n```python\nx = 2\n```'
    const html = renderToStaticMarkup((await compileMarkdown(md)) as ReactNode)
    const m = html.match(/<pre[^>]*data-source-line-start="(\d+)"[^>]*data-source-line-end="(\d+)"/)
    expect(m && [m[1], m[2]]).toEqual(['3', '5'])
  })

  it('content after a question (blank lines collapsed) keeps original lines', async () => {
    // 1:intro 2:blank 3:<question...> 4:Prompt 5:blank 6:<answer...>A
    // 7:<answer>B 8:</question> 9:blank 10:## Next
    const md = `intro\n\n<question id="q" type="single">\nPrompt\n\n<answer correct="true">A</answer>\n<answer>B</answer>\n</question>\n\n## Next`
    const lines = await sourceLines(md)
    expect(lines['intro']).toBe(1)
    expect(lines['Next']).toBe(10)
  })
})
