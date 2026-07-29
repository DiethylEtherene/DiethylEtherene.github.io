import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  createPlaylistPlayer,
  formatTime,
  wrapTrackIndex,
} from "../site/files/playlist-player.js";

const tracks = [
  { title: "Track 01", artist: "Ether", src: "/files/audio/track-01.mp3" },
  { title: "Track 02", artist: "Ether", src: "/files/audio/track-02.mp3" },
];

class FakeClassList {
  #classes = new Set();

  add(...classes) { classes.forEach((item) => this.#classes.add(item)); }
  remove(...classes) { classes.forEach((item) => this.#classes.delete(item)); }
  contains(item) { return this.#classes.has(item); }
}

class FakeElement {
  constructor() {
    this.classList = new FakeClassList();
    this.listeners = new Map();
    this.attributes = new Map();
    this.style = {};
    this.textContent = "";
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  async emit(type) {
    for (const listener of this.listeners.get(type) ?? []) await listener({ type, currentTarget: this });
  }

  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
}

class FakeAudio extends FakeElement {
  constructor() {
    super();
    this.src = "";
    this.preload = "";
    this.duration = Number.NaN;
    this.currentTime = 0;
    this.paused = true;
    this.playCalls = 0;
    this.pauseCalls = 0;
    this.rejectNextPlay = false;
  }

  play() {
    this.playCalls += 1;
    if (this.rejectNextPlay) {
      this.rejectNextPlay = false;
      return Promise.reject(new Error("blocked"));
    }
    this.paused = false;
    return Promise.resolve();
  }

  pause() {
    this.pauseCalls += 1;
    this.paused = true;
  }
}

function makeFixture() {
  const root = new FakeElement();
  const elements = {
    ".music-front": new FakeElement(),
    ".music-close": new FakeElement(),
    ".music-eyebrow": new FakeElement(),
    ".music-track-position": new FakeElement(),
    ".music-track-title": new FakeElement(),
    ".music-track-artist": new FakeElement(),
    ".track-progress i": new FakeElement(),
    ".track-time": new FakeElement(),
    ".track-prev": new FakeElement(),
    ".play-toggle": new FakeElement(),
    ".track-next": new FakeElement(),
  };
  root.querySelector = (selector) => elements[selector] ?? null;
  return { root, elements, audio: new FakeAudio() };
}

test("wraps indexes, formats safe clock values, and keeps icon source escaped", async () => {
  assert.equal(wrapTrackIndex(-1, 2), 1);
  assert.equal(wrapTrackIndex(2, 2), 0);
  assert.equal(formatTime(65.9), "01:05");
  assert.equal(formatTime(Number.NaN), "00:00");
  assert.equal(formatTime(-1), "00:00");
  const source = await readFile(new URL("../site/files/playlist-player.js", import.meta.url), "utf8");
  assert.equal(source.includes('"\\u275A\\u275A"'), true);
  assert.equal(source.includes('"\\u25B6"'), true);
});

test("opening loads the first track without autoplay", async () => {
  const { root, elements, audio } = makeFixture();
  const openChanges = [];
  createPlaylistPlayer({ root, tracks, audio, onOpenChange: (open) => openChanges.push(open) });

  await elements[".music-front"].emit("click");

  assert.deepEqual(openChanges, [true]);
  assert.equal(elements[".music-track-position"].textContent, "01 / 02");
  assert.equal(elements[".music-track-title"].textContent, "Track 01");
  assert.equal(audio.src, "/files/audio/track-01.mp3");
  assert.equal(audio.preload, "metadata");
  assert.equal(audio.playCalls, 0);
});

test("media timing renders duration and progress", async () => {
  const { root, elements, audio } = makeFixture();
  createPlaylistPlayer({ root, tracks, audio });
  await elements[".music-front"].emit("click");
  audio.duration = 100;
  audio.currentTime = 25;
  await audio.emit("loadedmetadata");
  await audio.emit("timeupdate");

  assert.equal(elements[".track-time"].textContent, "00:25 / 01:40");
  assert.equal(elements[".track-progress i"].style.width, "25%");
});

test("closing pauses and reopening remains paused", async () => {
  const { root, elements, audio } = makeFixture();
  const openChanges = [];
  createPlaylistPlayer({ root, tracks, audio, onOpenChange: (open) => openChanges.push(open) });
  await elements[".music-front"].emit("click");
  await elements[".play-toggle"].emit("click");
  audio.currentTime = 37;
  await elements[".music-close"].emit("click");
  await elements[".music-front"].emit("click");

  assert.equal(audio.currentTime, 37);
  assert.equal(audio.src, tracks[0].src);
  assert.equal(audio.paused, true);
  assert.deepEqual(openChanges, [true, false, true]);
  assert.equal(audio.playCalls, 1);
  assert.equal(elements[".play-toggle"].getAttribute("aria-label"), "Play Track 01");
});

test("previous and next wrap and retain the existing playing state", async () => {
  const { root, elements, audio } = makeFixture();
  createPlaylistPlayer({ root, tracks, audio });
  await elements[".music-front"].emit("click");
  await elements[".track-prev"].emit("click");
  assert.equal(elements[".music-track-title"].textContent, "Track 02");
  assert.equal(audio.playCalls, 0);
  assert.equal(elements[".track-next"].getAttribute("aria-label"), "Next: Track 01");
  await elements[".play-toggle"].emit("click");
  await elements[".track-next"].emit("click");
  assert.equal(elements[".music-track-title"].textContent, "Track 01");
  assert.equal(audio.paused, false);
  assert.equal(audio.playCalls, 2);
});

test("ended auto-advances continuously and plays the selected track", async () => {
  const { root, elements, audio } = makeFixture();
  createPlaylistPlayer({ root, tracks, audio });
  await elements[".music-front"].emit("click");
  await audio.emit("ended");
  assert.equal(elements[".music-track-title"].textContent, "Track 02");
  assert.equal(audio.playCalls, 1);
  await audio.emit("ended");
  assert.equal(elements[".music-track-title"].textContent, "Track 01");
  assert.equal(audio.playCalls, 2);
});

test("play rejection and media errors surface recovery state without disabling navigation", async () => {
  const { root, elements, audio } = makeFixture();
  createPlaylistPlayer({ root, tracks, audio });
  await elements[".music-front"].emit("click");
  audio.rejectNextPlay = true;
  await elements[".play-toggle"].emit("click");

  assert.equal(audio.paused, true);
  assert.equal(root.classList.contains("has-error"), true);
  assert.equal(elements[".music-eyebrow"].textContent, "SIGNAL LOST / SELECT ANOTHER");
  assert.equal(elements[".play-toggle"].getAttribute("aria-label"), "Play Track 01");
  assert.equal(elements[".track-next"].getAttribute("aria-label"), "Next: Track 02");
  await audio.emit("error");
  assert.equal(audio.paused, true);
  assert.equal(root.classList.contains("has-error"), true);
  assert.equal(elements[".music-eyebrow"].textContent, "SIGNAL LOST / SELECT ANOTHER");
  assert.equal(elements[".play-toggle"].getAttribute("aria-label"), "Play Track 01");
  assert.equal(elements[".track-next"].getAttribute("aria-label"), "Next: Track 02");
  await elements[".track-next"].emit("click");
  assert.equal(elements[".music-track-title"].textContent, "Track 02");
  assert.equal(elements[".track-prev"].getAttribute("aria-label"), "Previous: Track 01");
});
