import { expect, test } from '@playwright/test'
import {
  STUDENT,
  createScratchPage,
  deleteScratchPage,
  drawRelativeTo,
  loginAs,
  openPage,
  paperFrame,
  pinch,
  readZoom,
  renderedStrokes,
  selectPen,
  stateStrokes,
  waitForStoredStrokes,
  type ScratchPage,
} from './helpers'

/**
 * Smoke test for the annotation-fixes harness itself (helpers.ts): runs in
 * chromium (CDP touch) and webkit-ipad (synthetic touch). Not a fix test.
 */

const CONTENT = `# Harness smoke

## First section

Paragraph one in the first section, long enough to give the section some height.

## Second section

Paragraph in the second section — the stroke is drawn below this heading.

${Array.from({ length: 10 }, (_, i) => `Filler paragraph ${i + 1} so the page scrolls.`).join('\n\n')}
`

let scratch: ScratchPage

test.beforeAll(async () => {
  scratch = await createScratchPage(CONTENT, 'harness')
})
test.afterAll(async () => {
  if (scratch) await deleteScratchPage(scratch.id)
})

test('draw a stroke as a student; it persists and renders after reload', async ({ page, context }) => {
  await loginAs(context, STUDENT)
  await openPage(page, scratch.path)
  await selectPen(page)

  await drawRelativeTo(page, '#paper h2:nth-of-type(2)', 40, 60)
  await expect.poll(async () => (await stateStrokes(page)).length).toBe(1)

  const stored = await waitForStoredStrokes(STUDENT.email, scratch.id, 1)
  expect(stored[0].sectionId, 'stroke is section-anchored').toBeTruthy()
  expect(stored[0].points.length).toBeGreaterThan(2)

  const before = await renderedStrokes(page)
  expect(before).toHaveLength(1)

  await page.reload()
  await openPage(page, scratch.path)
  await expect.poll(async () => (await renderedStrokes(page)).length, { timeout: 10_000 }).toBe(1)
  const after = await renderedStrokes(page)
  expect(Math.abs(after[0].y - before[0].y)).toBeLessThan(1)
  expect(Math.abs(after[0].x - before[0].x)).toBeLessThan(1)
})

test('a two-finger pinch changes zoom', async ({ page, context }) => {
  await loginAs(context, STUDENT)
  await openPage(page, scratch.path)
  // Not necessarily 1: narrow viewports (iPad) open fit-to-width.
  const z0 = await readZoom(page)
  const f = await paperFrame(page)
  const vp = page.viewportSize()!
  await pinch(page, { centerX: Math.max(f.left + 200, vp.width / 2), centerY: vp.height / 2, fromGap: 100, toGap: 260 })
  await expect.poll(() => readZoom(page)).toBeGreaterThan(z0 * 1.3)
})
