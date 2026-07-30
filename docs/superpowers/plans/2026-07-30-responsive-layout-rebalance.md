# Responsive Portfolio Layout Rebalance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the portfolio’s mixed percentage/fixed absolute geometry with a single responsive layout authority that balances the three foreground regions and never shifts them when the music player opens.

**Architecture:** Add one high-specificity responsive stylesheet that owns all foreground geometry while preserving the existing component appearance and JavaScript behavior. Desktop uses a centered three-track grid; tablet and phone use normal document flow. A real-browser regression test measures containment, sizing, aspect ratios, breakpoint continuity, model fit, and playlist-open geometry.

**Tech Stack:** HTML, CSS Grid, CSS container units, JavaScript modules, Node.js test runner, Playwright Chromium, GitHub Actions, GitHub Pages.

---

## File Map

- Create `site/files/responsive-layout.css`: sole responsive geometry authority for the desktop surface, main regions, folders, model/orbits, player, dock, and mobile flow.
- Modify `site/index.html`: load the responsive stylesheet and remove the explicit player-open intro transform and obsolete 861–879px patch.
- Create `tests/responsive-layout.browser.test.mjs`: local static server plus parameterized Chromium geometry regression checks.
- Modify `package.json`: add Playwright and separate browser-test script.
- Create `package-lock.json`: lock the browser-test dependency.
- Modify `.github/workflows/pages.yml`: install Chromium and run responsive checks before upload/deployment.
- Modify `tests/verify-site.ps1`: verify the responsive stylesheet is shipped and obsolete shift rule is absent.

### Task 1: Add a failing responsive browser regression

**Files:**
- Create: `tests/responsive-layout.browser.test.mjs`
- Modify: `package.json`
- Create: `package-lock.json`

- [ ] **Step 1: Add Playwright as a locked development dependency**

Run:

```powershell
npm install --save-dev --save-exact playwright@1.61.1
```

Expected: `package.json` contains `"playwright": "1.61.1"` and `package-lock.json` is created.

- [ ] **Step 2: Add the browser-test script**

Update `package.json` scripts to:

```json
{
  "scripts": {
    "test": "node --test --test-isolation=none tests/playlist-player.test.mjs",
    "test:responsive": "node --test --test-isolation=none tests/responsive-layout.browser.test.mjs"
  }
}
```

- [ ] **Step 3: Write the static server and browser launcher**

Create `tests/responsive-layout.browser.test.mjs` with:

```js
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const siteRoot = fileURLToPath(new URL("../site/", import.meta.url));
const mime = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".stl", "model/stl"],
  [".mp3", "audio/mpeg"]
]);

let server;
let browser;
let baseUrl;

const startServer = () => new Promise((resolve) => {
  server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
      const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
      const filePath = normalize(join(siteRoot, relative));
      if (!filePath.startsWith(normalize(siteRoot))) {
        response.writeHead(403).end();
        return;
      }
      const details = await stat(filePath);
      if (!details.isFile()) throw new Error("Not a file");
      const body = await readFile(filePath);
      response.writeHead(200, {
        "Content-Type": mime.get(extname(filePath)) || "application/octet-stream",
        "Cache-Control": "no-store"
      });
      response.end(body);
    } catch {
      response.writeHead(404).end("Not found");
    }
  });
  server.listen(0, "127.0.0.1", () => {
    const { port } = server.address();
    resolve(`http://127.0.0.1:${port}`);
  });
});

before(async () => {
  baseUrl = await startServer();
  browser = process.env.PLAYWRIGHT_CDP_URL
    ? await chromium.connectOverCDP(process.env.PLAYWRIGHT_CDP_URL)
    : await chromium.launch({
        headless: true,
        executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined
      });
});

after(async () => {
  await browser?.close();
  await new Promise((resolve) => server?.close(resolve));
});
```

- [ ] **Step 4: Add shared geometry helpers**

Append:

```js
const viewports = [
  { width: 375, height: 812 },
  { width: 480, height: 900 },
  { width: 768, height: 1024 },
  { width: 860, height: 1100 },
  { width: 861, height: 1100 },
  { width: 879, height: 1100 },
  { width: 880, height: 1100 },
  { width: 1023, height: 1200 },
  { width: 1024, height: 900 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 }
];

