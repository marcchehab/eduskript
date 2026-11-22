/**
 * Stroke anchoring in SimpleCanvas: anchor picked at pointerdown from live
 * element positions, `-end` sentinel for ink in an element's bottom margin,
 * and correction for layout shifts during the stroke (plugin iframe growing
 * above the anchor). See pickAnchorElement / rebaseStrokePoints.
 */
import { describe, it, expect, vi, afterEach, afterAll, beforeAll } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'
import { SimpleCanvas, pickAnchorElement, rebaseStrokePoints, joinsStrokeGroup, STROKE_GROUP_MAX_GAP_MS, STROKE_GROUP_MAX_HEIGHT, type CanvasStroke, type LastStroke } from '@/components/annotations/simple-canvas'

const fakeCtx = new Proxy({}, { get: () => () => {} })
const getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
  () => fakeCtx as unknown as CanvasRenderingContext2D,
)
vi.stubGlobal('Path2D', class {
  moveTo() {}
  lineTo() {}
  quadraticCurveTo() {}
  closePath() {}
})

beforeAll(() => {
  // jsdom has no CSS.escape
  if (typeof CSS === 'undefined' || typeof CSS.escape !== 'function') {
    vi.stubGlobal('CSS', { escape: (s: string) => s.replace(/(["\\])/g, '\\$1') })
  }
})
afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})
afterAll(() => {
  getContextSpy.mockRestore()
  vi.unstubAllGlobals()
})

function rect(top: number, height: number, width = 600): DOMRect {
  return { left: 0, top, width, height, right: width, bottom: top + height, x: 0, y: top, toJSON: () => ({}) } as DOMRect
}

/** A section element whose rect is read from `box` (mutable, for layout shifts). */
function section(parent: HTMLElement, id: string, box: { top: number; height: number }, attrs: Record<string, string> = {}) {
  const el = document.createElement('div')
  el.setAttribute('data-section-id', id)
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
  el.getBoundingClientRect = () => rect(box.top, box.height)
  parent.appendChild(el)
  return el
}

describe('pickAnchorElement', () => {
  function page() {
    const root = document.createElement('div')
    section(root, 'paper-top', { top: 0, height: 0 })
    section(root, 'h2-intro', { top: 100, height: 40 })
    section(root, 'plugin-teacher-vektor-labor', { top: 200, height: 300 }) // margin 200..520
    section(root, 'plugin-teacher-vektor-labor-end', { top: 520, height: 0 }, { 'data-section-end': 'true' })
    section(root, 'h2-subtraktion', { top: 560, height: 40 })
    return root
  }
  const idAt = (root: ParentNode, y: number) => pickAnchorElement(y, root)?.getAttribute('data-section-id')

  it('picks the nearest section top at or above the point', () => {
    const root = page()
    expect(idAt(root, 50)).toBe('paper-top')
    expect(idAt(root, 120)).toBe('h2-intro')
    expect(idAt(root, 300)).toBe('plugin-teacher-vektor-labor')
    expect(idAt(root, 580)).toBe('h2-subtraktion')
  })

  it('ink in an element\'s bottom margin anchors to its -end sentinel', () => {
    const root = page()
    expect(idAt(root, 508)).toBe('plugin-teacher-vektor-labor-end')
    expect(idAt(root, 530)).toBe('plugin-teacher-vektor-labor-end')
  })

  it('without an -end sentinel, ink in the gap below an element anchors to the next one', () => {
    const root = page()
    expect(idAt(root, 150)).toBe('plugin-teacher-vektor-labor')
  })

  it('ink below a nested anchor but inside its container anchors to the container', () => {
    const root = document.createElement('div')
    section(root, 'list@top#1', { top: 0, height: 200 })
    section(root, 'pre@top#1', { top: 50, height: 50 }) // inside the list
    section(root, 'p@top#1', { top: 220, height: 40 })
    expect(idAt(root, 60)).toBe('pre@top#1')
    expect(idAt(root, 150)).toBe('list@top#1')
    expect(idAt(root, 210)).toBe('p@top#1')
  })

  it('ink below the last element keeps the last element', () => {
    const root = page()
    expect(idAt(root, 700)).toBe('h2-subtraktion')
  })

  it('takes whatever id the element carries (no id format assumed)', () => {
    const root = document.createElement('div')
    section(root, 's-7f3a', { top: 10, height: 20 })
    section(root, 's-7f3a-end', { top: 40, height: 0 })
    expect(idAt(root, 15)).toBe('s-7f3a')
    expect(idAt(root, 35)).toBe('s-7f3a-end')
  })

  it('equal tops resolve to the later element, like determineSectionFromY', () => {
    const root = document.createElement('div')
    section(root, 'a', { top: 10, height: 0 })
    section(root, 'b', { top: 10, height: 30 })
    expect(idAt(root, 20)).toBe('b')
  })

  it('returns null above every section', () => {
    expect(pickAnchorElement(-5, page())).toBeNull()
  })
})

describe('rebaseStrokePoints', () => {
  const pts = [{ x: 0, y: 10 }, { x: 1, y: 20 }, { x: 2, y: 30 }]

  it('returns the same array when nothing moved (stored coords unchanged)', () => {
    expect(rebaseStrokePoints(pts, [0, 0, 0], 0, 0)).toBe(pts)
    expect(rebaseStrokePoints(pts, null, 0, 0)).toBe(pts)
  })

  it('removes per-point anchor moves and adds the commit delta', () => {
    expect(rebaseStrokePoints(pts, [0, 0, 100], 100, 100).map(p => p.y)).toEqual([110, 120, 30])
  })

  it('uses the fallback shift when shifts do not line up with the points', () => {
    expect(rebaseStrokePoints(pts, null, 5, 5).map(p => p.y)).toEqual([10, 20, 30])
    expect(rebaseStrokePoints(pts, [0], 10, 0).map(p => p.y)).toEqual([0, 10, 20])
  })
})

describe('SimpleCanvas — anchor at pointerdown, layout shift during the stroke', () => {
  function setup() {
    const paper = document.createElement('div')
    paper.id = 'paper'
    document.body.appendChild(paper)
    Object.defineProperty(paper, 'offsetWidth', { value: 600, configurable: true })
    paper.getBoundingClientRect = () => rect(0, 3000)
    const pluginBox = { top: 100, height: 66 }
    const headingBox = { top: 200, height: 40 }
    section(paper, 'paper-top', { top: 0, height: 0 })
    section(paper, 'plugin-teacher-vektor-labor', pluginBox)
    section(paper, 'h2-subtraktion', headingBox)

    const onUpdate = vi.fn()
    const host = document.createElement('div')
    paper.appendChild(host)
    const { container } = render(
      <SimpleCanvas width={600} height={3000} mode="draw" onUpdate={onUpdate} svgHandlesDisplay />,
      { container: host },
    )
    const canvas = container.querySelector('canvas')!
    canvas.getBoundingClientRect = () => rect(0, 3000)
    const stored = (): CanvasStroke[] => JSON.parse(onUpdate.mock.calls.at(-1)![0])
    return { canvas, pluginBox, headingBox, stored }
  }

  const move = (canvas: HTMLCanvasElement, x: number, y: number) =>
    fireEvent.pointerMove(canvas, { pointerId: 1, pointerType: 'pen', clientX: x, clientY: y, pressure: 0.5 })

  it('unchanged layout: stored points equal the drawn points (backward-compatible coords)', () => {
    const { canvas, stored } = setup()
    fireEvent.pointerDown(canvas, { pointerId: 1, pointerType: 'pen', clientX: 50, clientY: 220, pressure: 0.5 })
    move(canvas, 60, 221)
    move(canvas, 70, 222)
    fireEvent.pointerUp(canvas, { pointerId: 1, pointerType: 'pen', clientX: 70, clientY: 222 })
    const [s] = stored()
    expect(s.sectionId).toBe('h2-subtraktion')
    expect(s.sectionOffsetY).toBe(200)
    expect(s.points.map(p => p.y)).toEqual([220, 221, 222])
  })

  it('plugin above the heading grows mid-stroke: stroke stays 20 px under the heading', () => {
    const { canvas, pluginBox, headingBox, stored } = setup()
    fireEvent.pointerDown(canvas, { pointerId: 1, pointerType: 'pen', clientX: 50, clientY: 220, pressure: 0.5 })
    move(canvas, 60, 220)
    // Plugin iframe loads: 66 → 659 px, heading moves down 593 px. No scroll
    // anchoring here, so the student follows the heading on screen.
    pluginBox.height = 659
    headingBox.top = 793
    move(canvas, 70, 813)
    move(canvas, 80, 813)
    fireEvent.pointerUp(canvas, { pointerId: 1, pointerType: 'pen', clientX: 80, clientY: 813 })
    const [s] = stored()
    // Before the fix: sectionId from the first point (y 220) against the
    // post-growth layout → the plugin, and the early points stayed at 220.
    expect(s.sectionId).toBe('h2-subtraktion')
    expect(s.sectionOffsetY).toBe(793)
    expect(s.points.map(p => p.y - s.sectionOffsetY)).toEqual([20, 20, 20, 20])
  })

  it('scroll-anchored growth (heading stays put on screen) also stays under the heading', () => {
    const { canvas, pluginBox, headingBox, stored } = setup()
    fireEvent.pointerDown(canvas, { pointerId: 1, pointerType: 'pen', clientX: 50, clientY: 220, pressure: 0.5 })
    move(canvas, 60, 220)
    // Plugin grows by 593 and the browser scrolls by 593: on screen the
    // heading is still at 200, the canvas (cached rect) is stale.
    pluginBox.height = 659
    pluginBox.top = 100 - 593
    headingBox.top = 200
    ;(document.getElementById('paper')!).getBoundingClientRect = () => rect(-593, 3000)
    move(canvas, 70, 220)
    fireEvent.pointerUp(canvas, { pointerId: 1, pointerType: 'pen', clientX: 70, clientY: 220 })
    const [s] = stored()
    expect(s.sectionId).toBe('h2-subtraktion')
    expect(s.sectionOffsetY).toBe(793)
    expect(s.points.map(p => p.y - s.sectionOffsetY)).toEqual([20, 20, 20])
  })
})

describe('joinsStrokeGroup', () => {
  // Previous stroke: a word 100..200 x 300..320, ended at t=1000.
  const last: LastStroke = { endAt: 1000, left: 100, right: 200, top: 300, bottom: 320, groupTop: 300, groupBottom: 320 }

  it('joins a stroke that starts soon after and close by', () => {
    expect(joinsStrokeGroup(last, 210, 310, 1500)).toBe(true) // next letter
    expect(joinsStrokeGroup(last, 150, 345, 1500)).toBe(true) // just below
  })

  it('does not join after the time limit, when far away, or without a previous stroke', () => {
    expect(joinsStrokeGroup(last, 210, 310, 1000 + STROKE_GROUP_MAX_GAP_MS + 1)).toBe(false)
    expect(joinsStrokeGroup(last, 400, 310, 1500)).toBe(false)
    expect(joinsStrokeGroup(null, 210, 310, 1500)).toBe(false)
  })

  it('stops a group from growing taller than STROKE_GROUP_MAX_HEIGHT', () => {
    const tall = { ...last, top: 400, bottom: 420, groupTop: 400 - STROKE_GROUP_MAX_HEIGHT + 20, groupBottom: 420 }
    expect(joinsStrokeGroup(tall, 150, 430, 1500)).toBe(false)
    expect(joinsStrokeGroup({ ...tall, groupTop: tall.groupTop + 20 }, 150, 430, 1500)).toBe(true)
  })
})
