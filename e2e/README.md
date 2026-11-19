# Annotation browser tests (e2e)

Real-Chromium invariant checks for the annotation system — the pointer/touch/
reflow behaviour that jsdom can't model and that has regressed by hand before
(eraser hitting the old position after reflow, strokes drifting, etc.).

Driven with Playwright. Gestures go through CDP (`Input.dispatchMouseEvent` /
`dispatchTouchEvent`) so they're *trusted* events — pointer capture works and
`pointerType`/`force` (pressure) are honoured, exercising the real pen/touch/
mouse branches in `simple-canvas.tsx`. The oracle reads the app's own state
rather than diffing pixels, via dev-only affordances (all stripped from
production builds):

- `window.__eduTest` in `annotation-layer.tsx` — `state()` (strokes +
  headingPositions + snaps), `clear()` (reset all annotations), `addSnap()`
  (insert a snap through the real capture/anchoring path, skipping only the
  paste/crop UI).
- `data-sticky-note-id` / `data-snap-id` on the rendered cards
  (`sticky-notes-layer.tsx` / `snaps-display.tsx`) so a test can measure and
  count them in the DOM. Strokes are read from the section-anchored SVG paths.

## Run it

Prereqs (one-time):

```bash
pnpm db:local                 # local Postgres (or any DATABASE_URL)
npx playwright install chromium
```

Then:

```bash
pnpm test:e2e        # seeds the e2e teacher, boots `pnpm dev`, runs the suite
pnpm test:e2e:ui     # same, in Playwright's interactive UI
pnpm test:e2e:seed   # just (re)create the deterministic seed page
```

`test:e2e` re-seeds a fixed teacher/page (`/e2e/e2e-annotations/canvas`,
`scripts/seed-e2e.mjs`) and reuses a running dev server if one is up. On failure,
open the report / trace:

```bash
npx playwright show-report
```

It is intentionally **not** part of `pnpm pre-push` (needs a browser + DB + a
running app, too slow for every push). Run it on demand, or on a timer/cron
later — `pnpm test:e2e` is the whole entry point.

## What it checks (invariants)

`annotation-invariants.spec.ts` (strokes):
1. a drawn stroke commits to a real section anchor;
2. the rendered stroke keeps its position *within its section* through reflow
   (expanding a collapsed callout above it);
3. the eraser hits the stroke at its **post-reflow** position, not the old one
   (the regression we fixed — re-neutralising `liveSectionYShift` makes this
   fail);
4. stroke positions survive a reload (paper-relative, scroll-invariant);
5. a pen pressure ramp is recorded as variable pressure;
6. a two-finger pinch-zoom never drops strokes.

`annotation-elements.spec.ts` (stroke + sticky note + snap together):
1. all three reposition with their section on reflow AND stay anchored under
   pinch-zoom (measured as offset-within-section, which is scroll/reflow/zoom
   invariant);
2. dragging a sticky note lands where it's dropped (guards the "jumps to another
   place" bug);
3. all three styles survive a reload;
4. pinch zoom scales the page (`<main>` transform) and keeps a stroke aligned to
   its section.

## Honest limits

These can't be reproduced headless and stay manual:

- real stylus **pressure dynamics** (we inject synthetic `force` values — enough
  to hit the variable-pressure code path, not real curves);
- the physical **hardware eraser button** electronics;
- iOS-Safari **coalesced-event** duplication (a WebKit/real-device behaviour).

## Annotation/zoom fix specs (`e2e/annotation-fixes/`)

Specs for individual annotation/zoom bug fixes, each on its own scratch page.
Helpers in `e2e/annotation-fixes/helpers.ts`; `harness.spec.ts` is a smoke test
of the helpers themselves.

```bash
# against an already-running dev server on :3050, chromium + iPad WebKit
PORT=3050 PW_WEBKIT_WS=ws://127.0.0.1:3999/ pnpm test:e2e:fixes
```

- `PORT` sets baseURL and the webServer port (default 3000; a running server
  is reused).
- `PW_WEBKIT_WS` enables the `webkit-ipad` project (`devices['iPad Pro 11']`,
  only `e2e/annotation-fixes/`). WebKit runs in a Playwright server of the SAME
  version as `@playwright/test`, e.g.
  `docker run -d --name pw-webkit --network host mcr.microsoft.com/playwright:v1.63.0-noble npx -y playwright@1.63.0 run-server --port 3999 --host 127.0.0.1`
  (`--network host` so it reaches `localhost:<PORT>`).
- Needs the e2e teacher/skript (`node scripts/seed-e2e.mjs`) and a student
  account (default `student1@eduskript.test` / `student123`, override with
  `E2E_STUDENT_EMAIL` / `E2E_STUDENT_PASSWORD`). DB access uses
  `DATABASE_URL` (from `.env.local`/`.env`), localhost only.

Gotchas:
- Remote WebKit has no CDP: touch gestures there are synthetic `TouchEvent`s
  (untrusted — no native scroll/zoom, only the app's listeners react).
  `new Touch()` is an illegal constructor in that WebKit and `TouchEvent` init
  needs a `TouchList`; the helper uses `document.createTouch`/`createTouchList`.
- Change page content via `updateScratchPage` (PATCH API, revalidates).
  Direct DB updates are hidden by the page render cache.
- The student "Choose your nickname" dialog mounts late (>3s in WebKit);
  `openPage`/`selectPen` dismiss it.
- On the iPad viewport the page opens fit-to-width (zoom about 0.65, not 1).
