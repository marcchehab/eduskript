import { expect, type Page, type CDPSession } from '@playwright/test'

/**
 * Input + state helpers for the annotation invariant suite.
 *
 * Gestures are driven through CDP (`Input.dispatchMouseEvent` /
 * `dispatchTouchEvent`) rather than synthetic DOM events, because CDP produces
 * *trusted* events: pointer capture works (the canvas calls setPointerCapture
 * for pen), and `pointerType` / `force` (pressure) are honored — so we exercise
 * the real pen/touch/mouse branches in simple-canvas.tsx.
 *
 * The oracle reads the app's own state via the dev-only
 * `window.__eduAnnotationTest` hook (annotation-layer.tsx) instead of
 * pixel-diffing.
 */

export interface Pt {
  x: number
  y: number
}

export interface Stroke {
  id: string
  points: Array<{ x: number; y: number; pressure: number }>
  sectionId?: string
  sectionOffsetY?: number
  mode?: string
  color?: string
  width?: number
}

export interface AnnotationState {
  pageId: string | null
  strokes: Stroke[]
  headingPositions: Array<{ sectionId: string; offsetY: number }>
}

const cdpByPage = new WeakMap<Page, Promise<CDPSession>>()
function cdp(page: Page): Promise<CDPSession> {
  let s = cdpByPage.get(page)
  if (!s) {
    s = page.context().newCDPSession(page)
    cdpByPage.set(page, s)
  }
  return s
}

// ── State / DOM readers ────────────────────────────────────────────────────

type EduTest = {
  state?: () => { pageId?: string; canvasData?: string; headingPositions?: unknown; snaps?: unknown }
  clear?: () => Promise<void> | void
  addSnap?: (snap: Record<string, unknown>) => void
}

export async function readAnnotationState(page: Page): Promise<AnnotationState> {
  const raw = await page.evaluate(() => {
    const t = (window as unknown as { __eduTest?: EduTest }).__eduTest
    return t?.state ? t.state() : null
  })
  if (!raw) {
    throw new Error(
      '__eduTest hook missing — is this a dev build with the annotation layer mounted?',
    )
  }
  let strokes: Stroke[] = []
  try {
    strokes = raw.canvasData ? (JSON.parse(raw.canvasData) as Stroke[]) : []
  } catch {
    strokes = []
  }
  return {
    pageId: raw.pageId ?? null,
    strokes,
    headingPositions: (raw.headingPositions as AnnotationState['headingPositions']) ?? [],
  }
}

/**
 * Replace the page's markdown via the same authenticated API the dashboard
 * editor uses (PATCH /api/pages/[id]). This is an ISR route, but the service
 * revalidates the public path/tags on content change, so a reload shows the new
 * content. Auth comes from the stored teacher session (storageState cookies).
 */
export async function patchPageContent(page: Page, pageId: string, content: string) {
  const res = await page.request.patch(`/api/pages/${pageId}`, { data: { content } })
  if (!res.ok()) throw new Error(`PATCH page content failed: ${res.status()} ${await res.text()}`)
}

/** Top of a section relative to #paper (scroll-invariant), measured atomically. */
export async function sectionPaperTop(page: Page, sectionId: string): Promise<number> {
  const v = await page.evaluate((sid) => {
    const paper = document.getElementById('paper')
    const sec = document.querySelector(`[data-section-id="${sid}"]`)
    if (!paper || !sec) return null
    return sec.getBoundingClientRect().top - paper.getBoundingClientRect().top
  }, sectionId)
  if (v === null) throw new Error(`section [${sectionId}] or #paper not found`)
  return v
}

/** Renderable (non-erase) stroke count from app state. */
export async function strokeCount(page: Page): Promise<number> {
  const { strokes } = await readAnnotationState(page)
  return strokes.filter((s) => s.mode !== 'erase').length
}

/**
 * Reset annotations to a clean slate (test isolation). Annotations persist
 * server-side, so without this strokes accumulate across specs and the
 * "first stroke" assertions become ambiguous. Uses the dev-only clear hook.
 */
