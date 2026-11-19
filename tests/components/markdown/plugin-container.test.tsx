import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { createPortal } from 'react-dom'

const session = { accountType: 'student' as 'student' | 'teacher' }

vi.mock('next-themes', () => ({ useTheme: () => ({ resolvedTheme: 'light', forcedTheme: undefined }) }))
vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { accountType: session.accountType } } }),
}))
vi.mock('@/lib/userdata/hooks', () => ({ useUserData: () => ({ data: null, updateData: vi.fn() }) }))
vi.mock('@/contexts/current-site-context', () => ({ useCurrentSite: () => ({ siteId: 's1' }) }))
vi.mock('@/hooks/use-realtime-events', () => ({ useRealtimeEvents: () => {} }))

import { PluginContainer } from '@/components/markdown/plugin-container'

const SID = 'plugin-teacher-slow'
const wrapper = () => document.querySelector(`[data-section-id="${SID}"]`) as HTMLElement | null

// Stands in for SectionAnchoredStrokes, which portals the stroke SVG into the
// element carrying data-section-id (section-anchored-strokes.tsx).
function StrokePortal({ target }: { target: HTMLElement | null }) {
  return target ? createPortal(<svg data-testid="strokes" />, target) : null
}

function okFetch() {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ plugin: { entryHtml: '<p>hi</p>', manifest: {} } }),
  })
}

async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
}

beforeEach(() => {
  vi.useFakeTimers()
  session.accountType = 'student'
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('PluginContainer keeps its section anchor in every state', () => {
  it('ready timeout with portaled strokes: no crash, same wrapper, strokes stay', async () => {
    vi.stubGlobal('fetch', okFetch())
    const { rerender } = render(<><PluginContainer src="teacher/slow" data-section-id={SID} /><StrokePortal target={null} /></>)
    await flush()
    rerender(<><PluginContainer src="teacher/slow" data-section-id={SID} /><StrokePortal target={wrapper()} /></>)
    const before = wrapper()
    expect(before).not.toBeNull()
    expect(screen.getByTestId('strokes').parentElement).toBe(before)

    await act(async () => { vi.advanceTimersByTime(5100) })
    expect(screen.getByText('This interactive element is not available right now.')).toBeTruthy()
    expect(wrapper()).toBe(before)
    expect(screen.getByTestId('strokes').parentElement).toBe(before)
    // The iframe stays mounted (hidden) so a late plugin:ready can recover.
    expect(before!.querySelector('iframe')?.style.display).toBe('none')
  })

  it('students never see the teacher "unresponsive" text', async () => {
    vi.stubGlobal('fetch', okFetch())
    render(<PluginContainer src="teacher/slow" data-section-id={SID} />)
    await flush()
    await act(async () => { vi.advanceTimersByTime(31000) })
    expect(screen.queryByText(/unresponsive/)).toBeNull()
    expect(screen.getByText('This interactive element is not available right now.')).toBeTruthy()
    expect(wrapper()).not.toBeNull()
  })

  it('teachers still see the unresponsive details', async () => {
    session.accountType = 'teacher'
    vi.stubGlobal('fetch', okFetch())
    render(<PluginContainer src="teacher/slow" data-section-id={SID} />)
    await flush()
    await act(async () => { vi.advanceTimersByTime(31000) })
    expect(screen.getByText(/is unresponsive/)).toBeTruthy()
    expect(wrapper()).not.toBeNull()
  })

  it('fetch error keeps the legacy section id (strokes stay attached)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }))
    render(<PluginContainer src="teacher/slow" data-section-id={SID} />)
    await flush()
    expect(screen.getByText('This interactive element is not available right now.')).toBeTruthy()
    expect(wrapper()).not.toBeNull()
    expect(wrapper()!.querySelector('iframe')).toBeNull()
  })

  it('invalid src keeps the section id', () => {
    vi.stubGlobal('fetch', okFetch())
    render(<PluginContainer src="noslash" data-section-id={SID} />)
    expect(screen.getByText(/Invalid plugin src/)).toBeTruthy()
    expect(wrapper()).not.toBeNull()
  })

  it('a plugin:ready after the timeout shows the plugin', async () => {
    vi.stubGlobal('fetch', okFetch())
    render(<PluginContainer src="teacher/slow" data-section-id={SID} />)
    await flush()
    await act(async () => { vi.advanceTimersByTime(6000) })
    const iframe = wrapper()!.querySelector('iframe') as HTMLIFrameElement
    expect(iframe.style.display).toBe('none')
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', { data: { type: 'plugin:ready' }, source: iframe.contentWindow }))
    })
    expect(iframe.style.display).toBe('block')
    expect(screen.queryByText('This interactive element is not available right now.')).toBeNull()
  })
})