const rectFor = async (page, selector) => page.locator(selector).evaluate((element) => {
  const rect = element.getBoundingClientRect();
  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    left: rect.left,
    right: rect.right,
    top: rect.top,
    bottom: rect.bottom
  };
});

const stableSelectors = [
  ".intro-column",
  ".artifact-zone",
  ".folder-column",
  ".utility-dock",
  ".final-theme-picker"
];

const snapshotStableGeometry = async (page) => Object.fromEntries(
  await Promise.all(stableSelectors.map(async (selector) => [selector, await rectFor(page, selector)]))
);

const assertNearlyEqual = (actual, expected, message, tolerance = 1) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} vs ${expected}`);
};

const assertContained = (outer, inner, label) => {
  assert.ok(inner.left >= outer.left - 1, `${label} crosses left edge`);
  assert.ok(inner.right <= outer.right + 1, `${label} crosses right edge`);
  assert.ok(inner.top >= outer.top - 1, `${label} crosses top edge`);
  assert.ok(inner.bottom <= outer.bottom + 1, `${label} crosses bottom edge`);
};
```

- [ ] **Step 5: Add the responsive geometry test**

Append:

```js
test("foreground layout remains balanced and stable across responsive widths", async () => {
  const context = await browser.newContext({
    reducedMotion: "reduce",
    deviceScaleFactor: 1
  });
  const page = await context.newPage();

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.locator(".desktop-v2").waitFor();
    await page.locator(".stl-model-shell").waitFor();

    const metrics = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth
    }));
    assert.ok(
      metrics.scrollWidth <= metrics.clientWidth + 1,
      `${viewport.width}px creates horizontal overflow`
    );

    const desktop = await rectFor(page, ".desktop-v2");
    for (const selector of [
      ".intro-column",
      ".artifact-zone",
      ".folder-column",
      ".utility-dock",
      ".final-theme-picker",
      ".music-easter"
    ]) {
      assertContained(desktop, await rectFor(page, selector), `${selector} at ${viewport.width}px`);
    }

    const shell = await rectFor(page, ".stl-model-shell");
    const canvas = await rectFor(page, ".stl-model-shell canvas");
    const orbitA = await rectFor(page, ".orbit-a");
    const orbitB = await rectFor(page, ".orbit-b");
    assertNearlyEqual(shell.width, shell.height, `model shell square at ${viewport.width}px`);
    assertNearlyEqual(canvas.width, shell.width, `canvas width at ${viewport.width}px`);
    assertNearlyEqual(canvas.height, shell.height, `canvas height at ${viewport.width}px`);
    assertNearlyEqual(orbitA.width, orbitA.height, `outer orbit square at ${viewport.width}px`);
    assertNearlyEqual(orbitB.width, orbitB.height, `inner orbit square at ${viewport.width}px`);
    assert.ok(orbitA.width > shell.width, `outer orbit must frame model at ${viewport.width}px`);
    assert.ok(orbitB.width < orbitA.width, `inner orbit must differ at ${viewport.width}px`);

    const folders = await page.locator(".folder").evaluateAll((elements) => elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    }));
    for (const folder of folders) {
      assertNearlyEqual(folder.width / folder.height, 205 / 124, `folder ratio at ${viewport.width}px`, 0.02);
    }

    if (viewport.width >= 1024) {
      const intro = await rectFor(page, ".intro-column");
      assert.ok(intro.width <= 361, `intro rail is too wide at ${viewport.width}px`);
    }
    if (viewport.width >= 1440) {
      assert.ok(folders[0].width > 205, `folders did not grow at ${viewport.width}px`);
      assert.ok(shell.width >= 380, `model did not grow at ${viewport.width}px`);
      assert.ok(orbitA.width >= 480, `outer orbit did not grow at ${viewport.width}px`);
    }

    const before = await snapshotStableGeometry(page);
    await page.locator(".music-front").click();
    await page.locator(".music-easter.open").waitFor();
    await page.waitForTimeout(550);
    const afterOpen = await snapshotStableGeometry(page);
    for (const selector of stableSelectors) {
      for (const property of ["x", "y", "width", "height"]) {
        assertNearlyEqual(
          afterOpen[selector][property],
          before[selector][property],
          `${selector} ${property} shifted at ${viewport.width}px`,
          0.5
        );
      }
    }
  }

  await context.close();
});
```

