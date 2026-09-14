import { describe, it, expect } from 'vitest'
import { extractFeedbackContext, solutionFilename } from '@/lib/ai/feedback-context'

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
  it('finds the tag by id and scopes from the preceding h2 down to the tag', () => {
    const ctx = extractFeedbackContext(PAGE, 'fb1')
    expect(ctx).not.toBeNull()
    expect(ctx!.prompt).toBe('Check each step.')
    expect(ctx!.sectionMarkdown).toContain('## Exercise 1')
    expect(ctx!.sectionMarkdown).toContain('Simplify $2x + 3x$.')
    expect(ctx!.sectionMarkdown).not.toContain('More notes.') // below the tag
    expect(ctx!.sectionMarkdown).not.toContain('Exercise 2')
    expect(ctx!.sectionMarkdown).not.toContain('Algebra basics')
  })

  it('does not treat h3 headings as boundaries', () => {
    const ctx = extractFeedbackContext(PAGE, 'fb2')
    expect(ctx!.prompt).toBe('Do not reveal the solution.')
    expect(ctx!.sectionMarkdown).toContain('## Exercise 2')
    expect(ctx!.sectionMarkdown).toContain('Solve $x^2 = 9$.')
    expect(ctx!.sectionMarkdown).toContain('### Hints')
    expect(ctx!.sectionMarkdown).toContain('A hint under an h3.')
    expect(ctx!.sectionMarkdown).not.toContain('Exercise 3')
  })

  it('gives each of several tags under one h2 only the text above it', () => {
    const page = [
      '## Hallo',
      '',
      'Erste Erklärung.',
      '',
      '<ai-feedback id="a" prompt="Prompt A." />',
      '',
      'Zweite Erklärung.',
      '',
      '<ai-feedback id="b" prompt="Prompt B." />',
      '',
      'Beispiel darunter.',
    ].join('\n')
    const a = extractFeedbackContext(page, 'a')!
    expect(a.prompt).toBe('Prompt A.')
    expect(a.sectionMarkdown).toBe('## Hallo\n\nErste Erklärung.')

    const b = extractFeedbackContext(page, 'b')!
    expect(b.prompt).toBe('Prompt B.')
    expect(b.sectionMarkdown).toContain('Erste Erklärung.')
    expect(b.sectionMarkdown).toContain('Zweite Erklärung.')
    expect(b.sectionMarkdown).not.toContain('Prompt A.')
    expect(b.sectionMarkdown).not.toContain('<ai-feedback')
    expect(b.sectionMarkdown).not.toContain('Beispiel darunter.')
  })

  it('removes the inner content of earlier paired ai-feedback blocks', () => {
    const page = '## S\n\n<ai-feedback id="a" prompt="A">\ninner\n</ai-feedback>\n\nText.\n\n<ai-feedback id="b" prompt="B" />'
    const ctx = extractFeedbackContext(page, 'b')!
    expect(ctx.sectionMarkdown).toContain('Text.')
    expect(ctx.sectionMarkdown).not.toContain('inner')
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
    expect(ctx!.sectionMarkdown).toContain('### Hints')
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
      'Above the tag.',
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

  it('returns the solution attribute, and null without one', () => {
    const page = '## S\n\n<excali src="task" />\n\n<ai-feedback id="a" solution="task-solution" prompt="p" />\n\n<ai-feedback id="b" prompt="q" />\n'
    expect(extractFeedbackContext(page, 'a')!.solution).toBe('task-solution')
    expect(extractFeedbackContext(page, 'b')!.solution).toBeNull()
  })

  it("keeps an earlier tag's solution out of a later tag's section markdown", () => {
    const page = '## S\n\n<ai-feedback solution="secret-1" />\n\n<ai-feedback id="later" />\n'
    const ctx = extractFeedbackContext(page, 'later')
    expect(ctx!.solution).toBeNull()
    expect(ctx!.sectionMarkdown).not.toContain('secret-1')
  })
})

describe('solutionFilename', () => {
  it('maps a bare name or .excalidraw name to the light SVG export', () => {
    expect(solutionFilename('forces')).toBe('forces.excalidraw.light.svg')
    expect(solutionFilename('forces.excalidraw')).toBe('forces.excalidraw.light.svg')
    expect(solutionFilename(' forces ')).toBe('forces.excalidraw.light.svg')
  })

  it('passes image files through unchanged', () => {
    expect(solutionFilename('solution.png')).toBe('solution.png')
    expect(solutionFilename('Solution.JPG')).toBe('Solution.JPG')
    expect(solutionFilename('diagram.svg')).toBe('diagram.svg')
  })
})
