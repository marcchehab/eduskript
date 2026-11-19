import { expect, test, type Browser, type Page } from '@playwright/test'
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
 * Findings annotations-spacer-moves-to-other-block-after-teacher-edit (incl.
 * its note: the add-time re-anchor was persisted only on unload) and the dead
 * orphaned-strokes banner.
 * Fix: src/lib/annotations/spacer-anchor.ts + annotation-layer.tsx (spacer
 * anchor, legacy afterBlockIndex, persisted re-anchor),
 * src/lib/annotations/orphan-strokes.ts + annotation-layer.tsx (banner).
 *
 * Mouse input, not touch/Safari-specific: chromium only.
 */
test.skip(({ browserName }) => browserName === 'webkit', 'not touch/Safari-specific')

const FILLER = Array.from({ length: 8 }, (_, i) => `Filler paragraph ${i + 1} so the page scrolls.`).join('\n\n')

const BASE = `# Spacer page

Intro paragraph.

## 1 Erste

Paragraph one A.

<solution title="Lösung 1">

Solution line.

</solution>

Target paragraph.

Paragraph below the target.

## 2 Zweite

> [!warning] Richtung beachten
> Gegenvektor addieren.

Second section paragraph.

${FILLER}
`

// The QA repro's edit: a new section with a callout above (4 blocks).
const INSERTED = BASE.replace('## 1 Erste', `## 0 Wiederholung

Ein Vektor beschreibt eine Verschiebung.

> [!tip] Merke
> Gleich lange Pfeile.

## 1 Erste`)

let scratch: ScratchPage

test.beforeAll(async () => {
  scratch = await createScratchPage(BASE, 'spacers')
})
test.beforeEach(async () => {
  await clearStoredAnnotations(STUDENT.email, scratch.id)
  await updateScratchPage(scratch.id, BASE)
})
test.afterAll(async () => {
  if (scratch) await deleteScratchPage(scratch.id)
})

/** openPage on the scratch page (openPage keeps the nickname dialog away). */
async function open(page: Page) {
  await openPage(page, scratch.path)
}

async function paragraphBox(page: Page, text: string) {
  const box = await page.evaluate((t) => {
    const p = document.getElementById('paper')!
    const pr = p.getBoundingClientRect()
    const s = pr.width / p.offsetWidth
    const el = [...document.querySelectorAll('#paper p')].find((e) => e.textContent?.trim() === t)
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: (r.left - pr.left) / s, y: (r.top - pr.top) / s, vx: r.left + r.width / 2, vBottom: r.bottom }
  }, text)
  if (!box) throw new Error(`no paragraph "${text}"`)
  return box
}

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

/** Text of the block right before the injected spacer (null: no spacer). */
const blockBeforeSpacer = (page: Page) =>
  page.evaluate(() => document.querySelector('[data-spacer-id]')?.previousElementSibling?.textContent?.trim() ?? null)

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

type SpacerRow = { id: string; data: { spacers: Array<Record<string, unknown>> } }
const spacerRows = () =>
  db<SpacerRow>(
    `SELECT ud.id, ud.data FROM user_data ud JOIN users u ON u.id = ud.user_id
     WHERE u.email = $1 AND ud.adapter = 'spacers' AND ud.item_id = $2 AND ud.target_type IS NULL`,
    [STUDENT.email, scratch.id],
  )

/** Student: stroke on "Paragraph below the target.", then a spacer after "Target paragraph.". */
async function addSpacerBelowTarget(page: Page) {
  await selectPen(page)
  const below = await paragraphBox(page, 'Paragraph below the target.')
  // Mid-line, clearly below the spacer's top (the paragraph's top margin collapses into it).
  await drawRelativeTo(page, '#paper', below.x + 40, below.y + 16)
  await waitForStoredStrokes(STUDENT.email, scratch.id, 1)

  await page.locator('button[title="Insert spacer"]').click()
  // The click-to-place overlay and its gap list mount after the mode switch;
  // a click before that lands on the content and places nothing.
  await expect(page.locator('.spacer-insertion-indicator').first()).toBeAttached()
  const target = await paragraphBox(page, 'Target paragraph.')
  await page.mouse.move(target.vx, target.vBottom + 4)
  await page.mouse.down()
  await page.mouse.up()
  await expect.poll(() => blockBeforeSpacer(page)).toBe('Target paragraph.')
  await page.keyboard.press('Escape')
}

/** A fresh context (no IndexedDB copy of the old records). */
async function freshPage(browser: Browser) {
  const ctx = await browser.newContext()
  const p = await ctx.newPage()
  await loginAs(ctx, STUDENT)
  await openPage(p, scratch.path)
  return { ctx, p }
}

