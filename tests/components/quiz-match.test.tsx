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
import { useSession } from 'next-auth/react'
import { shuffleTargets } from '@/lib/match-question'

// type="match" ("Zuordnen"): rows from <answer match> with content connected
// to shuffled targets on a two-column board (match-board.tsx), partial credit.
// See lib/match-question.ts.

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

const rowEl = (i: number) => document.querySelector(`[data-match-row="${i}"]`) as HTMLElement
const targetEl = (t: string) => document.querySelector(`[data-match-target="${t}"]`) as HTMLElement
const shownTargets = () =>
  Array.from(document.querySelectorAll('[data-match-target]')).map((el) => el.getAttribute('data-match-target'))
// Tap a row, then tap a target.
const connect = (row: number, target: string) => {
  fireEvent.click(rowEl(row))
  fireEvent.click(targetEl(target))
}
const checkButton = () => screen.queryByRole('button', { name: /check answer|check again/i })
const lastSaved = (): QuizData => updateData.mock.calls.at(-1)![0] as QuizData
const flushAutosave = () => act(() => { vi.advanceTimersByTime(1000) })

beforeEach(() => {
  updateData.mockClear()
  reviewState.review = null
  reviewState.mode = 'review'
  vi.mocked(useSession).mockReturnValue({ data: null, status: 'unauthenticated' } as ReturnType<typeof useSession>)
})

describe('match question rendering', () => {
  it('rows in authored order; targets = all distinct matches incl. distractor, shuffled by question + user', () => {
    renderMatch()
    expect(document.querySelectorAll('[data-match-row]')).toHaveLength(3)
    expect(screen.getByText('x² − 5')).toBeInTheDocument()
    expect(shownTargets()).toEqual(shuffleTargets(['Parabel 1', 'Parabel 2', 'Parabel 10'], 'quiz-z:'))
  })

  it('the shuffle uses the signed-in user and is stable across renders', () => {
    vi.mocked(useSession).mockReturnValue({ data: { user: { id: 'u7' } }, status: 'authenticated' } as ReturnType<typeof useSession>)
    const first = renderMatch()
    const order = shownTargets()
    expect(order).toEqual(shuffleTargets(['Parabel 1', 'Parabel 2', 'Parabel 10'], 'quiz-z:u7'))
    first.unmount()
    renderMatch()
    expect(shownTargets()).toEqual(order)
  })
})

describe('match question connect interactions', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('tap row, tap target connects; a target takes several rows; × removes', () => {
    renderMatch({ feedback: 'none' })
    connect(0, 'Parabel 2')
    connect(1, 'Parabel 2')
    flushAutosave()
    expect(lastSaved().matchAnswer).toEqual({ '0': 'Parabel 2', '1': 'Parabel 2' })
    expect(document.querySelectorAll('[data-match-line]')).toHaveLength(2)
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove connection' })[0])
    flushAutosave()
    expect(lastSaved().matchAnswer).toEqual({ '1': 'Parabel 2' })
  })

  it('pointer drag from a row onto a target connects; dropping in empty space removes', () => {
    renderMatch({ feedback: 'none' })
    const order = shownTargets() as string[]
    // Targets stacked at x 200..300, 50 px apart; everything else has no box.
    const spy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const t = this.getAttribute('data-match-target')
      const i = t ? order.indexOf(t) : -1
      if (i < 0) return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON() {} } as DOMRect
      return { left: 200, right: 300, top: i * 50, bottom: i * 50 + 40, width: 100, height: 40, x: 200, y: i * 50, toJSON() {} } as DOMRect
    })
    try {
      fireEvent.pointerDown(rowEl(2), { pointerId: 1, button: 0, clientX: 10, clientY: 10 })
      fireEvent.pointerMove(window, { pointerId: 1, clientX: 150, clientY: 60 })
      fireEvent.pointerUp(window, { pointerId: 1, clientX: 250, clientY: 70 })
      flushAutosave()
      expect(lastSaved().matchAnswer).toEqual({ '2': order[1] })

      fireEvent.pointerDown(rowEl(2), { pointerId: 2, button: 0, clientX: 10, clientY: 10 })
      fireEvent.pointerMove(window, { pointerId: 2, clientX: 120, clientY: 400 })
      fireEvent.pointerUp(window, { pointerId: 2, clientX: 120, clientY: 400 })
      flushAutosave()
      expect(lastSaved().matchAnswer).toEqual({})
    } finally {
      spy.mockRestore()
    }
  })

  it('keyboard: Enter on a row, arrow to a target, Enter connects and returns focus', () => {
    renderMatch({ feedback: 'none' })
    const order = shownTargets() as string[]
    rowEl(1).focus()
    fireEvent.keyDown(rowEl(1), { key: 'Enter' })
    expect(document.activeElement).toBe(targetEl(order[0]))
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(targetEl(order[1]))
    fireEvent.keyDown(document.activeElement!, { key: 'Enter' })
    expect(document.activeElement).toBe(rowEl(1))
    flushAutosave()
    expect(lastSaved().matchAnswer).toEqual({ '1': order[1] })
    fireEvent.keyDown(rowEl(1), { key: 'Delete' })
    flushAutosave()
    expect(lastSaved().matchAnswer).toEqual({})
  })
})

describe('match question check mode', () => {
  it('Check needs every row; partial credit is saved; wrong rows marked, key hidden until final', () => {
    vi.useFakeTimers()
    try {
      renderMatch({ attempts: 2 })
      connect(0, 'Parabel 10')
      expect(checkButton()).toBeDisabled()
      expect(screen.getByText('Connect every row first.')).toBeInTheDocument()
      connect(1, 'Parabel 1')
      connect(2, 'Parabel 2')
      flushAutosave()
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
      expect(document.querySelectorAll('[data-match-key-line]')).toHaveLength(0)

      fireEvent.click(checkButton()!)
      expect(lastSaved()).toMatchObject({ attempts: 2, checked: true })
      expect(screen.getByText(/Correct match:/)).toBeInTheDocument()
      expect(document.querySelectorAll('[data-match-key-line]')).toHaveLength(1)
      expect(screen.getByText('2 of 3 rows correct')).toBeInTheDocument()
      expect(screen.getByText('4 / 6 pts')).toBeInTheDocument()
      // Locked: tapping no longer changes anything.
      updateData.mockClear()
      connect(0, 'Parabel 1')
      flushAutosave()
      expect(updateData).not.toHaveBeenCalled()
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
      connect(0, 'B')
      flushAutosave()
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
    expect(document.querySelectorAll('[data-match-row]')).toHaveLength(3)
    expect([...shownTargets()].sort()).toEqual(['Parabel 1', 'Parabel 2', 'Parabel 3', 'Parabel 4'])
    expect(container.querySelectorAll('[data-match-row] .katex').length).toBe(3)
  })
})
