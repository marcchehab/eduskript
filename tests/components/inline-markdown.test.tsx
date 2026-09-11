import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { InlineMarkdown } from '@/components/ui/inline-markdown'
import { plainInlineText } from '@/lib/markdown'

describe('InlineMarkdown', () => {
  it('renders <nobr> as a nowrap span, not literal text', () => {
    const { container } = render(<InlineMarkdown>{'Kanti <nobr>Wettingen AG</nobr> Info'}</InlineMarkdown>)
    expect(container.textContent).toBe('Kanti Wettingen AG Info')
    const nowrap = container.querySelector('span.whitespace-nowrap')
    expect(nowrap?.textContent).toBe('Wettingen AG')
  })

  it('keeps links working inside <nobr>', () => {
    const { container } = render(
      <InlineMarkdown>{'by <nobr>[eduskript.org](https://eduskript.org)</nobr>'}</InlineMarkdown>
    )
    const a = container.querySelector('span.whitespace-nowrap a')
    expect(a?.getAttribute('href')).toBe('https://eduskript.org')
    expect(a?.textContent).toBe('eduskript.org')
  })

  it('leaves other HTML as literal text', () => {
    const { container } = render(<InlineMarkdown>{'a <b>b</b>'}</InlineMarkdown>)
    expect(container.textContent).toBe('a <b>b</b>')
    expect(container.querySelector('b')).toBeNull()
  })
})

describe('plainInlineText', () => {
  it('strips nobr tags and reduces links to text', () => {
    expect(plainInlineText('Kanti <nobr>Wettingen AG</nobr> by [eduskript](https://eduskript.org)'))
      .toBe('Kanti Wettingen AG by eduskript')
  })
})
