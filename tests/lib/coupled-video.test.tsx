import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { ReactNode } from 'react'
import {
  CoupledVideoProvider,
  useCoupledVideo,
  useVideoGate,
  parseTimecode,
} from '@/components/markdown/coupled-video-context'

// jsdom under vitest doesn't always provide Storage; polyfill a minimal one.
if (typeof window !== 'undefined' && !window.localStorage) {
  const store = new Map<string, string>()
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      get length() {
        return store.size
      },
    },
  })
}

describe('parseTimecode', () => {
  it('parses plain seconds', () => expect(parseTimecode('90')).toBe(90))
  it('parses m:ss', () => expect(parseTimecode('1:30')).toBe(90))
  it('parses h:mm:ss', () => expect(parseTimecode('1:02:03')).toBe(3723))
  it('passes through a number', () => expect(parseTimecode(45)).toBe(45))
  it('returns NaN for junk', () => expect(Number.isNaN(parseTimecode('x:y'))).toBe(true))
  it('returns NaN for undefined', () => expect(Number.isNaN(parseTimecode(undefined))).toBe(true))
})

function makeWrapper(initialCoupled: boolean) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <CoupledVideoProvider pageId="page-1" initialCoupled={initialCoupled}>
        {children}
      </CoupledVideoProvider>
    )
  }
}

describe('CoupledVideoProvider', () => {
  beforeEach(() => window.localStorage.clear())

  it('keeps gates sorted by time and tracks passed state', () => {
    const { result } = renderHook(() => useCoupledVideo()!, { wrapper: makeWrapper(true) })

    act(() => {
      result.current.registerGate('late', 180)
      result.current.registerGate('early', 90)
    })
    expect(result.current.gates.map((g) => g.key)).toEqual(['early', 'late'])

    const versionBefore = result.current.passedVersion
    act(() => result.current.markPassed('early'))
    expect(result.current.isPassed('early')).toBe(true)
    expect(result.current.passedVersion).toBeGreaterThan(versionBefore)
  })

  it('persists the coupling toggle to localStorage', () => {
    const { result } = renderHook(() => useCoupledVideo()!, { wrapper: makeWrapper(true) })
    act(() => result.current.setCoupled(false))
    expect(window.localStorage.getItem('coupled-video:page-1:coupled')).toBe('false')
    expect(result.current.coupled).toBe(false)
  })
})

describe('useVideoGate', () => {
  beforeEach(() => window.localStorage.clear())

  function renderGate(initialCoupled: boolean) {
    const pause = vi.fn()
    const play = vi.fn()
    const { result } = renderHook(
      () => {
        const ctx = useCoupledVideo()!
        const gate = useVideoGate({ pause, play })
        return { ctx, gate }
      },
      { wrapper: makeWrapper(initialCoupled) },
    )
    return { result, pause, play }
  }

  it('pauses on reaching an un-passed gate, then resumes when it passes', () => {
    const { result, pause, play } = renderGate(true)
    act(() => result.current.ctx.registerGate('g1', 100))

    act(() => result.current.gate.onTimeUpdate(50))
    expect(pause).not.toHaveBeenCalled()

    act(() => result.current.gate.onTimeUpdate(100))
    expect(pause).toHaveBeenCalledTimes(1)

    act(() => result.current.ctx.markPassed('g1'))
    expect(play).toHaveBeenCalledTimes(1)
  })

  it('does not pause while decoupled', () => {
    const { result, pause } = renderGate(false)
    act(() => result.current.ctx.registerGate('g1', 100))
    act(() => result.current.gate.onTimeUpdate(120))
    expect(pause).not.toHaveBeenCalled()
  })

  it('auto-pauses each gate at most once (manual resume sticks)', () => {
    const { result, pause, play } = renderGate(true)
    act(() => result.current.ctx.registerGate('g1', 100))

    act(() => result.current.gate.onTimeUpdate(100))
    expect(pause).toHaveBeenCalledTimes(1)

    // User overrides the pause, then plays past the still-unsatisfied gate.
    act(() => result.current.gate.onManualPlay())
    act(() => result.current.gate.onTimeUpdate(130))
    expect(pause).toHaveBeenCalledTimes(1)

    // The check passing later must NOT yank them back (they already moved on).
    act(() => result.current.ctx.markPassed('g1'))
    expect(play).not.toHaveBeenCalled()
  })
})
