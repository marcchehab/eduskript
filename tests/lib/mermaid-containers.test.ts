import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement, type ReactNode } from 'react'
import { compileMarkdown } from '@/lib/markdown-compiler'
import { createMarkdownComponents } from '@/lib/markdown-components'
import { createEmptySkriptFiles } from '@/lib/skript-files'

// A ```mermaid fence becomes <mermaid-diagram>, which renders a loading
// placeholder on the server. It used to be converted at the top level only,
// so inside a callout it stayed a plain code block.
// The real <solution> is collapsed until clicked and renders no children on the
// server, so it is replaced by a plain wrapper here.
async function html(md: string): Promise<string> {
  const components = {
    ...createMarkdownComponents(createEmptySkriptFiles()),
    solution: ({ children }: { children?: ReactNode }) => createElement('div', null, children),
  }
  return renderToStaticMarkup((await compileMarkdown(md, { components })) as ReactNode)
}

const FENCE = '```mermaid\ngraph LR\n  A --> B\n```'
const quoted = (text: string) => text.split('\n').map((line) => `> ${line}`).join('\n')

const CASES: Record<string, string> = {
  'at the top level': FENCE,
  'in a callout, after text': `> [!example] Beispiel\n> Text\n>\n${quoted(FENCE)}`,
  'in a callout, right under the title': `> [!example] Beispiel\n${quoted(FENCE)}`,
  'in a nested callout': `> [!note] A\n> > [!tip] B\n${quoted(quoted(FENCE))}`,
  'in a list item': `- Punkt\n\n  ${FENCE.replace(/\n/g, '\n  ')}`,
  'in a <flex-item>': `<flex>\n<flex-item>\n\n${FENCE}\n\n</flex-item>\n</flex>`,
  'in a <flex-item> without blank lines': `<flex>\n<flex-item>\n${FENCE}\n</flex-item>\n</flex>`,
  'in a <solution>': `<solution>\n\n${FENCE}\n\n</solution>`,
  'in a <solution> without blank lines': `<solution>\n${FENCE}\n</solution>`,
  'in a callout inside a <solution>': `<solution>\n\n> [!note] X\n${quoted(FENCE)}\n\n</solution>`,
}

describe('mermaid fences in containers', () => {
  for (const [where, md] of Object.entries(CASES)) {
    it(`renders a diagram ${where}`, async () => {
      const out = await html(md)
      expect(out).toContain('mermaid-loading')
      expect(out).not.toContain('graph LR')
    })
  }
})
