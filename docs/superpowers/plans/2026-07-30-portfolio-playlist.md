# Portfolio Easter-Egg Playlist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the portfolio easter egg's placeholder display with a functional, accessible two-track player for `Track 01` and `Track 02`, credited to Ether.

**Architecture:** Keep the flip-card markup and visual language in `site/index.html`, but move playback state and browser `Audio` behavior into a dependency-free ES module. The module receives the player root, track records, an optional injected audio object for tests, and a callback that preserves the existing open/close layout animation.

**Tech Stack:** Static HTML/CSS, browser ES modules, HTMLMediaElement/Audio API, Node.js 24 built-in test runner, PowerShell structural verification, GitHub Actions and GitHub Pages.

---

## File map

- Create `package.json`: mark `.js` files as ES modules and expose the dependency-free test command.
- Create `tests/playlist-player.test.mjs`: test pure helpers and the playlist controller with fake DOM/audio objects.
- Create `site/files/playlist-player.js`: own playlist state, Audio events, track switching, time/progress rendering, error handling, and accessible control labels.
- Create `site/files/audio/track-01.mp3`: deploy the supplied `Website/Songs/Track_01.mp3`.
- Create `site/files/audio/track-02.mp3`: deploy the supplied `Website/Songs/Track_02.mp3`.
- Modify `site/index.html:134-158`: replace placeholder player metadata and controls with the real two-track interface.
- Modify `site/index.html:537-706`: adapt the existing player CSS for live metadata, four compact control columns, and real progress.
- Modify `site/index.html:1470-1484`: replace fake playback toggling with module initialization.
- Modify `tests/verify-site.ps1`: require the module, both MP3 files, and their production references.
- Modify `.github/workflows/pages.yml`: run playlist unit tests before the existing structural check and deployment.

### Task 1: Build and test the playlist controller

**Files:**
- Create: `package.json`
- Create: `tests/playlist-player.test.mjs`
- Create: `site/files/playlist-player.js`

- [ ] **Step 1: Add the ES-module test harness**

Create `package.json`:

```json
{
  "name": "asteria-portfolio",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test tests/playlist-player.test.mjs"
  }
}
```

