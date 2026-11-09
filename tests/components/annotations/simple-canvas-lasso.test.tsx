import { describe, it, expect, vi, afterEach, afterAll } from 'vitest'
import { render, fireEvent, cleanup, act } from '@testing-library/react'
import { SimpleCanvas } from '@/components/annotations/simple-canvas'
import { HOLD_SNAP_MS } from '@/lib/annotations/shape-snap'

// jsdom has no 2D context and the pointer handlers bail out without one.
const fakeCtx = new Proxy({}, { get: () => () => {} })
const getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
  () => fakeCtx as unknown as CanvasRenderingContext2D,
)

// …nor Path2D (used to paint the in-progress stroke).
vi.stubGlobal('Path2D', class {
  moveTo() {}
  lineTo() {}
  quadraticCurveTo() {}
  closePath() {}
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})
afterAll(() => {
  getContextSpy.mockRestore()
  vi.unstubAllGlobals()
})

const target = {
  id: 'word', mode: 'draw', color: '#000', width: 2, sectionId: 'sec-a', sectionOffsetY: 0,
  points: [{ x: 190, y: 200, pressure: 0.5 }, { x: 200, y: 205, pressure: 0.5 }, { x: 210, y: 200, pressure: 0.5 }],
}

function setup() {
  const onUpdate = vi.fn()
  const onLassoSelect = vi.fn()
  const { container } = render(
    <SimpleCanvas
      width={600}
      height={600}
      mode="draw"
      initialData={JSON.stringify([target])}
      onUpdate={onUpdate}
      onLassoSelect={onLassoSelect}
      svgHandlesDisplay
    />,
  )
  const canvas = container.querySelector('canvas')!
  canvas.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 600, height: 600, right: 600, bottom: 600, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
  return { canvas, onUpdate, onLassoSelect }
}

/** Draw a closed loop of radius 60 around (cx, cy), then hold still past HOLD_SNAP_MS and lift. */
function drawLoopAndHold(canvas: HTMLCanvasElement, cx: number, cy: number) {
  const pts = Array.from({ length: 33 }, (_, i) => ({
    x: cx + 60 * Math.cos((2 * Math.PI * i) / 32),
    y: cy + 60 * Math.sin((2 * Math.PI * i) / 32),
  }))
  fireEvent.pointerDown(canvas, { pointerId: 1, pointerType: 'pen', clientX: pts[0].x, clientY: pts[0].y, pressure: 0.5 })
  for (const p of pts.slice(1)) {
    fireEvent.pointerMove(canvas, { pointerId: 1, pointerType: 'pen', clientX: p.x, clientY: p.y, pressure: 0.5 })
  }
  act(() => {
    vi.advanceTimersByTime(HOLD_SNAP_MS + 50)
  })
  const last = pts[pts.length - 1]
  fireEvent.pointerUp(canvas, { pointerId: 1, pointerType: 'pen', clientX: last.x, clientY: last.y })
}

describe('SimpleCanvas — lasso via draw-and-hold', () => {
  it('a held loop around a stroke selects it and commits nothing', () => {
    vi.useFakeTimers()
    const { canvas, onUpdate, onLassoSelect } = setup()
    drawLoopAndHold(canvas, 200, 200)
    expect(onLassoSelect).toHaveBeenCalledTimes(1)
    expect(onLassoSelect).toHaveBeenCalledWith(['word'])
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('a held loop around nothing falls back to the normal shape snap + commit', () => {
    vi.useFakeTimers()
    const { canvas, onUpdate, onLassoSelect } = setup()
    drawLoopAndHold(canvas, 420, 420)
    expect(onLassoSelect).not.toHaveBeenCalled()
    expect(onUpdate).toHaveBeenCalledTimes(1)
    const saved = JSON.parse(onUpdate.mock.calls[0][0])
    expect(saved).toHaveLength(2) // original + the (circle-snapped) loop
    expect(saved[0].id).toBe('word')
  })
})
