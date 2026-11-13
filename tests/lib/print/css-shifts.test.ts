/**
 * Strokes follow what the print CSS moves (measureCssShifts,
 * src/lib/print/stroke-shift.ts): compact callouts in the print view move the
 * text inside and below them up; strokes on that text must move with it.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { clearCssShifts, collectPrintMarkers, measureCssShifts, printShiftAt, printShiftsFor } from '@/lib/print/stroke-shift'

// Tops of each element online and in the print CSS (layout px, section top = 0).
const TOPS: Record<string, [number, number]> = {
  section: [0, 0],
  before: [50, 50],
  callout: [100, 90], // margin 10 px smaller
  title: [100, 90], // title 10 px lower
  p1: [150, 130],
  p2: [200, 175], // paragraph margin 5 px smaller
  after: [260, 225], // bottom padding/margin 10 px smaller
}

function setup() {
  document.body.innerHTML = `
    <div id="paper">
      <div id="section" data-section-id="s1"></div>
      <p id="before"></p>
      <blockquote id="callout" class="callout">
        <div id="title" class="callout-title"></div>
        <div class="callout-content"><p id="p1"></p><p id="p2"></p></div>
      </blockquote>
      <p id="after"></p>
    </div>`
  for (const [id, [online, print]] of Object.entries(TOPS)) {
    const el = document.getElementById(id)!
    const top = () => (document.documentElement.classList.contains('print-layout') ? print : online)
    el.getBoundingClientRect = () => ({ top: top(), bottom: top(), left: 0, right: 0, height: 0, width: 0, x: 0, y: top(), toJSON: () => ({}) })
    el.getClientRects = (() => [el.getBoundingClientRect()]) as unknown as typeof el.getClientRects
  }
}

afterEach(() => {
  clearCssShifts()
  document.documentElement.classList.remove('print-layout')
})

describe('print CSS shifts', () => {
  it('moves strokes with the text of a compacted callout', () => {
    setup()
    measureCssShifts(() => document.documentElement.classList.add('print-layout'))
    const shifts = printShiftsFor(document.getElementById('section')!, collectPrintMarkers(document.getElementById('paper')!), 1)

    expect(printShiftAt(shifts, 70)).toBe(0) // above the callout
    expect(printShiftAt(shifts, 155)).toBe(-20) // on p1
    expect(printShiftAt(shifts, 210)).toBe(-25) // on p2
    expect(printShiftAt(shifts, 280)).toBe(-35) // below the callout
  })

  it('registers nothing after leaving the print view', () => {
    setup()
    measureCssShifts(() => document.documentElement.classList.add('print-layout'))
    clearCssShifts()
    expect(collectPrintMarkers(document.getElementById('paper')!)).toEqual([])
  })
})