- [ ] **Step 6: Run the browser test and verify RED**

Run with the local Chrome executable:

```powershell
$env:PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH='C:\Program Files\Google\Chrome\Application\chrome.exe'
npm run test:responsive
```

Expected: FAIL on the existing `1920px`/`2560px` intro-width assertion, existing fixed folder/model/orbit sizing, mobile overflow, and/or playlist-open geometry shift.

- [ ] **Step 7: Commit the failing regression**

```powershell
git add package.json package-lock.json tests/responsive-layout.browser.test.mjs
git commit -m "Test responsive portfolio geometry"
```

### Task 2: Add the desktop grid and scalable artifact stage

**Files:**
- Create: `site/files/responsive-layout.css`
- Modify: `site/index.html`
- Test: `tests/responsive-layout.browser.test.mjs`

- [ ] **Step 1: Load the responsive geometry authority**

Add to the `site/index.html` head after the existing inline style:

```html
<link rel="stylesheet" href="/files/responsive-layout.css">
```

- [ ] **Step 2: Create the desktop grid**

Create `site/files/responsive-layout.css` with:

```css
#portfolio-consolidated .composition-wrap > .desktop-v2 {
  --layout-gutter: clamp(20px, 2vw, 40px);
  --layout-gap: clamp(18px, 2vw, 40px);
  --intro-track: clamp(280px, 20vw, 360px);
  --folder-track: clamp(250px, 18vw, 360px);
  container-type: inline-size;
  display: grid;
  grid-template-columns: var(--intro-track) minmax(0, 1fr) var(--folder-track);
  grid-template-areas: "intro artifact folders";
  gap: var(--layout-gap);
  align-items: stretch;
  min-height: max(780px, calc(100dvh - 16px));
  padding:
    58px
    max(var(--layout-gutter), calc((100vw - 2200px) / 2 + var(--layout-gutter)))
    126px;
}

#portfolio-consolidated .composition-wrap > .desktop-v2 > .intro-column {
  grid-area: intro;
  position: relative;
  inset: auto;
  width: 100%;
  max-width: 360px;
  transform: none;
  gap: clamp(16px, 2dvh, 26px);
}

#portfolio-consolidated .composition-wrap > .desktop-v2 > .artifact-zone {
  grid-area: artifact;
  position: relative;
  inset: auto;
  width: 100%;
  min-width: 0;
}

#portfolio-consolidated .composition-wrap > .desktop-v2 > .folder-column {
  grid-area: folders;
  position: relative;
  inset: auto;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  transform: none;
}

#portfolio-consolidated .composition-wrap > .desktop-v2 .folder {
  width: min(100%, calc((100dvh - 210px) * .41));
  height: auto;
  aspect-ratio: 205 / 124;
}

#portfolio-consolidated .composition-wrap > .desktop-v2 .stl-model-shell {
  width: clamp(280px, min(27cqw, 46dvh), 540px);
  height: auto;
  aspect-ratio: 1;
}

#portfolio-consolidated .composition-wrap > .desktop-v2 .orbit-a {
  width: clamp(340px, min(34cqw, 58dvh), 680px);
  height: auto;
  aspect-ratio: 1;
}

#portfolio-consolidated .composition-wrap > .desktop-v2 .orbit-b {
  width: clamp(300px, min(30cqw, 51dvh), 600px);
  height: auto;
  aspect-ratio: 1;
}
```

- [ ] **Step 3: Remove player-driven sibling movement**

Delete these rules from `site/index.html`:

```css
@media (min-width: 861px) {
  #portfolio-consolidated .desktop-v2.music-player-open .intro-column {
    transform: translateY(-26px);
  }
}

@media (min-width: 861px) and (max-width: 879px) {
  #portfolio-consolidated .music-easter {
    bottom: 78px;
  }
}
```

- [ ] **Step 4: Run the responsive test**

Run:

```powershell
$env:PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH='C:\Program Files\Google\Chrome\Application\chrome.exe'
npm run test:responsive
```

Expected: wide-desktop sizing and playlist zero-shift assertions pass; tablet/mobile assertions may remain red until Task 3.

