import { expect, test, type Page } from '@playwright/test'
import {
  STUDENT,
  cdpTouch,
  clearStoredAnnotations,
  createScratchPage,
  deleteScratchPage,
  drawRelativeTo,
  loginAs,
  openPage,
  readZoom,
  renderedStrokes,
  selectPen,
  waitForStoredStrokes,
  type ScratchPage,
  type TouchPt,
} from './helpers'

/**
 * QA run 2026-11-19-a, plugin findings:
 * - plugin-timeout-with-strokes-crashes-page: a plugin that sends plugin:ready
 *   after the 5 s timeout unmounted the wrapper holding the portaled strokes
 *   -> NotFoundError removeChild -> "This page couldn't load".
 * - annotations-plugin-error-hides-strokes-silently: error states had no
 *   data-section-id, strokes anchored to the plugin vanished.
 * - plugin-pinch-page-zoom-damped: a pinch inside a plugin zoomed the page by
 *   fingerRatio^0.2.
 * - pinch-first-finger-in-plugin-no-page-zoom (Chromium routing): first finger
 *   in the plugin, second outside -> no page zoom.
 *
 * The plugin API is mocked with page.route, so no plugin row is needed.
 */

const SRC = 'e2e-fix/probe'
// Section ids may be `plugin-e2e-fix-probe` (legacy scheme) or carry a
// scope suffix (`plugin-e2e-fix-probe@…#1`); match both, never the -end sentinel.
const WRAP = '[data-section-id^="plugin-e2e-fix-probe"]:not([data-section-id$="-end"])'
const wrapId = (page: Page) => page.locator(WRAP).getAttribute('data-section-id')
const API = `**/api/plugins/e2e-fix/probe`
const NEUTRAL = 'This interactive element is not available right now.'

const BODY = `<div style="height:360px;background:#dde7f5;font:16px sans-serif;padding:8px">probe plugin</div>
<script>eduskript.init().onReady(function(){})</script>`

// Holds back plugin:ready until `delayMs` after the iframe started, the way a
// plugin waiting on a slow CDN would. window.parent is [Replaceable].
const slowBody = (delayMs: number) => `<script>
(function(){
  var real = window.parent, until = Date.now() + ${delayMs};
  window.parent = { postMessage: function(m, o) {
    if (m && m.type === 'plugin:ready' && Date.now() < until) {
      setTimeout(function(){ real.postMessage(m, o) }, until - Date.now());
      return;
    }
    real.postMessage(m, o);
  } };
})();
</script>${BODY}`

const CONTENT = `# Plugin states

Some text above the plugin so a finger can land on the page next to it.

${Array.from({ length: 4 }, (_, i) => `Intro paragraph ${i + 1} with enough words to take up a full line of text here.`).join('\n\n')}

<plugin src="${SRC}" height="360" />

${Array.from({ length: 12 }, (_, i) => `Filler paragraph ${i + 1} so the page scrolls.`).join('\n\n')}
`

async function servePlugin(page: Page, mode: { html: string } | { status: number }) {
  await page.unroute(API)
  await page.route(API, (r) =>
    'status' in mode
      ? r.fulfill({ status: mode.status, body: 'down' })
      : r.fulfill({ json: { plugin: { entryHtml: mode.html, manifest: {} } } }),
  )
}

const iframeShown = (page: Page) =>
  page.locator(`${WRAP} iframe`).evaluate((el) => (el as HTMLElement).style.display === 'block')

let scratch: ScratchPage

test.beforeAll(async () => {
  scratch = await createScratchPage(CONTENT, 'plugin-states')
})
test.afterAll(async () => {
  if (scratch) await deleteScratchPage(scratch.id)
})

