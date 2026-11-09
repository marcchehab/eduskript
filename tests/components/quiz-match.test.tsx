import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import { Question } from '@/components/markdown/quiz'
import { ExamPageContextProvider } from '@/contexts/exam-page-context'
import type { QuizData } from '@/lib/userdata/types'
import type { ComponentReview } from '@/contexts/exam-review-context'
import type { ReactNode } from 'react'
import { compileMarkdown } from '@/lib/markdown-compiler'
import { createMarkdownComponents } from '@/lib/markdown-components'
import { createEmptySkriptFiles } from '@/lib/skript-files'

// type="match" ("Zuordnen"): rows from <answer match> with content, dropdown of
// all targets, partial credit. See lib/match-question.ts.

const stored: { data: QuizData | null } = { data: null }
const updateData = vi.fn()
vi.mock('@/lib/userdata', () => ({
  useSyncedUserData: () => ({ data: stored.data, updateData, isLoading: false }),
}))

const reviewState: {
  mode: 'grade' | 'review'
  review: Partial<ComponentReview> | null
  refreshGrades: ReturnType<typeof vi.fn>
} = { mode: 'review', review: null, refreshGrades: vi.fn() }
vi.mock('@/contexts/exam-review-context', () => ({
  useComponentReview: () => ({
    active: reviewState.review != null,
    mode: reviewState.mode,
    pageId: 'page-1',
    studentId: reviewState.review ? 's1' : null,
    loadedStudentId: reviewState.review ? 's1' : null,
    review: reviewState.review,
    locked: true,
    rubricLocked: true,
    setOverride: vi.fn(),
    setFeedback: vi.fn(),
    setCriterion: vi.fn(),
    resetCriterion: vi.fn(),
    clearOverride: vi.fn(),
    clearAiScore: vi.fn(),
    refreshGrades: reviewState.refreshGrades,
  }),
  useExamReview: () => ({ active: false }),
}))

function renderMatch(extra: Record<string, unknown> = {}, data: QuizData | null = null) {
  stored.data = data
  return render(
    <Question id="z" pageId="page-1" type="match" points={6} {...extra}>
      <answer match="Parabel 10">x² − 1</answer>
      <answer match="Parabel 2" feedback="Look at the y-intercept.">x² − 5</answer>
      <answer match="Parabel 2">x² + 3</answer>
      <answer match="Parabel 1"></answer>
    </Question>
  )
}

const selects = () => screen.getAllByRole('combobox') as HTMLSelectElement[]
const choose = (row: number, target: string) => fireEvent.change(selects()[row], { target: { value: target } })
const checkButton = () => screen.queryByRole('button', { name: /check answer|check again/i })
const lastSaved = (): QuizData => updateData.mock.calls.at(-1)![0] as QuizData

beforeEach(() => {
  updateData.mockClear()
  reviewState.review = null
  reviewState.mode = 'review'
})

describe('match question rendering', () => {
  it('one row per answer with content; options = all targets, natural order', () => {
    renderMatch()
    expect(selects()).toHaveLength(3)
    const opts = Array.from(selects()[0].options).map((o) => o.value)
    expect(opts).toEqual(['', 'Parabel 1', 'Parabel 2', 'Parabel 10'])
    expect(screen.getByText('x² − 5')).toBeInTheDocument()
  })
})

