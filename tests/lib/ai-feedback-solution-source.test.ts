import { describe, it, expect } from 'vitest'
import { getAiFeedbackSolution, setAiFeedbackSolution } from '@/lib/ai-feedback-solution-source'

const page = [
  '## Aufgabe 1',                                  // 1
  '<ai-feedback prompt="Check forces" />',         // 2
  '',                                              // 3
  '```markdown',                                   // 4
  '<ai-feedback prompt="example" />',              // 5
  '```',                                           // 6
  '<ai-feedback prompt="Second" solution="old.png" />', // 7
].join('\n')

describe('ai-feedback solution in source', () => {
  it('reads the value by source line', () => {
    expect(getAiFeedbackSolution(page, 2)).toBe('')
    expect(getAiFeedbackSolution(page, 7)).toBe('old.png')
    expect(getAiFeedbackSolution(page, 3)).toBeNull()
  })

  it('ignores tags inside fenced code', () => {
    expect(getAiFeedbackSolution(page, 5)).toBeNull()
    expect(setAiFeedbackSolution(page, 5, 'x.png')).toBeNull()
  })

  it('adds a solution to a tag without one', () => {
    const out = setAiFeedbackSolution(page, 2, 'kraefte-loesung')!
    expect(out.split('\n')[1]).toBe('<ai-feedback prompt="Check forces" solution="kraefte-loesung" />')
    expect(out.split('\n')[6]).toBe(page.split('\n')[6])
  })

  it('replaces an existing solution', () => {
    const out = setAiFeedbackSolution(page, 7, 'new.png')!
    expect(out.split('\n')[6]).toBe('<ai-feedback prompt="Second" solution="new.png" />')
  })

  it('removes the solution', () => {
    const out = setAiFeedbackSolution(page, 7, null)!
    expect(out.split('\n')[6]).toBe('<ai-feedback prompt="Second" />')
  })

  it('handles a non-self-closing tag', () => {
    const out = setAiFeedbackSolution('<ai-feedback prompt="p"></ai-feedback>', 1, 'a.png')
    expect(out).toBe('<ai-feedback prompt="p" solution="a.png"></ai-feedback>')
  })
})

describe('insertHiddenSolution', () => {
  it('inserts a hidden block after the tag, excali for drawings, ![]() for images', async () => {
    const { insertHiddenSolution } = await import('@/lib/ai-feedback-solution-source')
    const src = 'Task\n<ai-feedback prompt="x" />\nNext'
    expect(insertHiddenSolution(src, 2, 'forces')).toBe(
      'Task\n<ai-feedback prompt="x" />\n\n<solution hidden>\n\n<excali src="forces" />\n\n</solution>\nNext',
    )
    expect(insertHiddenSolution(src, 2, 'a.png')).toContain('![](a.png)')
    expect(insertHiddenSolution(src, 1, 'a.png')).toBeNull()
  })
})
