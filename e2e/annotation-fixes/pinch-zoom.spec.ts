import { expect, test, type Page } from '@playwright/test'
import { drawStroke } from '../helpers/input'
import {
  STUDENT,
  cdpTouch,
  createScratchPage,
  deleteScratchPage,
  loginAs,
  openPage,
  paperPointAt,
  pinch,
  readZoom,
  renderedStrokes,
  selectPen,
  stateStrokes,
  syntheticTouch,
  type ScratchPage,
  type TouchPt,
} from './helpers'

/**
 * Pinch / Ctrl+wheel zoom fixes (QA run 2026-11-19-a):
 * pinch-dead-zone-fingers-slip, pinch-pencil-plus-finger-zooms,
 * pinch-third-finger-lift-zoom-jump, paper-scale-blank-tail,
 * ctrl-wheel-zoom-rerenders-annotation-layer-per-event.
 *
 * Drift metric: the unscaled paper point under a viewport point, compared
 * before/after; converted to screen px by multiplying with the zoom.
 */

const CONTENT = `# Zoom fixes

${Array.from(
  { length: 30 },
  (_, i) => `## Section ${i + 1}

Paragraph ${i + 1}: plain text so a pinch lands on page content, not on a plugin or an editor. It is long enough to wrap onto a second line on narrow viewports.`,
).join('\n\n')}
`

let scratch: ScratchPage

test.beforeAll(async () => {
  scratch = await createScratchPage(CONTENT, 'pinch')
})
test.afterAll(async () => {
  if (scratch) await deleteScratchPage(scratch.id)
})

const isChromium = (page: Page) => page.context().browser()?.browserType().name() === 'chromium'

async function setScrollTop(page: Page, top: number) {
  await page.evaluate((t) => {
    document.getElementById('scroll-container')!.scrollTop = t
  }, top)
  await page.waitForTimeout(100)
}

const frame = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))))

/**
 * A two-finger gesture from explicit per-step finger positions. Trusted CDP
 * touches in chromium, synthetic TouchEvents elsewhere.
 */
async function twoFingerPath(page: Page, steps: TouchPt[][]) {
  if (isChromium(page)) {
    await cdpTouch(page, 'touchStart', steps[0])
    for (const pts of steps.slice(1)) {
      await cdpTouch(page, 'touchMove', pts)
      await frame(page)
    }
    await cdpTouch(page, 'touchEnd', [])
  } else {
    const s = steps[0]
    await syntheticTouch(page, 'touchstart', [s[0]], [s[0]])
    await syntheticTouch(page, 'touchstart', s, [s[1]])
    let cur = s
    for (const pts of steps.slice(1)) {
      cur = pts
      await syntheticTouch(page, 'touchmove', cur, cur)
      await frame(page)
    }
    await syntheticTouch(page, 'touchend', [cur[0]], [cur[1]])
    await syntheticTouch(page, 'touchend', [], [cur[0]])
  }
  await page.waitForTimeout(200)
}

async function drift(page: Page, before: { x: number; y: number }, cx: number, cy: number) {
  const after = await paperPointAt(page, cx, cy)
  return Math.hypot(after.x - before.x, after.y - before.y) * (await readZoom(page))
}

