import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Question } from '@/components/markdown/quiz'
import type { QuizData } from '@/lib/userdata/types'
import type { ComponentReview } from '@/contexts/exam-review-context'

// Student reviewing a returned exam: the auto-check box must not contradict the
// teacher's manual points (QA finding partially-correct-label-contradicts-manual-points).

const stored: { data: QuizData | null } = { data: null }
vi.mock('@/lib/userdata', () => ({
  useSyncedUserData: () => ({ data: stored.data, updateData: vi.fn(), isLoading: false }),
}))

const reviewState: { review: Partial<ComponentReview> | null } = { review: null }
vi.mock('@/contexts/exam-review-context', () => ({
  useComponentReview: () => ({
    active: reviewState.review != null,
    mode: 'review',
    pageId: 'page-1',
    studentId: null,
    loadedStudentId: null,
    review: reviewState.review,
    locked: true,
    rubricLocked: true,
    setOverride: vi.fn(),
    setFeedback: vi.fn(),
    setCriterion: vi.fn(),
    resetCriterion: vi.fn(),
    clearOverride: vi.fn(),
    clearAiScore: vi.fn(),
    refreshGrades: vi.fn(),
  }),
  useExamReview: () => ({ active: false }),
}))

const baseReview: Partial<ComponentReview> = {
  componentId: 'quiz-q',
  kind: 'quiz',
  questionType: 'text',
  max: 3,
  autoEarned: 0,
  aiEarned: null,
  answered: true,
  feedback: null,
  sources: [],
  rubric: null,
}

function renderText(review: Partial<ComponentReview> | null) {
  stored.data = { isSubmitted: true, textAnswer: '0 2 4' }
  reviewState.review = review
  return render(
    <Question id="q" pageId="page-1" type="text" expected={'0\n2\n4'} points={3}>
      What does the loop print?
    </Question>
  )
}

beforeEach(() => {
  reviewState.review = null
})

describe('auto-check box vs manual points', () => {
  it('labels a 0% auto-check result "Incorrect", not "Partially correct"', () => {
    renderText({ ...baseReview, earned: 0, effectiveSource: 'check', overridden: false })
    expect(screen.queryByText('Partially correct')).not.toBeInTheDocument()
    expect(screen.getByText('Incorrect')).toBeInTheDocument()
  })

  it('marks the auto-check as overridden once the teacher set points', () => {
    renderText({ ...baseReview, earned: 2, effectiveSource: 'override', overridden: true })
    // The teacher's points are shown (badge) …
    expect(screen.getByText('2 / 3')).toBeInTheDocument()
    // … and the stale auto-check score is not presented as the result.
    expect(screen.queryByText(/0 \/ 3 pts/)).not.toBeInTheDocument()
    expect(screen.getByText(/overridden by teacher/i)).toBeInTheDocument()
  })
})