async function drawOnPlugin(page: Page) {
  await clearStoredAnnotations(STUDENT.email, scratch.id)
  await servePlugin(page, { html: BODY })
  await openPage(page, scratch.path)
  await expect.poll(() => iframeShown(page)).toBe(true)
  await page.waitForTimeout(1500)
  await selectPen(page)
  await drawRelativeTo(page, WRAP, 60, 80)
  const sid = await wrapId(page)
  const stored = await waitForStoredStrokes(STUDENT.email, scratch.id, 1)
  expect(stored[0].sectionId).toBe(sid)
  const before = (await renderedStrokes(page)).filter((s) => s.host === sid)
  expect(before).toHaveLength(1)
  return { ...before[0], sid: sid! }
}

test.describe('plugin states keep the section anchor', () => {
  test.describe.configure({ mode: 'serial' })

  test('slow plugin (ready after 7 s): no crash, strokes stay, plugin recovers', async ({ page, context }) => {
    test.setTimeout(90_000)
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await loginAs(context, STUDENT)
    const before = await drawOnPlugin(page)

    await servePlugin(page, { html: slowBody(7000) })
    await page.reload()
    await openPage(page, scratch.path)

    // The 5 s ready timeout fires: neutral note, wrapper and stroke still there.
    await expect(page.getByText(NEUTRAL)).toBeVisible({ timeout: 15_000 })
    await expect(page.locator(WRAP)).toHaveCount(1)
    expect(await wrapId(page)).toBe(before.sid)
    expect((await renderedStrokes(page)).filter((s) => s.host === before.sid)).toHaveLength(1)
    await expect(page.getByText("This page couldn't load")).toHaveCount(0)

    // The late plugin:ready shows the plugin; the stroke is where it was.
    await expect.poll(() => iframeShown(page), { timeout: 15_000 }).toBe(true)
    await expect(page.getByText(NEUTRAL)).toHaveCount(0)
    const after = (await renderedStrokes(page)).filter((s) => s.host === before.sid)
    expect(after).toHaveLength(1)
    expect(Math.abs(after[0].y - before.y)).toBeLessThan(1)
    expect(Math.abs(after[0].x - before.x)).toBeLessThan(1)
    expect(errors.filter((m) => /removeChild|NotFoundError/.test(m))).toEqual([])
  })

  test('plugin fetch fails: strokes anchored to it still render', async ({ page, context }) => {
    test.setTimeout(60_000)
    await loginAs(context, STUDENT)
    const before = await drawOnPlugin(page)

    await servePlugin(page, { status: 503 })
    await page.reload()
    await openPage(page, scratch.path)
    await expect(page.getByText(NEUTRAL)).toBeVisible({ timeout: 15_000 })
    await expect(page.locator(WRAP)).toHaveCount(1)
    expect(await wrapId(page)).toBe(before.sid)
    await expect.poll(async () => (await renderedStrokes(page)).filter((s) => s.host === before.sid).length).toBe(1)
  })
})

// ── Pinch over a plugin ─────────────────────────────────────────────────────

/** Synthetic TouchEvent inside the plugin iframe (WebKit has no CDP). */
async function frameTouch(page: Page, type: string, touches: TouchPt[], changed: TouchPt[]) {
  const frame = await (await page.locator(`${WRAP} iframe`).elementHandle())!.contentFrame()
  const box = (await page.locator(`${WRAP} iframe`).boundingBox())!
  // Frame-local client coords; screen coords = page viewport coords (the SDK
  // only uses screenX/Y differences and the midpoint).
  await frame!.evaluate(
    ([type, touches, changed, ox, oy]) => {
      const d = document as unknown as {
        createTouch?: (v: Window, t: EventTarget, id: number, px: number, py: number, sx: number, sy: number) => Touch
        createTouchList?: (...t: Touch[]) => TouchList
      }
      const target = document.body
      const mk = (t: { id: number; x: number; y: number }) => {
        const cx = t.x - ox, cy = t.y - oy
        try {
          return new Touch({ identifier: t.id, target, clientX: cx, clientY: cy, screenX: t.x, screenY: t.y })
        } catch {
          return d.createTouch!(window, target, t.id, cx, cy, t.x, t.y)
        }
      }
      const list = (ts: Touch[]) => (d.createTouchList ? d.createTouchList(...ts) : ts) as unknown as Touch[]
      target.dispatchEvent(new TouchEvent(type, {
        touches: list(touches.map(mk)), targetTouches: list(touches.map(mk)), changedTouches: list(changed.map(mk)),
        bubbles: true, cancelable: true,
      }))
    },
    [type, touches, changed, box.x, box.y] as const,
  )
}

