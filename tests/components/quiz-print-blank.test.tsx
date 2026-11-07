import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { Question } from '@/components/markdown/quiz'
import { setPrintState } from '@/lib/print/print-mode'
import type { QuizData } from '@/lib/userdata/types'

// A printout is a blank worksheet: a question the viewer answered must print
// as unanswered, without touching the stored answer.
const stored: { data: QuizData | null } = { data: null }
const updateData = vi.fn()
vi.mock('@/lib/userdata', () => ({
  useSyncedUserData: () => ({ data: stored.data, updateData, isLoading: false }),
}))

const print = (active: boolean) => act(() => { setPrintState({ active }) })

beforeEach(() => {
  updateData.mockClear()
})
afterEach(() => {
  print(false)
})

function renderChoice(type: 'single' | 'multiple', extra: Record<string, unknown>, data: QuizData) {
  stored.data = data
  return render(
    <Question id="q" pageId="page-1" type={type} {...extra}>
      <answer feedback="21 = 3 · 7">21</answer>
      <answer correct="true">23</answer>
      <answer feedback="25 = 5 · 5">25</answer>
    </Question>
  )
}

const options = () => Array.from(document.querySelectorAll<HTMLElement>('[role="radio"], [role="checkbox"]'))

describe('print view prints questions blank', () => {
  it('single choice, checked wrong: no selection, marks, feedback or counters', () => {
    const { container } = renderChoice('single', { attempts: 3 }, { isSubmitted: true, selected: [0], attempts: 3, checked: true })
    expect(screen.getByText('21 = 3 · 7')).toBeInTheDocument()
    expect(screen.getByText(/Checked after 3 attempts/)).toBeInTheDocument()

    print(true)
    expect(options().map((o) => o.getAttribute('aria-checked'))).toEqual(['false', 'false', 'false'])
    expect(screen.queryByText('21 = 3 · 7')).not.toBeInTheDocument()
    // Online-only rows stay in the layout, invisible (card height).
    expect(screen.getByText(/Checked after/).closest('.invisible')).not.toBeNull()
    expect(container.querySelector('[class*="border-green"], [class*="border-red"], .border-primary')).toBeNull()
    expect(container.querySelector('.lucide-x, .lucide-check')).toBeNull()
    // Not shown as locked on paper.
    expect(options()[0].className).not.toMatch(/cursor-default/)

    print(false)
    expect(options()[0].getAttribute('aria-checked')).toBe('true')
    expect(screen.getByText('21 = 3 · 7')).toBeInTheDocument()
    expect(updateData).not.toHaveBeenCalled()
  })

  it('multiple choice with instant feedback', () => {
    renderChoice('multiple', { feedback: 'instant' }, { isSubmitted: true, selected: [0, 1] })
    print(true)
    expect(options().every((o) => o.getAttribute('aria-checked') === 'false')).toBe(true)
    expect(screen.queryByText('21 = 3 · 7')).not.toBeInTheDocument()
  })

  it('a click on the printed card does not change the stored answer', () => {
    vi.useFakeTimers()
    try {
      renderChoice('single', {}, { isSubmitted: true, selected: [0] })
      print(true)
      fireEvent.click(screen.getByText('25'))
      act(() => { vi.advanceTimersByTime(2000) })
      print(false)
      expect(options()[0].getAttribute('aria-checked')).toBe('true')
      expect(updateData).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('text / predict-output: empty textarea, no result panel', () => {
    stored.data = { isSubmitted: true, textAnswer: '42', textRatio: 0, attempts: 1, checked: true }
    render(
      <Question id="t" pageId="page-1" type="text" expected="43">
        <question-prompt>What prints?</question-prompt>
      </Question>
    )
    const box = screen.getByRole('textbox') as HTMLTextAreaElement
    expect(box.value).toBe('42')
    expect(screen.getByText('Incorrect')).toBeInTheDocument()

    print(true)
    expect(box.value).toBe('')
    expect(box.className).not.toMatch(/opacity-70/)
    expect(screen.queryByText('Incorrect')).not.toBeInTheDocument()
    expect(screen.queryByText(/expected/)).not.toBeInTheDocument()

    print(false)
    expect(box.value).toBe('42')
    expect(updateData).not.toHaveBeenCalled()
  })

  it('number slider: initial position, write-in line, no feedback panel', () => {
    stored.data = { isSubmitted: true, numberAnswer: 70, attempts: 1, checked: true }
    render(<Question id="n" pageId="page-1" type="number" minValue={0} maxValue={100} expected="50" />)
    const slider = screen.getByRole('slider') as HTMLInputElement
    expect(slider.value).toBe('70')
    expect(screen.getByText(/Correct answer/)).toBeInTheDocument()

    print(true)
    expect(slider.value).toBe('0')
    expect(screen.getByText(/Your answer: _+/)).toBeInTheDocument()
    expect(screen.queryByText(/Correct answer/)).not.toBeInTheDocument()
    expect(screen.queryByText(/pts/)).not.toBeInTheDocument()

    print(false)
    expect(slider.value).toBe('70')
    expect(updateData).not.toHaveBeenCalled()
  })

  it('range slider: full span, write-in lines', () => {
    stored.data = { isSubmitted: true, rangeAnswer: { min: 20, max: 30 } }
    render(<Question id="r" pageId="page-1" type="range" minValue={0} maxValue={100} feedback="none" />)
    const [lo, hi] = screen.getAllByRole('slider') as HTMLInputElement[]
    expect([lo.value, hi.value]).toEqual(['20', '30'])

    print(true)
    expect([lo.value, hi.value]).toEqual(['0', '100'])
    expect(screen.getByText(/Your answer: _+ – _+/)).toBeInTheDocument()

    print(false)
    expect([lo.value, hi.value]).toEqual(['20', '30'])
  })
})