describe('match question check mode', () => {
  it('Check needs every row; partial credit is saved; wrong rows marked, key hidden until final', () => {
    vi.useFakeTimers()
    try {
      renderMatch({ attempts: 2 })
      choose(0, 'Parabel 10')
      expect(checkButton()).toBeDisabled()
      expect(screen.getByText('Choose a match for every row first.')).toBeInTheDocument()
      choose(1, 'Parabel 1')
      choose(2, 'Parabel 2')
      act(() => { vi.advanceTimersByTime(1000) })
      expect(lastSaved()).toMatchObject({
        matchAnswer: { '0': 'Parabel 10', '1': 'Parabel 1', '2': 'Parabel 2' },
        matchScore: 4,
      })
      expect(lastSaved().matchRatio).toBeCloseTo(2 / 3)

      fireEvent.click(checkButton()!)
      expect(lastSaved()).toMatchObject({ attempts: 1, checked: false })
      expect(screen.getAllByLabelText('Correct')).toHaveLength(2)
      expect(screen.getAllByLabelText('Incorrect')).toHaveLength(1)
      // Row feedback shows for the checked row, the key does not (attempt left).
      expect(screen.getByText('Look at the y-intercept.')).toBeInTheDocument()
      expect(screen.queryByText(/Correct match:/)).not.toBeInTheDocument()

      fireEvent.click(checkButton()!)
      expect(lastSaved()).toMatchObject({ attempts: 2, checked: true })
      expect(screen.getByText(/Correct match:/)).toBeInTheDocument()
      expect(screen.getByText('2 of 3 rows correct')).toBeInTheDocument()
      expect(screen.getByText('4 / 6 pts')).toBeInTheDocument()
      selects().forEach((s) => expect(s).toBeDisabled())
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('match question on an exam page', () => {
  it('autosaves silently, no Check button, no marks', () => {
    vi.useFakeTimers()
    try {
      stored.data = null
      render(
        <ExamPageContextProvider>
          <Question id="z" pageId="page-1" type="match" points={2}>
            <answer match="A">a</answer>
            <answer match="B">b</answer>
          </Question>
        </ExamPageContextProvider>
      )
      choose(0, 'B')
      act(() => { vi.advanceTimersByTime(1000) })
      expect(lastSaved()).toMatchObject({ isSubmitted: true, matchAnswer: { '0': 'B' }, matchScore: 0 })
      expect(checkButton()).not.toBeInTheDocument()
      expect(screen.queryByLabelText('Incorrect')).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('match question exam grading (teacher device auto-score)', () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    fetchMock.mockReset()
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('persists points × correct rows / rows as the check score', async () => {
    reviewState.mode = 'grade'
    reviewState.review = {
      componentId: 'quiz-z',
      kind: 'quiz',
      questionType: 'match',
      max: 6,
      earned: 0,
      autoEarned: 0,
      aiEarned: null,
      effectiveSource: null,
      overridden: false,
      feedback: null,
      answered: true,
      // Client-stored score is ignored: the teacher's device re-derives it.
      answerPayload: { isSubmitted: true, matchAnswer: { '0': 'Parabel 10', '2': 'Parabel 1' }, matchScore: 6 },
      sources: [],
      rubric: null,
    } as Partial<ComponentReview>
    renderMatch()
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/api/exams/page-1/check-run')
    expect(JSON.parse(init.body)).toMatchObject({ studentId: 's1', componentId: 'quiz-z', earned: 2, max: 6 })
    // Review shows the key for the wrong and the blank row.
    expect(screen.getAllByText(/Correct match:/)).toHaveLength(2)
  })
})

describe('match question through the markdown pipeline', () => {
  it('sanitize keeps match=, math renders in rows, empty answer is a distractor', async () => {
    const components = createMarkdownComponents(createEmptySkriptFiles(), { pageId: 'p1' })
    stored.data = null
    const md = [
      '<question id="zuordnen-c" type="match" points="6">',
      'Ordnen Sie jeder Funktion die passende Parabel zu.',
      '<answer match="Parabel 1">$f(x)=x^2-1$</answer>',
      '',
      '<answer match="Parabel 2">$f(x)=x^2-5$</answer>',
      '<answer match="Parabel 3" feedback="optional per-row feedback">$f(x)=x^2+3$</answer>',
      '<answer match="Parabel 4"></answer>',
      '</question>',
    ].join('\n')
    const tree = (await compileMarkdown(md, { components })) as ReactNode
    const { container } = render(<>{tree}</>)
    expect(selects()).toHaveLength(3)
    expect(Array.from(selects()[0].options).map((o) => o.value)).toEqual([
      '', 'Parabel 1', 'Parabel 2', 'Parabel 3', 'Parabel 4',
    ])
    expect(container.querySelectorAll('[data-match-row] .katex').length).toBe(3)
  })
})
