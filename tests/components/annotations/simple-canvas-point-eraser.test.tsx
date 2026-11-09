import { describe, it, expect, vi, afterEach, afterAll } from 'vitest'
import { render, fireEvent, cleanup, act } from '@testing-library/react'
import { SimpleCanvas } from '@/components/annotations/simple-canvas'

// jsdom has no 2D context and the pointer handlers bail out without one:
// hand out a context whose methods are all no-ops.
const fakeCtx = new Proxy({}, { get: () => () => {} })
const getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
  () => fakeCtx as unknown as CanvasRenderingContext2D,
)

afterEach(() => cleanup())
afterAll(() => getContextSpy.mockRestore())

// Two strokes at y=100 in section sec-a; the eraser rubs across the first one only.
const strokes = [
  {
    id: 'a', mode: 'draw', color: '#000', width: 2, sectionId: 'sec-a', sectionOffsetY: 0,
    points: Array.from({ length: 21 }, (_, i) => ({ x: i * 10, y: 100, pressure: 0.5 + i * 0.01 })),
  },
  {
    id: 'b', mode: 'draw', color: '#f00', width: 2, sectionId: 'sec-a', sectionOffsetY: 0, tool: 'highlighter',
    points: [{ x: 0, y: 300, pressure: 0.5 }, { x: 200, y: 300, pressure: 0.5 }],
  },
]

function renderCanvas(variant: 'stroke' | 'point') {
  const onUpdate = vi.fn()
  const onPointErasePreview = vi.fn()
  const { container } = render(
    <SimpleCanvas
      width={400}
      height={400}
      mode="erase"
      eraserVariant={variant}
      initialData={JSON.stringify(strokes)}
      onUpdate={onUpdate}
      onPointErasePreview={onPointErasePreview}
      svgHandlesDisplay
    />,
  )
  const canvas = container.querySelector('canvas')!
  // jsdom has no layout: give the canvas a 1:1 paper-space rect.
  canvas.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 400, height: 400, right: 400, bottom: 400, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
  return { canvas, container, onUpdate, onPointErasePreview }
}

describe('SimpleCanvas — point eraser gesture', () => {
  it('splits only the rubbed stroke and commits once per gesture', async () => {
    const { canvas, container, onUpdate, onPointErasePreview } = renderCanvas('point')
    fireEvent.pointerDown(canvas, { pointerId: 1, pointerType: 'mouse', clientX: 100, clientY: 80, pressure: 0.5 })
    // Cursor shows the eraser circle from the first contact
    const cursor = container.querySelector('.eraser-cursor') as HTMLElement
    expect(cursor.style.display).toBe('block')
    expect(cursor.dataset.eraserVariant).toBe('point')

    fireEvent.pointerMove(canvas, { pointerId: 1, pointerType: 'mouse', clientX: 100, clientY: 100, pressure: 0.5 })
    fireEvent.pointerMove(canvas, { pointerId: 1, pointerType: 'mouse', clientX: 100, clientY: 120, pressure: 0.5 })
    expect(onUpdate).not.toHaveBeenCalled()

    // Preview is delivered on the next animation frame
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(null)))
    })
    expect(onPointErasePreview).toHaveBeenCalled()

    fireEvent.pointerUp(canvas, { pointerId: 1, pointerType: 'mouse', clientX: 100, clientY: 120 })
    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(onPointErasePreview).toHaveBeenLastCalledWith(null)

    const saved = JSON.parse(onUpdate.mock.calls[0][0])
    expect(saved).toHaveLength(3)
    expect(saved.map((s: { id: string }) => s.id)).not.toContain('a')
    // Untouched highlighter line is kept as is (same id, same position at the end)
    expect(saved[2]).toEqual(strokes[1])
    // Pieces keep metadata and sit where the original was in the list
    for (const piece of saved.slice(0, 2)) {
      expect(piece.color).toBe('#000')
      expect(piece.sectionId).toBe('sec-a')
      expect(piece.sectionOffsetY).toBe(0)
    }
  })

  it('pointercancel restores the strokes and saves nothing', () => {
    const { canvas, onUpdate, onPointErasePreview } = renderCanvas('point')
    fireEvent.pointerDown(canvas, { pointerId: 1, pointerType: 'mouse', clientX: 100, clientY: 100 })
    fireEvent.pointerCancel(canvas, { pointerId: 1, pointerType: 'mouse' })
    expect(onUpdate).not.toHaveBeenCalled()
    expect(onPointErasePreview).toHaveBeenLastCalledWith(null)
  })

  it('stroke eraser still deletes whole strokes', () => {
    const { canvas, onUpdate, onPointErasePreview } = renderCanvas('stroke')
    fireEvent.pointerDown(canvas, { pointerId: 1, pointerType: 'mouse', clientX: 100, clientY: 90 })
    fireEvent.pointerMove(canvas, { pointerId: 1, pointerType: 'mouse', clientX: 100, clientY: 100 })
    fireEvent.pointerUp(canvas, { pointerId: 1, pointerType: 'mouse', clientX: 100, clientY: 100 })
    expect(onPointErasePreview).not.toHaveBeenCalled()
    const saved = JSON.parse(onUpdate.mock.calls[0][0])
    expect(saved.map((s: { id: string }) => s.id)).toEqual(['b'])
  })
})
