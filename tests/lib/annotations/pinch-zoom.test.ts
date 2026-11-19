/**
 * Pinch math (src/lib/annotations/tap-gesture.ts, used by annotation-layer.tsx)
 * and the globals.css guard against [style*=…] attribute selectors.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TAP_MAX_MOVE, ZOOM_MAX, ZOOM_MIN, clampZoom, pinchLeftDeadZone, pinchOrigin, pinchStep } from '@/lib/annotations/tap-gesture'

const rel = { left: 0, top: 0 }

describe('pinch math', () => {
  it('zoom follows the finger distance ratio and keeps the content point under the midpoint', () => {
    const o = pinchOrigin({ x: 300, y: 500 }, { x: 400, y: 500 }, rel, { left: 0, top: 1000 }, 1)
    expect(o.content).toEqual({ x: 350, y: 1500 })
    const s = pinchStep(o, { x: 250, y: 500 }, { x: 450, y: 500 }, rel)
    expect(s.zoom).toBe(2)
    // Content point (350, 1500) at zoom 2 must sit at viewport midpoint (350, 500).
    expect(350 * 2 - s.scrollLeft).toBe(350)
    expect(1500 * 2 - s.scrollTop).toBe(500)
  })

  it('a pan without spread moves the scroll by the midpoint movement', () => {
    const o = pinchOrigin({ x: 300, y: 500 }, { x: 400, y: 500 }, rel, { left: 0, top: 1000 }, 1.5)
    const s = pinchStep(o, { x: 300, y: 450 }, { x: 400, y: 450 }, rel)
    expect(s.zoom).toBe(1.5)
    expect(s.scrollTop).toBeCloseTo(1050)
  })

  it('dead zone: movement up to TAP_MAX_MOVE is still a tap; the step afterwards includes it', () => {
    const o = pinchOrigin({ x: 300, y: 500 }, { x: 400, y: 500 }, rel, { left: 0, top: 0 }, 1)
    expect(pinchLeftDeadZone(o, { x: 300 - TAP_MAX_MOVE / 2, y: 500 }, { x: 400 + TAP_MAX_MOVE / 2, y: 500 })).toBe(false)
    const a = { x: 290, y: 500 }
    const b = { x: 410, y: 500 }
    expect(pinchLeftDeadZone(o, a, b)).toBe(true)
    // Computed from the original origin: 120 / 100, not 1 (re-based).
    expect(pinchStep(o, a, b, rel).zoom).toBeCloseTo(1.2)
  })

  it('re-basing on a new finger pair does not jump', () => {
    // A/B pinch reached zoom 1.2; a re-base on B/C at the current state must
    // map the current midpoint onto itself.
    const scroll = { left: 77, top: 1905 }
    const b = { x: 530, y: 600 }
    const c = { x: 420, y: 900 }
    const o = pinchOrigin(b, c, rel, scroll, 1.2)
    const s = pinchStep(o, b, c, rel)
    expect(s.zoom).toBeCloseTo(1.2)
    expect(s.scrollLeft).toBeCloseTo(scroll.left)
    expect(s.scrollTop).toBeCloseTo(scroll.top)
  })

  it('one clamp for all zoom inputs', () => {
    expect(clampZoom(100)).toBe(ZOOM_MAX)
    expect(clampZoom(0.01)).toBe(ZOOM_MIN)
    expect(clampZoom(3)).toBe(3)
    const o = pinchOrigin({ x: 0, y: 0 }, { x: 10, y: 0 }, rel, { left: 0, top: 0 }, 1)
    expect(pinchStep(o, { x: 0, y: 0 }, { x: 1000, y: 0 }, rel).zoom).toBe(ZOOM_MAX)
  })
})

describe('globals.css', () => {
  it('has no [style…] attribute selectors (every inline-style write would invalidate [style] descendants)', () => {
    const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(css).not.toMatch(/\[style[*^$~|]?=/)
  })
})
