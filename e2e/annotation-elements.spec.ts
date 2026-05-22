import { test, expect, type Page } from '@playwright/test'
import { E2E_PAGE_PATH, PAGE_CONTENT } from '../scripts/seed-e2e.mjs'
import {
  readAnnotationState,
  strokeCount,
  strokeRelBoxes,
  sectionBox,
  sectionPaperTop,
  clearAnnotations,
  enterDrawMode,
  escapeToView,
  drawCommitting,
  insertStickyNote,
  dragStickyNoteTo,
  addSnapInSection,
  elementBox,
  countOf,
  ratioInSection,
  patchPageContent,
  pinch,
  readZoom,
  settle,
  waitForPersist,
} from './helpers/input'

const SECTION_TWO = '[data-heading-text="Section Two"]'
const CALLOUT_TEXT = /Collapsible callout/i
const STROKE_SEL = 'svg.annotation-section-svg path'
const RATIO_TOL = 0.04 // fraction of section height

async function sectionTwoId(page: Page): Promise<string> {
  const id = await page.locator(SECTION_TWO).first().getAttribute('data-section-id')
  if (!id) throw new Error('Section Two has no data-section-id')
  return id
}

async function drawStrokeInSectionTwo(page: Page) {
  const box = await sectionBox(page, await sectionTwoId(page))
  const y = box.y + 24
  await enterDrawMode(page)
  await drawCommitting(
    page,
    [
      { x: box.x + 30, y },
      { x: box.x + 130, y },
    ],
    { pointerType: 'pen', pressure: 0.5 },
  )
}

async function expandCalloutAbove(page: Page) {
  await escapeToView(page)
  await page.getByText(CALLOUT_TEXT).first().dispatchEvent('click')
  await settle(page)
}

/** Place a sticky note, a snap and a stroke all in Section Two. Order matters:
 *  the sticky note + snap go down in view mode (no stylus) before the pen stroke
 *  flips stylus mode and leaves the canvas overlaying the content. */
async function placeAllThree(page: Page) {
  const sid = await sectionTwoId(page)
  const sec = await sectionBox(page, sid)
  const noteId = await insertStickyNote(page, { x: sec.x + 80, y: sec.y + 40 })
  const snapId = await addSnapInSection(page, sid)
  await drawStrokeInSectionTwo(page)
  return { sid, noteId, snapId }
}

async function ratios(page: Page, sid: string, noteId: string, snapId: string) {
  return {
    stroke: await ratioInSection(page, sid, STROKE_SEL),
    note: await ratioInSection(page, sid, `[data-sticky-note-id="${noteId}"]`),
    snap: await ratioInSection(page, sid, `[data-snap-id="${snapId}"]`),
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto(E2E_PAGE_PATH)
  await page.locator('[data-pen-button]').first().waitFor({ state: 'visible', timeout: 20_000 })
  await settle(page)
  await clearAnnotations(page)
})

test('stroke, sticky note and snap reposition on reflow and stay aligned on zoom', async ({ page }) => {
  const { sid, noteId, snapId } = await placeAllThree(page)

  const r0 = await ratios(page, sid, noteId, snapId)
  expect(r0.stroke, 'stroke in section').not.toBeNull()
  expect(r0.note, 'note in section').not.toBeNull()
  expect(r0.snap, 'snap in section').not.toBeNull()

  // 1) Reflow: add content above (expand the callout). All three must keep
  //    their position within Section Two.
  await expandCalloutAbove(page)
  const r1 = await ratios(page, sid, noteId, snapId)
  expect(Math.abs(r1.stroke! - r0.stroke!), 'stroke repositions with section').toBeLessThan(RATIO_TOL)
  expect(Math.abs(r1.note! - r0.note!), 'note repositions with section').toBeLessThan(RATIO_TOL)
  expect(Math.abs(r1.snap! - r0.snap!), 'snap repositions with section').toBeLessThan(RATIO_TOL)

  // 2) Zoom: pinch in. All three must stay anchored to the same content.
  const b = (await strokeRelBoxes(page))[0]
  await pinch(page, { centerX: b.cxVp, centerY: b.vpCenterY, fromGap: 80, toGap: 240 })
  await settle(page)
  expect(await readZoom(page), 'pinch should zoom in').toBeGreaterThan(1)

  const r2 = await ratios(page, sid, noteId, snapId)
  expect(Math.abs(r2.stroke! - r0.stroke!), 'stroke stays put under zoom').toBeLessThan(RATIO_TOL)
  expect(Math.abs(r2.note! - r0.note!), 'note stays put under zoom').toBeLessThan(RATIO_TOL)
  expect(Math.abs(r2.snap! - r0.snap!), 'snap stays put under zoom').toBeLessThan(RATIO_TOL)
})

