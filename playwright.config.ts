import { defineConfig, devices, type Project } from '@playwright/test'

// Port of the dev server under test. Default 3000; set PORT=3050 (etc.) to run
// against another worktree's already-running `pnpm dev` (reuseExistingServer).
const PORT = Number(process.env.PORT ?? 3000)
const BASE_URL = `http://localhost:${PORT}`

// WebKit (Safari engine) is not run locally: it runs in a Playwright server
// (e.g. Docker `playwright run-server`, same version as @playwright/test) and
// is reached over this websocket. Project only exists when the env var is set.
const WEBKIT_WS = process.env.PW_WEBKIT_WS

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
    baseURL: BASE_URL,
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
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // iPad Safari engine for the annotation/zoom fix specs (touch, Pencil).
    // Remote browser: CDP is unavailable here, so the helpers in
    // e2e/annotation-fixes/helpers.ts fall back to synthetic TouchEvents.
    ...(WEBKIT_WS
      ? [
          {
            name: 'webkit-ipad',
            testDir: './e2e/annotation-fixes',
            use: { ...devices['iPad Pro 11'], connectOptions: { wsEndpoint: WEBKIT_WS } },
          } satisfies Project,
        ]
      : []),
  ],
  webServer: {
    // `next dev` reads PORT from the environment.
    command: 'pnpm dev',
    // Readiness probe: `/` is a 404 on a fresh DB (no root site), which
    // Playwright treats as not-ready and then tries to boot a second server.
    url: `${BASE_URL}/auth/signin`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
