import { describe, it, expect, vi, afterEach, afterAll } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'
import { SimpleCanvas } from '@/components/annotations/simple-canvas'
import { PLUGIN_POINTER_ATTR, forwardPointer, pointerInputFrameAt } from '@/lib/plugin-pointer-forward'

// jsdom has no 2D context and the pointer handlers bail out without one.
const fakeCtx = new Proxy({}, { get: () => () => {} })
const getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
  () => fakeCtx as unknown as CanvasRenderingContext2D,
)

// jsdom has no Path2D; committing a stroke builds one.
vi.stubGlobal('Path2D', function () { return new Proxy({}, { get: () => () => {} }) })

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})
afterAll(() => getContextSpy.mockRestore())

const rect = (left: number, top: number, width: number, height: number) =>
  ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect

/** A plugin iframe at (100,200), laid out 300x400 but shown at 2x (page zoom). */
function pluginFrame(attr: string | null) {
  const iframe = document.createElement('iframe')
  if (attr !== null) iframe.setAttribute(PLUGIN_POINTER_ATTR, attr)
  document.body.appendChild(iframe)
  iframe.getBoundingClientRect = () => rect(100, 200, 600, 800)
  Object.defineProperty(iframe, 'clientWidth', { value: 300 })
  Object.defineProperty(iframe, 'clientHeight', { value: 400 })
  const post = vi.fn()
  Object.defineProperty(iframe, 'contentWindow', { value: { postMessage: post } })
  // jsdom has no hit testing: every point hits the iframe.
  document.elementsFromPoint = () => [iframe]
  return { iframe, post }
}

function renderCanvas() {
  const onUpdate = vi.fn()
  const { container } = render(<SimpleCanvas width={1000} height={1000} mode="draw" onUpdate={onUpdate} svgHandlesDisplay />)
  const canvas = container.querySelector('canvas')!
  canvas.getBoundingClientRect = () => rect(0, 0, 1000, 1000)
  return { canvas, onUpdate }
}

describe('plugin pointer forwarding', () => {
  it('finds only iframes that ask for pointer input', () => {
    const { iframe } = pluginFrame('true')
    expect(pointerInputFrameAt(1, 1)).toBe(iframe)
    pluginFrame('false')
    expect(pointerInputFrameAt(1, 1)).toBeNull()
    pluginFrame(null)
    expect(pointerInputFrameAt(1, 1)).toBeNull()
  })

  it('converts viewport coordinates to the iframe\'s own pixels under zoom', () => {
    const { iframe, post } = pluginFrame('true')
    forwardPointer(iframe, 'move', { clientX: 400, clientY: 600, pointerId: 7, pointerType: 'pen', pressure: 0.4 })
    expect(post).toHaveBeenCalledWith(
      { type: 'host:pointer', phase: 'move', x: 150, y: 200, pointerId: 7, pointerType: 'pen', pressure: 0.4 }, '*')
  })

  it('hands a pen gesture over the plugin to the plugin and draws no annotation', () => {
    const { post } = pluginFrame('true')
    const { canvas, onUpdate } = renderCanvas()
    fireEvent.pointerDown(canvas, { pointerId: 1, pointerType: 'pen', clientX: 300, clientY: 400, pressure: 0.5 })
    fireEvent.pointerMove(canvas, { pointerId: 1, pointerType: 'pen', clientX: 340, clientY: 460, pressure: 0.5 })
    fireEvent.pointerUp(canvas, { pointerId: 1, pointerType: 'pen', clientX: 340, clientY: 460 })
    expect(post.mock.calls.map((c) => [c[0].phase, c[0].x, c[0].y])).toEqual([['down', 100, 100], ['move', 120, 130], ['up', 120, 130]])
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('a gesture next to the plugin, a plugin that did not ask, and touch still annotate', () => {
    const { canvas, onUpdate } = renderCanvas()
    const stroke = (pointerType: string) => {
      fireEvent.pointerDown(canvas, { pointerId: 1, pointerType, clientX: 300, clientY: 400, pressure: 0.5 })
      fireEvent.pointerMove(canvas, { pointerId: 1, pointerType, clientX: 340, clientY: 460, pressure: 0.5 })
      fireEvent.pointerMove(canvas, { pointerId: 1, pointerType, clientX: 380, clientY: 500, pressure: 0.5 })
      fireEvent.pointerUp(canvas, { pointerId: 1, pointerType, clientX: 380, clientY: 500 })
    }
    document.elementsFromPoint = () => [canvas]
    stroke('pen')
    expect(onUpdate).toHaveBeenCalledTimes(1)

    const off = pluginFrame('false')
    stroke('pen')
    expect(off.post).not.toHaveBeenCalled()
    expect(onUpdate).toHaveBeenCalledTimes(2)

    const on = pluginFrame('true')
    stroke('touch')
    expect(on.post).not.toHaveBeenCalled()
  })
})
