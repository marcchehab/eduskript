import { test, expect, type Page } from '@playwright/test'
import { E2E_PAGE_PATH } from '../scripts/seed-e2e.mjs'

/**
 * Code editor pane layout (src/components/public/code-editor/index.tsx).
 * - A plain editor (no graphics, not Kara) takes the full width. Regression:
 *   the Kara side-by-side state defaulted to true for every editor, so each one
 *   was squeezed to 50 % next to an empty strip.
 * - Below 640 px the graphics pane (turtle/matplotlib) stacks under the code,
 *   both full width; wider, they stay side by side.
 * Runs anonymously (empty storage state) so typing code saves nothing to the DB.
 */
test.use({ storageState: { cookies: [], origins: [] } })

async function openEditor(page: Page) {
  await page.goto(E2E_PAGE_PATH)
  // The editor mounts lazily once scrolled near the viewport.
  // Retried: the page can re-render under us while hydrating.
  const cm = page.locator('.cm-editor').first()
  await expect(async () => {
    await page.getByText('Filler paragraph 12').scrollIntoViewIfNeeded({ timeout: 2_000 })
    await cm.waitFor({ state: 'visible', timeout: 5_000 })
  }).toPass({ timeout: 90_000 })
  await cm.scrollIntoViewIfNeeded()
  return cm
}

async function boxes(page: Page) {
  return page.evaluate(() => {
    const cm = document.querySelector('.cm-editor') as HTMLElement
    const wrapper = cm.closest('[data-dynamic-height]') as HTMLElement
    const fit = wrapper.querySelector('[title="Fit to view — show everything"]')
    const graphics = fit?.closest('.flex.flex-col.relative') as HTMLElement | null
    const r = (el: Element | null) => (el ? el.getBoundingClientRect().toJSON() : null)
    return { cm: r(cm), wrapper: r(wrapper), graphics: r(graphics) }
  })
}

async function addTurtleImport(page: Page) {
  await page.locator('.cm-content').first().click()
  await page.keyboard.press('Control+Home')
  await page.keyboard.type('import turtle\n')
  // Typing doesn't re-render (focus safety), so graphics detection only sees the
  // code once it is loaded again: wait for the debounced local save, reload.
  await page.waitForTimeout(2_000)
  await page.reload()
  await openEditor(page)
  await expect(page.locator('[title="Fit to view — show everything"]').first()).toBeVisible()
}

for (const [label, width] of [['mobile', 390], ['desktop', 1280]] as const) {
  test(`plain editor uses the full width (${label})`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    await openEditor(page)
    const b = await boxes(page)
    expect(b.cm!.width).toBeGreaterThan(b.wrapper!.width * 0.9)
  })
}

test('graphics pane stacks below the code on narrow screens', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openEditor(page)
  await addTurtleImport(page)
  const b = await boxes(page)
  expect(b.cm!.width).toBeGreaterThan(b.wrapper!.width * 0.9)
  expect(b.graphics!.width).toBeGreaterThan(b.wrapper!.width * 0.9)
  expect(b.graphics!.top).toBeGreaterThanOrEqual(b.cm!.bottom - 1)
  expect(b.graphics!.height).toBeGreaterThan(150)
})

test('graphics pane stays beside the code on desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 844 })
  await openEditor(page)
  await addTurtleImport(page)
  const b = await boxes(page)
  expect(b.graphics!.left).toBeGreaterThan(b.cm!.left + b.cm!.width / 2)
  expect(Math.abs(b.graphics!.top - b.wrapper!.top)).toBeLessThan(5)
})
