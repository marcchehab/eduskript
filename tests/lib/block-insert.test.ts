import { describe, it, expect } from 'vitest'
import { planBlockInsert } from '@/lib/block-insert'

const QUIZ = '<question id="q1" type="single">\nQ\n</question>\n'

function apply(doc: string, pos: number, template: string) {
  const p = planBlockInsert(doc, pos, template)
  return { text: doc.slice(0, p.from) + p.insert + doc.slice(p.from), plan: p }
}

describe('planBlockInsert', () => {
  it('does not glue a quiz onto the callout title the cursor is in (QA repro)', () => {
    const doc = 'Intro\n\n> [!tip] Title\n> Content\n'
    const pos = doc.indexOf('Title') + 2 // cursor mid-title
    const { text } = apply(doc, pos, QUIZ)
    expect(text).toBe('Intro\n\n> [!tip] Title\n> Content\n\n<question id="q1" type="single">\nQ\n</question>\n')
  })

  it('puts the block after the current line with blank lines around when mid-line', () => {
    const doc = 'first line\nsecond line\n\nnext para'
    const { text } = apply(doc, 3, QUIZ)
    expect(text).toBe('first line\n\n<question id="q1" type="single">\nQ\n</question>\n\nsecond line\n\nnext para')
  })

  it('inserts at an empty line without piling up blank lines', () => {
    const doc = 'para\n\n\nmore'
    const { text } = apply(doc, 6, '<ping />\n')
    expect(text).toBe('para\n\n<ping />\n\nmore')
  })

  it('inserts into an empty document without leading newlines', () => {
    expect(apply('', 0, '\n<fullwidth>\n\n</fullwidth>\n').text).toBe('<fullwidth>\n\n</fullwidth>\n')
  })

  it('inserts before a line when the cursor is at its start', () => {
    const doc = 'para\n\nhello'
    const { text } = apply(doc, 6, '<ping />')
    expect(text).toBe('para\n\n<ping />\n\nhello')
  })

  it('reports where the template body starts so callers can select placeholders', () => {
    const doc = 'abc'
    const { text, plan } = apply(doc, 1, '> [!tip] Title\n> Content')
    expect(text.slice(plan.bodyStart, plan.bodyStart + 14)).toBe('> [!tip] Title')
    expect(text.slice(plan.cursor - 1, plan.cursor)).toBe('\n')
  })
})