test('a new spacer stays after its block when the teacher inserts a section above', async ({ page, context }) => {
  await loginAs(context, STUDENT)
  await open(page)
  await addSpacerBelowTarget(page)

  // Re-anchor of the stroke below the spacer is persisted (autosave, no unload).
  await expect
    .poll(async () => (await storedStrokes(STUDENT.email, scratch.id))[0]?.sectionId ?? '', { timeout: 10_000 })
    .toMatch(/^spacer-.+-end$/)
  const [row] = await spacerRows()
  expect(row.data.spacers[0]).toMatchObject({ anchorSectionId: 'h2-@erste', anchorText: 'Target paragraph.' })

  const below0 = await paragraphBox(page, 'Paragraph below the target.')
  const rel0 = (await allRenderedStrokeYs(page))[0] - below0.y

  await updateScratchPage(scratch.id, INSERTED)
  const { ctx, p } = await freshPage(context.browser()!)
  try {
    await expect(p.locator('#paper blockquote', { hasText: 'Gleich lange Pfeile' })).toBeVisible()
    await expect.poll(() => blockBeforeSpacer(p), { timeout: 10_000 }).toBe('Target paragraph.')
    await expect.poll(async () => (await allRenderedStrokeYs(p)).length, { timeout: 10_000 }).toBe(1)
    const below1 = await paragraphBox(p, 'Paragraph below the target.')
    const rel1 = (await allRenderedStrokeYs(p))[0] - below1.y
    expect(Math.abs(rel1 - rel0), 'stroke stays on the paragraph below the spacer').toBeLessThan(2)
  } finally {
    await ctx.close()
  }
})

test('a legacy spacer (afterBlockIndex only) below a solution stays on its block', async ({ page, context }) => {
  await loginAs(context, STUDENT)
  await open(page)
  await addSpacerBelowTarget(page)
  await expect.poll(async () => (await spacerRows()).length, { timeout: 8000 }).toBe(1)

  // Store it as production holds spacers today: afterBlockIndex only. The
  // index counts blocks as before 2026-11-19 (no <solution> end sentinel).
  const [row] = await spacerRows()
  const legacy = row.data.spacers.map(({ id, afterBlockIndex, height, pattern }) => ({ id, afterBlockIndex, height, pattern }))
  const expectedIndex = await page.evaluate(() => {
    const c = document.querySelector('[data-spacer-id]')!.parentElement!
    const old = [...c.children].filter(
      (e) => !e.hasAttribute('data-spacer-id') && !e.hasAttribute('data-spacer-end') && !/^solution@.+-end$/.test(e.getAttribute('data-section-id') ?? ''),
    )
    return old.findIndex((e) => e.textContent?.trim() === 'Target paragraph.')
  })
  expect(legacy[0].afterBlockIndex).toBe(expectedIndex)
  await db(`UPDATE user_data SET data = $1, version = version + 1 WHERE id = $2`, [JSON.stringify({ ...row.data, spacers: legacy }), row.id])

  const { ctx, p } = await freshPage(context.browser()!)
  try {
    await expect.poll(() => blockBeforeSpacer(p), { timeout: 10_000 }).toBe('Target paragraph.')
  } finally {
    await ctx.close()
  }
})

test('strokes whose section was removed: banner, "Keep here" anchors them in place', async ({ page, context }) => {
  await loginAs(context, STUDENT)
  await open(page)
  await selectPen(page)
  const warn = await calloutBox(page, 'Richtung beachten')
  await drawRelativeTo(page, '#paper', warn.x + 60, warn.y + warn.height / 2)
  await waitForStoredStrokes(STUDENT.email, scratch.id, 1)

  await updateScratchPage(scratch.id, BASE.replace(/> \[!warning\][^\n]*\n>[^\n]*\n/, ''))
  await open(page)
  const banner = page.getByTestId('orphan-strokes-banner')
  await expect(banner).toContainText('1 stroke no longer matches the page content', { timeout: 10_000 })
  const y0 = (await allRenderedStrokeYs(page))[0]

  await banner.getByRole('button', { name: 'Keep here' }).click()
  await expect(banner).toBeHidden()
  await expect
    .poll(async () => (await storedStrokes(STUDENT.email, scratch.id))[0]?.sectionId ?? '', { timeout: 8000 })
    .not.toMatch(/^callout/)
  expect(Math.abs((await allRenderedStrokeYs(page))[0] - y0)).toBeLessThan(1)

  await open(page)
  await expect.poll(async () => (await allRenderedStrokeYs(page)).length, { timeout: 10_000 }).toBe(1)
  expect(Math.abs((await allRenderedStrokeYs(page))[0] - y0)).toBeLessThan(1)
  await page.waitForTimeout(2500)
  await expect(banner).toBeHidden()
})

test('"Delete" in the banner removes the orphaned strokes', async ({ page, context }) => {
  await loginAs(context, STUDENT)
  await open(page)
  await selectPen(page)
  const warn = await calloutBox(page, 'Richtung beachten')
  await drawRelativeTo(page, '#paper', warn.x + 60, warn.y + warn.height / 2)
  await waitForStoredStrokes(STUDENT.email, scratch.id, 1)

  await updateScratchPage(scratch.id, BASE.replace(/> \[!warning\][^\n]*\n>[^\n]*\n/, ''))
  await open(page)
  const banner = page.getByTestId('orphan-strokes-banner')
  await banner.getByRole('button', { name: 'Delete' }).click({ timeout: 10_000 })
  await expect(banner).toBeHidden()
  await expect.poll(async () => (await storedStrokes(STUDENT.email, scratch.id)).length, { timeout: 8000 }).toBe(0)
  await expect.poll(async () => (await allRenderedStrokeYs(page)).length).toBe(0)
})
