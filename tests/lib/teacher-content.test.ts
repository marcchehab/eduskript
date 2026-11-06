import { describe, it, expect } from 'vitest'
import { stripTeacherContent, publicContent } from '@/lib/teacher-content'
import { generateExcerpt } from '@/lib/markdown'
import { extractFeedbackContext } from '@/lib/ai/feedback-context'

const PAGE = [
  '# Aufgabe 1',
  '',
  'Berechne $x$.',
  '',
  '<solution teacher title="Lösung 1">',
  '',
  'SECRET_SOLUTION $x = 42$',
  '',
  '</solution>',
  '',
  '| A | B |',
  '|---|---|',
  '| 0 | <blank width="1cm" answer="$q_1$" /> |',
  '',
  '<solution>public solution</solution>',
].join('\n')

describe('stripTeacherContent', () => {
  it('removes teacher solution bodies and blank answers, keeping the line count', () => {
    const { content, solutions, answers } = stripTeacherContent(PAGE)
    expect(content).not.toContain('SECRET_SOLUTION')
    expect(content).not.toContain('q_1')
    expect(content).not.toMatch(/answer=/)
    expect(content.split('\n')).toHaveLength(PAGE.split('\n').length)
    expect(content).toContain('<solution teacher data-teacher-slot="0">')
    expect(content).not.toContain('Lösung 1')
    expect(content).toContain('<blank width="1cm" data-teacher-slot="0" />')
    expect(content).toContain('<solution>public solution</solution>')
    expect(solutions).toHaveLength(1)
    expect(solutions[0].title).toBe('Lösung 1')
    expect(solutions[0].markdown).toContain('SECRET_SOLUTION')
    expect(answers).toEqual(['$q_1$'])
  })

  it('numbers slots in document order and is idempotent', () => {
    const md = '<blank answer="a" /> <blank answer=\'b\' />\n\n<solution teacher>A</solution>\n<solution teacher>B</solution>'
    const once = stripTeacherContent(md)
    expect(once.answers).toEqual(['a', 'b'])
    expect(once.solutions.map((x) => x.markdown)).toEqual(['A', 'B'])
    expect(once.content).toContain('data-teacher-slot="1" />')
    expect(publicContent(once.content)).toBe(once.content)
  })

  it('leaves code, normal/hidden solutions and teacher="false" alone', () => {
    const md = [
      '```md',
      '<solution teacher>FENCED</solution> <blank answer="F" />',
      '```',
      'Inline `<blank answer="INLINE" />` example.',
      '<solution title="for the teacher">open</solution>',
      '<solution hidden>ai only</solution>',
      '<solution teacher="false">visible</solution>',
    ].join('\n')
    expect(stripTeacherContent(md).content).toBe(md)
  })

  it('strips an unclosed teacher solution to the end', () => {
    const { content } = stripTeacherContent('a\n<solution teacher>\nSECRET\nmore')
    expect(content).toBe('a\n<solution teacher data-teacher-slot="0">\n\n')
  })

  it('keeps answers with ">" and quotes inside', () => {
    const { content, answers } = stripTeacherContent('<blank answer="$a > b$" label="x:" />')
    expect(answers).toEqual(['$a > b$'])
    expect(content).toBe('<blank data-teacher-slot="0" label="x:" />')
  })
})

describe('teacher content outside the renderer', () => {
  it('is not in the SEO excerpt', () => {
    expect(generateExcerpt('Intro text.\n\n<solution teacher>\nSECRET_EXCERPT\n</solution>')).not.toContain('SECRET_EXCERPT')
  })

  it('reaches <ai-feedback> as a hidden reference, blank answers not at all', () => {
    const md = 'Fill in <blank answer="BLANK_SECRET" />\n\n<ai-feedback prompt="p" />\n\n<solution teacher>REF</solution>'
    const ctx = extractFeedbackContext(md)
    expect(ctx?.sectionMarkdown).not.toContain('BLANK_SECRET')
    expect(ctx?.solutions).toEqual([expect.objectContaining({ markdown: 'REF', hidden: true })])
  })
})