test('dragging a sticky note lands where it is dropped', async ({ page }) => {
  const sid = await sectionTwoId(page)
  const sec = await sectionBox(page, sid)
  const id = await insertStickyNote(page, { x: sec.x + 90, y: sec.y + 40 })

  const before = await elementBox(page, 'data-sticky-note-id', id)
  const target = { x: before.x + before.width / 2 + 110, y: before.y + 80 }
  const grabOffsetY = await dragStickyNoteTo(page, id, target)
  await settle(page)

  const after = await elementBox(page, 'data-sticky-note-id', id)
  // The grabbed header point should sit at `target` — the card must not jump.
  // Tolerances catch the "jumps to another place" bug (hundreds of px) while
  // allowing header-grab + sub-pixel rounding slack.
  expect(Math.abs(after.x + after.width / 2 - target.x), 'note x lands at drop').toBeLessThan(15)
  expect(Math.abs(after.y - (target.y - grabOffsetY)), 'note y lands at drop').toBeLessThan(25)
})

test('all three annotation styles survive a reload', async ({ page }) => {
  const { sid, noteId, snapId } = await placeAllThree(page)
  const r0 = await ratios(page, sid, noteId, snapId)

  await waitForPersist(page) // let debounced sync flush before reload aborts it
  await page.reload()
  await page.locator('[data-pen-button]').first().waitFor({ state: 'visible', timeout: 20_000 })
  await settle(page)

  expect(await strokeCount(page), 'stroke survives reload').toBe(1)
  expect(await countOf(page, 'data-sticky-note-id'), 'sticky note survives reload').toBe(1)
  expect(await countOf(page, 'data-snap-id'), 'snap survives reload').toBe(1)

  const r1 = await ratios(page, sid, noteId, snapId)
  expect(Math.abs(r1.stroke! - r0.stroke!), 'stroke reloads in place').toBeLessThan(RATIO_TOL)
  expect(Math.abs(r1.note! - r0.note!), 'note reloads in place').toBeLessThan(RATIO_TOL)
  expect(Math.abs(r1.snap! - r0.snap!), 'snap reloads in place').toBeLessThan(RATIO_TOL)
})

test('annotations stay anchored after editing the page (paragraph added at the top) + reload', async ({ page }) => {
  const { sid, noteId, snapId } = await placeAllThree(page)
  const r0 = await ratios(page, sid, noteId, snapId)
  const sectionTop0 = await sectionPaperTop(page, sid)

  const { pageId } = await readAnnotationState(page)
  expect(pageId, 'need the page id to edit content').toBeTruthy()

  const NEW_PARAGRAPH = [
    'BRAND NEW INTRO PARAGRAPH added at the very top by the content-edit test.',
    'It exists only to push every section (and its annotations) further down the page.',
    'Line three, to make the downward shift comfortably larger than tolerance.',
  ].join(' ')

  await waitForPersist(page) // ensure the annotations are saved before we edit+reload

  try {
    // Edit the real page content: prepend a paragraph before the H1.
    await patchPageContent(page, pageId!, `${NEW_PARAGRAPH}\n\n${PAGE_CONTENT}`)

    await page.reload()
    await page.locator('[data-pen-button]').first().waitFor({ state: 'visible', timeout: 20_000 })
    await settle(page)

    // The edit actually landed and pushed Section Two down.
    await expect(page.getByText('BRAND NEW INTRO PARAGRAPH')).toBeVisible()
    const sectionTop1 = await sectionPaperTop(page, sid)
    expect(sectionTop1 - sectionTop0, 'the new paragraph should push Section Two down').toBeGreaterThan(20)

    // All three annotations survived and are still anchored within their section.
    expect(await strokeCount(page), 'stroke survives the edit').toBe(1)
    expect(await countOf(page, 'data-sticky-note-id'), 'note survives the edit').toBe(1)
    expect(await countOf(page, 'data-snap-id'), 'snap survives the edit').toBe(1)

    const r1 = await ratios(page, sid, noteId, snapId)
    expect(Math.abs(r1.stroke! - r0.stroke!), 'stroke still in place after content edit').toBeLessThan(RATIO_TOL)
    expect(Math.abs(r1.note! - r0.note!), 'note still in place after content edit').toBeLessThan(RATIO_TOL)
    expect(Math.abs(r1.snap! - r0.snap!), 'snap still in place after content edit').toBeLessThan(RATIO_TOL)
  } finally {
    // Restore the seed content so later specs / reruns are unaffected.
    await patchPageContent(page, pageId!, PAGE_CONTENT)
  }
})

test('zoom scales the page and keeps a stroke aligned to its section', async ({ page }) => {
  const sid = await sectionTwoId(page)
  await drawStrokeInSectionTwo(page)

  expect(await readZoom(page)).toBeCloseTo(1, 1)
  const r0 = await ratioInSection(page, sid, STROKE_SEL)

  const b = (await strokeRelBoxes(page))[0]
  await pinch(page, { centerX: b.cxVp, centerY: b.vpCenterY, fromGap: 80, toGap: 260 })
  await settle(page)

  expect(await readZoom(page), '#paper/main should be scaled up').toBeGreaterThan(1)
  const r1 = await ratioInSection(page, sid, STROKE_SEL)
  expect(Math.abs(r1! - r0!), 'stroke stays anchored to its section under zoom').toBeLessThan(RATIO_TOL)
})
