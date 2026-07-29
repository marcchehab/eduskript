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

describe('question prompt rendering', () => {
  it('keeps KaTeX in a slider prompt', async () => {
    const { container } = await renderMd(
      '<question id="q" type="number" minValue="-2" maxValue="2" step="0.1">\nBei welchem $x$ liegt der Hochpunkt von $f(x) = x^2$?\n</question>'
    )
    expect(container.querySelectorAll('.katex').length).toBe(2)
  })

  it('keeps KaTeX in a choice prompt', async () => {
    const { container } = await renderMd(
      '<question id="q2" type="single">\nWie gross ist $f(1)$?\n<answer correct="true">1</answer>\n</question>'
    )
    expect(container.querySelectorAll('.katex').length).toBe(1)
  })
})

describe('multi-line opening tag', () => {
  it('still renders KaTeX in the prompt', async () => {
    const { container } = await renderMd(
      '<question id="q3" type="number" points="2" showFeedback="true"\n          minValue="-2" maxValue="2" step="0.1" expected="-1" tolerance="0.15">\nBei welchem $x$ liegt der Hochpunkt von $f(x) = x^2$?\n<answer from="1" feedback="ja"></answer>\n</question>'
    )
    expect(container.querySelectorAll('.katex').length).toBe(2)
  })
})
