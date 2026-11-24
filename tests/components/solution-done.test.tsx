import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { Solution } from '@/components/markdown/solution'
import type { SolutionProgress } from '@/components/markdown/solution-progress-bar'

// "Done" checkbox of <solution> (solution.tsx). useSyncedUserData is replaced
// by component state, so every write is visible on the next render.
const writes: SolutionProgress[] = []
vi.mock('@/lib/userdata', () => ({
  useSyncedUserData: () => {
    const [data, setData] = useState<SolutionProgress | null>(null)
    return {
      data,
      updateData: async (d: SolutionProgress) => { writes.push(d); setData(d) },
      isLoading: false,
    }
  },
}))

const renderSolution = () =>
  render(<Solution title="Lösung 1" pageId="p1" solutionId="solution@h2-@a#1">x = 1</Solution>)
const header = () => screen.getByRole('button', { name: /Lösung 1/ })
const box = () => screen.getByRole('checkbox') as HTMLInputElement

describe('<solution> Done checkbox', () => {
  beforeEach(() => { writes.length = 0 })

  it('opening ticks it (opened + done)', () => {
    renderSolution()
    expect(box().checked).toBe(false)
    fireEvent.click(header())
    expect(box().checked).toBe(true)
    expect(writes.at(-1)).toEqual({ done: true, opened: true, manual: false })
  })

  it('after an untick, opening again changes nothing', () => {
    renderSolution()
    fireEvent.click(header())
    fireEvent.click(box())
    expect(writes.at(-1)).toEqual({ done: false, opened: true, manual: true })
    fireEvent.click(header()) // close
    fireEvent.click(header()) // open again
    expect(box().checked).toBe(false)
    expect(writes).toHaveLength(2)
  })

  it('a manual tick without opening counts as opened + done and does not open it', () => {
    renderSolution()
    fireEvent.click(box())
    expect(writes.at(-1)).toEqual({ done: true, opened: true, manual: true })
    expect(header().getAttribute('aria-expanded')).toBe('false')
  })

  it('teacher solutions and solutions without id have no checkbox', () => {
    render(<Solution title="T" pageId="p1" solutionId="solution@h2-@a#1" teacher>x</Solution>)
    render(<Solution title="N" pageId="p1">x</Solution>)
    expect(screen.queryByRole('checkbox')).toBeNull()
  })
})
