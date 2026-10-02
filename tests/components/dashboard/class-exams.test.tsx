import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ClassExams } from '@/components/dashboard/class-exams'

describe('ClassExams', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('shows each exam with counts and a link to its grading page', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          exams: [
            {
              pageId: 'p1',
              title: 'Klassenarbeit 2',
              memberCount: 20,
              handedIn: 18,
              graded: 5,
              returned: 2,
              lastSubmittedAt: null,
              gradingUrl: '/dashboard/exams/p1/grading?classId=c1',
              examUrl: null,
            },
          ],
        }),
      }),
    )
    render(<ClassExams classId="c1" />)
    expect(await screen.findByText('Klassenarbeit 2')).toBeInTheDocument()
    expect(screen.getByText(/Handed in 18\/20 · Graded 5 · Returned 2/)).toBeInTheDocument()
    expect(screen.getByText('13 to grade')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Grade/ })).toHaveAttribute(
      'href',
      '/dashboard/exams/p1/grading?classId=c1',
    )
    expect(fetch).toHaveBeenCalledWith('/api/classes/c1/exams')
  })

  it('explains the empty state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ exams: [] }) }))
    render(<ClassExams classId="c1" />)
    expect(await screen.findByText(/No exams yet/)).toBeInTheDocument()
  })
})
