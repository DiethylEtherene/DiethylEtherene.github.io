# CI-Safe Responsive Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy the already-implemented responsive portfolio redesign by removing redundant heavy work from its browser gate while preserving every geometry and no-shift assertion.

**Architecture:** Instrument the real browser suite with runtime counters for committed top-level navigations and playlist-readiness probes. Require setup to finish with exactly one main-frame document commit and one readiness probe before any timed viewport subtest begins, snapshot that baseline, and require the full viewport matrix to leave it unchanged. Keep one browser page and one loaded STL scene for the full matrix, resize that live page for each geometry pass, and exercise the music-player layout at every size because media transport is independent of viewport geometry. After each resize, poll requested viewport and fixed-control style sentinels on animation frames before retaining the existing two-frame layout settle; this prevents a live-page 480-to-768 resize from being measured while 480px media-query offsets are still computed. Retain GitHub Pages upload/deploy behind all existing checks.

**Tech Stack:** Node.js test runner, Playwright Chromium, HTML/CSS, GitHub Actions, GitHub Pages.

---

## File Map

- Modify `tests/responsive-layout.browser.test.mjs`: measure committed main-frame navigations and real media-readiness probes, enforce their setup placement, then reuse the loaded page, condition-settle resize-driven styles, close the player between viewport passes, and keep one media readiness probe.
- Modify `docs/superpowers/plans/2026-07-30-ci-safe-responsive-deploy.md`: document the runtime regression and deployment workflow.
- Leave `package.json` unchanged; its existing responsive command already runs the instrumented browser suite.

### Task 1: Add the failing CI-efficiency regression

**Files:**
- Modify: `tests/responsive-layout.browser.test.mjs`
- Modify: `docs/superpowers/plans/2026-07-30-ci-safe-responsive-deploy.md`

- [ ] **Step 1: Count committed top-level navigations**

Create a runtime metrics object before the initial navigation. Register a dedicated `framenavigated` listener before `page.goto()` and increment `topLevelDocumentCommits` only when the committed frame is the page's main frame and its URL starts with the local static-server base URL. Remove the listener in `finally`.

- [ ] **Step 2: Count actual playlist-readiness probes**

Require the runtime metrics object as a `waitForPlaylistResourceReady()` parameter and increment its readiness-probe count inside the helper, so call indirection cannot evade the measurement.

- [ ] **Step 3: Assert setup placement and an unchanged matrix baseline**

Immediately before the viewport loop, snapshot the runtime metrics and assert setup completed with exactly one top-level document commit and one playlist-readiness probe. After the viewport matrix, assert the live metrics are unchanged from that setup snapshot. Preserve all current reloads, readiness calls, geometry assertions, and timeout limits until the RED run is recorded.

- [ ] **Step 4: Run a targeted viewport through the external CDP browser and verify RED**

Run:

```powershell
$env:PLAYWRIGHT_CDP_URL='http://127.0.0.1:9333'
$env:RESPONSIVE_VIEWPORT='1440x900'
node --test --test-isolation=none tests/responsive-layout.browser.test.mjs
```

Expected: FAIL before the timed viewport subtest because setup observed one committed top-level document but zero playlist-readiness probes instead of the required one and one.

### Task 2: Reuse the loaded scene across responsive passes

**Files:**
- Modify: `tests/responsive-layout.browser.test.mjs`

- [ ] **Step 1: Probe playlist readiness once**

After the initial page is ready, set the audio element to `preload="auto"`, open the player, wait for readiness once, close the player, and wait for the closed state.

- [ ] **Step 2: Replace per-viewport reloads with condition-based resize settling**

Inside the viewport loop, call `page.setViewportSize(viewport)`, then poll on animation frames until `innerWidth`/`innerHeight` and the fixed music/theme offsets match the requested breakpoint. Use side inset `clamp(16px, 4vw, 32px)` through 1023px and 24px above it; theme bottoms 88px/70px/16px and music bottoms 150px/70px/16px across phone/tablet/desktop. Keep a bounded timeout, retain two animation frames after the condition matches, and keep all geometry, containment, breakpoint, model/orbit, folder, and player no-shift assertions.

- [ ] **Step 3: Assert the responsive sentinels after every settle**

Read the same viewport and computed-style sentinels immediately after settling and assert them within a 0.02px tolerance. The full ordered viewport matrix is the regression for the intermittent 480-to-768 stale-style transition; do not replace it with a fixed sleep or a wider tolerance.

- [ ] **Step 4: Reset the player after every viewport**

After the open-player assertions, click the close control and wait for `.music-easter` to lose the `open` class so each pass starts from the same state.

- [ ] **Step 5: Run the browser suite**

Run:

```powershell
$env:PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH='C:\Program Files\Google\Chrome\Application\chrome.exe'
npm run test:responsive
```

Expected: responsive browser suite PASS all 14 tests, including its runtime one-load/one-probe contract, well within the parent timeout.

### Task 3: Verify and deploy

**Files:**
- No additional production files unless a verified visual defect is found.

- [ ] **Step 1: Run the full local gate**

Run:

```powershell
npm test
pwsh -File tests/verify-site.ps1
$env:PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH='C:\Program Files\Google\Chrome\Application\chrome.exe'
npm run test:responsive
git diff --check
```

Expected: playlist 9/9, static verifier PASS, responsive 14/14 including the runtime contract, and no whitespace errors.

Repeat the full responsive CDP matrix at least ten consecutive times after the sentinel fix. All runs must retain the 10-second viewport and 90-second parent budgets with zero stale-style failures.

- [ ] **Step 2: Commit and push**

Commit only the browser-suite regression and optimization plus this plan, then push `main`.

- [ ] **Step 3: Monitor GitHub Pages**

Wait for `Deploy portfolio to GitHub Pages` to conclude successfully and verify the deployed page serves `/files/responsive-layout.css` from the new commit.

- [ ] **Step 4: Verify production geometry**

Run the public URL through representative desktop and mobile viewports and confirm narrower left cards, larger folders/model/orbits, no player-open shift, and no horizontal overflow.