export async function clearAnnotations(page: Page) {
  await page.evaluate(async () => {
    const t = (window as unknown as { __eduTest?: EduTest }).__eduTest
    if (t?.clear) await t.clear()
  })
  await expect
    .poll(
      async () =>
        (await strokeCount(page)) +
        (await countOf(page, 'data-sticky-note-id')) +
        (await countOf(page, 'data-snap-id')),
      { timeout: 5000 },
    )
    .toBe(0)
}

/** Count elements matching a bare attribute selector, e.g. 'data-snap-id'. */
export async function countOf(page: Page, attr: string): Promise<number> {
  return page.locator(`[${attr}]`).count()
}

async function attrValues(page: Page, attr: string): Promise<string[]> {
  const loc = page.locator(`[${attr}]`)
  const n = await loc.count()
  const out: string[] = []
  for (let i = 0; i < n; i++) {
    const v = await loc.nth(i).getAttribute(attr)
    if (v) out.push(v)
  }
  return out
}

/** Viewport box of a sticky note / snap card by its id. */
export async function elementBox(page: Page, attr: 'data-sticky-note-id' | 'data-snap-id', id: string) {
  const box = await page.locator(`[${attr}="${id}"]`).first().boundingBox()
  if (!box) throw new Error(`no box for [${attr}="${id}"]`)
  return box
}

/**
 * Viewport box of #paper — the scroll reference. The page scrolls inside a
 * container (not the window), so window.scrollY is useless; instead we measure
 * everything RELATIVE to #paper, which scrolls together with the strokes and
 * sections. Paper-relative coords are therefore scroll- and reload-invariant.
 */
export async function paperBox(page: Page) {
  const box = await page.locator('#paper').first().boundingBox()
  if (!box) throw new Error('#paper has no box')
  return box
}

/** Viewport box of a section element, after scrolling it into view. */
export async function sectionBox(page: Page, sectionId: string) {
  const el = page.locator(`[data-section-id="${sectionId}"]`).first()
  await el.scrollIntoViewIfNeeded()
  const box = await el.boundingBox()
  if (!box) throw new Error(`section [${sectionId}] has no box`)
  return box
}

/** Top of a section relative to #paper (scroll-independent), no scrolling. */
export async function sectionRelTop(page: Page, sectionId: string): Promise<number> {
  const box = await page.locator(`[data-section-id="${sectionId}"]`).first().boundingBox()
  if (!box) throw new Error(`section [${sectionId}] has no box`)
  return box.y - (await paperBox(page)).y
}

export interface StrokeRelBox {
  /** Viewport coords (for dispatching gestures at the current scroll). */
  vpTop: number
  vpCenterY: number
  cxVp: number
  width: number
  height: number
  /** Paper-relative top/center (scroll- and reload-invariant). */
  relTop: number
  relCenterY: number
}

/** Paper-relative + viewport boxes of every rendered committed stroke path. */
export async function strokeRelBoxes(page: Page): Promise<StrokeRelBox[]> {
  const boxes = await strokePathBoxes(page)
  const paper = await paperBox(page)
  return boxes.map((b) => ({
    vpTop: b.y,
    vpCenterY: b.y + b.height / 2,
    cxVp: b.x + b.width / 2,
    width: b.width,
    height: b.height,
    relTop: b.y - paper.y,
    relCenterY: b.y - paper.y + b.height / 2,
  }))
}

/** Viewport boxes of every rendered committed stroke path (active layer). */
export async function strokePathBoxes(page: Page): Promise<Array<{ x: number; y: number; width: number; height: number }>> {
  const paths = page.locator('svg.annotation-section-svg path')
  const n = await paths.count()
  const boxes: Array<{ x: number; y: number; width: number; height: number }> = []
  for (let i = 0; i < n; i++) {
    const b = await paths.nth(i).boundingBox()
    if (b) boxes.push(b)
  }
  return boxes
}