const nextFrame = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))))

test.describe('pinch over a plugin zooms the page', () => {
  test('both fingers in the plugin: page zoom follows the finger ratio', async ({ page, context, browserName }) => {
    await loginAs(context, STUDENT)
    await servePlugin(page, { html: BODY })
    await openPage(page, scratch.path)
    await expect.poll(() => iframeShown(page)).toBe(true)
    await page.locator(WRAP).scrollIntoViewIfNeeded()
    const box = (await page.locator(`${WRAP} iframe`).boundingBox())!
    const cx = box.x + box.width / 2
    const cy = box.y + Math.min(box.height / 2, 120)
    const at = (gap: number): TouchPt[] => [{ id: 1, x: cx - gap / 2, y: cy }, { id: 2, x: cx + gap / 2, y: cy }]
    const z0 = await readZoom(page)

    if (browserName === 'chromium') {
      await cdpTouch(page, 'touchStart', at(100))
      for (let i = 1; i <= 12; i++) { await cdpTouch(page, 'touchMove', at(100 + (100 * i) / 12)); await nextFrame(page) }
      await cdpTouch(page, 'touchEnd', [])
    } else {
      const s = at(100)
      await frameTouch(page, 'touchstart', [s[0]], [s[0]])
      await frameTouch(page, 'touchstart', s, [s[1]])
      let cur = s
      for (let i = 1; i <= 12; i++) { cur = at(100 + (100 * i) / 12); await frameTouch(page, 'touchmove', cur, cur); await nextFrame(page) }
      await frameTouch(page, 'touchend', [], cur)
    }
    // Before the fix: x1.15 for a 2x spread (ratio^0.2). Chromium drops the
    // first touchmoves of a real touch sequence (measured x1.71 for 2x), the
    // synthetic WebKit path delivers all of them.
    await expect.poll(async () => (await readZoom(page)) / z0).toBeGreaterThan(1.6)
    expect((await readZoom(page)) / z0).toBeLessThan(2.2)
  })

  test('first finger in the plugin, second on the page: page zooms', async ({ page, context, browserName }) => {
    // Needs real touch routing (whole sequence goes to the first finger's
    // frame); synthetic events in WebKit cannot reproduce that.
    test.skip(browserName !== 'chromium', 'CDP-only: browser touch routing between frames')
    await loginAs(context, STUDENT)
    await servePlugin(page, { html: BODY })
    await openPage(page, scratch.path)
    await expect.poll(() => iframeShown(page)).toBe(true)
    // Plugin top roughly mid-viewport so there is page text above it.
    await page.locator(WRAP).evaluate((el) => el.scrollIntoView({ block: 'center' }))
    const box = (await page.locator(`${WRAP} iframe`).boundingBox())!
    const x = box.x + box.width / 2
    const A = (d: number): TouchPt => ({ id: 1, x, y: box.y + 50 + d })
    const B = (d: number): TouchPt => ({ id: 2, x, y: box.y - 50 - d })
    const z0 = await readZoom(page)

    await cdpTouch(page, 'touchStart', [A(0)])
    await cdpTouch(page, 'touchStart', [A(0), B(0)])
    for (let i = 1; i <= 12; i++) { const d = (50 * i) / 12; await cdpTouch(page, 'touchMove', [A(d), B(d)]); await nextFrame(page) }
    await cdpTouch(page, 'touchEnd', [])
    // Before the fix: ratio 1.000.
    await expect.poll(async () => (await readZoom(page)) / z0).toBeGreaterThan(1.5)
  })
})