- [ ] **Step 5: Commit desktop geometry**

```powershell
git add site/index.html site/files/responsive-layout.css
git commit -m "Rebalance desktop portfolio layout"
```

### Task 3: Replace tablet and phone absolute positioning with normal flow

**Files:**
- Modify: `site/files/responsive-layout.css`
- Test: `tests/responsive-layout.browser.test.mjs`

- [ ] **Step 1: Add tablet flow**

Append:

```css
@media (max-width: 1023px) {
  #portfolio-consolidated .composition-wrap > .desktop-v2 {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: clamp(36px, 6vw, 56px);
    min-height: max(720px, calc(100dvh - 16px));
    padding: 58px clamp(16px, 4vw, 32px) 170px;
  }

  #portfolio-consolidated .composition-wrap > .desktop-v2 > .intro-column {
    width: min(100%, 360px);
    max-width: 360px;
    flex: 0 0 auto;
  }

  #portfolio-consolidated .composition-wrap > .desktop-v2 > .artifact-zone {
    width: 100%;
    height: clamp(420px, 60cqw, 560px);
    flex: 0 0 auto;
  }

  #portfolio-consolidated .composition-wrap > .desktop-v2 > .folder-column {
    width: min(100%, 520px);
    height: auto;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 30px 24px;
    flex: 0 0 auto;
  }

  #portfolio-consolidated .composition-wrap > .desktop-v2 .folder {
    width: 100%;
  }

  #portfolio-consolidated .composition-wrap > .desktop-v2 .stl-model-shell {
    width: clamp(320px, min(52cqw, 50dvh), 460px);
  }

  #portfolio-consolidated .composition-wrap > .desktop-v2 .orbit-a {
    width: clamp(380px, min(64cqw, 64dvh), 560px);
  }

  #portfolio-consolidated .composition-wrap > .desktop-v2 .orbit-b {
    width: clamp(320px, min(54cqw, 54dvh), 480px);
  }

  #portfolio-consolidated .composition-wrap > .desktop-v2 > .music-easter {
    left: clamp(16px, 4vw, 32px);
    bottom: 70px;
  }

  #portfolio-consolidated .composition-wrap > .desktop-v2 > .final-theme-picker {
    right: clamp(16px, 4vw, 32px);
    bottom: 70px;
  }
}
```

- [ ] **Step 2: Add narrow-phone flow**

Append:

```css
@media (max-width: 479px) {
  #portfolio-consolidated .composition-wrap > .desktop-v2 {
    gap: 34px;
    padding: 58px 16px 170px;
  }

  #portfolio-consolidated .composition-wrap > .desktop-v2 > .intro-column {
    width: 100%;
    max-width: none;
  }

  #portfolio-consolidated .composition-wrap > .desktop-v2 > .artifact-zone {
    height: 360px;
  }

  #portfolio-consolidated .composition-wrap > .desktop-v2 > .folder-column {
    width: 100%;
    grid-template-columns: 1fr;
    gap: 28px;
  }

  #portfolio-consolidated .composition-wrap > .desktop-v2 .stl-model-shell {
    width: clamp(240px, min(70cqw, 42dvh), 290px);
  }

  #portfolio-consolidated .composition-wrap > .desktop-v2 .orbit-a {
    width: min(calc(100cqw - 48px), 340px);
  }

  #portfolio-consolidated .composition-wrap > .desktop-v2 .orbit-b {
    width: min(calc(100cqw - 88px), 290px);
  }

  #portfolio-consolidated .composition-wrap > .desktop-v2 > .music-easter.open {
    width: min(calc(100cqw - 32px), 360px);
  }
}
```

- [ ] **Step 3: Run responsive tests and verify GREEN**

Run:

```powershell
$env:PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH='C:\Program Files\Google\Chrome\Application\chrome.exe'
npm run test:responsive
```

Expected: PASS across all listed widths, including 860/861 and 879/880.

- [ ] **Step 4: Commit flow layouts**

```powershell
git add site/files/responsive-layout.css tests/responsive-layout.browser.test.mjs
git commit -m "Fix tablet and mobile portfolio flow"
```

### Task 4: Harden static verification and deployment

**Files:**
- Modify: `tests/verify-site.ps1`
- Modify: `.github/workflows/pages.yml`

