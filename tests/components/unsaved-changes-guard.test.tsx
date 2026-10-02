import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/dashboard/skripts/s/pages/a/edit',
  useSearchParams: () => new URLSearchParams(),
}))

import Link from 'next/link'
import { useUnsavedChangesGuard } from '@/components/dashboard/unsaved-changes-guard'

function Harness({ dirty, onSave }: { dirty: boolean; onSave: () => Promise<boolean> }) {
  const guard = useUnsavedChangesGuard({ isDirty: dirty, onSave })
  return (
    <div>
      <Link href="/dashboard/skripts/s/pages/b/edit">Other page</Link>
      <a href="https://example.com/x">External</a>
      {guard.dialog}
    </div>
  )
}

function clickLink(name: string) {
  const link = screen.getByText(name)
  const ev = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
  act(() => { link.dispatchEvent(ev) })
  return ev
}

describe('useUnsavedChangesGuard (page editor: unsaved edits on page switch)', () => {
  beforeEach(() => push.mockReset())

  it('does not intercept navigation when there are no unsaved changes', () => {
    render(<Harness dirty={false} onSave={vi.fn()} />)
    const ev = clickLink('Other page')
    // jsdom does not navigate; the guard must simply stay out of the way.
    expect(ev.defaultPrevented).toBe(false)
    expect(screen.queryByText('Unsaved changes')).toBeNull()
  })

  it('blocks an in-app link click when dirty and asks Save / Discard / Cancel', () => {
    render(<Harness dirty onSave={vi.fn()} />)
    const ev = clickLink('Other page')
    expect(ev.defaultPrevented).toBe(true)
    expect(screen.getByText('Unsaved changes')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Discard' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy()
    expect(push).not.toHaveBeenCalled()
  })

  it('Cancel stays on the page', async () => {
    render(<Harness dirty onSave={vi.fn()} />)
    clickLink('Other page')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByText('Unsaved changes')).toBeNull())
    expect(push).not.toHaveBeenCalled()
  })

  it('Discard navigates without saving', async () => {
    const onSave = vi.fn()
    render(<Harness dirty onSave={onSave} />)
    clickLink('Other page')
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(push).toHaveBeenCalledWith('/dashboard/skripts/s/pages/b/edit'))
    expect(onSave).not.toHaveBeenCalled()
  })

  it('Save saves first, then navigates', async () => {
    const onSave = vi.fn().mockResolvedValue(true)
    render(<Harness dirty onSave={onSave} />)
    clickLink('Other page')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(push).toHaveBeenCalledWith('/dashboard/skripts/s/pages/b/edit'))
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('Save that fails stays on the page', async () => {
    const onSave = vi.fn().mockResolvedValue(false)
    render(<Harness dirty onSave={onSave} />)
    clickLink('Other page')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 0))
    expect(push).not.toHaveBeenCalled()
  })

  it('leaves external links alone', () => {
    render(<Harness dirty onSave={vi.fn()} />)
    const ev = clickLink('External')
    expect(ev.defaultPrevented).toBe(false)
    expect(screen.queryByText('Unsaved changes')).toBeNull()
  })

  it('arms the browser beforeunload warning only while dirty', () => {
    const { rerender } = render(<Harness dirty={false} onSave={vi.fn()} />)
    const clean = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(clean)
    expect(clean.defaultPrevented).toBe(false)

    rerender(<Harness dirty onSave={vi.fn()} />)
    const dirty = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(dirty)
    expect(dirty.defaultPrevented).toBe(true)
  })
})
