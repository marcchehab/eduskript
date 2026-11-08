/**
 * Foldable callout titles are role=button so the annotation canvas's
 * tap-through (simple-canvas.tsx) can forward finger taps to them while
 * stylus mode covers the page — and so keyboards can fold them.
 */
import { describe, it, expect } from 'vitest'
import { render, fireEvent, act } from '@testing-library/react'
import { createElement } from 'react'
import { Callout } from '@/components/markdown/callout'

// Same selector simple-canvas.tsx uses to find a tap-through target
const TAP_TARGETS =
  'button, a[href], input, textarea, select, summary, label, [role="button"], [role="tab"], [role="checkbox"], [contenteditable="true"]'

function renderCallout(isFoldable: boolean) {
  return render(
    createElement(
      Callout,
      { className: 'callout callout-tip', type: 'tip', isFoldable, initiallyFolded: true },
      createElement('div', { className: 'callout-title' }, 'Tipp'),
      createElement('div', { className: 'callout-content' }, 'Inhalt'),
    ),
  )
}

describe('Callout title as tap target', () => {
  it('foldable title matches the tap-through selector and click toggles', () => {
    const { container } = renderCallout(true)
    const bq = container.querySelector('blockquote')!
    const span = container.querySelector('.callout-title span')!
    const target = span.closest<HTMLElement>(TAP_TARGETS)
    expect(target).not.toBeNull()
    expect(target!.getAttribute('aria-expanded')).toBe('false')
    expect(bq.className).toContain('callout-folded')
    act(() => target!.click()) // what tap-through does
    expect(bq.className).not.toContain('callout-folded')
    expect(target!.getAttribute('aria-expanded')).toBe('true')
  })

  it('Enter and Space toggle the foldable callout', () => {
    const { container } = renderCallout(true)
    const bq = container.querySelector('blockquote')!
    const title = container.querySelector<HTMLElement>('.callout-title')!
    fireEvent.keyDown(title, { key: 'Enter' })
    expect(bq.className).not.toContain('callout-folded')
    fireEvent.keyDown(title, { key: ' ' })
    expect(bq.className).toContain('callout-folded')
  })

  it('non-foldable title is not a button', () => {
    const { container } = renderCallout(false)
    expect(container.querySelector('.callout-title')!.getAttribute('role')).toBeNull()
  })
})
