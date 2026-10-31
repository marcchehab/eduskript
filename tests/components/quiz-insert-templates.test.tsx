import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ReactNode } from 'react'
import { EditorState } from '@codemirror/state'
import { CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import { compileMarkdown } from '@/lib/markdown-compiler'
import { createMarkdownComponents } from '@/lib/markdown-components'
import { createEmptySkriptFiles } from '@/lib/skript-files'
import { parseGradableComponents } from '@/lib/scoring/components'
import { createMarkdownCompletions, quizTemplate } from '@/components/dashboard/markdown-completions'
import type { QuizData } from '@/lib/userdata/types'

const updateData = vi.fn()
vi.mock('@/lib/userdata', () => ({
  useSyncedUserData: () => ({ data: null, updateData, isLoading: false }),
}))

// `<` typed in the editor: the completion text is inserted after that `<`.
function tagCompletion(): string {
  const source = createMarkdownCompletions(() => [])
  const result = source(new CompletionContext(EditorState.create({ doc: '<' }), 1, false)) as CompletionResult
  const option = result.options.find((o) => o.label === 'question')!
  return `<${option.apply as string}`
}

// Ctrl+Space on an empty line: the completion text replaces nothing and keeps its `<`.
function ctrlSpaceCompletion(): string {
  const source = createMarkdownCompletions(() => [])
  const result = source(new CompletionContext(EditorState.create({ doc: '' }), 0, true)) as CompletionResult
  return result.options.find((o) => o.label === '<question>')!.apply as string
}

async function renderMd(md: string, pageId?: string) {
  const components = createMarkdownComponents(createEmptySkriptFiles(), pageId ? { pageId } : {})
  return render(<>{(await compileMarkdown(md, { components })) as ReactNode}</>)
}

const lastSaved = (): QuizData => updateData.mock.calls.at(-1)![0] as QuizData
const check = () => act(() => { fireEvent.click(screen.getByRole('button', { name: /check answer/i })) })

// The preview marks a correct option with the text "correct" on its <li>.
async function previewCorrectLabels(md: string) {
  const { container } = await renderMd(md)
  const rows = [...container.querySelectorAll('li')]
  return rows.filter((li) => /correct$/.test(li.textContent ?? '')).map((li) => li.textContent!.replace(/correct$/, ''))
}

beforeEach(() => {
  updateData.mockClear()
  cleanup()
})

describe.each([
  ['toolbar Quiz button', () => quizTemplate('single')],
  ['tag completion', tagCompletion],
  ['Ctrl+Space completion', ctrlSpaceCompletion],
])('quiz template from %s', (_name, template) => {
  it('marks the correct option in the preview', async () => {
    expect(await previewCorrectLabels(template())).toEqual(['Correct answer'])
  })

  it('scores the correct option as correct', async () => {
    await renderMd(template(), 'p1')
    fireEvent.click(screen.getByText('Correct answer'))
    check()
    expect(lastSaved()).toMatchObject({ checked: true, selected: [0], choiceScore: 1 })
    expect(screen.queryByText('Incorrect')).not.toBeInTheDocument()
  })

  it('scores the wrong option as wrong', async () => {
    await renderMd(template(), 'p1')
    fireEvent.click(screen.getByText('Wrong answer'))
    check()
    expect(lastSaved()).toMatchObject({ selected: [1], choiceScore: 0 })
  })

  it('has an explicit id, so answers are stored per question and exams list it', () => {
    const md = template()
    const [component] = parseGradableComponents(md)
    expect(component?.kind).toBe('quiz')
    expect(component.componentId).toMatch(/^quiz-.+/)
  })

  it('gets a new id on every insert', () => {
    expect(parseGradableComponents(template())[0].componentId)
      .not.toBe(parseGradableComponents(template())[0].componentId)
  })
})

describe('stored spellings of the correct flag', () => {
  it('scores is="correct" in a live question', async () => {
    await renderMd('<question id="q" type="single">\nPick\n<answer is="correct">Yes</answer>\n<answer>No</answer>\n</question>', 'p1')
    fireEvent.click(screen.getByText('Yes'))
    check()
    expect(lastSaved()).toMatchObject({ checked: true, choiceScore: 1 })
  })

  const question = (attr: string) =>
    `<question id="q" type="multiple">\nPick\n<answer${attr}>A</answer>\n<answer>B</answer>\n</question>`

  it.each([
    [' correct'],
    [' correct=""'],
    [' correct="true"'],
    [' correct="correct"'],
    [' is="correct"'],
  ])('<answer%s> is correct', async (attr) => {
    expect(await previewCorrectLabels(question(attr))).toEqual(['A'])
  })

  it.each([
    [''],
    [' correct="false"'],
    [' is="wrong"'],
    [' correct="false" is="correct"'],
  ])('<answer%s> is not correct', async (attr) => {
    expect(await previewCorrectLabels(question(attr))).toEqual([])
  })

  it.each([
    ['<Option correct>A</Option>'],
    ['<Option correct="true">A</Option>'],
    ['<Option is="correct">A</Option>'],
  ])('legacy %s is correct', async (option) => {
    const md = `<Question id="q" type="multiple">\nPick\n${option}\n<Option>B</Option>\n</Question>`
    expect(await previewCorrectLabels(md)).toEqual(['A'])
  })

  it.each([
    ['<Option correct="false">A</Option>'],
    ['<Option feedback="not correct here">A</Option>'],
  ])('legacy %s is not correct', async (option) => {
    const md = `<Question id="q" type="multiple">\n${option}\n<Option>B</Option>\n</Question>`
    expect(await previewCorrectLabels(md)).toEqual([])
  })
})

describe.each([
  ['docs/components/11-quizzes-and-tabs.md'],
  ['docs/de/komponenten/11-quiz-und-tabs.md'],
])('manual page %s', (path) => {
  it('renders options and auto-checks for its live examples', async () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
    const md = readFileSync(resolve(process.cwd(), path), 'utf8')
    expect(md).not.toContain('type="multi"')
    const { container } = await renderMd(md)
    // The two choice demos with bare correct, the multiple one with three.
    expect(container.textContent!.match(/Text answer · auto-checked/g)).toHaveLength(2)
    const correct = [...container.querySelectorAll('li')].filter((li) => /correct$/.test(li.textContent ?? ''))
    expect(correct.map((li) => li.textContent!.replace(/correct$/, ''))).toEqual(['def', 'tuple', 'str', 'frozenset', 'def'])
  })
})