// ── Mode toggles ───────────────────────────────────────────────────────────

export async function enterDrawMode(page: Page) {
  await page.locator('[data-pen-button]').first().click()
}

export async function enterEraseMode(page: Page) {
  await page.getByRole('button', { name: 'Erase' }).click()
}

/** Exit draw/erase mode so the drawing canvas stops intercepting clicks on the
 *  page content (the canvas overlays content while a tool is active). */
export async function escapeToView(page: Page) {
  await page.keyboard.press('Escape')
}

// ── Quiescence ─────────────────────────────────────────────────────────────

/**
 * Wait for layout to settle: headingPositions is recomputed by a 300ms-debounced
 * ResizeObserver, so we poll it until two reads ~180ms apart agree (true
 * quiescence) rather than sleeping a fixed amount. Falls through after `timeout`.
 */
export async function settle(page: Page, timeout = 4000) {
  const start = Date.now()
  let prev = ''
  while (Date.now() - start < timeout) {
    const { headingPositions } = await readAnnotationState(page)
    const snapshot = JSON.stringify(headingPositions)
    if (snapshot !== '[]' && snapshot === prev) return
    prev = snapshot
    await page.waitForTimeout(180)
  }
}

/**
 * Wait for debounced annotation saves to flush before a reload. The sync is
 * debounced + networked, and a reload aborts in-flight requests
 * (`[user-data/sync] Error: aborted`) — so without this a just-created note/snap
 * can be lost. A fixed window is fine for an on-demand suite; there's no
 * queryable "saved" signal exposed.
 */
export async function waitForPersist(page: Page) {
  await page.waitForTimeout(2000)
}

// ── Gestures (CDP) ─────────────────────────────────────────────────────────

interface DrawOpts {
  pointerType?: 'mouse' | 'pen'
  /** Constant pressure, or 'ramp' to vary it across the stroke (pen path). */
  pressure?: number | 'ramp'
  steps?: number
}

/**
 * Draw a stroke through `points` (viewport coords) with a pen or mouse pointer.
 * Interpolates between the given points so the canvas records a smooth path.
 */
export async function drawStroke(page: Page, points: Pt[], opts: DrawOpts = {}) {
  const client = await cdp(page)
  const pointerType = opts.pointerType ?? 'pen'
  const steps = opts.steps ?? 8
  const pressureAt = (t: number) =>
    opts.pressure === 'ramp' ? 0.2 + 0.6 * t : (typeof opts.pressure === 'number' ? opts.pressure : 0.5)

  const path: Array<{ x: number; y: number; p: number }> = []
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]
    const b = points[i + 1]
    for (let s = 0; s < steps; s++) {
      const t = s / steps
      path.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, p: 0 })
    }
  }
  path.push({ x: points[points.length - 1].x, y: points[points.length - 1].y, p: 0 })
  // assign pressure along the whole path
  path.forEach((pt, i) => (pt.p = pressureAt(i / Math.max(1, path.length - 1))))

  await client.send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x: path[0].x, y: path[0].y,
    button: 'left', buttons: 1, clickCount: 1, pointerType, force: path[0].p,
  })
  for (let i = 1; i < path.length; i++) {
    await client.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: path[i].x, y: path[i].y,
      button: 'left', buttons: 1, pointerType, force: path[i].p,
    })
  }
  const last = path[path.length - 1]
  await client.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: last.x, y: last.y,
    button: 'left', buttons: 0, clickCount: 1, pointerType, force: 0,
  })
}

/**
 * Draw a stroke and confirm it committed, retrying a couple times. Absorbs the
 * race where draw mode was just toggled but React hasn't enabled the canvas
 * pointer-events yet (an immediate draw would be silently dropped). Returns the
 * paper-relative box of the committed stroke.
 */
