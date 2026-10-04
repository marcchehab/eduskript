import { describe, it, expect } from 'vitest'
import { changedExcerpt } from '@/lib/ai/changed-excerpt'

const page = `# Title

Intro paragraph.

## Section

$$f(x) = x^2$$

Closing paragraph.`

describe('changedExcerpt', () => {
  it('returns only the inserted block, not the whole section', () => {
    const proposed = page.replace(
      'Closing paragraph.',
      '> [!exercise]+ Practice\n> Solve it.\n\nClosing paragraph.'
    )
    const { excerpt, removedOnly } = changedExcerpt(page, proposed)
    expect(removedOnly).toBe(false)
    expect(excerpt).toBe('> [!exercise]+ Practice\n> Solve it.')
  })

  it('widens to the whole block around an edited line', () => {
    const original = '> [!tip] Hint\n> line one\n> line two\n\nAfter.'
    const proposed = '> [!tip] Hint\n> line one changed\n> line two\n\nAfter.'
    expect(changedExcerpt(original, proposed).excerpt).toBe('> [!tip] Hint\n> line one changed\n> line two')
  })

  it('does not split a code fence at blank lines inside it', () => {
    const original = 'Before.\n\n```python\na = 1\n\nb = 2\n```\n\nAfter.'
    const proposed = original.replace('b = 2', 'b = 3')
    expect(changedExcerpt(original, proposed).excerpt).toBe('```python\na = 1\n\nb = 3\n```')
  })

  it('flags pure deletions', () => {
    const proposed = page.replace('Intro paragraph.\n\n', '')
    expect(changedExcerpt(page, proposed)).toEqual({ excerpt: '', removedOnly: true })
  })

  it('reports no change for identical content', () => {
    expect(changedExcerpt(page, page)).toEqual({ excerpt: '', removedOnly: false })
  })
})
