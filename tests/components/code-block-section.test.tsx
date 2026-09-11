import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { compileMarkdown } from '@/lib/markdown-compiler'
import { createMarkdownComponents } from '@/lib/markdown-components'
import { createEmptySkriptFiles } from '@/lib/skript-files'

vi.mock('@/lib/userdata', () => ({
  useSyncedUserData: () => ({ data: null, updateData: vi.fn(), isLoading: false }),
}))

async function renderMd(md: string) {
  const components = createMarkdownComponents(createEmptySkriptFiles(), { pageId: 'p1' })
  const tree = (await compileMarkdown(md, { components })) as ReactNode
  return render(<>{tree}</>)
}

/**
 * rehypeHeadingSectionIds tags every <pre> with data-section-id, but language
 * code blocks are rendered by CodeBlock and the <pre> is dropped. PreComponent
 * must forward the id onto its wrapper, otherwise strokes drawn on a code block
 * anchor to the preceding heading and shift when the user font size changes
 * (code blocks don't scale with it).
 */
describe('code block annotation section', () => {
  it('language code block keeps its data-section-id in the DOM', async () => {
    const { container } = await renderMd('Intro\n\n```python\nx = 2\n```')
    const section = container.querySelector('[data-section-id="pre-0"]')
    expect(section).not.toBeNull()
    expect(section!.querySelector('.code-block')).not.toBeNull()
  })

  it('plain code block keeps its data-section-id on the <pre>', async () => {
    const { container } = await renderMd('Intro\n\n```\nplain\n```')
    const pre = container.querySelector('pre[data-section-id="pre-0"]')
    expect(pre).not.toBeNull()
  })
})
