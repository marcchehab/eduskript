import { describe, it, expect } from 'vitest'
import type { EditorView } from '@codemirror/view'
import { addQuestionIds, findQuestionsWithoutId } from '@/lib/question-ids'
import { questionIdDiagnostics } from '@/components/dashboard/question-id-lint'
import { parseGradableComponents } from '@/lib/scoring/components'

const tags = (doc: string) => findQuestionsWithoutId(doc).map((q) => doc.slice(q.from, q.to))

describe('findQuestionsWithoutId', () => {
  it('finds a question without an id', () => {
    expect(tags('<question type="single">\n</question>')).toEqual(['<question type="single">'])
    expect(tags('<question>\n</question>')).toEqual(['<question>'])
  })

  it('finds a multi-line opening tag', () => {
    const tag = '<question type="number"\n  minValue="1">'
    expect(tags(`${tag}\n</question>`)).toEqual([tag])
  })

  it('accepts ids in any attribute position and quote style', () => {
    expect(tags('<question id="a">')).toEqual([])
    expect(tags('<question type="single" id="a">')).toEqual([])
    expect(tags("<question id='a'>")).toEqual([])
    expect(tags('<question type="text"\n  id="a">')).toEqual([])
  })

  it('does not read an id out of another attribute value', () => {
    const tag = '<question type="single" feedback=" id=x">'
    expect(tags(tag)).toEqual([tag])
  })

  it('handles > inside a quoted value', () => {
    const tag = '<question minLabel="a > b">'
    expect(tags(tag)).toEqual([tag])
  })

  it('skips fenced blocks and inline code', () => {
    expect(tags('```html\n<question>\n```')).toEqual([])
    expect(tags('~~~\n<question>\n~~~')).toEqual([])
    expect(tags('````html\n```\n<question>\n```\n````')).toEqual([])
    expect(tags('> ```html\n> <question>\n> ```')).toEqual([])
    expect(tags('Use `<question>` here.')).toEqual([])
    expect(tags('```html\n<question>')).toEqual([])
  })

  it('finds a question after a fence', () => {
    expect(tags('```\n<question>\n```\n\n<question>')).toEqual(['<question>'])
  })

  it('ignores PascalCase, which gets a content-hash id, and <question-prompt>', () => {
    expect(tags('<Question type="single">\n<Option>A</Option>\n</Question>')).toEqual([])
    expect(tags('<question-prompt>')).toEqual([])
  })
})

describe('addQuestionIds', () => {
  it('inserts ids so the questions become gradable, leaving the rest unchanged', () => {
    const doc = 'a\n\n<question type="single">\n</question>\n\n<question id="keep">\n</question>\n\n<question>\n</question>\n'
    const { content, ids } = addQuestionIds(doc, (i) => `n${i}`)
    expect(ids).toEqual(['n0', 'n1'])
    expect(content).toBe('a\n\n<question id="n0" type="single">\n</question>\n\n<question id="keep">\n</question>\n\n<question id="n1">\n</question>\n')
    expect(parseGradableComponents(content).map((c) => c.componentId)).toEqual(['quiz-n0', 'quiz-keep', 'quiz-n1'])
  })

  it('finds nothing left on a second run', () => {
    const { content } = addQuestionIds('<question>\n</question>', () => 'a')
    expect(addQuestionIds(content, () => 'b')).toEqual({ content, ids: [] })
  })
})

describe('questionIdDiagnostics', () => {
  it('warns once per question and the action adds an id at the shifted position', () => {
    const doc = 'text\n<question type="single">\n</question>'
    const [diagnostic, ...rest] = questionIdDiagnostics(doc)
    expect(rest).toEqual([])
    expect(diagnostic.severity).toBe('warning')
    expect(diagnostic.from).toBe(5)

    const dispatched: unknown[] = []
    const view = { dispatch: (spec: unknown) => dispatched.push(spec) } as unknown as EditorView
    diagnostic.actions![0].apply(view, 10, 34)
    expect(dispatched).toEqual([
      { changes: { from: 10 + '<question'.length, insert: expect.stringMatching(/^ id="\w+"$/) } },
    ])
  })
})
