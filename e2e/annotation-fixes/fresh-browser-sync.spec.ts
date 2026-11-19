import { expect, test, type Browser, type BrowserContext } from '@playwright/test'
import {
  STUDENT,
  clearStoredAnnotations,
  db,
  createScratchPage,
  deleteScratchPage,
  drawRelativeTo,
  loginAs,
  openPage,
  renderedStrokes,
  selectPen,
  stateStrokes,
  storedStrokes,
  waitForStoredStrokes,
  type ScratchPage,
} from './helpers'

/**
 * Findings annotations-not-shown-on-first-visit-fresh-browser and
 * annotations-new-browser-overwrites-server-strokes (QA run 2026-11-19-a).
 *
 * A browser with an empty IndexedDB (new device) must (a) show the strokes the
 * server holds on the first visit, without a reload, and (b) never replace the
 * server row with only the strokes drawn on that device.
 *
 * Every context here is created with browser.newContext(), so it starts with an
 * empty IndexedDB.
 */

const CONTENT = `# Fresh browser sync

## First section

Paragraph one in the first section, long enough to give the section some height.

## Second section

Paragraph in the second section.

${Array.from({ length: 8 }, (_, i) => `Filler paragraph ${i + 1} so the page scrolls.`).join('\n\n')}
`

let scratch: ScratchPage

test.beforeAll(async () => {
  scratch = await createScratchPage(CONTENT, 'freshsync')
})
test.afterAll(async () => {
  if (scratch) await deleteScratchPage(scratch.id)
})
test.beforeEach(async () => {
  await clearStoredAnnotations(STUDENT.email, scratch.id)
})

type CtxOpts = Parameters<Browser['newContext']>[0]

/** The project's device + baseURL options (browser.newContext() does not apply them). */
function projectContextOptions(): CtxOpts {
  const u = test.info().project.use
  return {
    baseURL: u.baseURL,
    viewport: u.viewport,
    userAgent: u.userAgent,
    deviceScaleFactor: u.deviceScaleFactor,
    isMobile: u.isMobile,
    hasTouch: u.hasTouch,
  }
}

async function freshContext(browser: Browser, contextOptions: CtxOpts): Promise<BrowserContext> {
  const ctx = await browser.newContext(contextOptions)
  // A fresh profile shows the student nickname dialog late (its overlay would
  // swallow the pen strokes); mark it as already seen.
  await ctx.addInitScript(() => {
    try { localStorage.setItem('eduskript:nickname-prompt-seen', '1') } catch { /* ignore */ }
  })
  await loginAs(ctx, STUDENT)
  return ctx
}

/** Device A: draw two strokes and wait until the server holds them. */
async function seedTwoStrokesFromDeviceA(browser: Browser, contextOptions: CtxOpts) {
  const ctx = await freshContext(browser, contextOptions)
  const page = await ctx.newPage()
  await openPage(page, scratch.path)
  await selectPen(page)
  await drawRelativeTo(page, '#paper h2:nth-of-type(1)', 40, 50)
  await drawRelativeTo(page, '#paper h2:nth-of-type(2)', 40, 50)
  await expect.poll(async () => (await stateStrokes(page)).length).toBe(2)
  const stored = await waitForStoredStrokes(STUDENT.email, scratch.id, 2)
  await ctx.close()
  return stored.map((s) => s.id)
}

test('fresh browser shows the server strokes on first visit and adds to them', async ({ browser }) => {
  const contextOptions = projectContextOptions()
  const seeded = await seedTwoStrokesFromDeviceA(browser, contextOptions)

  const ctxB = await freshContext(browser, contextOptions)
  const page = await ctxB.newPage()
  await openPage(page, scratch.path)

  // (a) No reload: the strokes fetched by the initial sync must render.
  await expect.poll(async () => (await renderedStrokes(page)).length, { timeout: 15_000 }).toBe(2)

  // (b) Drawing on device B adds to the server row.
  await selectPen(page)
  await drawRelativeTo(page, '#paper h2:nth-of-type(2)', 60, 120)
  const after = await waitForStoredStrokes(STUDENT.email, scratch.id, 3)
  for (const id of seeded) expect(after.map((s) => s.id)).toContain(id)
  await ctxB.close()
})

