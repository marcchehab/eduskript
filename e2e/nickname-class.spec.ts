import { test, expect, type Page } from '@playwright/test'
import { E2E_PAGE_PATH } from '../scripts/seed-e2e.mjs'

// The editor mounts lazily once scrolled near the viewport (see
// code-editor-layout.spec.ts).
async function openEditor(page: Page) {
  await page.goto(E2E_PAGE_PATH)
  const cm = page.locator('.cm-editor').first()
  await expect(async () => {
    await page.getByText('Filler paragraph 12').scrollIntoViewIfNeeded({ timeout: 2_000 })
    await cm.waitFor({ state: 'visible', timeout: 5_000 })
  }).toPass({ timeout: 90_000 })
  await cm.scrollIntoViewIfNeeded()
  return cm
}

/**
 * Nickname classes (src/lib/nickname-login.ts), whole flow:
 * teacher creates a class and turns on nickname login → a student joins on
 * /join/<code> with nickname + password → writes code in an editor and runs
 * it (server checkpoint) → on a second "device" (fresh browser context) signs in with the
 * same nickname + password and finds the code again.
 */
test('nickname student joins, saves code, signs in again on another device', async ({ page, browser, baseURL }) => {
  test.setTimeout(300_000)

  // Teacher (storageState from global-setup).
  const created = await page.request.post('/api/classes', {
    data: { name: `Nickname e2e ${Date.now()}`, allowAnonymous: true },
  })
  expect(created.ok()).toBe(true)
  const { class: cls } = await created.json()
  expect(cls.inviteCode).toMatch(/^[a-z2-9]{6}$/)
  const patched = await page.request.patch(`/api/classes/${cls.id}`, { data: { nicknameLogin: true } })
  expect((await patched.json()).class.nicknameLogin).toBe(true)

  const nickname = `Blitz ${Date.now() % 100000}`
  const password = 'geheim123'
  const marker = `# saved by ${nickname}`

  // Device 1: join with a new nickname (code typed in upper case).
  const device1 = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } })
  const s1 = await device1.newPage()
  await s1.goto(`/join/${cls.inviteCode.toUpperCase()}`)
  await s1.getByLabel('Nickname').fill(nickname)
  await s1.getByLabel('Password', { exact: true }).fill(password)
  await s1.getByLabel('Repeat password').fill(password)
  await s1.getByRole('button', { name: 'Join class' }).click()
  await expect(s1.getByText(`Welcome, ${nickname}!`)).toBeVisible({ timeout: 30_000 })

  // Write code and press Run: keystrokes stay local, Run posts a server
  // checkpoint, which another device restores.
  const cm1 = await openEditor(s1)
  await s1.locator('.cm-content').first().click()
  await s1.keyboard.press('ControlOrMeta+End')
  await s1.keyboard.type(`\n${marker}`)
  await expect(cm1).toContainText(marker)
  const checkpointed = s1.waitForResponse(
    (r) => r.url().includes('/api/user-data/checkpoints') && r.request().method() === 'POST' && r.ok(),
    { timeout: 60_000 }
  )
  await s1.getByTitle('Run (Ctrl+Enter or Shift+Enter)').first().click()
  await checkpointed
  await device1.close()

  // Wrong password is refused.
  const device2 = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } })
  const s2 = await device2.newPage()
  await s2.goto(`/join/${cls.inviteCode}`)
  await s2.getByRole('button', { name: 'Already joined' }).click()
  await s2.getByLabel('Nickname').fill(nickname.toLowerCase())
  await s2.getByLabel('Password', { exact: true }).fill('falsch99')
  await s2.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(s2.getByText('Nickname or password is wrong')).toBeVisible({ timeout: 30_000 })

  // Device 2: sign in again (nickname in another case) and find the code.
  await s2.getByLabel('Password', { exact: true }).fill(password)
  await s2.getByRole('button', { name: 'Sign in', exact: true }).click()
  await s2.waitForURL(/\/dashboard/, { timeout: 30_000 })
  const cm2 = await openEditor(s2)
  await expect(cm2).toContainText(marker, { timeout: 30_000 })
  await device2.close()

  // Teacher sees the nickname account; deleting the class deletes it.
  const students = await (await page.request.get(`/api/classes/${cls.id}/students`)).json()
  expect(students.students).toEqual([expect.objectContaining({ displayName: nickname, nicknameAccount: true })])
  expect((await page.request.delete(`/api/classes/${cls.id}`)).ok()).toBe(true)
})
