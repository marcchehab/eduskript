import { chromium, type FullConfig } from '@playwright/test'
import { mkdirSync } from 'fs'
import { E2E_EMAIL, E2E_PASSWORD } from '../scripts/seed-e2e.mjs'

const STORAGE_PATH = 'e2e/.auth/state.json'

/**
 * Logs in once as the seeded e2e teacher via the real signin UI and saves the
 * NextAuth session to storageState, which every test reuses. The credentials
 * form is behind a "Sign in with email" toggle on /auth/signin.
 *
 * Assumes the e2e teacher exists — run `node scripts/seed-e2e.mjs` first
 * (the README / test:e2e script wires this up).
 */
export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use?.baseURL ?? 'http://localhost:3000'
  mkdirSync('e2e/.auth', { recursive: true })

  const browser = await chromium.launch()
  const page = await browser.newPage({ baseURL })
  try {
    await page.goto('/auth/signin')
    // Reveal the email/password form (hidden behind a toggle button).
    await page.getByRole('button', { name: /sign in with email/i }).first().click()
    await page.fill('#email', E2E_EMAIL)
    await page.fill('#password', E2E_PASSWORD)
    await page.getByRole('button', { name: /^sign in$/i }).click()
    // Success navigates away from /auth/signin (default callbackUrl /dashboard).
    await page.waitForURL((url) => !url.pathname.startsWith('/auth/signin'), {
      timeout: 30_000,
    })
    await page.context().storageState({ path: STORAGE_PATH })
  } finally {
    await browser.close()
  }
}
