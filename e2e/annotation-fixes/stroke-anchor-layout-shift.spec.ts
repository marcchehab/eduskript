import { expect, test, type Page } from '@playwright/test'
import {
  STUDENT,
  clearStoredAnnotations,
  createScratchPage,
  deleteScratchPage,
  loginAs,
  openPage,
  paperFrame,
  scrollPaperYIntoView,
  selectPen,
  stateStrokes,
  strokesRelativeTo,
  waitForStoredStrokes,
  type ScratchPage,
} from './helpers'

/**
 * Finding annotations-layout-shift-during-stroke-misanchors (+ the "stroke
 * 8 px below a plugin is stored with the plugin id, not its -end sentinel"
 * note). Fix in src/components/annotations/simple-canvas.tsx
 * (pickAnchorElement / rebaseStrokePoints).
 *
 * The layout shift is produced by growing a paragraph above the target
 * heading mid-stroke (same effect as a plugin iframe going 66 → 659 px).
 */

const CONTENT = `# Anchor layout shift

## Above

Shifter paragraph: it grows by 600 px while the stroke is in progress.

## Target heading

Text under the target heading.

> [!note] A callout
> Callout body. Ink in its bottom margin should anchor to its end sentinel.

Paragraph after the callout.

${Array.from({ length: 12 }, (_, i) => `Filler paragraph ${i + 1} so the page scrolls.`).join('\n\n')}
`

const TARGET = 'h2[data-heading-text="Target heading"]'

// Mouse-driven, not touch/Safari-specific: chromium only. (In the remote
// webkit-ipad project mouse strokes here did not register reliably.)
test.skip(({ browserName }) => browserName === 'webkit', 'not touch/Safari-specific')

let scratch: ScratchPage

test.beforeAll(async () => {
  scratch = await createScratchPage(CONTENT, 'anchor-shift')
})
test.beforeEach(async () => {
  await clearStoredAnnotations(STUDENT.email, scratch.id)
})
test.afterAll(async () => {
  if (scratch) await deleteScratchPage(scratch.id)
})

/** Viewport y of `selector`'s top. */
async function viewportTop(page: Page, selector: string) {
  return page.evaluate((sel) => document.querySelector(sel)!.getBoundingClientRect().top, selector)
}

test('content above grows during the stroke: the stroke stays under its heading', async ({ page, context }) => {
  await loginAs(context, STUDENT)
  await openPage(page, scratch.path)
  await selectPen(page)
  await expect(page.locator(TARGET)).toHaveCount(1)

  const heading = await page.evaluate((sel) => {
    const p = document.getElementById('paper')!
    const s = p.getBoundingClientRect().width / p.offsetWidth
    return { y: (document.querySelector(sel)!.getBoundingClientRect().top - p.getBoundingClientRect().top) / s }
  }, TARGET)
  await scrollPaperYIntoView(page, heading.y, 250)
  const f = await paperFrame(page)
  const dy = 20 * f.s // 20 paper px below the heading's top, in viewport px
  const x0 = f.left + 150 * f.s

  let top = await viewportTop(page, TARGET)
  await page.mouse.move(x0, top + dy)
  await page.mouse.down()
  for (let i = 1; i <= 4; i++) await page.mouse.move(x0 + i * 15 * f.s, top + dy)

  // Grow the paragraph above the heading by 600 px (a plugin finishing load).
  await page.evaluate(() => {
    const p = [...document.querySelectorAll('#paper p')].find((e) => e.textContent?.startsWith('Shifter'))!
    ;(p as HTMLElement).style.paddingBottom = '600px'
  })
  // Let the debounced headingPositions (300 ms) catch up, as on a slow load.
  await page.waitForTimeout(500)

  // The student keeps writing next to the heading where it is now.
  top = await viewportTop(page, TARGET)
  for (let i = 5; i <= 9; i++) await page.mouse.move(x0 + i * 15 * f.s, top + dy)
  await page.mouse.up()

  await expect.poll(async () => (await stateStrokes(page)).length).toBe(1)
  const [s] = await stateStrokes(page)
  const targetId = await page.locator(TARGET).getAttribute('data-section-id')
  expect(s.sectionId).toBe(targetId)
  for (const p of s.points) expect(Math.abs(p.y - s.sectionOffsetY! - 20)).toBeLessThan(3)

  // Reload: the shifter is back to normal height; the stroke is still 20 px under the heading.
  await waitForStoredStrokes(STUDENT.email, scratch.id, 1)
  await page.reload()
  await openPage(page, scratch.path)
  await expect.poll(async () => (await strokesRelativeTo(page, TARGET)).length, { timeout: 10_000 }).toBe(1)
  const [r] = await strokesRelativeTo(page, TARGET)
  // Box top = line y minus half the stroke width.
  expect(Math.abs(r.dy - 20)).toBeLessThan(6)
})

test('ink in the bottom margin of a callout anchors to its -end sentinel', async ({ page, context }) => {
  await loginAs(context, STUDENT)
  await openPage(page, scratch.path)
  await selectPen(page)

  // The callout element with an end sentinel; ids are read from the DOM.
  const box = await page.evaluate(() => {
    const p = document.getElementById('paper')!
    const s = p.getBoundingClientRect().width / p.offsetWidth
    const pt = p.getBoundingClientRect().top
    for (const el of document.querySelectorAll<HTMLElement>('#paper [data-section-id]')) {
      const id = el.getAttribute('data-section-id')!
      if (!el.textContent?.includes('Callout body')) continue
      const end = document.querySelector(`[data-section-id="${CSS.escape(`${id}-end`)}"]`)
      if (!end) continue
      return {
        id,
        bottom: (el.getBoundingClientRect().bottom - pt) / s,
        endTop: (end.getBoundingClientRect().top - pt) / s,
      }
    }
    return null
  })
  expect(box, 'callout with -end sentinel').not.toBeNull()
  const margin = box!.endTop - box!.bottom
  expect(margin, 'callout has a bottom margin').toBeGreaterThan(6)

  const py = box!.bottom + margin / 2
  await scrollPaperYIntoView(page, py, 250)
  const f = await paperFrame(page)
  const y = f.top + py * f.s
  await page.mouse.move(f.left + 150 * f.s, y)
  await page.mouse.down()
  for (let i = 1; i <= 6; i++) await page.mouse.move(f.left + (150 + i * 15) * f.s, y)
  await page.mouse.up()

  await expect.poll(async () => (await stateStrokes(page)).length).toBe(1)
  const [s] = await stateStrokes(page)
  expect(s.sectionId).toBe(`${box!.id}-end`)
})
