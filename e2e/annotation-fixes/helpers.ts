import { expect, request, type APIRequestContext, type BrowserContext, type CDPSession, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { config as loadEnv } from 'dotenv'
import pg from 'pg'
import { E2E_EMAIL, E2E_PASSWORD, E2E_SITE_SLUG, E2E_SKRIPT_SLUG } from '../../scripts/seed-e2e.mjs'

/**
 * Helpers for the annotation/zoom fix specs (e2e/annotation-fixes/), ported from
 * the QA run scripts (qa/runs/2026-11-19-a/ in the eduskript-qa worktree).
 *
 * Works in two browsers:
 *  - chromium (local): gestures can go through CDP (trusted touch events).
 *  - webkit-ipad (remote Playwright server, see playwright.config.ts): no CDP,
 *    so touch gestures are SYNTHETIC TouchEvents dispatched in the page. They
 *    are untrusted (isTrusted=false) and do not trigger native scrolling or
 *    native browser zoom — only the app's own touch listeners see them.
 *
 * DB access (scratch pages, stored strokes) goes straight to Postgres via `pg`
 * using DATABASE_URL (loaded from .env.local / .env if not already set). Refuses
 * non-localhost URLs. Requires the e2e teacher + skript from
 * `node scripts/seed-e2e.mjs`.
 */

loadEnv({ path: '.env.local', quiet: true })
loadEnv({ quiet: true })

// ── Accounts ────────────────────────────────────────────────────────────────

export const TEACHER = { email: E2E_EMAIL, password: E2E_PASSWORD }
/** Seeded by scripts/seed-qa.sh (QA DB). Override with E2E_STUDENT_EMAIL/PASSWORD. */
export const STUDENT = {
  email: process.env.E2E_STUDENT_EMAIL ?? 'student1@eduskript.test',
  password: process.env.E2E_STUDENT_PASSWORD ?? 'student123',
}

// Fixed ids from scripts/seed-e2e.mjs.
const E2E_USER_ID = 'e2e-user-0001'
const E2E_SKRIPT_ID = 'e2e-skript-0001'

export const BASE_URL = `http://localhost:${process.env.PORT ?? 3000}`

// ── DB ──────────────────────────────────────────────────────────────────────

export async function db<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const url = process.env.DATABASE_URL
  if (!url || !/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
    throw new Error(`e2e helpers refuse non-local DATABASE_URL (${url ? 'set, not localhost' : 'unset'})`)
  }
  const c = new pg.Client({ connectionString: url })
  await c.connect()
  try {
    return (await c.query(sql, params)).rows as T[]
  } finally {
    await c.end()
  }
}

// ── Auth ────────────────────────────────────────────────────────────────────

/**
 * Log a browser context in via the NextAuth credentials endpoint (no UI).
 * `context.request` shares its cookie jar with the context's pages, so pages
 * opened afterwards are authenticated. Clears existing cookies first (the
 * default storageState is the teacher session from e2e/global-setup.ts).
 */
export async function loginAs(context: BrowserContext, who: { email: string; password: string }) {
  await context.clearCookies()
  await credentialsLogin(context.request, who)
}

/** Fresh API request context logged in as `who` (e.g. TEACHER for PATCH calls). */
export async function apiAs(who: { email: string; password: string }): Promise<APIRequestContext> {
  const r = await request.newContext({ baseURL: BASE_URL })
  await credentialsLogin(r, who)
  return r
}

async function credentialsLogin(r: APIRequestContext, who: { email: string; password: string }) {
  const { csrfToken } = await (await r.get(`${BASE_URL}/api/auth/csrf`)).json()
  const res = await r.post(`${BASE_URL}/api/auth/callback/credentials`, {
    form: { csrfToken, email: who.email, password: who.password, json: 'true', callbackUrl: '/' },
  })
  if (!res.ok()) throw new Error(`login ${who.email} failed: ${res.status()}`)
  const session = await (await r.get(`${BASE_URL}/api/auth/session`)).json()
  if (session?.user?.email !== who.email) throw new Error(`login ${who.email}: no session after callback`)
}

/**
 * Same login through the real sign-in UI ('Sign in with password' on the
 * teacher card reveals #email/#password). Slower; use when the UI itself matters.
 */
export async function loginViaUi(page: Page, who: { email: string; password: string }) {
  await page.context().clearCookies()
  await page.goto('/auth/signin')
  await page.getByRole('button', { name: /^Sign in with password/ }).first().click()
  await page.fill('#email', who.email)
  await page.fill('#password', who.password)
  await page.locator('#password').press('Enter')
  await page.waitForURL((u) => !u.pathname.startsWith('/auth/signin'), { timeout: 30_000 })
}