test('drawing before the server state arrived never drops server strokes', async ({ browser }) => {
  const contextOptions = projectContextOptions()
  const seeded = await seedTwoStrokesFromDeviceA(browser, contextOptions)

  const ctxB = await freshContext(browser, contextOptions)
  // Hold the initial-sync bulk fetch, so the page is drawn on before the
  // server's strokes reach this browser.
  let release!: () => void
  const held = new Promise<void>((r) => { release = r })
  await ctxB.route('**/api/user-data/bulk-fetch', async (route) => {
    await held
    await route.continue()
  })
  const page = await ctxB.newPage()
  await openPage(page, scratch.path)
  await selectPen(page)

  // Stroke X: written with no knowledge of the server row.
  await drawRelativeTo(page, '#paper h2:nth-of-type(1)', 60, 90)
  await expect.poll(async () => (await stateStrokes(page)).length).toBe(1)
  await page.waitForTimeout(3000)
  // The server row must still hold the two seeded strokes (merged, not replaced).
  const mid = (await storedStrokes(STUDENT.email, scratch.id)).map((s) => s.id)
  for (const id of seeded) expect(mid).toContain(id)

  // Let the server state arrive while this layer already holds stroke X.
  release()
  await page.waitForTimeout(2000)

  // Stroke Y: the layer's own state may still lack the seeded strokes; the
  // write must keep them anyway.
  await drawRelativeTo(page, '#paper h2:nth-of-type(2)', 80, 140)
  await expect.poll(async () => (await stateStrokes(page)).length).toBeGreaterThanOrEqual(2)
  const final = await waitForStoredStrokes(STUDENT.email, scratch.id, 4)
  for (const id of seeded) expect(final.map((s) => s.id)).toContain(id)

  // After a reload all four render.
  await page.reload()
  await openPage(page, scratch.path)
  await expect.poll(async () => (await renderedStrokes(page)).length, { timeout: 15_000 }).toBe(4)
  await ctxB.close()
})

test('one reload shows strokes another device added (local copy shown first)', async ({ browser }) => {
  const contextOptions = projectContextOptions()
  const ctxA = await freshContext(browser, contextOptions)
  const pageA = await ctxA.newPage()
  await openPage(pageA, scratch.path)
  await selectPen(pageA)
  await drawRelativeTo(pageA, '#paper h2:nth-of-type(1)', 40, 50)
  await waitForStoredStrokes(STUDENT.email, scratch.id, 1)

  // Device B gets a local (IndexedDB) copy holding that one stroke.
  const ctxB = await freshContext(browser, contextOptions)
  const pageB = await ctxB.newPage()
  await openPage(pageB, scratch.path)
  await expect.poll(async () => (await renderedStrokes(pageB)).length, { timeout: 15_000 }).toBe(1)

  // Device A adds a second stroke.
  await drawRelativeTo(pageA, '#paper h2:nth-of-type(2)', 40, 50)
  await waitForStoredStrokes(STUDENT.email, scratch.id, 2)

  // B reloads once: its local copy (1 stroke) renders first, the server copy
  // (2 strokes) arrives after. Both must show without a second reload.
  await pageB.reload()
  await openPage(pageB, scratch.path)
  await expect.poll(async () => (await renderedStrokes(pageB)).length, { timeout: 15_000 }).toBe(2)
  await ctxA.close()
  await ctxB.close()
})

test('one reload shows strokes changed on the server under the same id', async ({ browser }) => {
  const contextOptions = projectContextOptions()
  const ctx = await freshContext(browser, contextOptions)
  const page = await ctx.newPage()
  await openPage(page, scratch.path)
  await selectPen(page)
  await drawRelativeTo(page, '#paper h2:nth-of-type(1)', 40, 50)
  await waitForStoredStrokes(STUDENT.email, scratch.id, 1)
  const before = (await renderedStrokes(page))[0]

  // Move the stroke 200 px down on the server (same id, version + 1), the way
  // a server-side repair or port rewrites a row.
  await db(
    `UPDATE user_data SET version = version + 1, updated_at = now(),
       data = jsonb_set(data, '{canvasData}', to_jsonb(
         (SELECT json_agg(jsonb_set(s, '{points}', (SELECT jsonb_agg(jsonb_set(p, '{y}', to_jsonb((p->>'y')::float + 200))) FROM jsonb_array_elements(s->'points') p)))::text
          FROM jsonb_array_elements((data->>'canvasData')::jsonb) s)))
     WHERE adapter = 'annotations' AND item_id = $1 AND user_id = (SELECT id FROM users WHERE email = $2) AND target_type IS NULL`,
    [scratch.id, STUDENT.email],
  )

  await page.reload()
  await openPage(page, scratch.path)
  await expect.poll(async () => {
    const r = (await renderedStrokes(page))[0]
    return r ? Math.round(r.y - before.y) : null
  }, { timeout: 15_000 }).toBe(200)
  await ctx.close()
})