test.describe('touch pinch', () => {
  test.beforeEach(async ({ page, context }) => {
    await loginAs(context, STUDENT)
    await openPage(page, scratch.path)
    await setScrollTop(page, 600)
  })

  test('symmetric pinch: zoom follows the finger ratio, content stays under the midpoint', async ({ page }) => {
    const vp = page.viewportSize()!
    const cx = vp.width / 2
    const cy = vp.height / 2
    const z0 = await readZoom(page)
    const p0 = await paperPointAt(page, cx, cy)
    await pinch(page, { centerX: cx, centerY: cy, fromGap: 120, toGap: 240, steps: 12 })
    const ratio = (await readZoom(page)) / z0
    // Before the fix: the 15 px dead zone was swallowed → 240/136 ≈ 1.76.
    expect(ratio).toBeGreaterThan(1.97)
    expect(ratio).toBeLessThan(2.03)
    expect(await drift(page, p0, cx, cy)).toBeLessThanOrEqual(2)
  })

  test('pinch plus pan: content follows the finger midpoint from the first move', async ({ page }) => {
    const vp = page.viewportSize()!
    const cx = vp.width / 2
    const cy = vp.height / 2
    const p0 = await paperPointAt(page, cx, cy)
    // Each step: spread +6 px, move both fingers up 5 px. The first three
    // steps are inside the old 15 px dead zone.
    const steps: TouchPt[][] = []
    for (let i = 0; i <= 12; i++) {
      const gap = 200 + 6 * i
      const y = cy - 5 * i
      steps.push([
        { id: 1, x: cx - gap / 2, y },
        { id: 2, x: cx + gap / 2, y },
      ])
    }
    await twoFingerPath(page, steps)
    // Before the fix: about 15 px (3 steps × 5 px) of pan were lost.
    expect(await drift(page, p0, cx, cy - 5 * 12)).toBeLessThanOrEqual(2)
  })

  test('Apple Pencil plus a resting finger neither zooms nor scrolls', async ({ page }) => {
    // WebKit copies the Touch objects into the dispatched event, so the
    // touchType set via defineProperty is lost (e.touches[i].touchType is
    // undefined there) and a synthetic Pencil cannot be expressed.
    test.skip(!isChromium(page), 'synthetic touchType does not survive dispatch in WebKit')
    const vp = page.viewportSize()!
    const y = vp.height * 0.5
    const z0 = await readZoom(page)
    const st0 = await page.evaluate(() => document.getElementById('scroll-container')!.scrollTop)
    const finger: TouchPt = { id: 1, x: vp.width * 0.35, y, touchType: 'direct' }
    let pencil: TouchPt = { id: 2, x: vp.width * 0.6, y, touchType: 'stylus' }
    await syntheticTouch(page, 'touchstart', [finger], [finger])
    await syntheticTouch(page, 'touchstart', [finger, pencil], [pencil])
    for (let i = 1; i <= 20; i++) {
      pencil = { ...pencil, x: pencil.x + 8, y: pencil.y + 6 }
      await syntheticTouch(page, 'touchmove', [finger, pencil], [pencil])
      await frame(page)
    }
    await syntheticTouch(page, 'touchend', [finger], [pencil])
    await syntheticTouch(page, 'touchend', [], [finger])
    await page.waitForTimeout(200)
    expect(await readZoom(page)).toBeCloseTo(z0, 4)
    expect(await page.evaluate(() => document.getElementById('scroll-container')!.scrollTop)).toBe(st0)
  })

  test('third finger down, first finger lifted: no jump on the next move', async ({ page }) => {
    // Synthetic in both engines: CDP cannot lift a single touch point.
    const vp = page.viewportSize()!
    const y = vp.height * 0.4
    const x = vp.width * 0.5
    let a: TouchPt = { id: 1, x: x - 100, y }
    let b: TouchPt = { id: 2, x: x + 100, y }
    const c: TouchPt = { id: 3, x: x - 20, y: vp.height * 0.7 }
    await syntheticTouch(page, 'touchstart', [a], [a])
    await syntheticTouch(page, 'touchstart', [a, b], [b])
    for (let i = 1; i <= 6; i++) {
      a = { ...a, x: x - 100 - 5 * i }
      b = { ...b, x: x + 100 + 5 * i }
      await syntheticTouch(page, 'touchmove', [a, b], [a, b])
      await frame(page)
    }
    await page.waitForTimeout(100)
    await syntheticTouch(page, 'touchstart', [a, b, c], [c])
    await syntheticTouch(page, 'touchend', [b, c], [a])
    await page.waitForTimeout(100)
    const mid = () => ({ x: (b.x + c.x) / 2, y: (b.y + c.y) / 2 })
    const z1 = await readZoom(page)
    const p1 = await paperPointAt(page, mid().x, mid().y)
    b = { ...b, x: b.x + 1 }
    await syntheticTouch(page, 'touchmove', [b, c], [b])
    await frame(page)
    await page.waitForTimeout(100)
    // Before the fix: zoom jumped by dist(B,C)/dist(A,B) and scroll by ~185 px.
    expect((await readZoom(page)) / z1).toBeLessThan(1.01)
    expect(await drift(page, p1, mid().x, mid().y)).toBeLessThanOrEqual(2)
    await syntheticTouch(page, 'touchend', [c], [b])
    await syntheticTouch(page, 'touchend', [], [c])
  })
})

test.describe('two-finger tap in stylus mode (chromium: CDP pen)', () => {
  test('two-finger tap still undoes; a pinch in stylus mode still follows the fingers', async ({ page, context }) => {
    test.skip(!isChromium(page), 'needs CDP pen input')
    await loginAs(context, STUDENT)
    await openPage(page, scratch.path)
    await setScrollTop(page, 600)
    await selectPen(page)
    const vp = page.viewportSize()!
    const cx = vp.width / 2
    const cy = vp.height / 2
    await drawStroke(page, [
      { x: cx - 80, y: cy - 150 },
      { x: cx + 80, y: cy - 120 },
    ])
    await expect.poll(async () => (await stateStrokes(page)).length).toBe(1)

    await cdpTouch(page, 'touchStart', [
      { id: 1, x: cx - 60, y: cy },
      { id: 2, x: cx + 60, y: cy },
    ])
    await page.waitForTimeout(60)
    await cdpTouch(page, 'touchEnd', [])
    await expect.poll(async () => (await stateStrokes(page)).length).toBe(0)

    const z0 = await readZoom(page)
    await pinch(page, { centerX: cx, centerY: cy, fromGap: 120, toGap: 240, steps: 12 })
    const ratio = (await readZoom(page)) / z0
    expect(ratio).toBeGreaterThan(1.97)
    expect(ratio).toBeLessThan(2.03)
  })
})