// ── Scratch pages ───────────────────────────────────────────────────────────

export interface ScratchPage {
  id: string
  slug: string
  /** Public URL path, e.g. /e2e/e2e-annotations/fix-abc123 */
  path: string
}

/**
 * Create a published page in the e2e skript (author: e2e teacher) via direct
 * DB insert. A brand-new page has no cached render, so this is safe for
 * creation. To CHANGE content later use updateScratchPage (API path): direct DB
 * updates are hidden by the page render cache.
 */
export async function createScratchPage(content: string, slugPrefix = 'fix'): Promise<ScratchPage> {
  const skript = await db(`SELECT id FROM skripts WHERE id = $1`, [E2E_SKRIPT_ID])
  if (!skript.length) throw new Error('e2e skript missing — run `node scripts/seed-e2e.mjs` first')
  const id = randomUUID()
  const slug = `${slugPrefix}-${id.slice(0, 8)}`
  await db(
    `INSERT INTO pages (id, title, slug, content, "order", "isPublished", page_type, "skriptId", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, 1000, true, 'normal', $5, NOW(), NOW())`,
    [id, `E2E ${slug}`, slug, content, E2E_SKRIPT_ID],
  )
  await db(
    `INSERT INTO page_authors (id, "pageId", "userId", permission, "createdAt") VALUES ($1, $2, $3, 'author', NOW())`,
    [randomUUID(), id, E2E_USER_ID],
  )
  return { id, slug, path: `/${E2E_SITE_SLUG}/${E2E_SKRIPT_SLUG}/${slug}` }
}

/**
 * Replace a page's markdown through PATCH /api/pages/<id> as the e2e teacher —
 * the same call the dashboard editor makes; it revalidates the public render.
 */
export async function updateScratchPage(pageId: string, content: string) {
  const r = await apiAs(TEACHER)
  try {
    const res = await r.patch(`${BASE_URL}/api/pages/${pageId}`, { data: { content } })
    if (!res.ok()) throw new Error(`PATCH page failed: ${res.status()} ${await res.text()}`)
    // The public render is stale-while-revalidate: the first GET after the
    // PATCH still serves the old HTML and starts the re-render. Wait until a
    // GET returns different HTML (length as the cheap signature) or 5 s pass,
    // so a page.reload() right after this sees the new content.
    const [row] = await db<{ slug: string }>(`SELECT slug FROM pages WHERE id = $1`, [pageId])
    if (row) {
      const url = `${BASE_URL}/${E2E_SITE_SLUG}/${E2E_SKRIPT_SLUG}/${row.slug}`
      const stale = (await (await r.get(url)).text()).length
      const until = Date.now() + 5000
      while (Date.now() < until) {
        await new Promise((ok) => setTimeout(ok, 300))
        if ((await (await r.get(url)).text()).length !== stale) break
      }
    }
  } finally {
    await r.dispose()
  }
}

/** Delete the page and every user_data row keyed by it (annotations, spacers, ...). */
export async function deleteScratchPage(pageId: string) {
  await db(`DELETE FROM user_data WHERE item_id = $1`, [pageId])
  await db(`DELETE FROM pages WHERE id = $1 AND "skriptId" = $2`, [pageId, E2E_SKRIPT_ID])
}

// ── Page open / dialogs ─────────────────────────────────────────────────────

/**
 * Click 'Keep this' on the student 'Choose your nickname' dialog if it shows.
 * openPage() pre-sets the dialog's localStorage flag so it normally never
 * mounts; this is the fallback. Note: locator.isVisible() ignores its timeout
 * (returns immediately), so this waits with waitFor().
 */
export async function dismissNicknameDialog(page: Page, timeout = 6000) {
  const keep = page.getByRole('button', { name: 'Keep this' })
  const shown = await keep.waitFor({ state: 'visible', timeout }).then(() => true, () => false)
  if (shown) {
    await keep.click()
    await expect(page.getByText('Choose your nickname')).toBeHidden()
  }
}

/** Navigate, wait for #paper + the dev-only __eduTest hook, dismiss the nickname dialog. */
export async function openPage(page: Page, path: string) {
  // The late nickname dialog's overlay intercepts clicks; mark it as seen
  // (NICKNAME_PROMPT_FLAG in nickname-modal.tsx) before any page script runs.
  await page.addInitScript(() => {
    try { localStorage.setItem('eduskript:nickname-prompt-seen', '1') } catch { /* ignore */ }
  })
  await page.goto(path)
  await page.waitForSelector('#paper', { timeout: 60_000 })
  await page.waitForFunction(
    () => !!(window as unknown as { __eduTest?: { state?: unknown } }).__eduTest?.state,
    null,
    { timeout: 30_000 },
  )
  await dismissNicknameDialog(page, 500)
}