export async function drawCommitting(page: Page, points: Pt[], opts: DrawOpts = {}): Promise<StrokeRelBox> {
  const before = await strokeCount(page)
  for (let attempt = 0; attempt < 3; attempt++) {
    await drawStroke(page, points, opts)
    try {
      await expect.poll(() => strokeCount(page), { timeout: 1500 }).toBe(before + 1)
      const boxes = await strokeRelBoxes(page)
      return boxes[boxes.length - 1]
    } catch {
      /* retry */
    }
  }
  throw new Error('draw did not commit a stroke after retries')
}

/** Short eraser stroke over a viewport point (requires erase mode active). */
export async function eraseAt(page: Page, point: Pt) {
  await drawStroke(
    page,
    [
      { x: point.x - 6, y: point.y - 6 },
      { x: point.x, y: point.y },
      { x: point.x + 6, y: point.y + 6 },
    ],
    { pointerType: 'pen', pressure: 0.5, steps: 4 },
  )
}

/**
 * Two-finger pinch centered on (centerX, centerY): the touch points start
 * `fromGap` apart and end `toGap` apart (toGap > fromGap = zoom in). Drives the
 * annotation-layer touch handlers via CDP touch events.
 */
export async function pinch(
  page: Page,
  { centerX, centerY, fromGap, toGap, steps = 10 }: { centerX: number; centerY: number; fromGap: number; toGap: number; steps?: number },
) {
  const client = await cdp(page)
  const half = (gap: number) => gap / 2
  const points = (gap: number) => [
    { x: centerX - half(gap), y: centerY, id: 0 },
    { x: centerX + half(gap), y: centerY, id: 1 },
  ]
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(fromGap) })
  for (let s = 1; s <= steps; s++) {
    const gap = fromGap + (toGap - fromGap) * (s / steps)
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(gap) })
  }
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}

// ── Sticky notes ───────────────────────────────────────────────────────────

/**
 * Insert a sticky note at a viewport point: toggles placement mode (toolbar)
 * then clicks the paper. Must be in view mode so the drawing canvas isn't
 * intercepting the placement click. Returns the new note's id.
 */
export async function insertStickyNote(page: Page, point: Pt): Promise<string> {
  await escapeToView(page)
  const before = new Set(await attrValues(page, 'data-sticky-note-id'))
  await page.getByRole('button', { name: /add sticky note/i }).click()
  await page.mouse.click(point.x, point.y)
  await expect
    .poll(() => countOf(page, 'data-sticky-note-id'), { timeout: 3000 })
    .toBeGreaterThan(before.size)
  const after = await attrValues(page, 'data-sticky-note-id')
  const id = after.find((x) => !before.has(x))
  if (!id) throw new Error('sticky note id not found after insert')
  return id
}

/**
 * Drag a sticky note by its header so the grab point lands on `target`. Uses
 * real mouse events (the note's drag handler listens on document mousemove). Do
 * this in view mode with no pen stroke yet, so the canvas overlay doesn't eat
 * the mousedown. Returns the grab y-offset within the card (header) for
 * landing assertions.
 */
export async function dragStickyNoteTo(page: Page, id: string, target: Pt): Promise<number> {
  await escapeToView(page)
  const box = await elementBox(page, 'data-sticky-note-id', id)
  const grabOffsetY = 8 // within the header strip
  await page.mouse.move(box.x + box.width / 2, box.y + grabOffsetY)
  await page.mouse.down()
  await page.mouse.move(target.x, target.y, { steps: 10 })
  await page.mouse.up()
  return grabOffsetY
}

// ── Snaps ──────────────────────────────────────────────────────────────────

const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

/**
 * Insert a snap anchored to a section, via the REAL capture path (window hook
 * exposes annotation-layer's handleSnapCapture, which sets sectionId/
 * sectionOffsetY from `top`). Skips only the paste/crop UI, which isn't what we
 * test. `top` is derived from the section's headingPositions offset so the snap
 * anchors to that section. Returns the snap id.
 */
