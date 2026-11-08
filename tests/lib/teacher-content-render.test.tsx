import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import { compileMarkdown } from '@/lib/markdown-compiler'
import { createMarkdownComponents } from '@/lib/markdown-components'
import { createEmptySkriptFiles } from '@/lib/skript-files'

// No DB: the page has no skriptId, so no files are looked up anyway.
vi.mock('@/lib/skript-files.server', () => ({ getSkriptFiles: async () => createEmptySkriptFiles() }))
vi.mock('next-auth/react', () => ({ useSession: () => ({ status: 'unauthenticated', data: null }) }))

const PAGE = [
  '# Wahrheitstabelle',
  '',
  '| A | B | A ∧ B |',
  '|---|---|---|',
  '| 0 | 1 | <blank width="1cm" answer="$q_{SECRET}$" /> |',
  '',
  'Lücke im Text: <blank answer="**BLANK_SECRET**" />.',
  '',
  '<solution teacher title="Für Lehrpersonen">',
  '',
  'TEACHER_SECRET $x^2$',
  '',
  '</solution>',
  '',
  '<solution>PUBLIC_SOLUTION</solution>',
].join('\n')

describe('teacher content, student render (ServerMarkdownRenderer)', () => {
  it('contains no teacher solution and no blank answer', async () => {
    const { ServerMarkdownRenderer } = await import('@/components/markdown/markdown-renderer.server')
    const tree = await ServerMarkdownRenderer({ content: PAGE, pageId: 'p1' })
    const html = renderToStaticMarkup(<>{tree}</>)
    expect(html).not.toContain('TEACHER_SECRET')
    expect(html).not.toContain('SECRET')
    expect(html).not.toContain('Für Lehrpersonen')
    expect(html).not.toContain('Teachers only')
    expect(html).not.toContain('answer=')
    // The blanks are still there, empty, also inside the table cell.
    expect(html.match(/class="blank-line"/g)).toHaveLength(2)
    expect(html).toMatch(/<td[^>]*><span aria-hidden="true" class="blank-line"/)
    // Normal solution boxes are unchanged.
    expect(html).toContain('Solution')
  })
})

describe('teacher content, editor preview (full markdown)', () => {
  async function render(md: string) {
    const components = createMarkdownComponents(createEmptySkriptFiles(), { pageId: 'p1' })
    const tree = (await compileMarkdown(md, { components })) as ReactNode
    return renderToStaticMarkup(<>{tree}</>)
  }

  it('renders a blank answer with math in pen colour, also inside a table cell', async () => {
    const html = await render(PAGE)
    expect(html).toMatch(/<td[^>]*><span class="blank-line"[^>]*><span class="blank-answer"><span class="katex"/)
    expect(html).toContain('<span class="blank-answer"><strong>BLANK_SECRET</strong></span>')
  })

  it('marks a teacher solution as "Teachers only"', async () => {
    const html = await render(PAGE)
    expect(html).toContain('Für Lehrpersonen')
    expect(html).not.toContain('Solution: Für Lehrpersonen')
    expect(html).toContain('Teachers only')
  })
})
