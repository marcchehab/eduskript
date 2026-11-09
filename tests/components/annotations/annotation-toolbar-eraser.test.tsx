import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { AnnotationToolbar, type AnnotationMode } from '@/components/annotations/annotation-toolbar'
import { DEFAULT_PENS } from '@/lib/annotations/pens'
import type { EraserVariant } from '@/lib/annotations/eraser'

vi.mock('@/contexts/layout-context', () => ({
  useLayout: () => ({ sidebarWidth: 0 }),
}))

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function setup(mode: AnnotationMode = 'view', eraserVariant: EraserVariant = 'stroke') {
  const onModeChange = vi.fn()
  const onEraserVariantChange = vi.fn()
  render(
    <AnnotationToolbar
      mode={mode}
      onModeChange={onModeChange}
      onClear={vi.fn()}
      hasAnnotations={false}
      pens={DEFAULT_PENS}
      activePenId={DEFAULT_PENS[0].id}
      onPenSelect={vi.fn()}
      onPenColorChange={vi.fn()}
      onPenSizeChange={vi.fn()}
      onPenAdd={vi.fn()}
      onPenRemove={vi.fn()}
      onPensReorder={vi.fn()}
      onResetZoom={vi.fn()}
      eraserVariant={eraserVariant}
      onEraserVariantChange={onEraserVariantChange}
    />,
  )
  return { onModeChange, onEraserVariantChange }
}

describe('AnnotationToolbar — eraser variants', () => {
  it('the eraser button names the current variant', () => {
    setup('view', 'point')
    expect(screen.getByRole('button', { name: 'Point eraser' })).toBeTruthy()
  })

  it('a click toggles erase mode without opening the variant menu', () => {
    const { onModeChange } = setup('view')
    fireEvent.click(screen.getByRole('button', { name: 'Stroke eraser' }))
    expect(onModeChange).toHaveBeenCalledWith('erase')
    expect(screen.queryByRole('menu', { name: 'Eraser type' })).toBeNull()
  })

  it('hovering opens the variant menu; picking one switches variant and activates the eraser', () => {
    vi.useFakeTimers()
    const { onModeChange, onEraserVariantChange } = setup('view', 'stroke')
    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Stroke eraser' }))
    act(() => {
      vi.advanceTimersByTime(350)
    })
    const menu = screen.getByRole('menu', { name: 'Eraser type' })
    const stroke = screen.getByRole('menuitemradio', { name: /Stroke eraser/ })
    expect(stroke.getAttribute('aria-checked')).toBe('true')
    expect(menu).toBeTruthy()

    fireEvent.click(screen.getByRole('menuitemradio', { name: /Point eraser/ }))
    expect(onEraserVariantChange).toHaveBeenCalledWith('point')
    expect(onModeChange).toHaveBeenCalledWith('erase')
    expect(screen.queryByRole('menu', { name: 'Eraser type' })).toBeNull()
  })

  it('long-press (touch) opens the variant menu', () => {
    vi.useFakeTimers()
    setup('erase', 'point')
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Point eraser' }), { pointerType: 'touch', clientX: 0, clientY: 0 })
    act(() => {
      vi.advanceTimersByTime(550)
    })
    expect(screen.getByRole('menuitemradio', { name: /Point eraser/ }).getAttribute('aria-checked')).toBe('true')
  })
})