export async function addSnapInSection(page: Page, sectionId: string): Promise<string> {
  const { headingPositions } = await readAnnotationState(page)
  const h = headingPositions.find((p) => p.sectionId === sectionId)
  const top = (h?.offsetY ?? 0) + 40
  const id = `e2e-snap-${Date.now()}`
  await page.evaluate(
    ({ id, top, img }) => {
      const t = (window as unknown as { __eduTest?: EduTest }).__eduTest
      t?.addSnap?.({ id, name: 'e2e', imageUrl: img, top, left: 70, width: 180, height: 110 })
    },
    { id, top, img: TINY_PNG },
  )
  await expect.poll(() => page.locator(`[data-snap-id="${id}"]`).count(), { timeout: 3000 }).toBe(1)
  return id
}

/** Resolve a section's data-section-id from its heading text. */
export async function sectionIdByHeading(page: Page, headingText: string): Promise<string> {
  const id = await page
    .locator(`[data-heading-text="${headingText}"]`)
    .first()
    .getAttribute('data-section-id')
  if (!id) throw new Error(`no section for heading "${headingText}"`)
  return id
}

export interface ScrollHeightMetrics {
  /** #scroll-container scrollable height (= the zoom spacer when zoomed). */
  scrollHeight: number
  /** <main> layout scrollHeight — UNSCALED, so zoom-independent. The section-
   *  anchored stroke SVGs used to inflate this by spilling below #paper. */
  mainScrollHeight: number
  /** #paper layout height (unscaled). */
  paperOffsetHeight: number
  /** #paper rendered height (post-transform, i.e. scaled by zoom). */
  scaledPaperHeight: number
}

/** Page-height metrics used to guard against section SVGs inflating scroll. */
export async function scrollHeightMetrics(page: Page): Promise<ScrollHeightMetrics> {
  return page.evaluate(() => {
    const sc = document.getElementById('scroll-container')
    const paper = document.getElementById('paper') as HTMLElement | null
    const main = document.querySelector('main')
    return {
      scrollHeight: sc?.scrollHeight ?? 0,
      mainScrollHeight: main?.scrollHeight ?? 0,
      paperOffsetHeight: paper?.offsetHeight ?? 0,
      scaledPaperHeight: paper?.getBoundingClientRect().height ?? 0,
    }
  })
}

/** Scroll the page's scroll container to an absolute offset, then settle a frame. */
export async function scrollContainerTo(page: Page, top: number) {
  await page.evaluate((t) => {
    const sc = document.getElementById('scroll-container')
    if (sc) sc.scrollTop = t
  }, top)
  await page.waitForTimeout(120)
}

// ── Zoom ───────────────────────────────────────────────────────────────────

/** Current page zoom = the scale on <main> (parsed from its transform). */
export async function readZoom(page: Page): Promise<number> {
  return page.evaluate(() => {
    const main = document.querySelector('main')
    if (!main) return 1
    const t = getComputedStyle(main).transform
    if (!t || t === 'none') return 1
    const matrix = t.match(/matrix\(([^)]+)\)/)
    if (matrix) return parseFloat(matrix[1].split(',')[0])
    const scale = t.match(/scale\(([^)]+)\)/)
    return scale ? parseFloat(scale[1]) : 1
  })
}

/**
 * Vertical position of an element's center WITHIN its host section, as a
 * fraction of section height. Scroll-, reflow- and zoom-invariant (the element
 * is portaled into the section and scales with it), so it's the single metric
 * for "stays in the right spot". `elemSel` is scoped inside the section element.
 */
export async function ratioInSection(
  page: Page,
  sectionId: string,
  elemSel: string,
): Promise<number | null> {
  return page.evaluate(
    ([sid, sel]) => {
      const sec = document.querySelector(`[data-section-id="${sid}"]`)
      if (!sec) return null
      const secR = sec.getBoundingClientRect()
      const el = sec.querySelector(sel)
      if (!el || secR.height === 0) return null
      const r = el.getBoundingClientRect()
      return (r.top + r.height / 2 - secR.top) / secR.height
    },
    [sectionId, elemSel] as const,
  )
}
