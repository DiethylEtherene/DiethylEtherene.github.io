const NORMAL_EYEBROW = "NOW.PLAYING / HIDDEN SIGNAL";
const ERROR_EYEBROW = "SIGNAL LOST / SELECT ANOTHER";

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

export function wrapTrackIndex(index, length) {
  if (!Number.isInteger(length) || length <= 0) {
    throw new RangeError("Playlist length must be a positive integer");
  }
  return ((index % length) + length) % length;
}

export function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "00:00";
  const totalSeconds = Math.floor(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const remainder = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

export function createPlaylistPlayer({ root, tracks, audio: suppliedAudio, onOpenChange = () => {} } = {}) {
  if (!root || typeof root.querySelector !== "function") {
    throw new TypeError("A playlist root element is required");
  }
  if (!Array.isArray(tracks) || tracks.length === 0) {
    throw new RangeError("A non-empty playlist is required");
  }

  const elements = Object.fromEntries(selectors.map((selector) => [selector, root.querySelector(selector)]));
  for (const [selector, element] of Object.entries(elements)) {
    if (!element) throw new Error(`Missing playlist element: ${selector}`);
  }

  const audio = suppliedAudio ?? root.querySelector(".playlist-audio") ?? new Audio();
  audio.preload = "metadata";

  const state = { isOpen: false, trackIndex: 0, hasLoadedTrack: false, hasError: false };
  let playbackGeneration = 0;
  const track = () => tracks[state.trackIndex];

  function render() {
    const current = track();
    const duration = Number.isFinite(audio.duration) && audio.duration >= 0 ? audio.duration : 0;
    const currentTime = Number.isFinite(audio.currentTime) && audio.currentTime >= 0 ? audio.currentTime : 0;
    const progress = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
    const previous = tracks[wrapTrackIndex(state.trackIndex - 1, tracks.length)];
    const next = tracks[wrapTrackIndex(state.trackIndex + 1, tracks.length)];
    const isPlaying = !audio.paused;

    elements[".music-eyebrow"].textContent = state.hasError ? ERROR_EYEBROW : NORMAL_EYEBROW;
    elements[".music-track-position"].textContent = `${String(state.trackIndex + 1).padStart(2, "0")} / ${String(tracks.length).padStart(2, "0")}`;
    elements[".music-track-title"].textContent = current.title;
    elements[".music-track-artist"].textContent = current.artist;
    elements[".track-progress i"].style.width = `${progress}%`;
    elements[".track-time"].textContent = `${formatTime(currentTime)} / ${formatTime(duration)}`;
    elements[".play-toggle"].textContent = isPlaying ? "\u275A\u275A" : "\u25B6";
    elements[".play-toggle"].setAttribute("aria-label", `${isPlaying ? "Pause" : "Play"} ${current.title}`);
    elements[".track-prev"].setAttribute("aria-label", `Previous: ${previous.title}`);
    elements[".track-next"].setAttribute("aria-label", `Next: ${next.title}`);
    root.classList[state.hasError ? "add" : "remove"]("has-error");
  }

  function loadCurrentTrack() {
    audio.src = track().src;
    audio.currentTime = 0;
    state.hasLoadedTrack = true;
  }

  function markError() {
    audio.pause();
    state.hasError = true;
    render();
  }

  async function play() {
    if (!state.hasLoadedTrack) loadCurrentTrack();
    const generation = ++playbackGeneration;
    try {
      await audio.play();
      if (generation !== playbackGeneration) return;
      state.hasError = false;
      render();
    } catch {
      if (generation !== playbackGeneration) return;
      markError();
    }
  }

  function pause() {
    playbackGeneration += 1;
    audio.pause();
    render();
  }

  async function selectTrack(index, { autoplay = !audio.paused } = {}) {
    playbackGeneration += 1;
    state.trackIndex = wrapTrackIndex(index, tracks.length);
    state.hasError = false;
    loadCurrentTrack();
    render();
    if (autoplay) await play();
  }

  async function open() {
    state.isOpen = true;
    if (!state.hasLoadedTrack) loadCurrentTrack();
    root.classList.add("is-open");
    render();
    onOpenChange(true);
  }

  function close() {
    // Closing only hides the panel — playback continues; only the pause
    // button stops it. Bump the generation so any in-flight play() result
    // is ignored, but do not pause the audio.
    playbackGeneration += 1;
    state.isOpen = false;
    root.classList.remove("is-open");
    onOpenChange(false);
  }

  elements[".music-front"].addEventListener("click", open);
  elements[".music-close"].addEventListener("click", close);
  elements[".play-toggle"].addEventListener("click", () => (audio.paused ? play() : pause()));
  elements[".track-prev"].addEventListener("click", () => selectTrack(state.trackIndex - 1));
  elements[".track-next"].addEventListener("click", () => selectTrack(state.trackIndex + 1));
  audio.addEventListener("loadedmetadata", render);
  audio.addEventListener("timeupdate", render);
  audio.addEventListener("error", markError);
  audio.addEventListener("ended", () => selectTrack(state.trackIndex + 1, { autoplay: true }));

  render();

  return Object.freeze({
    getState: () => Object.freeze({
      isOpen: state.isOpen,
      trackIndex: state.trackIndex,
      isPlaying: !audio.paused,
      hasError: state.hasError,
    }),
    play,
    pause,
    selectTrack,
  });
}
