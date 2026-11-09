import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { AnnotationSelection } from '@/components/annotations/annotation-selection'

afterEach(() => cleanup())

function setup() {
  const props = {
    bounds: { minX: 100, minY: 100, maxX: 200, maxY: 150 },
    zoom: 1,
    onPreviewMove: vi.fn(),
    onCommitMove: vi.fn(),
    onDelete: vi.fn(),
    onDuplicate: vi.fn(),
    onDismiss: vi.fn(),
  }
  render(<AnnotationSelection {...props} />)
  return props
}

const nextFrame = () => act(async () => {
  await new Promise((r) => requestAnimationFrame(() => r(null)))
})

describe('AnnotationSelection', () => {
  it('Delete and Duplicate each fire once', () => {
    const p = setup()
    fireEvent.click(screen.getByRole('button', { name: /Delete/ }))
    fireEvent.click(screen.getByRole('button', { name: /Duplicate/ }))
    expect(p.onDelete).toHaveBeenCalledTimes(1)
    expect(p.onDuplicate).toHaveBeenCalledTimes(1)
    expect(p.onDismiss).not.toHaveBeenCalled()
  })

  it('dragging the move gizmo previews live and commits once on release', async () => {
    const p = setup()
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Move selection' }), { pointerId: 3, clientX: 150, clientY: 170 })
    fireEvent.pointerMove(window, { pointerId: 3, clientX: 160, clientY: 175 })
    await nextFrame()
    fireEvent.pointerMove(window, { pointerId: 3, clientX: 190, clientY: 200 })
    await nextFrame()
    expect(p.onPreviewMove).toHaveBeenLastCalledWith({ dx: 40, dy: 30 })
    expect(p.onCommitMove).not.toHaveBeenCalled()
    fireEvent.pointerUp(window, { pointerId: 3, clientX: 190, clientY: 200 })
    expect(p.onCommitMove).toHaveBeenCalledTimes(1)
    expect(p.onCommitMove).toHaveBeenCalledWith(40, 30)
    expect(p.onPreviewMove).toHaveBeenLastCalledWith(null)
  })

  it('dragging the box itself also moves; a tap without movement saves nothing', () => {
    const p = setup()
    const box = screen.getByTestId('selection-box')
    fireEvent.pointerDown(box, { pointerId: 4, clientX: 120, clientY: 120 })
    fireEvent.pointerUp(window, { pointerId: 4, clientX: 120, clientY: 120 })
    expect(p.onCommitMove).not.toHaveBeenCalled()
    fireEvent.pointerDown(box, { pointerId: 5, clientX: 120, clientY: 120 })
    fireEvent.pointerMove(window, { pointerId: 5, clientX: 100, clientY: 120 })
    fireEvent.pointerUp(window, { pointerId: 5, clientX: 100, clientY: 120 })
    expect(p.onCommitMove).toHaveBeenCalledWith(-20, 0)
  })

  it('a tap outside the selection dismisses it', () => {
    const p = setup()
    fireEvent.pointerDown(screen.getByTestId('selection-catcher'), { pointerId: 6 })
    expect(p.onDismiss).toHaveBeenCalledTimes(1)
  })
})
