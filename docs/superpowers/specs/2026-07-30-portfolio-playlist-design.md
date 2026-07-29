# Portfolio Easter-Egg Playlist Design

## Goal

Replace the easter egg's placeholder song display with a compact, functional two-track player that matches the existing futuristic desktop interface.

The supplied songs are:

| Display title | Artist | Source file | Deployed file |
| --- | --- | --- | --- |
| Track 01 | Ether | `Website/Songs/Track_01.mp3` | `site/files/audio/track-01.mp3` |
| Track 02 | Ether | `Website/Songs/Track_02.mp3` | `site/files/audio/track-02.mp3` |

## Interaction

1. The existing `signal_?` tile remains closed by default.
2. Clicking it performs the existing flip-and-expand animation. Opening the player does not autoplay audio.
3. The open player displays:
   - track position, such as `01 / 02`;
   - title and artist;
   - previous, play/pause, and next buttons;
   - actual elapsed and total time;
   - actual playback progress.
4. Previous and next wrap continuously between the two tracks.
5. Changing tracks preserves the playback state: switching while playing starts the selected track, while switching when paused leaves it paused.
6. When a track finishes, the next track starts automatically. Track 02 wraps back to Track 01.
7. Closing the player pauses audio without resetting its track or current position.
8. Reopening the player restores the same track and position; the visitor must press play to resume.

The progress bar is display-only in this iteration. Seeking, volume controls, shuffle, and external track links are intentionally out of scope.

## Interface

The current flip card, album-orbit graphic, mint/blue surfaces, pink progress accent, and dark-theme treatment remain intact.

The placeholder `Open ↗` link is replaced with compact previous and next buttons. Controls use the existing outlined button language and hover/press motion. The player remains within its current expanded footprint so it does not overlap the utility dock or the left information cards.

Track changes update the title, artist, track number, time, progress, and accessible labels without replaying the flip animation.

## Architecture

Add a small dependency-free ES module at `site/files/playlist-player.js`. It owns:

- the two-track playlist data passed in by `site/index.html`;
- one browser `Audio` instance;
- wrapped track-index calculations;
- time formatting;
- playback and track-change state;
- DOM updates and audio event listeners.

`site/index.html` continues to own the easter-egg markup and visual styling. After inserting that markup, it imports the module and initializes it with the player root and the two track records.

The audio element uses `preload="metadata"` so durations become available without intentionally downloading both complete MP3 files during initial page load.

## Failure Handling

If a song cannot load or play:

- playback stops;
- the play button returns to its idle state;
- the eyebrow text changes to `SIGNAL LOST / SELECT ANOTHER`;
- previous and next remain available so the visitor can try the other track;
- no uncaught error breaks the rest of the portfolio.

If autoplay is rejected after automatic track advance, the selected track remains visible and paused so the visitor can restart it manually.

## Accessibility

- Every control is a real `button` with a track-aware `aria-label`.
- Play/pause exposes its current state through its label and icon.
- Track metadata is announced through a polite live region.
- The hidden audio element is not a competing keyboard control.
- Existing reduced-motion behavior remains respected.

## Testing

1. Add unit tests for wrapped index selection and time formatting.
2. Add controller tests with a lightweight fake audio object for:
   - play and pause;
   - previous and next behavior;
   - preserving playback state during track changes;
   - automatic advance on `ended`;
   - pause-on-close;
   - the error-state fallback.
3. Extend `tests/verify-site.ps1` to require both MP3 assets and the playlist module.
4. Run a browser smoke test against the packaged `site/` directory to confirm the player opens, metadata changes, and no console or asset-loading errors occur.
5. After deployment, verify the public HTML, both MP3 URLs, and the GitHub Pages workflow.
