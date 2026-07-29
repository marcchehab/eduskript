import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Question } from '@/components/markdown/quiz'
import type { QuizData } from '@/lib/userdata/types'

// The question persists through useSyncedUserData; the test supplies a stored
// answer directly instead of standing up the IndexedDB provider.
const stored: { data: QuizData | null } = { data: null }
vi.mock('@/lib/userdata', () => ({
  useSyncedUserData: () => ({ data: stored.data, updateData: vi.fn(), isLoading: false }),
}))

function renderSlider(data: QuizData, extra: Record<string, unknown> = {}) {
  stored.data = data
  return render(
    <Question
      id="q"
      pageId="page-1"
      type="number"
      minValue={-2}
      maxValue={2}
      step={0.1}
      expected="-1"
      tolerance={0.15}
      points={2}
      showFeedback
      {...extra}
    >
      <answer from="1" feedback="Spot on"></answer>
      <answer from="0.7" feedback="Close, look at the derivative"></answer>
      <answer feedback="Not yet"></answer>
    </Question>
  )
}

describe('slider feedback', () => {
  it('awards full points and the top band inside the tolerance', () => {
    renderSlider({ isSubmitted: true, numberAnswer: -1 })
    expect(screen.getByText('Correct')).toBeInTheDocument()
    expect(screen.getByText('Spot on')).toBeInTheDocument()
    expect(screen.getByText(/2 \/ 2 pts · 100%/)).toBeInTheDocument()
  })

  it('picks the middle band for a near miss', () => {
    renderSlider({ isSubmitted: true, numberAnswer: -0.7 })
    expect(screen.getByText('Partially correct')).toBeInTheDocument()
    expect(screen.getByText('Close, look at the derivative')).toBeInTheDocument()
  })

  it('falls through to the catch-all band when far off', () => {
    renderSlider({ isSubmitted: true, numberAnswer: 1.5 })
    expect(screen.getByText('Incorrect')).toBeInTheDocument()
    expect(screen.getByText('Not yet')).toBeInTheDocument()
    expect(screen.getByText(/0 \/ 2 pts · 0%/)).toBeInTheDocument()
  })

  it('stays silent until an answer exists', () => {
    renderSlider({ isSubmitted: false, numberAnswer: -1 })
    expect(screen.queryByText('Spot on')).not.toBeInTheDocument()
  })

  it('stays silent when the author did not opt into feedback', () => {
    renderSlider({ isSubmitted: true, numberAnswer: -1 }, { showFeedback: undefined })
    expect(screen.queryByText('Spot on')).not.toBeInTheDocument()
  })

  it('does not grade a slider without a target', () => {
    renderSlider({ isSubmitted: true, numberAnswer: -1 }, { expected: undefined })
    expect(screen.queryByText('Correct')).not.toBeInTheDocument()
  })

  it('scores a two-handle range by overlap', () => {
    // Twice as wide as the target interval → half the overlap ratio.
    renderSlider(
      { isSubmitted: true, rangeAnswer: { min: -2, max: 2 } },
      { type: 'range', expected: '-1..1' }
    )
    expect(screen.getByText('Partially correct')).toBeInTheDocument()
    expect(screen.getByText(/1 \/ 2 pts · 50%/)).toBeInTheDocument()
  })
})