/** Click the first pen in the annotation toolbar ('Select pen 1'). */
export async function selectPen(page: Page) {
  await dismissNicknameDialog(page, 300)
  await page.locator('[data-pen-button]').first().click()
  await page.waitForTimeout(300)
}

// ── Coordinates (drift metric) ──────────────────────────────────────────────

export interface PaperFrame {
  /** #paper getBoundingClientRect (viewport, post-transform). */
  left: number
  top: number
  /** Rendered scale = rect.width / offsetWidth (= current zoom). */
  s: number
}

export async function paperFrame(page: Page): Promise<PaperFrame> {
  return page.evaluate(() => {
    const p = document.getElementById('paper')
    if (!p) throw new Error('#paper missing')
    const r = p.getBoundingClientRect()
    return { left: r.left, top: r.top, s: r.width / p.offsetWidth }
  })
}

/** Current zoom, measured as #paper's rendered/layout width ratio. */
export async function readZoom(page: Page): Promise<number> {
  return (await paperFrame(page)).s
}

/**
 * Drift metric: the unscaled paper point under viewport point (cx, cy):
 * P = ((cx - r.left) / s, (cy - r.top) / s). Compare P before/after a gesture
 * at the same finger position; any difference is content drifting under it.
 */
export async function paperPointAt(page: Page, cx: number, cy: number) {
  const f = await paperFrame(page)
  return { x: (cx - f.left) / f.s, y: (cy - f.top) / f.s }
}

/** Inverse of paperPointAt: viewport point for an unscaled paper point. */
export async function viewportPointOf(page: Page, px: number, py: number) {
  const f = await paperFrame(page)
  return { x: f.left + px * f.s, y: f.top + py * f.s }
}

/**
 * Scroll #scroll-container so paper-y `py` sits `marginTop` px below the
 * container's top edge. The page scrolls inside #scroll-container, not window.
 */
export async function scrollPaperYIntoView(page: Page, py: number, marginTop = 200) {
  await page.evaluate(
    ([y, m]) => {
      const sc = document.getElementById('scroll-container')
      const p = document.getElementById('paper')
      if (!sc || !p) return
      const r = p.getBoundingClientRect()
      const s = r.width / p.offsetWidth
      const target = r.top + y * s
      sc.scrollTop += target - sc.getBoundingClientRect().top - m
    },
    [py, marginTop] as const,
  )
  await page.waitForTimeout(150)
}

/** Unscaled paper-relative box of the first element matching `selector`. */
export async function elementPaperBox(page: Page, selector: string) {
  return page.evaluate((sel) => {
    const p = document.getElementById('paper')
    const e = document.querySelector(sel)
    if (!p || !e) return null
    const pr = p.getBoundingClientRect()
    const s = pr.width / p.offsetWidth
    const r = e.getBoundingClientRect()
    return { x: (r.left - pr.left) / s, y: (r.top - pr.top) / s, width: r.width / s, height: r.height / s }
  }, selector)
}

// ── Drawing ─────────────────────────────────────────────────────────────────

/**
 * Draw a mouse stroke through viewport points (pen tool must be selected).
 * page.mouse works in both chromium and remote webkit; the canvas receives
 * pointerType 'mouse'. For pen/pressure in chromium use e2e/helpers/input.ts
 * drawStroke (CDP).
 */
export async function drawViewport(page: Page, pts: Array<{ x: number; y: number }>, steps = 6) {
  await page.mouse.move(pts[0].x, pts[0].y)
  await page.mouse.down()
  for (let i = 1; i < pts.length; i++) await page.mouse.move(pts[i].x, pts[i].y, { steps })
  await page.mouse.up()
}

/**
 * Draw a short zig-zag stroke starting at unscaled paper point (px, py),
 * `len` paper px wide. Scrolls it into view first. Returns the viewport points.
 */
export async function drawAtPaper(page: Page, px: number, py: number, len = 120) {
  await scrollPaperYIntoView(page, py)
  const f = await paperFrame(page)
  const pts = Array.from({ length: 7 }, (_, i) => ({
    x: f.left + (px + (len * i) / 6) * f.s,
    y: f.top + (py + (i % 2 ? 6 : -6)) * f.s,
  }))
  await drawViewport(page, pts)
  return pts
}

/** Draw at (dx, dy) paper px from the top-left of `selector`'s element. */
export async function drawRelativeTo(page: Page, selector: string, dx: number, dy: number, len = 120) {
  const b = await elementPaperBox(page, selector)
  if (!b) throw new Error(`no element for ${selector}`)
  return drawAtPaper(page, b.x + dx, b.y + dy, len)
}

