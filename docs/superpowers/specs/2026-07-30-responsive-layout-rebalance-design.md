# Responsive Portfolio Layout Rebalance

Date: 2026-07-30

## Objective

Rebalance the portfolio homepage so its three main regions remain visually proportional from small phones through ultra-wide desktops:

- keep the introduction, information, and contact cards compact enough for their content;
- make the project folders more prominent while preserving their folder proportions;
- make the featured STL model and both orbit circles use the available center space;
- prevent opening the music player from moving any unrelated interface element;
- eliminate clipping, horizontal overflow, and breakpoint-specific overlaps.

The visual language, content, interactions, colors, slanted folders, ASCII artwork, model rendering, and existing light/dark themes remain unchanged.

## Confirmed Root Causes

The current page combines geometry from two stylesheets:

- the fetched composition gives the left column an uncapped `29%` width;
- the final stylesheet fixes the folder column at `220px` and each folder at `205px × 124px`;
- the model and orbit circles stop growing at `360px`, `360px`, and `280px`;
- the artifact region mixes a percentage left inset with a fixed right inset, so its center drifts on wide screens;
- opening the player explicitly applies `translateY(-26px)` to the introduction column;
- the mobile layout uses a fixed `440px` folder grid, which clips on narrow phones;
- competing selector specificity prevents the intended mobile minimum height from reliably applying.

These are systemic layout ownership problems, so increasing a few pixel values would not provide a durable fix.

## Layout Architecture

One scoped responsive layout layer will own the geometry of the introduction, artifact, and folder regions. Prototype styles may continue to provide component appearance, but they will no longer determine page-level positioning.

### Desktop: 1024px and wider

Use a centered three-column CSS grid inside the desktop surface:

1. a bounded introduction rail;
2. a flexible artifact stage;
3. a bounded folder rail.

The composition canvas will stop spreading after approximately `2200px` while the decorative background may continue to fill the viewport.

Target sizing:

- introduction rail: approximately `280–360px`, capped at `360px`;
- folder rail: approximately `250–360px`;
- gaps and outer gutters: fluid with guarded minimums and maximums;
- artifact stage: consumes the remaining width and stays geometrically centered between the two rails.

The three foreground regions will use grid placement rather than percentage/fixed absolute insets. Existing labels, metadata, controls, and decorative layers may remain positioned within their own regions.

### Tablet: 480px–1023px

Use normal document flow rather than a squeezed three-column desktop:

1. introduction stack;
2. artifact stage;
3. two-by-two folder grid.

The introduction stack remains centered and capped near `360px`. The artifact stage and folder grid size from the available container width, not fixed viewport assumptions.

### Phone: below 480px

Use a single-column foreground flow:

1. introduction stack;
2. artifact stage;
3. one folder per row.

All foreground blocks remain within the desktop surface. Gutters reduce to approximately `16px`, and no fixed-width child may exceed `100%`.

## Component Sizing

### Introduction cards

- The window and profile cards fill the bounded introduction rail.
- On wide screens, the rail will not exceed `360px`.
- Existing typography and content widths remain readable without stretching empty card chrome.
- Vertical spacing may use a fluid gap, but cards must never overlap.

### Folders

- All four folders keep a consistent `205:124` width-to-height ratio.
- Folders fill the folder rail up to its guarded maximum instead of remaining fixed at `205px`.
- At 1440px and above, they must be visibly larger than the current implementation.
- Existing alternating slants, hover motion, colors, outlines, text, and counts remain intact.
- Tablet uses two columns; narrow phones use one.

### Model and orbit circles

- The STL shell stays square and scales between roughly `280px` and `540px` on desktop.
- The outer orbit scales between roughly `340px` and `680px`.
- The inner orbit scales between roughly `300px` and `600px`.
- Sizing is constrained by both available width and viewport height so short screens do not clip the model or circles.
- The outer orbit remains larger than the model shell, and the inner orbit remains visually distinct.
- The orthographic camera fitting logic remains authoritative; increasing the shell must not crop the model at any rotation.
- Canvas bounds must continue to match the shell bounds.

## Music Player Behavior

- Remove the rule that translates the introduction column when the player opens.
- Opening or closing the player must not change the position or dimensions of the introduction cards, artifact region, folders, utility dock, or theme control.
- The player receives a reserved footprint or dedicated responsive slot.
- Desktop open width remains capped near `315px`.
- Tablet and phone width is limited to the available container, up to approximately `360px`.
- Existing flip animation, playback state, accessibility state, and controls remain unchanged.
- The special 861–879px player-position patch is removed; adjacent widths must behave continuously.

## Decorative Layers

ASCII portrait, manta, jellyfish, scan animation, and orbit visuals remain background/decorative layers with no pointer interaction.

Their placement may be adjusted only as needed to follow the new stage geometry. They must stay beneath foreground cards, folders, and controls and must not affect document flow.

## Responsive and Accessibility Requirements

The implementation must be checked at these representative viewport widths:

- `375`
- `480`
- `768`
- `1023`
- `1024`
- `1440`
- `1920`
- `2560`

Additional seam checks will cover the former `860/861` and `879/880` boundaries.

At every checked width:

- the document must not have unintended horizontal overflow;
- visible foreground controls and cards must remain inside the desktop surface;
- foreground sibling regions must not overlap;
- opening the playlist must leave non-player geometry unchanged;
- keyboard focus, reduced-motion behavior, and light/dark themes must remain functional;
- the model, model canvas, and orbit circles must remain square and unclipped.

## Verification Strategy

Use test-first implementation:

1. add a failing responsive regression check that captures the current uncapped left rail, fixed folder sizing, capped model/orbits, mobile folder overflow, and playlist-driven sibling movement;
2. implement the new layout authority with the minimum CSS and structural changes needed to satisfy it;
3. run existing playlist behavior and static-site verification;
4. run real-browser geometry checks across the representative widths in both closed and open player states;
5. visually inspect representative phone, tablet, standard desktop, and ultra-wide screenshots in both themes;
6. deploy only after the local suite and browser checks pass.

## Non-goals

- redesigning typography, colors, content, themes, ASCII art style, or model materials;
- changing playlist functionality or track metadata;
- adding new navigation destinations;
- changing the established desktop/folder visual concept.

## Acceptance Criteria

The change is complete when:

- the wide-screen introduction rail no longer stretches beyond the approved cap;
- folders are larger on wide desktop and preserve their proportions;
- the model and both orbit circles are materially larger on wide desktop;
- the featured artifact remains centered between the bounded side rails;
- no foreground element moves when the player opens;
- narrow layouts use flow-based stacking with no clipped fixed-width grid;
- all regression, static, behavior, accessibility, and browser geometry checks pass;
- the verified commit is deployed successfully to GitHub Pages.