Create `tests/playlist-player.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";

import {
  createPlaylistPlayer,
  formatTime,
  wrapTrackIndex,
} from "../site/files/playlist-player.js";

const tracks = [
  { title: "Track 01", artist: "Ether", src: "/files/audio/track-01.mp3" },
  { title: "Track 02", artist: "Ether", src: "/files/audio/track-02.mp3" },
];

const flush = () => new Promise((resolve) => setImmediate(resolve));

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  add(name) {
    this.values.add(name);
  }

  remove(name) {
    this.values.delete(name);
  }

  contains(name) {
    return this.values.has(name);
  }

  toggle(name, force) {
    if (force === undefined) {
      force = !this.values.has(name);
    }
    if (force) {
      this.values.add(name);
    } else {
      this.values.delete(name);
    }
    return force;
  }
}

class FakeElement {
  constructor() {
    this.attributes = new Map();
    this.classList = new FakeClassList();
    this.listeners = new Map();
    this.style = {};
    this.textContent = "";
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name);
  }

  async click() {
    for (const listener of this.listeners.get("click") ?? []) {
      await listener({ preventDefault() {} });
    }
  }
}

class FakeAudio {
  constructor() {
    this.currentTime = 0;
    this.duration = Number.NaN;
    this.listeners = new Map();
    this.loadCalls = 0;
    this.pauseCalls = 0;
    this.paused = true;
    this.playCalls = 0;
    this.preload = "";
    this.rejectNextPlay = false;
    this.src = "";
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  async emit(type) {
    for (const listener of this.listeners.get(type) ?? []) {
      await listener({ target: this, type });
    }
  }

  load() {
    this.loadCalls += 1;
  }

  pause() {
    this.pauseCalls += 1;
    this.paused = true;
  }

  async play() {
    this.playCalls += 1;
    if (this.rejectNextPlay) {
      this.rejectNextPlay = false;
      throw new Error("Playback rejected");
    }
    this.paused = false;
  }
}

function createFixture() {
  const selectors = [
    ".music-front",
    ".music-close",
    ".music-eyebrow",
    ".music-track-position",
    ".music-track-title",
    ".music-track-artist",
    ".track-progress i",
    ".track-time",
    ".track-prev",
    ".play-toggle",
    ".track-next",
  ];
  const elements = Object.fromEntries(
    selectors.map((selector) => [selector, new FakeElement()]),
  );
  const root = new FakeElement();
  root.querySelector = (selector) => elements[selector] ?? null;
  return {
    audio: new FakeAudio(),
    close: elements[".music-close"],
    eyebrow: elements[".music-eyebrow"],
    front: elements[".music-front"],
    next: elements[".track-next"],
    play: elements[".play-toggle"],
    position: elements[".music-track-position"],
    previous: elements[".track-prev"],
    progress: elements[".track-progress i"],
    root,
    time: elements[".track-time"],
    title: elements[".music-track-title"],
  };
}

test("wrapTrackIndex and formatTime handle playlist boundaries", () => {
  assert.equal(wrapTrackIndex(-1, 2), 1);
  assert.equal(wrapTrackIndex(2, 2), 0);
  assert.equal(formatTime(65.9), "01:05");
  assert.equal(formatTime(Number.NaN), "00:00");
  assert.equal(formatTime(-4), "00:00");
});

test("opening renders Track 01 without autoplay", async () => {
  const fixture = createFixture();
  const openChanges = [];
  createPlaylistPlayer({
    root: fixture.root,
    tracks,
    audio: fixture.audio,
    onOpenChange: (open) => openChanges.push(open),
  });

  await fixture.front.click();

  assert.deepEqual(openChanges, [true]);
  assert.equal(fixture.audio.playCalls, 0);
  assert.equal(fixture.audio.preload, "metadata");
  assert.equal(fixture.position.textContent, "01 / 02");
  assert.equal(fixture.title.textContent, "Track 01");
  assert.equal(fixture.audio.src, "/files/audio/track-01.mp3");
});

test("metadata and time events drive the real progress display", async () => {
  const fixture = createFixture();
  createPlaylistPlayer({ root: fixture.root, tracks, audio: fixture.audio });
  fixture.audio.duration = 100;
  fixture.audio.currentTime = 25;

  await fixture.audio.emit("loadedmetadata");
  await fixture.audio.emit("timeupdate");

  assert.equal(fixture.time.textContent, "00:25 / 01:40");
  assert.equal(fixture.progress.style.width, "25%");
});

test("play, close, and reopen preserve the selected time while paused", async () => {
  const fixture = createFixture();
  const openChanges = [];
  const player = createPlaylistPlayer({
    root: fixture.root,
    tracks,
    audio: fixture.audio,
    onOpenChange: (open) => openChanges.push(open),
  });

  await fixture.play.click();
  await flush();
  fixture.audio.currentTime = 42;
  await fixture.close.click();

  assert.equal(player.getState().playing, false);
  assert.equal(fixture.audio.currentTime, 42);
  assert.equal(fixture.play.getAttribute("aria-label"), "Play Track 01 by Ether");
  assert.deepEqual(openChanges, [false]);

  await fixture.front.click();
  assert.deepEqual(openChanges, [false, true]);
  assert.equal(fixture.audio.playCalls, 1);
});

test("previous and next wrap while preserving paused or playing state", async () => {
  const fixture = createFixture();
  const player = createPlaylistPlayer({
    root: fixture.root,
    tracks,
    audio: fixture.audio,
  });

  await fixture.next.click();
  await flush();
  assert.equal(fixture.title.textContent, "Track 02");
  assert.equal(fixture.audio.playCalls, 0);

  await fixture.next.click();
  await flush();
  assert.equal(fixture.title.textContent, "Track 01");

  await fixture.play.click();
  await flush();
  await fixture.previous.click();
  await flush();

  assert.equal(fixture.title.textContent, "Track 02");
  assert.equal(fixture.audio.playCalls, 2);
  assert.equal(player.getState().playing, true);
});

test("ended advances automatically and wraps Track 02 to Track 01", async () => {
  const fixture = createFixture();
  createPlaylistPlayer({ root: fixture.root, tracks, audio: fixture.audio });

  await fixture.play.click();
  await flush();
  await fixture.audio.emit("ended");
  await flush();
  assert.equal(fixture.title.textContent, "Track 02");

  await fixture.audio.emit("ended");
  await flush();
  assert.equal(fixture.title.textContent, "Track 01");
  assert.equal(fixture.audio.playCalls, 3);
});

test("playback failure pauses safely and exposes the signal-lost state", async () => {
  const fixture = createFixture();
  const player = createPlaylistPlayer({
    root: fixture.root,
    tracks,
    audio: fixture.audio,
  });
  fixture.audio.rejectNextPlay = true;

  await fixture.play.click();
  await flush();

  assert.equal(player.getState().playing, false);
  assert.equal(fixture.eyebrow.textContent, "SIGNAL LOST / SELECT ANOTHER");
  assert.equal(fixture.root.classList.contains("has-error"), true);
  assert.equal(fixture.play.getAttribute("aria-label"), "Play Track 01 by Ether");

  await fixture.audio.emit("error");
  assert.equal(fixture.next.getAttribute("aria-label"), "Next track: Track 02 by Ether");
});
```

