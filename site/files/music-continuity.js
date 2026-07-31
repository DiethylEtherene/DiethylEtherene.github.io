/* music-continuity.js — carries hidden-signal playback across full page
   navigations between site pages (this is a static multi-page site, not
   an SPA, so a navigation always tears down and recreates the <audio>
   element; this can't make that gapless, only make the new page resume
   at nearly the same track/position instead of resetting to idle). */

const STATE_KEY = "asteria-music-state";

function saveMusicState(state) {
  try { localStorage.setItem(STATE_KEY, JSON.stringify(state)); } catch {}
}

function loadMusicState() {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Number.isInteger(parsed.trackIndex) || typeof parsed.currentTime !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Wire a playlist-player instance (the object returned by
 * createPlaylistPlayer()) and its underlying <audio> element so playback
 * state survives navigating to another page on the site. Call once, right
 * after creating the player.
 */
export function attachMusicContinuity({ player, audio, tracks }) {
  const saved = loadMusicState();
  if (saved && saved.trackIndex >= 0 && saved.trackIndex < tracks.length) {
    player.selectTrack(saved.trackIndex, { autoplay: false });
    const resumeTime = saved.currentTime;
    const applyTime = () => { try { audio.currentTime = resumeTime; } catch {} };
    if (audio.readyState >= 1) applyTime();
    else audio.addEventListener("loadedmetadata", applyTime, { once: true });
    // Autoplay may be blocked depending on how the browser scores this
    // navigation; if so the track just stays loaded and paused at the
    // resumed position, and the user taps play once more.
    if (saved.playing) player.play().catch(() => {});
  }

  let lastPersist = 0;
  const persist = (force) => {
    const now = Date.now();
    if (!force && now - lastPersist < 1000) return;
    lastPersist = now;
    const state = player.getState();
    saveMusicState({ trackIndex: state.trackIndex, currentTime: audio.currentTime || 0, playing: state.isPlaying });
  };
  audio.addEventListener("play", () => persist(true));
  audio.addEventListener("pause", () => persist(true));
  audio.addEventListener("ended", () => persist(true));
  audio.addEventListener("timeupdate", () => persist(false));
  window.addEventListener("pagehide", () => persist(true));
}
