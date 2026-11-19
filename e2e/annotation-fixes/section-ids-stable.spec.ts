import { expect, test, type Page } from '@playwright/test'
import {
  STUDENT,
  clearStoredAnnotations,
  createScratchPage,
  db,
  deleteScratchPage,
  drawRelativeTo,
  loginAs,
  openPage,
  selectPen,
  storedStrokes,
  updateScratchPage,
  waitForStoredStrokes,
  type ScratchPage,
} from './helpers'

/**
 * Findings annotations-counter-section-ids-shift-on-edit,
 * annotations-duplicate-plugin-ids-shift-on-insert (same mechanism, callouts
 * here: plugins need a plugin row), annotations-renumbered-heading-orphans-
 * strokes (id part), the silent drop of callout orphans, and
 * annotations-stroke-floats-after-solution-collapses.
 * Fix: src/lib/rehype-plugins/heading-section-ids.ts (scoped ids + legacy map),
 * section-anchored-strokes.tsx / reposition-strokes.ts (legacy lookup, orphans).
 *
 * Mouse strokes, not touch/Safari-specific: chromium only (mouse strokes in the
 * remote webkit-ipad project do not register reliably, see
 * stroke-anchor-layout-shift.spec.ts).
 */
test.skip(({ browserName }) => browserName === 'webkit', 'not touch/Safari-specific')

const FILLER = Array.from({ length: 8 }, (_, i) => `Filler paragraph ${i + 1} so the page scrolls.`).join('\n\n')

const BASE = `# Rechnen

> [!success] Lernziele
> Sie können addieren.

Intro paragraph.

## 1 Addition

> [!info] Addition von Vektoren
> Spitze an Schaft.

Paragraph after the addition callout.

## 2 Subtraktion

> [!warning] Richtung beachten
> Gegenvektor addieren.

Paragraph after the warning callout.

<solution title="Lösung 1">

Line one of the solution.

Line two of the solution.

Line three of the solution.

</solution>

Paragraph after the solution.

${FILLER}
`

const INSERTED = BASE.replace('## 1 Addition', `## 1 Einstieg

> [!tip] Vorwissen
> Ein Vektor ist eine Verschiebung.

Paragraph after the inserted callout.

## 2 Addition`).replace('## 2 Subtraktion', '## 3 Subtraktion')

/** Paper box of the first anchored callout whose text contains `text`. */
async function calloutBox(page: Page, text: string) {
  const box = await page.evaluate((t) => {
    const p = document.getElementById('paper')!
    const pr = p.getBoundingClientRect()
    const s = pr.width / p.offsetWidth
    const b = [...document.querySelectorAll('#paper blockquote[data-section-id]')].find((e) => e.textContent?.includes(t))
    if (!b) return null
    const r = b.getBoundingClientRect()
    return { x: (r.left - pr.left) / s, y: (r.top - pr.top) / s, height: r.height / s }
  }, text)
  if (!box) throw new Error(`no callout "${text}"`)
  return box
}

/** Paper box of the first paragraph whose text is exactly `text`. */
async function paragraphBox(page: Page, text: string) {
  const box = await page.evaluate((t) => {
    const p = document.getElementById('paper')!
    const pr = p.getBoundingClientRect()
    const s = pr.width / p.offsetWidth
    const el = [...document.querySelectorAll('#paper p')].find((e) => e.textContent?.trim() === t)
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: (r.left - pr.left) / s, y: (r.top - pr.top) / s }
  }, text)
  if (!box) throw new Error(`no paragraph "${text}"`)
  return box
}

/** Every rendered stroke path (section SVGs and the orphan fallback), unscaled paper px. */
async function allRenderedStrokeYs(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const p = document.getElementById('paper')!
    const pr = p.getBoundingClientRect()
    const s = pr.width / p.offsetWidth
    return [...document.querySelectorAll('svg.annotation-section-svg path, svg.annotation-svg path')]
      .map((e) => (e.getBoundingClientRect().top - pr.top) / s)
      .sort((a, b) => a - b)
  })
}

/** openPage on the scratch page (openPage keeps the nickname dialog away). */
async function open(page: Page) {
  await openPage(page, scratch.path)
}

let scratch: ScratchPage

test.beforeAll(async () => {
  scratch = await createScratchPage(BASE, 'section-ids')
})
test.beforeEach(async () => {
  await clearStoredAnnotations(STUDENT.email, scratch.id)
  await updateScratchPage(scratch.id, BASE)
})
test.afterAll(async () => {
  if (scratch) await deleteScratchPage(scratch.id)
})

async function reloadAndSettle(page: Page) {
  await open(page)
  await page.waitForTimeout(800)
}

test('strokes on callouts stay on them when a section with a callout is inserted above', async ({ page, context }) => {
  await loginAs(context, STUDENT)
  await open(page)
  await selectPen(page)

  const add = await calloutBox(page, 'Addition von Vektoren')
  await drawRelativeTo(page, '#paper', add.x + 60, add.y + add.height / 2)
  const warn = await calloutBox(page, 'Richtung beachten')
  await drawRelativeTo(page, '#paper', warn.x + 60, warn.y + warn.height / 2)
  await waitForStoredStrokes(STUDENT.email, scratch.id, 2)

  const ysBefore = await allRenderedStrokeYs(page)
  expect(ysBefore).toHaveLength(2)
  const rel = (ys: number[], a: { y: number }, w: { y: number }) => [ys[0] - a.y, ys[1] - w.y]
  const before = rel(ysBefore, add, warn)

  await updateScratchPage(scratch.id, INSERTED)
  await reloadAndSettle(page)
  await expect(page.locator('#paper blockquote', { hasText: 'Vorwissen' })).toBeVisible()

  const add2 = await calloutBox(page, 'Addition von Vektoren')
  const warn2 = await calloutBox(page, 'Richtung beachten')
  await expect.poll(async () => (await allRenderedStrokeYs(page)).length).toBe(2)
  const after = rel(await allRenderedStrokeYs(page), add2, warn2)
  expect(Math.abs(after[0] - before[0]), 'stroke stays on "Addition von Vektoren"').toBeLessThan(2)
  expect(Math.abs(after[1] - before[1]), 'stroke stays on "Richtung beachten"').toBeLessThan(2)
})

