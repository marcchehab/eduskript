import { defineConfig, devices } from '@playwright/test'

/**
 * Browser test harness for the annotation system (v1). See e2e/README.md and
 * the plan in CLAUDE_ROADMAP / docs. Runs Chromium headless against a local dev
 * server + local Postgres. NOT part of pre-push — invoke with `pnpm test:e2e`.
 *
 * Needs the dev server in NON-production mode so the `window.__eduAnnotationTest`
 * debug hook (annotation-layer.tsx) is present. `pnpm dev` satisfies that.
 */
export default defineConfig({
  testDir: './e2e',
  // Drawing/erasing mutates one shared seeded page; keep it serial.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['html', { open: 'never' }], ['list']],
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: 'http://localhost:3000',
    // Written by global-setup (logged-in teacher session).
    storageState: 'e2e/.auth/state.json',
    // Keep a full trace when watching, so it shows up in the HTML report even
    // on passing runs (`npx playwright show-report`). Otherwise only on failure.
    trace: process.env.E2E_HEADED === '1' ? 'on' : 'retain-on-failure',
    screenshot: 'only-on-failure',
    // E2E_HEADED=1 opens a real browser window; E2E_SLOMO=<ms> slows each
    // action so gestures (draw/drag/pinch) are watchable. Default: headless.
    headless: process.env.E2E_HEADED !== '1',
    launchOptions: { slowMo: Number(process.env.E2E_SLOMO ?? 0) },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
