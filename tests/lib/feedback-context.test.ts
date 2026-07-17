import { describe, it, expect } from 'vitest'
import { extractFeedbackContext } from '@/lib/ai/feedback-context'

const PAGE = `# Algebra basics

Intro text.

## Exercise 1

Simplify $2x + 3x$.

<ai-feedback id="fb1" prompt="Check each step." />

More notes.

## Exercise 2

Solve $x^2 = 9$.

### Hints

A hint under an h3.

<ai-feedback id="fb2" prompt="Do not reveal the solution." />

## Exercise 3

Nothing here.
`

describe('extractFeedbackContext', () => {
  it('finds the tag by id and scopes to the enclosing H2 section', () => {
    const ctx = extractFeedbackContext(PAGE, 'fb1')
    expect(ctx).not.toBeNull()
    expect(ctx!.prompt).toBe('Check each step.')
    expect(ctx!.sectionMarkdown).toContain('## Exercise 1')
    expect(ctx!.sectionMarkdown).toContain('Simplify $2x + 3x$.')
    expect(ctx!.sectionMarkdown).toContain('More notes.')
    expect(ctx!.sectionMarkdown).not.toContain('Exercise 2')
    expect(ctx!.sectionMarkdown).not.toContain('Algebra basics')
  })

  it('does not treat h3 headings as section boundaries', () => {
    const ctx = extractFeedbackContext(PAGE, 'fb2')
    expect(ctx!.prompt).toBe('Do not reveal the solution.')
    expect(ctx!.sectionMarkdown).toContain('## Exercise 2')
    expect(ctx!.sectionMarkdown).toContain('### Hints')
    expect(ctx!.sectionMarkdown).not.toContain('Exercise 3')
  })

  it('strips ai-feedback tags from the section markdown', () => {
    const ctx = extractFeedbackContext(PAGE, 'fb1')
    expect(ctx!.sectionMarkdown).not.toContain('<ai-feedback')
    expect(ctx!.sectionMarkdown).not.toContain('Check each step.')
  })

  it('falls back to the first tag when no id is given', () => {
    const ctx = extractFeedbackContext(PAGE)
    expect(ctx!.prompt).toBe('Check each step.')
  })

  it('selects the nth tag by feedbackIndex when no id is given', () => {
    expect(extractFeedbackContext(PAGE, null, 0)!.prompt).toBe('Check each step.')
    const ctx = extractFeedbackContext(PAGE, null, 1)
    expect(ctx!.prompt).toBe('Do not reveal the solution.')
    expect(ctx!.sectionMarkdown).toContain('## Exercise 2')
    expect(extractFeedbackContext(PAGE, null, 5)).toBeNull()
  })

  it('id wins over index when both are given', () => {
    expect(extractFeedbackContext(PAGE, 'fb2', 0)!.prompt).toBe('Do not reveal the solution.')
  })

  it('returns null when the id does not match any tag', () => {
    expect(extractFeedbackContext(PAGE, 'nope')).toBeNull()
  })

  it('returns null when the page has no ai-feedback tag', () => {
    expect(extractFeedbackContext('# Just text\n\nHello.')).toBeNull()
  })

  it('ignores tags and headings inside code fences', () => {
    const page = [
      '## Real section',
      '',
      '```html',
      '<ai-feedback id="fake" prompt="in a fence" />',
      '## not a heading',
      '```',
      '',
      '<ai-feedback id="real" prompt="Real prompt." />',
      '',
      '## Next section',
    ].join('\n')
    const ctx = extractFeedbackContext(page, 'real')
    expect(ctx!.prompt).toBe('Real prompt.')
    expect(ctx!.sectionMarkdown).toContain('## Real section')
    expect(ctx!.sectionMarkdown).toContain('## not a heading') // fence content kept, not a boundary
    expect(ctx!.sectionMarkdown).not.toContain('## Next section')
    expect(extractFeedbackContext(page, 'fake')).toBeNull()
  })

  it('uses the page start when there is no heading above the tag', () => {
    const page = 'Some intro.\n\n<ai-feedback prompt="p" />\n\n## Later'
    const ctx = extractFeedbackContext(page)
    expect(ctx!.sectionMarkdown).toContain('Some intro.')
    expect(ctx!.sectionMarkdown).not.toContain('## Later')
  })

  it('handles a multi-line opening tag', () => {
    const page = '## S\n\n<ai-feedback id="ml"\n  prompt="Multi line." />\n'
    const ctx = extractFeedbackContext(page, 'ml')
    expect(ctx!.prompt).toBe('Multi line.')
  })
})
