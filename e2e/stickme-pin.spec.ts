import { test, expect, type Page } from '@playwright/test'
import { E2E_PAGE_PATH } from '../scripts/seed-e2e.mjs'
import { pinch, readZoom, scrollContainerTo, settle } from './helpers/input'

/**
 * Regression guard for <stickme> pinning under zoom (fix: stick-me.tsx). A
 * pinned element anchors its right edge to the viewport (scroll-container)
 * right edge. Pre-fix it anchored to #paper's right edge, which zoom pushes
 * off-screen — so the pinned element flew off the right side of the viewport.
 * Pins via transform inside the zoomed <main>, so this also exercises the
 * zoom-aware translate math.
 */

const CARD = 'E2E pinned card'

/** Box of the pinned card's blockquote, plus the viewport edges, in one read. */
async function pinnedCardBox(page: Page) {
  const m = await page.evaluate((needle) => {
    const sc = document.getElementById('scroll-container')
    if (!sc) return null
    const bq = [...document.querySelectorAll('blockquote')].find((b) =>
      b.textContent?.includes(needle),
    )
    if (!bq) return null
    const r = bq.getBoundingClientRect()
    const s = sc.getBoundingClientRect()
    return { top: r.top, right: r.right, left: r.left, vpTop: s.top, vpRight: s.right }
  }, CARD)
  if (!m) throw new Error('pinned card or scroll container not found')
  return m
}

/** Scroll so the card docks (its top passes the viewport top with room below). */
async function dockCard(page: Page) {
  const topInContent = await page.evaluate((needle) => {
    const sc = document.getElementById('scroll-container')!
    const bq = [...document.querySelectorAll('blockquote')].find((b) =>
      b.textContent?.includes(needle),
    )!
    return bq.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop
  }, CARD)
  await scrollContainerTo(page, topInContent + 80) // push it above the fold → pins
}

test.beforeEach(async ({ page }) => {
  await page.goto(E2E_PAGE_PATH)
  await page.getByText(CARD).first().waitFor({ state: 'visible', timeout: 20_000 })
  await settle(page)
})

test('pinned <stickme> stays anchored to the viewport right edge, including when zoomed', async ({
  page,
}) => {
  // 1) Dock it at zoom 1 — right edge should sit just inside the viewport.
  await dockCard(page)
  const a = await pinnedCardBox(page)
  expect(a.top - a.vpTop, 'card should be pinned near the viewport top').toBeLessThan(80)
  expect(a.right, 'pinned right edge must be on-screen').toBeLessThanOrEqual(a.vpRight + 2)
  expect(a.vpRight - a.right, 'pinned right edge should hug the viewport edge').toBeLessThan(40)

  // 2) Zoom in. Pre-fix the right edge anchored to #paper, which zoom drives
  //    off-screen → the card disappeared past the right of the viewport.
  await pinch(page, { centerX: a.vpRight / 2, centerY: 280, fromGap: 80, toGap: 240 })
  await settle(page)
  const z = await readZoom(page)
  expect(z, 'pinch should have zoomed in').toBeGreaterThan(1.1)

  // Scroll a touch so StickMe recomputes the pin against the new zoom.
  await page.evaluate(() => {
    const sc = document.getElementById('scroll-container')!
    sc.scrollTop += 60
  })
  await page.waitForTimeout(150)

  const b = await pinnedCardBox(page)
  expect(b.top - b.vpTop, 'card should still be pinned near the viewport top').toBeLessThan(120)
  expect(b.right, 'pinned right edge must stay on-screen under zoom').toBeLessThanOrEqual(
    b.vpRight + 2,
  )
  expect(b.vpRight - b.right, 'pinned right edge should still hug the viewport edge').toBeLessThan(40)
})