test('a stroke stored with a legacy id renders exactly where the current id renders it', async ({ page, context }) => {
  await loginAs(context, STUDENT)
  await open(page)
  await selectPen(page)
  const warn = await calloutBox(page, 'Richtung beachten')
  await drawRelativeTo(page, '#paper', warn.x + 60, warn.y + warn.height / 2)
  const [stroke] = await waitForStoredStrokes(STUDENT.email, scratch.id, 1)
  await page.waitForTimeout(500)
  const yCurrent = (await allRenderedStrokeYs(page))[0]

  // Legacy id of the same element, from the page's own legacy → current map.
  const legacyId = await page.evaluate((current) => {
    const raw = document.querySelector('[data-legacy-section-ids]')?.getAttribute('data-legacy-section-ids')
    const map = JSON.parse(raw ?? '{}') as Record<string, string>
    return Object.keys(map).find((k) => map[k] === current) ?? null
  }, stroke.sectionId!)
  expect(legacyId).toBe('callout-2')

  // Rewrite the stored stroke as production holds it today (legacy id).
  const rows = await db<{ id: string; data: { canvasData: string } }>(
    `SELECT ud.id, ud.data FROM user_data ud JOIN users u ON u.id = ud.user_id
     WHERE u.email = $1 AND ud.adapter = 'annotations' AND ud.item_id = $2 AND ud.target_type IS NULL`,
    [STUDENT.email, scratch.id],
  )
  expect(rows).toHaveLength(1)
  const strokes = JSON.parse(rows[0].data.canvasData) as Array<{ sectionId?: string }>
  for (const s of strokes) if (s.sectionId === stroke.sectionId) s.sectionId = legacyId!
  await db(`UPDATE user_data SET data = $1, version = version + 1 WHERE id = $2`, [
    JSON.stringify({ ...rows[0].data, canvasData: JSON.stringify(strokes) }),
    rows[0].id,
  ])
  expect((await storedStrokes(STUDENT.email, scratch.id))[0].sectionId).toBe('callout-2')

  // Fresh context: no client-side cache of the old record.
  const fresh = await context.browser()!.newContext()
  try {
    const p2 = await fresh.newPage()
    await loginAs(fresh, STUDENT)
    await openPage(p2, scratch.path)
    await expect.poll(async () => (await allRenderedStrokeYs(p2)).length, { timeout: 10_000 }).toBe(1)
    const host = await p2.evaluate(() => document.querySelector('svg.annotation-section-svg path')?.closest('[data-section-id]')?.getAttribute('data-section-id') ?? null)
    expect(host).toBe(stroke.sectionId)
    expect(Math.abs((await allRenderedStrokeYs(p2))[0] - yCurrent)).toBeLessThan(0.5)
  } finally {
    await fresh.close()
  }
})

test('a stroke on a removed callout is still rendered (not dropped)', async ({ page, context }) => {
  await loginAs(context, STUDENT)
  await open(page)
  await selectPen(page)
  const warn = await calloutBox(page, 'Richtung beachten')
  await drawRelativeTo(page, '#paper', warn.x + 60, warn.y + warn.height / 2)
  await waitForStoredStrokes(STUDENT.email, scratch.id, 1)

  await updateScratchPage(scratch.id, BASE.replace(/> \[!warning\][^\n]*\n>[^\n]*\n/, ''))
  await reloadAndSettle(page)
  await expect(page.locator('#paper blockquote', { hasText: 'Richtung beachten' })).toHaveCount(0)
  await expect.poll(async () => (await allRenderedStrokeYs(page)).length, { timeout: 10_000 }).toBe(1)
})

test('a stroke below an opened solution stays next to the paragraph after it on reload', async ({ page, context }) => {
  await loginAs(context, STUDENT)
  await open(page)
  await page.getByRole('button', { name: 'Lösung 1' }).click()
  await expect(page.getByText('Line three of the solution.')).toBeVisible()
  await selectPen(page)

  const para = 'Paragraph after the solution.'
  const p0 = await paragraphBox(page, para)
  await drawRelativeTo(page, '#paper', p0.x + 40, p0.y + 4)
  await waitForStoredStrokes(STUDENT.email, scratch.id, 1)
  const before = (await allRenderedStrokeYs(page))[0] - p0.y

  await reloadAndSettle(page) // solution collapsed again
  await expect(page.getByText('Line three of the solution.')).toHaveCount(0)
  await expect.poll(async () => (await allRenderedStrokeYs(page)).length).toBe(1)
  const p1 = await paragraphBox(page, para)
  const after = (await allRenderedStrokeYs(page))[0] - p1.y
  expect(Math.abs(after - before), 'stroke follows the paragraph after the collapsed solution').toBeLessThan(2)
})