// The remaining `type` values offered by attribute completion do not use
// <answer correct>: their target comes from `expected`.
describe('non-choice question types offered by completion', () => {
  it('text: an ```expected block turns on the auto-check', async () => {
    const { container } = await renderMd('<question id="q" type="text">\nOutput?\n\n```expected\n42\n```\n</question>')
    expect(container.textContent).toContain('auto-checked')
    expect(container.textContent).not.toContain('42')
  })

  it('text: a plain expected attribute also turns on the auto-check', async () => {
    const { container } = await renderMd('<question id="q" type="text" expected="42">\nOutput?\n</question>')
    expect(container.textContent).toContain('auto-checked')
    expect(container.textContent).not.toContain('42')
  })

  it('text: without expected there is no auto-check', async () => {
    const { container } = await renderMd('<question id="q" type="text">\nOutput?\n</question>')
    expect(container.textContent).not.toContain('auto-checked')
  })

  it('number: expected reaches the question', async () => {
    const { container } = await renderMd('<question id="q" type="number" minValue="-2" maxValue="2" expected="-1">\nx?\n</question>')
    expect(container.textContent).toContain('expected -1')
  })

  it('range: expected reaches the question', async () => {
    const { container } = await renderMd('<question id="q" type="range" minValue="-2" maxValue="2" expected="-1..1">\nx?\n</question>')
    expect(container.textContent).toContain('expected -1..1')
  })
})
