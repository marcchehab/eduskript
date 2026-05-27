import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import { compileMarkdown } from '@/lib/markdown-compiler'

/**
 * Custom container tags must render identically WITH or WITHOUT blank lines
 * around their inner content. The blank-line "requirement" was a workaround for
 * CommonMark's raw-HTML-block rules, not a feature — rehypeMarkdownChildren now
 * re-parses inner literal text as markdown so spacing no longer matters.
 */
async function html(md: string): Promise<string> {
  const tree = (await compileMarkdown(md)) as ReactNode
  return renderToStaticMarkup(tree)
}

// Structural comparison: drop source-line attrs (blank lines legitimately shift
// line numbers) and collapse pure-whitespace gaps between tags, so we compare
// the rendered structure, not incidental spacing.
async function structure(md: string): Promise<string> {
  return (await html(md))
    .replace(/ data-source-line-(?:start|end)="[^"]*"/g, '')
    .replace(/>\s+</g, '><')
    .trim()
}

describe('container tags are blank-line independent', () => {
  it('flex-item renders markdown with AND without blank lines (identical)', async () => {
    const withBlanks = `<flex>\n<flex-item>\n\n**bold** and *italic*\n\n</flex-item>\n</flex>`
    const without = `<flex>\n<flex-item>\n**bold** and *italic*\n</flex-item>\n</flex>`
    expect(await html(without)).toContain('<strong>bold</strong>')
    expect(await structure(without)).toBe(await structure(withBlanks))
  })

  it('flex-item renders headings and lists without blank lines', async () => {
    const out = await html(`<flex>\n<flex-item>\n## Title\n- one\n- two\n</flex-item>\n</flex>`)
    expect(out).toContain('<h2')
    expect(out).toContain('<ul')
    expect(out).toMatch(/<li[^>]*>one<\/li>/)
  })

  it('plain-text-only flex-item still renders (gate removed)', async () => {
    const out = await html(`<flex>\n<flex-item>\njust plain text\n</flex-item>\n</flex>`)
    expect(out).toContain('just plain text')
  })

  it('fullwidth renders markdown without blank lines', async () => {
    const out = await html(`<fullwidth>\n**wide** content\n</fullwidth>`)
    expect(out).toContain('<strong>wide</strong>')
  })

  it('left/center/right render markdown without blank lines', async () => {
    const out = await html(`<center>\n**centered**\n</center>`)
    expect(out).toContain('<strong>centered</strong>')
    expect(out).toContain('es-align-center')
  })

  it('nested tabs > tab-item > flex > flex-item resolves without any blank lines', async () => {
    const md = `<tabs-container data-items='["A"]'>\n<tab-item>\n<flex>\n<flex-item>\n**deep**\n</flex-item>\n</flex>\n</tab-item>\n</tabs-container>`
    const out = await html(md)
    expect(out).toContain('<strong>deep</strong>')
  })

  it('content after a closing container tag is NOT absorbed (no blank line after)', async () => {
    // No blank line between </flex> and the next heading used to swallow it.
    const out = await html(`<flex>\n<flex-item>\nhi\n</flex-item>\n</flex>\n## After\nFinal paragraph.`)
    expect(out).toMatch(/<h2[^>]*>After<\/h2>/)
    expect(out).toContain('Final paragraph.')
    expect(out).not.toContain('## After') // not literal text
  })

  it('content after </question> is NOT absorbed (no blank line after)', async () => {
    const out = await html(`<question id="q" type="single">\nPick\n<answer correct="true">A</answer>\n<answer>B</answer>\n</question>\n## Next section\nbody`)
    expect(out).toMatch(/<h2[^>]*>Next section<\/h2>/)
    expect(out).not.toContain('## Next section')
  })

  it('blank line INSIDE a flex-item does not break it', async () => {
    const out = await html(`<flex>\n<flex-item>\n\nSecond column.\n</flex-item>\n</flex>\n## After`)
    expect(out).toContain('Second column.')
    expect(out).toMatch(/<h2[^>]*>After<\/h2>/)
  })

  it('question: answers stay direct children regardless of blank-line spacing', async () => {
    // <answer> must NOT be wrapped in a <p> (which detaches it from <question>
    // and breaks option parsing). All three spacings must converge.
    const variants = [
      `<question id="p9" type="single">\nPrompt?\n\n<answer>A</answer>\n<answer correct="true">B</answer>\n\n</question>`, // blank after prompt + before close
      `<question id="p9" type="single">\nPrompt?\n\n<answer>A</answer>\n<answer correct="true">B</answer>\n</question>`, // blank after prompt only
      `<question id="p9" type="single">\nPrompt?\n<answer>A</answer>\n<answer correct="true">B</answer>\n</question>`, // no blanks
    ]
    for (const md of variants) {
      const out = await html(md)
      expect((out.match(/<answer/g) || []).length).toBe(2)
      // No paragraph wrapping the answers.
      expect(out).not.toMatch(/<p[^>]*>\s*<answer/)
    }
  })
})