test.describe('narrow viewport', () => {
  test.use({ viewport: { width: 820, height: 1180 }, hasTouch: true })

  async function bottomGap(page: Page) {
    await page.evaluate(() => {
      const c = document.getElementById('scroll-container')!
      c.scrollTop = c.scrollHeight
    })
    await page.waitForTimeout(150)
    return page.evaluate(() => {
      const c = document.getElementById('scroll-container')!.getBoundingClientRect()
      const p = document.getElementById('paper')!.getBoundingClientRect()
      // Visible scroll room below the paper's visual bottom edge.
      return c.bottom - p.bottom
    })
  }

  test('scrolling ends shortly below the paper (no blank tail), at zoom 1 and zoomed in', async ({ page, context }) => {
    await loginAs(context, STUDENT)
    await openPage(page, scratch.path)
    const z0 = await readZoom(page)
    expect(z0, 'paper is scaled to fit the narrow viewport').toBeLessThan(1)
    // 8rem bottom margin below the paper (scaled by the zoom), plus slack.
    const gap1 = await bottomGap(page)
    expect(gap1).toBeGreaterThanOrEqual(0)
    expect(gap1).toBeLessThan(128 + 60)

    await setScrollTop(page, 300)
    const vp = page.viewportSize()!
    await pinch(page, { centerX: vp.width / 2, centerY: vp.height / 2, fromGap: 150, toGap: 300, steps: 12 })
    const zoomed = (await readZoom(page)) / z0
    expect(zoomed).toBeGreaterThan(1.5)
    const gap2 = await bottomGap(page)
    expect(gap2).toBeGreaterThanOrEqual(0)
    expect(gap2).toBeLessThan(128 * zoomed + 60)
  })
})

test.describe('ctrl+wheel', () => {
  test('a ctrl+wheel burst zooms per frame but commits the zoom state once; strokes stay on the paper', async ({ page, context }) => {
    await loginAs(context, STUDENT)
    await openPage(page, scratch.path)
    await setScrollTop(page, 600)
    const vp = page.viewportSize()!
    const cx = vp.width / 2
    const cy = vp.height / 2

    // One stroke (mouse) so the d88145ec drift check has something to measure.
    await selectPen(page)
    await page.mouse.move(cx - 60, cy - 100)
    await page.mouse.down()
    await page.mouse.move(cx, cy - 80, { steps: 5 })
    await page.mouse.move(cx + 60, cy - 100, { steps: 5 })
    await page.mouse.up()
    await expect.poll(async () => (await renderedStrokes(page)).length).toBe(1)
    const strokeBefore = (await renderedStrokes(page))[0]

    // Count commits of the dev-only zoom readout (rendered from the `zoom` state).
    await page.evaluate(() => {
      const el = Array.from(document.body.children).find((n) => /^zoom \d/.test(n.textContent ?? ''))
      if (!el) throw new Error('dev zoom readout missing')
      const w = window as unknown as { __zoomCommits: number }
      w.__zoomCommits = 0
      new MutationObserver(() => w.__zoomCommits++).observe(el, { childList: true, subtree: true, characterData: true })
    })
    const z0 = await readZoom(page)
    const p0 = await paperPointAt(page, cx, cy)
    for (let i = 0; i < 30; i++) {
      await page.evaluate(
        ([x, y]) => {
          document.dispatchEvent(
            new WheelEvent('wheel', { deltaY: -10, ctrlKey: true, clientX: x, clientY: y, bubbles: true, cancelable: true }),
          )
        },
        [cx, cy] as const,
      )
      await frame(page)
      if (i === 15) expect(await readZoom(page), 'transform applied during the burst').toBeGreaterThan(z0 * 1.1)
    }
    const commitsDuringBurst = await page.evaluate(() => (window as unknown as { __zoomCommits: number }).__zoomCommits)
    // Before the fix: one commit per wheel event (~30).
    expect(commitsDuringBurst).toBeLessThanOrEqual(2)
    await page.waitForTimeout(500)
    const z1 = await readZoom(page)
    expect(z1 / z0).toBeCloseTo(Math.pow(1.002, 300), 2)
    // The committed state matches the applied transform once the burst settles.
    const { readout, transform } = await page.evaluate(() => ({
      readout: Array.from(document.body.children).find((n) => /^zoom \d/.test(n.textContent ?? ''))!.textContent,
      transform: document.querySelector('main')!.style.transform,
    }))
    const applied = Number(/scale\(([\d.]+)\)/.exec(transform)![1])
    expect(readout).toBe(`zoom ${(applied * 100).toFixed(1)}%`)
    expect(await drift(page, p0, cx, cy)).toBeLessThanOrEqual(2)

    // d88145ec: the stroke stays at its paper position after the burst.
    await expect
      .poll(async () => {
        const s = (await renderedStrokes(page))[0]
        return Math.max(Math.abs(s.x - strokeBefore.x), Math.abs(s.y - strokeBefore.y))
      })
      .toBeLessThan(1)
  })
})