- [ ] **Step 1: Add failing static checks**

Add to `tests/verify-site.ps1` before its final PASS output:

```powershell
$responsivePath = Join-Path $siteRoot 'files\responsive-layout.css'
Assert-True (Test-Path -LiteralPath $responsivePath) 'responsive layout stylesheet is missing'

$responsiveCss = Get-Content -LiteralPath $responsivePath -Raw
Assert-Match $indexHtml '/files/responsive-layout\.css' 'responsive layout stylesheet is not linked'
Assert-Match $responsiveCss 'grid-template-areas:\s*"intro artifact folders"' 'desktop grid authority is missing'
Assert-Match $responsiveCss '@media \(max-width:\s*1023px\)' 'tablet flow breakpoint is missing'
Assert-Match $responsiveCss '@media \(max-width:\s*479px\)' 'phone flow breakpoint is missing'
Assert-NotMatch $indexHtml 'music-player-open \.intro-column\s*\{[^}]*translateY' 'playlist still moves the intro column'
```

Run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tests\verify-site.ps1
```

Expected before adding or completing the stylesheet: FAIL on a missing responsive contract.

- [ ] **Step 2: Install locked dependencies in Pages**

In `.github/workflows/pages.yml`, after `Set up Node.js`, add:

```yaml
      - name: Install dependencies
        run: npm ci
```

- [ ] **Step 3: Add Chromium installation and responsive test to Pages**

After the new dependency-install step, add:

```yaml
      - name: Install Chromium for responsive checks
        run: npx playwright install --with-deps chromium

      - name: Run responsive layout tests
        run: npm run test:responsive
```

Keep the existing playlist and static verification steps before artifact upload.

- [ ] **Step 4: Run the complete local suite**

Run:

```powershell
node --test --test-isolation=none tests\playlist-player.test.mjs
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tests\verify-site.ps1
$env:PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH='C:\Program Files\Google\Chrome\Application\chrome.exe'
npm run test:responsive
git diff --check
```

Expected:

- playlist: `9` passed, `0` failed;
- static verifier: `PASS`;
- responsive browser test: passed;
- `git diff --check`: no output.

- [ ] **Step 5: Commit verification and deployment changes**

```powershell
git add tests/verify-site.ps1 .github/workflows/pages.yml
git commit -m "Verify responsive layout before Pages deploy"
```

### Task 5: Visual QA, integration, and production verification

**Files:**
- Modify only if a verified defect is found: `site/files/responsive-layout.css`

- [ ] **Step 1: Capture representative screenshots**

Use Chromium at:

```text
375×812
768×1024
1024×900
1440×900
1920×1080
2560×1440
```

Capture light-theme closed player, light-theme open player, and dark-theme desktop examples.

- [ ] **Step 2: Inspect each screenshot**

Confirm:

- left card chrome is proportional to its content;
- folders are readable, larger on desktop, and preserve slants;
- model and both orbit circles dominate the central stage without clipping;
- ASCII creatures remain behind foreground content;
- player, dock, and theme control do not overlap;
- no foreground region shifts when opening the player.

- [ ] **Step 3: Fix only evidence-backed visual defects**

For each defect:

1. add or tighten the browser assertion;
2. run it and observe the failure;
3. make one CSS change;
4. rerun the responsive and existing suites.

- [ ] **Step 4: Perform final verification**

Run:

```powershell
npm test
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tests\verify-site.ps1
$env:PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH='C:\Program Files\Google\Chrome\Application\chrome.exe'
npm run test:responsive
git status --short --branch
```

Expected: all suites pass and the worktree contains only intentional responsive-layout changes.

- [ ] **Step 5: Commit any QA adjustment**

```powershell
git add site/files/responsive-layout.css tests/responsive-layout.browser.test.mjs
git commit -m "Polish responsive portfolio proportions"
```

- [ ] **Step 6: Push and verify GitHub Pages**

```powershell
git push origin main
```

Wait for the `Deploy portfolio to GitHub Pages` workflow, then verify:

- the run conclusion is `success`;
- `https://diethyletherene.github.io/` serves the new stylesheet;
- public browser geometry checks pass against the deployed URL;
- `main` and `origin/main` resolve to the same commit.
