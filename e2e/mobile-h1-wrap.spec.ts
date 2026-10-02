import { test, expect, type Page } from '@playwright/test'

/**
 * Regression guard: on a phone (reflow mode) a long H1 must not break inside a
 * word (QA finding mobile-title-breaks-mid-word). `.prose-theme` sets
 * `overflow-wrap: break-word`, and the H1 is 5em, so at 390px "Annotation" was
 * split mid-word. Self-contained: needs no seeded data or login — it loads any
 * public page for globals.css and injects a prose H1.
 */
test.use({ storageState: { cookies: [], origins: [] } })

const TITLE = 'E2E Annotation Test Page'

async function mountH1(page: Page, reflow: boolean) {
  await page.goto('/auth/signin')
  await page.evaluate(
    ({ title, reflow }) => {
      document.documentElement.classList.toggle('reflow-mode', reflow)
      const article = document.createElement('article')
      article.className = 'prose-theme'
      // Same column as the reflow paper on a phone: full width, 1.25rem padding.
      article.style.padding = '0 1.25rem'
      article.innerHTML = `<div><h1 id="qa-h1">${title}</h1></div>`
      document.body.prepend(article)
    },
    { title: TITLE, reflow }
  )
}

/** Words whose glyphs span more than one line box (= broken inside the word). */
async function wordsBrokenMidWord(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const h1 = document.getElementById('qa-h1')!
    const text = h1.firstChild as Text
    const broken: string[] = []
    const re = /\S+/g
    let m: RegExpExecArray | null
    while ((m = re.exec(text.data))) {
      const r = document.createRange()
      r.setStart(text, m.index)
      r.setEnd(text, m.index + m[0].length)
      const tops = new Set([...r.getClientRects()].map((rect) => Math.round(rect.top)))
      if (tops.size > 1) broken.push(m[0])
    }
    return broken
  })
}

test('phone reflow: H1 breaks only between words', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mountH1(page, true)
  expect(await wordsBrokenMidWord(page)).toEqual([])
  const overflow = await page.evaluate(() => {
    const h1 = document.getElementById('qa-h1')!
    return h1.scrollWidth - h1.clientWidth
  })
  expect(overflow).toBeLessThanOrEqual(0)
})

test('desktop: H1 size unchanged (5em)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await mountH1(page, false)
  const ratio = await page.evaluate(() => {
    const h1 = document.getElementById('qa-h1')!
    const parent = h1.parentElement!
    return parseFloat(getComputedStyle(h1).fontSize) / parseFloat(getComputedStyle(parent).fontSize)
  })
  expect(ratio).toBeCloseTo(5, 2)
})