// ── Strokes: app state, DB, rendered ────────────────────────────────────────

export interface StoredStroke {
  id: string
  sectionId?: string
  sectionOffsetY?: number
  mode?: string
  points: Array<{ x: number; y: number; pressure?: number }>
}

/** Strokes in the app's in-memory state (dev-only window.__eduTest hook). */
export async function stateStrokes(page: Page): Promise<StoredStroke[]> {
  const raw = await page.evaluate(() => {
    const t = (window as unknown as { __eduTest?: { state?: () => { canvasData?: string } } }).__eduTest
    return t?.state?.().canvasData ?? null
  })
  try {
    return raw ? (JSON.parse(raw) as StoredStroke[]).filter((s) => s.mode !== 'erase') : []
  } catch {
    return []
  }
}

/**
 * Strokes persisted in user_data (adapter 'annotations', personal rows only,
 * any site) for one user + page. This is what production stores and what the
 * backward-compat constraint is about.
 */
export async function storedStrokes(email: string, pageId: string): Promise<StoredStroke[]> {
  const rows = await db<{ data: { canvasData?: string } }>(
    `SELECT ud.data FROM user_data ud JOIN users u ON u.id = ud.user_id
     WHERE u.email = $1 AND ud.adapter = 'annotations' AND ud.item_id = $2 AND ud.target_type IS NULL`,
    [email, pageId],
  )
  const out: StoredStroke[] = []
  for (const r of rows) {
    try {
      out.push(...(JSON.parse(r.data?.canvasData || '[]') as StoredStroke[]).filter((s) => s.mode !== 'erase'))
    } catch {
      /* skip malformed row */
    }
  }
  return out
}

/** Poll the DB until `n` strokes are persisted (sync is debounced). */
export async function waitForStoredStrokes(email: string, pageId: string, n: number, timeout = 15_000) {
  await expect.poll(async () => (await storedStrokes(email, pageId)).length, { timeout }).toBe(n)
  return storedStrokes(email, pageId)
}

/** Remove a user's stored annotation rows for a page (between tests). */
export async function clearStoredAnnotations(email: string, pageId: string) {
  await db(
    `DELETE FROM user_data ud USING users u WHERE u.id = ud.user_id AND u.email = $1 AND ud.item_id = $2`,
    [email, pageId],
  )
}

export interface RenderedStroke {
  /** Unscaled paper-relative box. */
  x: number
  y: number
  width: number
  height: number
  /** data-section-id of the section the stroke SVG is portaled into. */
  host: string | null
}

/**
 * Bounding boxes of every rendered committed stroke path
 * (svg.annotation-section-svg path), in unscaled paper px. Paths carry no
 * stroke id, so match by `host` / position. Order = DOM order.
 */
export async function renderedStrokes(page: Page): Promise<RenderedStroke[]> {
  return page.evaluate(() => {
    const p = document.getElementById('paper')
    if (!p) return []
    const pr = p.getBoundingClientRect()
    const s = pr.width / p.offsetWidth
    return [...document.querySelectorAll('svg.annotation-section-svg path')].map((path) => {
      const r = path.getBoundingClientRect()
      const host = path.closest('[data-section-id]')
      return {
        x: (r.left - pr.left) / s,
        y: (r.top - pr.top) / s,
        width: r.width / s,
        height: r.height / s,
        host: host?.getAttribute('data-section-id') ?? null,
      }
    })
  })
}

/**
 * Rendered stroke boxes relative to the top-left of `selector`'s element, in
 * unscaled px. Use to assert "the stroke stays N px below this paragraph".
 */
export async function strokesRelativeTo(page: Page, selector: string) {
  const el = await elementPaperBox(page, selector)
  if (!el) throw new Error(`no element for ${selector}`)
  return (await renderedStrokes(page)).map((s) => ({ ...s, dx: s.x - el.x, dy: s.y - el.y }))
}

// ── Touch gestures ──────────────────────────────────────────────────────────

export interface TouchPt {
  id: number
  x: number
  y: number
  /** Synthetic path only: Apple Pencil = 'stylus'; finger = 'direct' (default). */
  touchType?: 'direct' | 'stylus'
}

const cdpSessions = new WeakMap<Page, Promise<CDPSession>>()

