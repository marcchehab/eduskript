import { describe, it, expect, vi, beforeAll } from 'vitest'
import { PLUGIN_SDK_SOURCE, pinchRatioToWheelDeltaY } from '@/lib/plugin-sdk'

describe('pinchRatioToWheelDeltaY', () => {
  // annotation-layer.tsx handleZoomWheel: newZoom = zoom * 1.002 ** -deltaY
  it.each([2, 0.5, 1.05, 0.97, 3])('inverts the wheel zoom formula (ratio %s)', (r) => {
    expect(Math.pow(1.002, -pinchRatioToWheelDeltaY(r))).toBeCloseTo(r, 10)
  })
  it('zooms in for spreading fingers (negative deltaY)', () => {
    expect(pinchRatioToWheelDeltaY(1.1)).toBeLessThan(0)
  })
  it('ignores invalid ratios', () => {
    expect(pinchRatioToWheelDeltaY(0)).toBe(0)
    expect(pinchRatioToWheelDeltaY(NaN)).toBe(0)
  })
})

// Runs the SDK source in jsdom (window.parent === window here) and feeds it
// touch events with only the fields the SDK reads.
describe('plugin SDK pinch forwarding', () => {
  const posted: Array<Record<string, unknown>> = []
  let rafCb: FrameRequestCallback | null = null

  beforeAll(() => {
    vi.spyOn(window, 'postMessage').mockImplementation(((m: Record<string, unknown>) => { posted.push(m) }) as typeof window.postMessage)
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { rafCb = cb; return 1 })
    vi.stubGlobal('cancelAnimationFrame', () => { rafCb = null })
    new Function(PLUGIN_SDK_SOURCE)()
  })

  function touch(type: string, pts: Array<[number, number]>) {
    const e = new Event(type, { bubbles: true, cancelable: true })
    Object.defineProperty(e, 'touches', { value: pts.map(([x, y]) => ({ screenX: x, screenY: y })) })
    document.body.dispatchEvent(e)
    return e
  }
  function frame() { const cb = rafCb; rafCb = null; cb?.(0) }
  const zooms = () => posted.filter((m) => m.type === 'plugin:zoomTouchMove')

  it('starts a pinch whose second finger only shows up in touchmove', () => {
    posted.length = 0
    touch('touchstart', [[100, 100]]) // first finger inside the iframe
    // Second finger landed outside the iframe: no 2-touch touchstart.
    const first = touch('touchmove', [[100, 100], [200, 100]])
    expect(first.defaultPrevented).toBe(true)
    frame()
    expect(zooms()).toHaveLength(0) // first 2-touch move only sets the baseline
    touch('touchmove', [[100, 100], [300, 100]])
    frame()
    expect(zooms()).toHaveLength(1)
    expect(zooms()[0].ratio).toBeCloseTo(2, 10)
    touch('touchend', [[100, 100]])
  })

  it('still works for a pinch with a 2-touch touchstart', () => {
    posted.length = 0
    touch('touchstart', [[0, 0], [100, 0]])
    touch('touchmove', [[0, 0], [150, 0]])
    frame()
    expect(zooms()[0].ratio).toBeCloseTo(1.5, 10)
    touch('touchend', [])
  })

  it('does not touch single-finger moves', () => {
    posted.length = 0
    touch('touchstart', [[0, 0]])
    const e = touch('touchmove', [[10, 0]])
    expect(e.defaultPrevented).toBe(false)
    frame()
    expect(zooms()).toHaveLength(0)
    touch('touchend', [])
  })
})