- [ ] **Step 2: Run the tests and verify the module is missing**

Run:

```powershell
node --test tests/playlist-player.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `site/files/playlist-player.js`.

- [ ] **Step 3: Implement the dependency-free playlist module**

Create `site/files/playlist-player.js`:

```js
const NORMAL_EYEBROW = "NOW.PLAYING / HIDDEN SIGNAL";
const ERROR_EYEBROW = "SIGNAL LOST / SELECT ANOTHER";

export function wrapTrackIndex(index, length) {
  if (!Number.isInteger(length) || length < 1) {
    throw new RangeError("Playlist length must be a positive integer.");
  }
  return ((index % length) + length) % length;
}

export function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "00:00";
  }
  const totalSeconds = Math.floor(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const remainder = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function requireElement(root, selector) {
  const element = root.querySelector(selector);
  if (!element) {
    throw new Error(`Playlist player is missing ${selector}.`);
  }
  return element;
}

export function createPlaylistPlayer({
  root,
  tracks,
  audio,
  onOpenChange = () => {},
}) {
  if (!root || typeof root.querySelector !== "function") {
    throw new TypeError("Playlist player requires a root element.");
  }
  if (!Array.isArray(tracks) || tracks.length === 0) {
    throw new TypeError("Playlist player requires at least one track.");
  }

  const media =
    audio ?? root.querySelector(".playlist-audio") ?? new Audio();
  const ui = {
    artist: requireElement(root, ".music-track-artist"),
    close: requireElement(root, ".music-close"),
    eyebrow: requireElement(root, ".music-eyebrow"),
    front: requireElement(root, ".music-front"),
    next: requireElement(root, ".track-next"),
    play: requireElement(root, ".play-toggle"),
    position: requireElement(root, ".music-track-position"),
    previous: requireElement(root, ".track-prev"),
    progress: requireElement(root, ".track-progress i"),
    time: requireElement(root, ".track-time"),
    title: requireElement(root, ".music-track-title"),
  };

  let currentIndex = 0;
  let playing = false;

  media.preload = "metadata";

  const currentTrack = () => tracks[currentIndex];

  function renderPlaybackState() {
    const track = currentTrack();
    root.classList.toggle("playing", playing);
    ui.play.textContent = playing ? "\u275A\u275A" : "\u25B6";
    ui.play.setAttribute(
      "aria-label",
      `${playing ? "Pause" : "Play"} ${track.title} by ${track.artist}`,
    );
  }

  function renderTime() {
    const currentTime = Number.isFinite(media.currentTime) ? media.currentTime : 0;
    const duration =
      Number.isFinite(media.duration) && media.duration > 0 ? media.duration : 0;
    const percentage =
      duration > 0
        ? Math.min(100, Math.max(0, (currentTime / duration) * 100))
        : 0;

    ui.time.textContent = `${formatTime(currentTime)} / ${formatTime(duration)}`;
    ui.progress.style.width = `${percentage}%`;
  }

  function renderTrack() {
    const track = currentTrack();
    const previous = tracks[wrapTrackIndex(currentIndex - 1, tracks.length)];
    const next = tracks[wrapTrackIndex(currentIndex + 1, tracks.length)];

    root.classList.remove("has-error");
    ui.eyebrow.textContent = NORMAL_EYEBROW;
    ui.position.textContent =
      `${String(currentIndex + 1).padStart(2, "0")} / ` +
      String(tracks.length).padStart(2, "0");
    ui.title.textContent = track.title;
    ui.artist.textContent = track.artist;
    ui.previous.setAttribute(
      "aria-label",
      `Previous track: ${previous.title} by ${previous.artist}`,
    );
    ui.next.setAttribute(
      "aria-label",
      `Next track: ${next.title} by ${next.artist}`,
    );

    media.src = track.src;
    media.currentTime = 0;
    if (typeof media.load === "function") {
      media.load();
    }
    renderTime();
    renderPlaybackState();
  }

  function failSafely() {
    playing = false;
    media.pause();
    root.classList.add("has-error");
    ui.eyebrow.textContent = ERROR_EYEBROW;
    renderPlaybackState();
  }

  async function play() {
    root.classList.remove("has-error");
    ui.eyebrow.textContent = NORMAL_EYEBROW;
    try {
      await media.play();
      playing = true;
      renderPlaybackState();
      return true;
    } catch {
      failSafely();
      return false;
    }
  }

  function pause() {
    media.pause();
    playing = false;
    renderPlaybackState();
  }

  async function selectTrack(index, { shouldPlay = playing } = {}) {
    media.pause();
    playing = false;
    currentIndex = wrapTrackIndex(index, tracks.length);
    renderTrack();
    if (shouldPlay) {
      return play();
    }
    return true;
  }

  ui.front.addEventListener("click", () => {
    onOpenChange(true);
  });
  ui.close.addEventListener("click", () => {
    pause();
    onOpenChange(false);
  });
  ui.play.addEventListener("click", () => {
    if (playing) {
      pause();
      return;
    }
    void play();
  });
  ui.previous.addEventListener("click", () => {
    void selectTrack(currentIndex - 1);
  });
  ui.next.addEventListener("click", () => {
    void selectTrack(currentIndex + 1);
  });

  media.addEventListener("loadedmetadata", renderTime);
  media.addEventListener("durationchange", renderTime);
  media.addEventListener("timeupdate", renderTime);
  media.addEventListener("ended", () => {
    void selectTrack(currentIndex + 1, { shouldPlay: true });
  });
  media.addEventListener("error", failSafely);

  renderTrack();

  return Object.freeze({
    getState: () => ({ currentIndex, playing }),
    pause,
    play,
    selectTrack,
  });
}
```

- [ ] **Step 4: Run the controller tests and verify they pass**

Run:

```powershell
node --test tests/playlist-player.test.mjs
```

Expected: PASS with 7 tests and 0 failures.

- [ ] **Step 5: Commit the tested controller**

```powershell
git add package.json tests/playlist-player.test.mjs site/files/playlist-player.js
git commit -m "Add tested portfolio playlist controller"
```

Expected: one commit containing only the module and its automated tests.

### Task 2: Integrate the real tracks and player interface

**Files:**
- Create: `site/files/audio/track-01.mp3`
- Create: `site/files/audio/track-02.mp3`
- Modify: `site/index.html:134-158`
- Modify: `site/index.html:537-706`
- Modify: `site/index.html:1470-1484`
- Modify: `tests/verify-site.ps1`

- [ ] **Step 1: Strengthen the production-shell test before adding assets**

Replace `tests/verify-site.ps1` with:

```powershell
$ErrorActionPreference = "Stop"

$siteRoot = [System.IO.Path]::GetFullPath(
  (Join-Path $PSScriptRoot "..\site")
)

function Assert-SiteCondition {
  param(
    [Parameter(Mandatory)]
    [bool] $Condition,

    [Parameter(Mandatory)]
    [string] $Message
  )

  if (-not $Condition) {
    throw $Message
  }
}

function Read-StrictUtf8 {
  param(
    [Parameter(Mandatory)]
    [string] $Path
  )

  $utf8 = [System.Text.UTF8Encoding]::new($false, $true)
  return $utf8.GetString([System.IO.File]::ReadAllBytes($Path))
}

$requiredFiles = @(
  "index.html",
  "files/desktop-composition-v2.html",
  "files/ascii-portrait-renderer.js",
  "files/ascii-portrait-data.js",
  "files/nautical-creature-data.js",
  "files/three.module.min.js",
  "files/three.core.min.js",
  "files/STLLoader.js",
  "files/asu-desk-tidy.stl",
  "files/playlist-player.js",
  "files/audio/track-01.mp3",
  "files/audio/track-02.mp3"
)

foreach ($relativePath in $requiredFiles) {
  $fullPath = Join-Path $siteRoot $relativePath
  Assert-SiteCondition (Test-Path -LiteralPath $fullPath -PathType Leaf) "Missing site asset: $relativePath"
}

$index = Read-StrictUtf8 (Join-Path $siteRoot "index.html")
$composition = Read-StrictUtf8 (Join-Path $siteRoot "files/desktop-composition-v2.html")
$playlistModule = Read-StrictUtf8 (Join-Path $siteRoot "files/playlist-player.js")

Assert-SiteCondition ($index.StartsWith("<!doctype html>")) "index.html must start with an HTML5 doctype."
Assert-SiteCondition ($index.Contains('<meta charset="utf-8">')) "index.html must declare UTF-8 before rendering interface text."
Assert-SiteCondition ($index.Contains('<meta name="viewport" content="width=device-width, initial-scale=1">')) "index.html must include a mobile viewport."
$expectedTitle = "<title>Asteria $([char]0x2014) Portfolio</title>"
Assert-SiteCondition ($index.Contains($expectedTitle)) "index.html must include the public-facing page title."
Assert-SiteCondition (-not $composition.Contains("Homepage composition:")) "The public page must not render the internal prototype heading."
Assert-SiteCondition (-not $composition.Contains('<p class="subtitle">')) "The public page must not render prototype explanatory copy."

Assert-SiteCondition ($index.Contains('class="track-prev"')) "The player must expose a previous-track button."
Assert-SiteCondition ($index.Contains('class="track-next"')) "The player must expose a next-track button."
Assert-SiteCondition ($index.Contains('aria-live="polite"')) "The player must announce track changes politely."
Assert-SiteCondition ($index.Contains('preload="metadata"')) "The hidden audio element must preload metadata only."
Assert-SiteCondition ($index.Contains('await import("/files/playlist-player.js")')) "index.html must import the playlist controller."
Assert-SiteCondition ($index.Contains('/files/audio/track-01.mp3')) "index.html must reference Track 01."
Assert-SiteCondition ($index.Contains('/files/audio/track-02.mp3')) "index.html must reference Track 02."
Assert-SiteCondition ($index.Contains('artist: "Ether"')) "Both tracks must use the approved Ether credit."
Assert-SiteCondition ($playlistModule.Contains("export function createPlaylistPlayer")) "The playlist module must export its controller."
Assert-SiteCondition (-not $index.Contains("YOUR SONG")) "The placeholder track title must be removed."
Assert-SiteCondition (-not $index.Contains("03:24")) "The placeholder duration must be removed."
Assert-SiteCondition (-not $index.Contains("finalFakeProgress")) "The fake progress animation must be removed."

foreach ($relativePath in @("files/audio/track-01.mp3", "files/audio/track-02.mp3")) {
  $audioFile = Get-Item -LiteralPath (Join-Path $siteRoot $relativePath)
  Assert-SiteCondition ($audioFile.Length -gt 100000) "Audio asset is unexpectedly small: $relativePath"
  $bytes = [System.IO.File]::ReadAllBytes($audioFile.FullName)
  $header = [System.Text.Encoding]::ASCII.GetString($bytes, 0, 3)
  Assert-SiteCondition ($header -eq "ID3") "Audio asset must begin with an ID3 header: $relativePath"
}

Write-Host "PASS: portfolio site structure, playlist assets, and production shell verified."
```

- [ ] **Step 2: Run the structural test and confirm the real audio is absent**

Run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tests\verify-site.ps1
```

Expected: FAIL with `Missing site asset: files/audio/track-01.mp3`.

- [ ] **Step 3: Copy and normalize the two supplied MP3 assets**

Run:

```powershell
New-Item -ItemType Directory -Force -Path "site\files\audio"
Copy-Item -LiteralPath "D:\Internships\.Internship preparation\Website\Songs\Track_01.mp3" -Destination "site\files\audio\track-01.mp3"
Copy-Item -LiteralPath "D:\Internships\.Internship preparation\Website\Songs\Track_02.mp3" -Destination "site\files\audio\track-02.mp3"
Get-ChildItem -LiteralPath "site\files\audio" | Select-Object Name, Length
```

Expected sizes:

```text
track-01.mp3  2882504
track-02.mp3  3717871
```

- [ ] **Step 4: Replace the placeholder player markup**

In `site/index.html`, replace the `music.innerHTML` block at the current lines 136-157 with:

```js
    music.innerHTML = `
      <div class="music-inner">
        <button type="button" class="music-face music-front" aria-label="Reveal hidden playlist">
          <span class="mini-disc"><i></i></span>
          <span class="music-question mono">signal_?</span>
        </button>
        <section class="music-face music-back" aria-label="Hidden signal playlist">
          <button type="button" class="music-close" aria-label="Close player">&times;</button>
          <div class="album-chip"><span class="album-orbit"></span></div>
          <div class="track-data">
            <span class="music-eyebrow mono pink">NOW.PLAYING / HIDDEN SIGNAL</span>
            <div class="track-heading" aria-live="polite" aria-atomic="true">
              <span class="music-track-position mono">01 / 02</span>
              <strong>
                <span class="music-track-title">Track 01</span>
                &mdash;
                <span class="music-track-artist">Ether</span>
              </strong>
            </div>
            <div class="track-progress" aria-hidden="true"><i></i></div>
            <div class="track-controls">
              <button type="button" class="track-prev" aria-label="Previous track">&#x2190;</button>
              <button type="button" class="play-toggle" aria-label="Play Track 01 by Ether">&#x25B6;</button>
              <button type="button" class="track-next" aria-label="Next track">&#x2192;</button>
              <span class="track-time mono">00:00 / 00:00</span>
            </div>
          </div>
          <audio class="playlist-audio" preload="metadata" hidden></audio>
        </section>
      </div>
    `;
```

- [ ] **Step 5: Replace the fake-progress styles with live control styles**

In `site/index.html`, keep the existing `.music-easter` through `.album-orbit:after` rules, then replace the current `.track-data` through `.track-controls a` rules with:

```css
      #portfolio-consolidated .track-data {
        min-width: 0;
        display: flex;
        flex-direction: column;
        justify-content: center;
        gap: 4px;
      }
      #portfolio-consolidated .music-eyebrow {
        overflow: hidden;
        padding-right: 18px;
        font-size: 6px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      #portfolio-consolidated .track-heading {
        min-width: 0;
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        gap: 6px;
        align-items: baseline;
        padding-right: 18px;
      }
      #portfolio-consolidated .music-track-position {
        color: #687583;
        font-size: 6px;
        white-space: nowrap;
      }
      #portfolio-consolidated .track-heading strong {
        overflow: hidden;
        font-size: 9px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      #portfolio-consolidated .track-progress {
        height: 5px;
        overflow: hidden;
        border: 1px solid var(--ink);
      }
      #portfolio-consolidated .track-progress i {
        display: block;
        width: 0;
        height: 100%;
        background: var(--pink);
        transition: width 120ms linear;
      }
      #portfolio-consolidated .track-controls {
        display: grid;
        grid-template-columns: 22px 22px 22px minmax(0, 1fr);
        gap: 5px;
        align-items: center;
      }
      #portfolio-consolidated .track-controls button {
        width: 22px;
        height: 19px;
        padding: 0;
        border: 1px solid var(--ink);
        color: var(--ink);
        background: var(--mint);
        cursor: pointer;
        font-size: 8px;
        transition:
          transform 150ms cubic-bezier(.16,1,.3,1),
          background 150ms ease;
      }
      #portfolio-consolidated .track-controls button:hover {
        transform: translateY(-2px);
        background: var(--blue);
      }
      #portfolio-consolidated .track-controls button:active {
        transform: translateY(1px) scale(.94);
      }
      #portfolio-consolidated .track-time {
        justify-self: end;
        color: #687583;
        font-size: 6px;
        white-space: nowrap;
      }
      #portfolio-consolidated .music-front:focus-visible,
      #portfolio-consolidated .music-close:focus-visible,
      #portfolio-consolidated .track-controls button:focus-visible {
        outline: 2px solid var(--pink);
        outline-offset: 2px;
      }
      #portfolio-consolidated .music-easter.has-error .music-eyebrow {
        color: var(--pink);
      }
```

Delete the now-unused `@keyframes finalFakeProgress` rule. Add this dark-theme text rule immediately after the existing dark `.track-progress` rule:

```css
      #portfolio-consolidated .dark-theme .music-track-position,
      #portfolio-consolidated .dark-theme .track-time {
        color: #9fcbe0;
      }
```

- [ ] **Step 6: Initialize the real playlist after creating the flip card**

Replace the current fake player code at the bottom of `site/index.html` with:

```js
    const setMusicOpen = (open) => {
      music.classList.toggle("open", open);
      desktop.classList.toggle("music-player-open", open);
    };
    const { createPlaylistPlayer } = await import("/files/playlist-player.js");
    createPlaylistPlayer({
      root: music,
      onOpenChange: setMusicOpen,
      tracks: [
        {
          title: "Track 01",
          artist: "Ether",
          src: "/files/audio/track-01.mp3",
        },
        {
          title: "Track 02",
          artist: "Ether",
          src: "/files/audio/track-02.mp3",
        },
      ],
    });
```

- [ ] **Step 7: Run both test layers**

Run:

```powershell
node --test tests/playlist-player.test.mjs
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tests\verify-site.ps1
```

Expected:

```text
# pass 7
# fail 0
PASS: portfolio site structure, playlist assets, and production shell verified.
```

- [ ] **Step 8: Commit the integrated player and audio**

```powershell
git add site/index.html site/files/audio tests/verify-site.ps1
git commit -m "Integrate Ether playlist into portfolio"
```

Expected: one commit containing the two exact MP3 assets, player interface, initialization, and structural verification.

### Task 3: Gate GitHub Pages deployment on the playlist tests

**Files:**
- Modify: `.github/workflows/pages.yml`

- [ ] **Step 1: Add a pinned Node setup and playlist test**

Replace `.github/workflows/pages.yml` with:

```yaml
name: Deploy portfolio to GitHub Pages

on:
  push:
    branches:
      - main
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v6

      - name: Set up Node.js
        uses: actions/setup-node@v6
        with:
          node-version: 24
          package-manager-cache: false

      - name: Test playlist controller
        run: node --test tests/playlist-player.test.mjs

      - name: Verify static site
        shell: pwsh
        run: ./tests/verify-site.ps1

      - name: Configure Pages
        uses: actions/configure-pages@v5

      - name: Upload site
        uses: actions/upload-pages-artifact@v4
        with:
          path: site

      - name: Deploy
        id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 2: Re-run the exact CI checks locally**

Run:

```powershell
node --test tests/playlist-player.test.mjs
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tests\verify-site.ps1
git diff --check
```

Expected: 7 unit tests pass, the shell verification prints `PASS`, and `git diff --check` produces no output.

- [ ] **Step 3: Commit the deployment gate**

```powershell
git add .github/workflows/pages.yml
git commit -m "Test playlist before Pages deployment"
```

Expected: one workflow-only commit.

### Task 4: Browser-smoke, publish, and verify production

**Files:**
- Verify only; no planned source changes.

- [ ] **Step 1: Start the packaged site locally**

Run:

```powershell
$server = Start-Process -FilePath "python" -ArgumentList "-m","http.server","4173","--directory","site" -WindowStyle Hidden -PassThru
Invoke-WebRequest -Uri "http://127.0.0.1:4173/" -UseBasicParsing | Select-Object StatusCode
```

Expected: HTTP `200`.

- [ ] **Step 2: Run the interaction smoke test in a browser**

Open `http://127.0.0.1:4173/` and verify:

1. The `signal_?` tile opens with the existing flip animation and does not autoplay.
2. It initially shows `01 / 02`, `Track 01 — Ether`, and `00:00 / <duration>`.
3. Play starts Track 01; elapsed time and the pink progress bar move together.
4. Next changes to Track 02 and keeps playing; previous returns to Track 01.
5. After Track 02 ends, the player wraps to Track 01.
6. Closing pauses without resetting time; reopening preserves the same track and time.
7. Light and dark themes keep every label and outline readable.
8. Keyboard focus reaches open, close, previous, play/pause, and next controls with a visible pink focus ring.
9. The console contains no uncaught exceptions, and both MP3 requests return successfully.

- [ ] **Step 3: Stop the local server and confirm a clean tree**

Run:

```powershell
Stop-Process -Id $server.Id
git status --short
git log -4 --oneline
```

Expected: no uncommitted files, followed by the plan commit and three implementation commits after the approved design commit.

- [ ] **Step 4: Push the verified commits**

Run:

```powershell
$env:HTTP_PROXY = "http://127.0.0.1:65532"
$env:HTTPS_PROXY = "http://127.0.0.1:65532"
git -c http.sslBackend=openssl push origin main
```

Expected: `main` advances on `origin` without a non-fast-forward error.

- [ ] **Step 5: Watch the Pages workflow**

Run:

```powershell
$run = gh run list --workflow pages.yml --limit 1 --json databaseId,status,conclusion | ConvertFrom-Json | Select-Object -First 1
gh run watch $run.databaseId --exit-status
```

Expected: the unit test, structural verification, artifact upload, and deployment steps all complete successfully.

- [ ] **Step 6: Verify the public player and audio assets**

Run:

```powershell
$page = Invoke-WebRequest -Uri "https://diethyletherene.github.io/" -UseBasicParsing
$track01 = Invoke-WebRequest -Uri "https://diethyletherene.github.io/files/audio/track-01.mp3" -Method Head -UseBasicParsing
$track02 = Invoke-WebRequest -Uri "https://diethyletherene.github.io/files/audio/track-02.mp3" -Method Head -UseBasicParsing

if ($page.StatusCode -ne 200) { throw "Public portfolio did not return 200." }
if (-not $page.Content.Contains("Track 01")) { throw "Public HTML is missing Track 01." }
if (-not $page.Content.Contains("Track 02")) { throw "Public HTML is missing Track 02." }
if ($track01.StatusCode -ne 200) { throw "Track 01 did not return 200." }
if ($track02.StatusCode -ne 200) { throw "Track 02 did not return 200." }

Write-Host "PASS: public playlist and both Ether tracks are live."
```

Expected:

```text
PASS: public playlist and both Ether tracks are live.
```
