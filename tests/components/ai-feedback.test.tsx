import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { useState } from 'react'

// In-memory stand-in for the synced user-data store: survives unmount, so a
// remount behaves like a page reload that reads IndexedDB again.
const store = new Map<string, unknown>()

vi.mock('@/lib/userdata', () => ({
  userDataService: {
    get: vi.fn(async () => ({ data: { canvasData: '[]' } })),
  },
  useSyncedUserData: <T,>(pageId: string, componentId: string, initial: T | null) => {
    const key = `${pageId}:${componentId}`
    const [data, setData] = useState<T | null>(
      pageId ? ((store.get(key) as T | undefined) ?? initial) : initial
    )
    return {
      data,
      updateData: async (next: T) => {
        store.set(key, next)
        setData(next)
      },
      isLoading: false,
      isSynced: true,
    }
  },
}))

vi.mock('@/hooks/use-stroke-animation', () => ({ parseStrokes: () => [] }))

const renderPng = vi.fn<() => { dataUrl: string } | null>()
vi.mock('@/lib/annotations/render-strokes-to-png', () => ({
  renderStrokesToPng: () => renderPng(),
}))

import { AIFeedback } from '@/components/markdown/ai-feedback'

function sseResponse(text: string): Response {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode(`data: ${JSON.stringify({ type: 'content', content: text })}\n\n`)
      )
      controller.close()
    },
  })
  return new Response(body, { status: 200 })
}

function renderOnPaper() {
  return render(
    <div id="paper">
      <AIFeedback pageId="page-1" feedbackId="a1" />
    </div>
  )
}

describe('<ai-feedback>', () => {
  beforeEach(() => {
    store.clear()
    renderPng.mockReset()
    vi.restoreAllMocks()
  })

  it('shows the last feedback again after a reload', async () => {
    renderPng.mockReturnValue({ dataUrl: 'data:image/png;base64,AAAA' })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(sseResponse('Gut gemacht, **x = 2** stimmt.'))

    const first = renderOnPaper()
    fireEvent.click(screen.getByRole('button', { name: /get ai feedback/i }))
    await screen.findByText(/Gut gemacht/)
    await waitFor(() => expect(store.size).toBe(1))
    first.unmount()

    renderOnPaper()
    expect(await screen.findByText(/Gut gemacht/)).toBeInTheDocument()
  })

  it('clears the "nothing written" error once the student draws', async () => {
    renderPng.mockReturnValue(null)
    renderOnPaper()

    fireEvent.click(screen.getByRole('button', { name: /get ai feedback/i }))
    expect(await screen.findByText(/Nothing written in this section yet/)).toBeInTheDocument()

    act(() => {
      window.dispatchEvent(new Event('eduskript:annotations-changed'))
    })
    expect(screen.queryByText(/Nothing written in this section yet/)).not.toBeInTheDocument()
  })
})
