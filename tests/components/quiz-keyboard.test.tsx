import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Question } from '@/components/markdown/quiz'
import type { QuizData } from '@/lib/userdata/types'

// Choice options must be operable by keyboard and exposed to assistive tech as
// radios/checkboxes (QA finding quiz-options-not-keyboard-accessible).
const stored: { data: QuizData | null } = { data: null }
const updateData = vi.fn()
vi.mock('@/lib/userdata', () => ({
  useSyncedUserData: () => ({ data: stored.data, updateData, isLoading: false }),
}))

function renderQuiz(type: 'single' | 'multiple', data: QuizData | null = null, extra: Record<string, unknown> = {}) {
  stored.data = data
  return render(
    <Question id="q" pageId="page-1" type={type} {...extra}>
      <answer>alpha</answer>
      <answer correct="true">beta</answer>
      <answer>gamma</answer>
    </Question>
  )
}

beforeEach(() => {
  updateData.mockClear()
})

describe('single choice keyboard / a11y', () => {
  it('exposes a radiogroup of radios with aria-checked', () => {
    renderQuiz('single')
    expect(screen.getByRole('radiogroup')).toBeInTheDocument()
    const radios = screen.getAllByRole('radio')
    expect(radios).toHaveLength(3)
    expect(radios.map(r => r.getAttribute('aria-checked'))).toEqual(['false', 'false', 'false'])
    expect(screen.getByRole('radio', { name: 'beta' })).toBeInTheDocument()
  })

  it('uses a roving tabindex: first option tabbable when nothing is selected', () => {
    renderQuiz('single')
    const radios = screen.getAllByRole('radio')
    expect(radios.map(r => r.tabIndex)).toEqual([0, -1, -1])
  })

  it('Space and Enter select the focused option', () => {
    renderQuiz('single')
    const [a, b] = screen.getAllByRole('radio')
    fireEvent.keyDown(b, { key: ' ' })
    expect(b).toHaveAttribute('aria-checked', 'true')
    expect(screen.getAllByRole('radio').map(r => r.tabIndex)).toEqual([-1, 0, -1])
    fireEvent.keyDown(a, { key: 'Enter' })
    expect(a).toHaveAttribute('aria-checked', 'true')
    expect(b).toHaveAttribute('aria-checked', 'false')
  })

  it('arrow keys move focus and selection, wrapping around', () => {
    renderQuiz('single')
    const [a, b, c] = screen.getAllByRole('radio')
    a.focus()
    fireEvent.keyDown(a, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(b)
    expect(b).toHaveAttribute('aria-checked', 'true')
    fireEvent.keyDown(b, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(c)
    fireEvent.keyDown(c, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(a)
    expect(a).toHaveAttribute('aria-checked', 'true')
    fireEvent.keyDown(a, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(c)
    expect(c).toHaveAttribute('aria-checked', 'true')
  })

  it('locked question: aria-disabled and keys do not change the answer', () => {
    renderQuiz('single', { isSubmitted: true, selected: [0], attempts: 1, checked: true })
    const [a, b] = screen.getAllByRole('radio')
    expect(a).toHaveAttribute('aria-disabled', 'true')
    fireEvent.keyDown(b, { key: ' ' })
    expect(a).toHaveAttribute('aria-checked', 'true')
    expect(b).toHaveAttribute('aria-checked', 'false')
  })
})

describe('multiple choice keyboard / a11y', () => {
  it('exposes a group of checkboxes, each tabbable', () => {
    renderQuiz('multiple')
    expect(screen.getByRole('group')).toBeInTheDocument()
    const boxes = screen.getAllByRole('checkbox')
    expect(boxes).toHaveLength(3)
    expect(boxes.map(b => b.tabIndex)).toEqual([0, 0, 0])
  })

  it('Space toggles a checkbox', () => {
    renderQuiz('multiple')
    const [a, , c] = screen.getAllByRole('checkbox')
    fireEvent.keyDown(a, { key: ' ' })
    fireEvent.keyDown(c, { key: 'Enter' })
    expect(a).toHaveAttribute('aria-checked', 'true')
    expect(c).toHaveAttribute('aria-checked', 'true')
    fireEvent.keyDown(a, { key: ' ' })
    expect(a).toHaveAttribute('aria-checked', 'false')
  })
})