/** One touch event via CDP (chromium only; trusted). Empty list = all lifted. */
export async function cdpTouch(page: Page, type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel', pts: TouchPt[]) {
  let client = cdpSessions.get(page)
  if (!client) {
    client = page.context().newCDPSession(page)
    cdpSessions.set(page, client)
  }
  await (await client).send('Input.dispatchTouchEvent', {
    type,
    touchPoints: pts.map((t) => ({ x: t.x, y: t.y, id: t.id, radiusX: 5, radiusY: 5, force: 1 })),
  })
}

/**
 * One synthetic TouchEvent dispatched on the element under the first touch
 * (or `document.body`). `touches` = all touches currently down AFTER this
 * event; `changed` = the ones that started/moved/ended. touchType is set via
 * defineProperty (not a TouchInit field in either engine). Returns
 * defaultPrevented.
 */
export async function syntheticTouch(
  page: Page,
  type: 'touchstart' | 'touchmove' | 'touchend' | 'touchcancel',
  touches: TouchPt[],
  changed: TouchPt[],
): Promise<boolean> {
  return page.evaluate(
    ([type, touches, changed]) => {
      const first = changed[0] ?? touches[0]
      const target = (first && document.elementFromPoint(first.x, first.y)) || document.body
      const mk = (t: { id: number; x: number; y: number; touchType?: string }) => {
        let touch: Touch
        try {
          touch = new Touch({ identifier: t.id, target, clientX: t.x, clientY: t.y, radiusX: 5, radiusY: 5, force: 1 })
        } catch {
          // Playwright's Linux WebKit: `new Touch` is an illegal constructor;
          // the legacy document.createTouch(view, target, id, pageX, pageY,
          // screenX, screenY) works. pageX = clientX because the window itself
          // never scrolls here (content scrolls in #scroll-container).
          const d = document as unknown as {
            createTouch: (v: Window, tg: EventTarget, id: number, px: number, py: number, sx: number, sy: number) => Touch
          }
          touch = d.createTouch(window, target, t.id, t.x, t.y, t.x, t.y)
        }
        Object.defineProperty(touch, 'touchType', { value: t.touchType ?? 'direct' })
        return touch
      }
      // WebKit's TouchEventInit rejects plain arrays ("Type error") and needs
      // a TouchList; Chromium has no createTouchList and takes arrays.
      const d = document as unknown as { createTouchList?: (...t: Touch[]) => TouchList }
      const list = (ts: Touch[]) => (d.createTouchList ? d.createTouchList(...ts) : ts) as unknown as Touch[]
      const all = list(touches.map(mk))
      const ev = new TouchEvent(type, {
        touches: all,
        targetTouches: all,
        changedTouches: list(changed.map(mk)),
        bubbles: true,
        cancelable: true,
        composed: true,
      })
      target.dispatchEvent(ev)
      return ev.defaultPrevented
    },
    [type, touches, changed] as const,
  )
}

export interface PinchOpts {
  centerX: number
  centerY: number
  fromGap: number
  toGap: number
  steps?: number
  /** 'auto' (default): CDP in chromium, synthetic elsewhere. */
  via?: 'auto' | 'cdp' | 'synthetic'
}

/**
 * Horizontal two-finger pinch around (centerX, centerY), viewport coords.
 * toGap > fromGap zooms in. One frame between moves so the app's
 * rAF-batched transform can apply.
 */
export async function pinch(page: Page, o: PinchOpts) {
  const steps = o.steps ?? 12
  const via =
    o.via && o.via !== 'auto' ? o.via : page.context().browser()?.browserType().name() === 'chromium' ? 'cdp' : 'synthetic'
  const at = (gap: number): TouchPt[] => [
    { id: 1, x: o.centerX - gap / 2, y: o.centerY },
    { id: 2, x: o.centerX + gap / 2, y: o.centerY },
  ]
  const frame = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))))
  if (via === 'cdp') {
    await cdpTouch(page, 'touchStart', at(o.fromGap))
    for (let i = 1; i <= steps; i++) {
      await cdpTouch(page, 'touchMove', at(o.fromGap + ((o.toGap - o.fromGap) * i) / steps))
      await frame()
    }
    await cdpTouch(page, 'touchEnd', [])
  } else {
    const start = at(o.fromGap)
    await syntheticTouch(page, 'touchstart', [start[0]], [start[0]])
    await syntheticTouch(page, 'touchstart', start, [start[1]])
    let cur = start
    for (let i = 1; i <= steps; i++) {
      cur = at(o.fromGap + ((o.toGap - o.fromGap) * i) / steps)
      await syntheticTouch(page, 'touchmove', cur, cur)
      await frame()
    }
    await syntheticTouch(page, 'touchend', [cur[0]], [cur[1]])
    await syntheticTouch(page, 'touchend', [], [cur[0]])
  }
  await page.waitForTimeout(200)
}
