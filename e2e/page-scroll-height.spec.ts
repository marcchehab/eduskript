import { test, expect } from '@playwright/test'
import { E2E_PAGE_PATH } from '../scripts/seed-e2e.mjs'
import {
  clearAnnotations,
  drawCommitting,
  enterDrawMode,
  paperBox,
  pinch,
  readZoom,
  scrollHeightMetrics,
  sectionBox,
  sectionIdByHeading,
  settle,
} from './helpers/input'

/**
 * Regression guard for the section-anchored stroke SVGs inflating the page's
 * scrollable height (fix: section-anchored-strokes.tsx). Each per-section SVG
 * used to be sized to the full paper height but positioned at its section's
 * top, so a stroke in a low section spilled ~a page below #paper — inflating
 * #scroll-container.scrollHeight (phantom scroll past the paper bottom + a
 * wrong reading-progress total). The SVG is now clipped to reach the paper
 * bottom, so drawing must NOT grow the layout height. The invariant is
 * zoom-independent: <main>'s (unscaled) scrollHeight must stay ≈ #paper height.
 */

const LOW_SECTION = 'Section Three' // far down the page → maximal pre-fix inflation

test.beforeEach(async ({ page }) => {
  await page.goto(E2E_PAGE_PATH)
  await page.locator('[data-pen-button]').first().waitFor({ state: 'visible', timeout: 20_000 })
  await settle(page)
  await clearAnnotations(page)
  await enterDrawMode(page)
})

async function drawInLowSection(page: import('@playwright/test').Page) {
  const id = await sectionIdByHeading(page, LOW_SECTION)
  const box = await sectionBox(page, id)
  await drawCommitting(
    page,
    [
      { x: box.x + 30, y: box.y + 20 },
      { x: box.x + 140, y: box.y + 20 },
    ],
    { pointerType: 'pen', pressure: 0.5 },
  )
}

test('a stroke in a low section does not inflate the page scroll height', async ({ page }) => {
  const before = await scrollHeightMetrics(page)
  await drawInLowSection(page)
  const after = await scrollHeightMetrics(page)

  // Pre-fix this jumped by hundreds of px (a full-paper-height SVG anchored deep
  // in the page). The clipped SVG ends at the paper bottom → no growth.
  expect(
    after.mainScrollHeight - before.mainScrollHeight,
    'drawing a stroke must not grow the layout scroll height',
  ).toBeLessThan(40)
  // And the scrollable area still ends at the paper (no phantom scroll below).
  expect(after.scrollHeight - after.scaledPaperHeight).toBeLessThan(60)
})

test('page scroll height stays correct under zoom', async ({ page }) => {
  const before = await scrollHeightMetrics(page)
  await drawInLowSection(page)

  const pb = await paperBox(page)
  await pinch(page, { centerX: pb.x + pb.width / 2, centerY: 280, fromGap: 80, toGap: 240 })
  await settle(page)

  const z = await readZoom(page)
  expect(z, 'pinch should have zoomed in').toBeGreaterThan(1.1)

  const after = await scrollHeightMetrics(page)
  // <main> layout height is unscaled — the SVG must not have inflated it even
  // though we drew a stroke and then zoomed.
  expect(
    after.mainScrollHeight - before.mainScrollHeight,
    'layout scroll height must not grow when zoomed',
  ).toBeLessThan(40)
  // The zoom spacer (= main.scrollHeight × zoom) must track the scaled paper,
  // not a phantom page-tall overflow. Pre-fix this was ~1.5×+ too tall.
  expect(
    Math.abs(after.scrollHeight - after.scaledPaperHeight),
    'scrollable area must match the scaled paper under zoom',
  ).toBeLessThan(after.scaledPaperHeight * 0.15)
})
