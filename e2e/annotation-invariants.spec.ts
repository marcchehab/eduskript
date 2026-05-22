import { test, expect, type Page } from '@playwright/test'
import { E2E_PAGE_PATH } from '../scripts/seed-e2e.mjs'
import {
  readAnnotationState,
  strokeCount,
  strokeRelBoxes,
  sectionBox,
  clearAnnotations,
  enterDrawMode,
  enterEraseMode,
  escapeToView,
  drawCommitting,
  eraseAt,
  pinch,
  settle,
  type StrokeRelBox,
} from './helpers/input'

const SECTION_TWO = '[data-heading-text="Section Two"]'
const CALLOUT_TEXT = /Collapsible callout/i

async function sectionTwoId(page: Page): Promise<string> {
  const id = await page.locator(SECTION_TWO).first().getAttribute('data-section-id')
  if (!id) throw new Error('Section Two has no data-section-id')
  return id
}

/** Draw one short horizontal stroke near the top of Section Two. */
async function drawInSectionTwo(page: Page): Promise<StrokeRelBox> {
  const box = await sectionBox(page, await sectionTwoId(page))
  const y = box.y + 24
  return drawCommitting(
    page,
    [
      { x: box.x + 30, y },
      { x: box.x + 130, y },
    ],
    { pointerType: 'pen', pressure: 0.5 },
  )
}

/** Expand the collapsed callout in Section One (which pushes Section Two down).
 *  Uses dispatchEvent('click') rather than a real click: once a pen stroke has
 *  set stylusModeActive, the drawing canvas keeps pointerEvents:'auto' even in
 *  view mode (simple-canvas.tsx) and permanently obscures the callout, so a
 *  real click never becomes actionable. dispatchEvent bypasses hit-testing. */
async function expandCalloutAbove(page: Page) {
  await escapeToView(page)
  await page.getByText(CALLOUT_TEXT).first().dispatchEvent('click')
  await settle(page)
}

test.beforeEach(async ({ page }) => {
  await page.goto(E2E_PAGE_PATH)
  // Annotation toolbar appears for the authenticated author.
  await page.locator('[data-pen-button]').first().waitFor({ state: 'visible', timeout: 20_000 })
  await settle(page)
  await clearAnnotations(page) // isolation: annotations persist across specs
  await enterDrawMode(page)
})

test('draws a stroke that commits to a real section', async ({ page }) => {
  expect(await strokeCount(page)).toBe(0)
  await drawInSectionTwo(page)

  const { strokes, headingPositions } = await readAnnotationState(page)
  expect(strokes.filter((s) => s.mode !== 'erase')).toHaveLength(1)
  const s = strokes[0]
  expect(s.sectionId, 'stroke must be anchored to a section').toBeTruthy()
  const known = new Set(headingPositions.map((h) => h.sectionId))
  expect(known.has(s.sectionId!) || s.sectionId === 'paper-top').toBeTruthy()
})

test('rendered stroke tracks its section through reflow', async ({ page }) => {
  await drawInSectionTwo(page)

  // Measure section + stroke ATOMICALLY (one rAF-synced read) so an in-flight
  // expand animation can't skew the two against each other. The invariant is
  // that the stroke keeps the same offset *within* its section across reflow.
  const measure = () =>
    page.evaluate((sel) => {
      const paper = document.getElementById('paper')!.getBoundingClientRect()
      const section = document.querySelector(sel)!.getBoundingClientRect()
      const path = document.querySelector('svg.annotation-section-svg path')?.getBoundingClientRect()
      return {
        sectionRel: section.top - paper.top,
        offsetInSection: path ? path.top - section.top : null,
      }
    }, SECTION_TWO)

  const m0 = await measure()
  await expandCalloutAbove(page)
  const m1 = await measure()

  expect(m1.sectionRel - m0.sectionRel, 'callout expansion should push Section Two down').toBeGreaterThan(20)
  expect(m0.offsetInSection, 'stroke should render inside its section').not.toBeNull()
  expect(
    Math.abs((m1.offsetInSection as number) - (m0.offsetInSection as number)),
    'stroke must keep its position within the section through reflow',
  ).toBeLessThan(6)
})

test('eraser hits the stroke at its post-reflow position, not the old one', async ({ page }) => {
  await drawInSectionTwo(page)
  const rel0 = (await strokeRelBoxes(page))[0].relCenterY

  await expandCalloutAbove(page)
  await sectionBox(page, await sectionTwoId(page)) // scroll stroke back into view
  await settle(page)

  const box1 = (await strokeRelBoxes(page))[0]
  const relDelta = box1.relCenterY - rel0
  expect(relDelta, 'stroke should have shifted down within the paper').toBeGreaterThan(20)

  await enterEraseMode(page)
  // The stroke's OLD viewport position (relDelta above its current one) must miss.
  await eraseAt(page, { x: box1.cxVp, y: box1.vpCenterY - relDelta })
  await settle(page)
  expect(await strokeCount(page), 'old position must not erase the moved stroke').toBe(1)

  // Its current rendered position must hit.
  await eraseAt(page, { x: box1.cxVp, y: box1.vpCenterY })
  await settle(page)
  expect(await strokeCount(page), 'current position must erase the stroke').toBe(0)
})

test('stroke positions survive a reload', async ({ page }) => {
  await drawInSectionTwo(page)
  const rel0 = (await strokeRelBoxes(page))[0].relTop
  const count0 = await strokeCount(page)

  await page.reload()
  await page.locator('[data-pen-button]').first().waitFor({ state: 'visible', timeout: 20_000 })
  await settle(page)

  expect(await strokeCount(page)).toBe(count0)
  const rel1 = (await strokeRelBoxes(page))[0].relTop
  expect(Math.abs(rel1 - rel0), 'stroke must reload at the same paper-relative position').toBeLessThan(6)
})

test('pen pressure ramp is recorded as variable pressure', async ({ page }) => {
  const box = await sectionBox(page, await sectionTwoId(page))
  await drawCommitting(
    page,
    [
      { x: box.x + 30, y: box.y + 60 },
      { x: box.x + 160, y: box.y + 60 },
    ],
    { pointerType: 'pen', pressure: 'ramp', steps: 12 },
  )
  const { strokes } = await readAnnotationState(page)
  const pressures = strokes[strokes.length - 1].points.map((p) => p.pressure)
  const unique = new Set(pressures.map((p) => Math.round(p * 100)))
  expect(unique.size, 'pen pressure should vary along the stroke').toBeGreaterThan(1)
})

test('pinch-zoom does not drop strokes', async ({ page }) => {
  await drawInSectionTwo(page)
  expect(await strokeCount(page)).toBe(1)

  const b = (await strokeRelBoxes(page))[0]
  await pinch(page, { centerX: b.cxVp, centerY: b.vpCenterY, fromGap: 80, toGap: 240 })
  await settle(page)

  // Strokes are persisted state — a pinch must never lose them.
  expect(await strokeCount(page)).toBe(1)
})
