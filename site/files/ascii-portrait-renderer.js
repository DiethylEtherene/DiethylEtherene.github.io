import {
  ASCII_PORTRAIT_DIMENSIONS,
  ASCII_PORTRAIT_MAPS,
} from "./ascii-portrait-data.js";
import { NAUTICAL_CREATURE_MAPS } from "./nautical-creature-data.js";

const DENSITY_RAMP = " .,:;+*xX#%@";
const EDGE_RAMP = "+xX#%@";
const CELL_SIZE = 10;
const CREATURE_RAMP = " .,:;+xX#@";
const CREATURE_EDGE_RAMP = "+x#@";
const CREATURE_CELL_SIZE = 5;
const BUFFER_WIDTH = ASCII_PORTRAIT_DIMENSIONS.columns * CELL_SIZE;
const BUFFER_HEIGHT = ASCII_PORTRAIT_DIMENSIONS.rows * CELL_SIZE;

const clamp = (value, minimum, maximum) =>
  Math.min(maximum, Math.max(minimum, value));

const smoothstep = (minimum, maximum, value) => {
  const position = clamp((value - minimum) / (maximum - minimum), 0, 1);
  return position * position * (3 - 2 * position);
};

const decodeBase64 = (encoded) => {
  const binary = atob(encoded);
  const values = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    values[index] = binary.charCodeAt(index);
  }
  return values;
};

const NAUTICAL_PORTRAIT_MAP = Object.freeze({
  id: ASCII_PORTRAIT_MAPS.nautical.id,
  luminance: decodeBase64(ASCII_PORTRAIT_MAPS.nautical.luminance),
  edges: decodeBase64(ASCII_PORTRAIT_MAPS.nautical.edges),
});

const DECODED_CREATURE_MAPS = Object.freeze(
  Object.fromEntries(
    Object.entries(NAUTICAL_CREATURE_MAPS).map(([creatureId, map]) => [
      creatureId,
      Object.freeze({
        id: map.id,
        columns: map.columns,
        rows: map.rows,
        density: decodeBase64(map.density),
        edges: decodeBase64(map.edges),
      }),
    ]),
  ),
);

const clampAlpha = (value, fallback) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : fallback;
};

const readPalette = (desktop) => {
  const styles = getComputedStyle(desktop);
  const read = (name, fallback) => styles.getPropertyValue(name).trim() || fallback;
  return {
    base: read("--ascii-base", "#334c5f"),
    edge: read("--ascii-edge", "#3c718f"),
    scan: read("--ascii-scan", "rgba(51,76,95,.12)"),
    accent: read("--ascii-accent", "#ff2b8d"),
    baseAlpha: clampAlpha(read("--ascii-base-alpha", ".2"), .2),
    edgeAlpha: clampAlpha(read("--ascii-edge-alpha", ".38"), .38),
    creatureBase: read("--ascii-creature-base", "#376f8b"),
    creatureEdge: read("--ascii-creature-edge", "#2d6886"),
  };
};

const createBaseBuffer = (map, palette) => {
  const buffer = document.createElement("canvas");
  buffer.width = BUFFER_WIDTH;
  buffer.height = BUFFER_HEIGHT;
  const context = buffer.getContext("2d");
  if (!context) return buffer;

  context.clearRect(0, 0, BUFFER_WIDTH, BUFFER_HEIGHT);
  context.fillStyle = palette.scan;
  context.globalAlpha = .2;
  for (let row = 1; row < ASCII_PORTRAIT_DIMENSIONS.rows; row += 2) {
    context.fillRect(0, row * CELL_SIZE, BUFFER_WIDTH, 1);
  }

  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = `700 ${CELL_SIZE - 1}px/1 "Courier New", monospace`;
  for (let index = 0; index < map.luminance.length; index += 1) {
    const column = index % ASCII_PORTRAIT_DIMENSIONS.columns;
    const row = Math.floor(index / ASCII_PORTRAIT_DIMENSIONS.columns);
    const luminance = map.luminance[index];
    const densityIndex = Math.min(
      DENSITY_RAMP.length - 1,
      Math.floor(luminance / 256 * DENSITY_RAMP.length),
    );
    const glyph = DENSITY_RAMP[densityIndex];
    if (glyph !== " ") {
      context.globalAlpha = palette.baseAlpha;
      context.fillStyle = palette.base;
      context.fillText(
        glyph,
        column * CELL_SIZE + CELL_SIZE / 2,
        row * CELL_SIZE + CELL_SIZE / 2,
      );
    }

    const edge = map.edges[index];
    if (edge < 28) continue;
    const edgeIndex = Math.min(
      EDGE_RAMP.length - 1,
      Math.floor(edge / 256 * EDGE_RAMP.length),
    );
    context.globalAlpha = palette.edgeAlpha;
    const useAccent = edge >= 196 && (index * 17) % 257 < 2;
    context.fillStyle = useAccent ? palette.accent : palette.edge;
    context.fillText(
      EDGE_RAMP[edgeIndex],
      column * CELL_SIZE + CELL_SIZE / 2,
      row * CELL_SIZE + CELL_SIZE / 2,
    );
  }
  context.globalAlpha = 1;
  return buffer;
};

const createCreatureBuffer = (map, palette, creatureId) => {
  const width = map.columns * CREATURE_CELL_SIZE;
  const height = map.rows * CREATURE_CELL_SIZE;
  const buffer = document.createElement("canvas");
  buffer.width = width;
  buffer.height = height;
  const context = buffer.getContext("2d");
  if (!context) return buffer;

  context.clearRect(0, 0, width, height);
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = `700 ${CREATURE_CELL_SIZE}px/1 "Courier New", monospace`;

  for (let index = 0; index < map.density.length; index += 1) {
    const column = index % map.columns;
    const row = Math.floor(index / map.columns);
    const density = map.density[index] / 255;
    const edge = map.edges[index] / 255;
    const normalizedX = map.columns > 1 ? column / (map.columns - 1) : 0;
    const directionalGain = creatureId === "manta"
      ? 1 - .52 * smoothstep(.58, 1, normalizedX)
      : .55 + .45 * smoothstep(0, .38, normalizedX);
    const strength = Math.min(
      1,
      (density * .9 + edge * .3) * directionalGain,
    );
    if (strength < .08) continue;

    const edgeCell = edge > .28;
    const ramp = edgeCell ? CREATURE_EDGE_RAMP : CREATURE_RAMP;
    const rampIndex = Math.min(
      ramp.length - 1,
      Math.max(1, Math.floor(strength * ramp.length)),
    );
    context.globalAlpha = creatureId === "manta"
      ? .16 + strength * .64
      : .12 + strength * .48;
    context.fillStyle = edgeCell
      ? palette.creatureEdge
      : palette.creatureBase;
    context.fillText(
      ramp[rampIndex],
      column * CREATURE_CELL_SIZE + CREATURE_CELL_SIZE / 2,
      row * CREATURE_CELL_SIZE + CREATURE_CELL_SIZE / 2,
    );
  }

  context.globalAlpha = 1;
  return buffer;
};

const fitCanvasBacking = (canvas, dpr) => {
  const bounds = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(bounds.width * dpr));
  const height = Math.max(1, Math.round(bounds.height * dpr));
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
};

const drawContained = (context, canvas, buffer) => {
  const sourceAspect =
    ASCII_PORTRAIT_DIMENSIONS.columns / ASCII_PORTRAIT_DIMENSIONS.rows;
  let drawWidth = canvas.width;
  let drawHeight = drawWidth / sourceAspect;
  if (drawHeight > canvas.height) {
    drawHeight = canvas.height;
    drawWidth = drawHeight * sourceAspect;
  }
  const left = (canvas.width - drawWidth) / 2;
  const top = (canvas.height - drawHeight) / 2;

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = false;
  context.drawImage(buffer, left, top, drawWidth, drawHeight);
};

const drawFilled = (context, canvas, buffer) => {
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.globalCompositeOperation = "source-over";
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(buffer, 0, 0, canvas.width, canvas.height);
};

export function createAsciiPortraitRenderer({
  desktop,
  layer,
  canvas,
  creatureCanvases = {},
}) {
  const centralContext = canvas.getContext("2d");
  const creatureMetadataEntries = [];
  const creatureEntries = [];
  const creatureBufferById = new Map();
  let centralBuffer = null;
  let paletteId = desktop.classList.contains("dark-theme") ? "dark" : "light";
  let renderRevision = 0;
  let resizeFrame = 0;
  let destroyed = false;
  let lastLayoutSignature = "";
  let resizeObserver = null;

  desktop.dataset.asciiVariant = "nautical";
  layer.dataset.asciiMotion = "idle";
  canvas.dataset.mapId = NAUTICAL_PORTRAIT_MAP.id;
  canvas.dataset.palette = paletteId;
  canvas.dataset.columns = String(ASCII_PORTRAIT_DIMENSIONS.columns);
  canvas.dataset.rows = String(ASCII_PORTRAIT_DIMENSIONS.rows);
  canvas.dataset.renderRevision = "0";
  canvas.width = 1;
  canvas.height = 1;

  Object.entries(creatureCanvases).forEach(([creatureId, creatureCanvas]) => {
    const map = DECODED_CREATURE_MAPS[creatureId];
    if (
      !map ||
      !creatureCanvas?.dataset ||
      typeof creatureCanvas.getContext !== "function"
    ) {
      return;
    }

    creatureCanvas.dataset.creatureId = creatureId;
    creatureCanvas.dataset.columns = String(map.columns);
    creatureCanvas.dataset.rows = String(map.rows);
    creatureCanvas.dataset.cellSize = String(CREATURE_CELL_SIZE);
    creatureCanvas.dataset.palette = paletteId;
    creatureCanvas.dataset.renderRevision = "0";
    creatureCanvas.width = 1;
    creatureCanvas.height = 1;
    creatureMetadataEntries.push({ id: creatureId, canvas: creatureCanvas });

    const context = creatureCanvas.getContext("2d");
    if (context) {
      creatureEntries.push({
        id: creatureId,
        canvas: creatureCanvas,
        context,
        map,
      });
    }
  });

  const updatePaletteMetadata = () => {
    canvas.dataset.palette = paletteId;
    creatureMetadataEntries.forEach(({ canvas: creatureCanvas }) => {
      creatureCanvas.dataset.palette = paletteId;
    });
  };

  const rebuildRenderSources = () => {
    const palette = readPalette(desktop);
    centralBuffer = createBaseBuffer(NAUTICAL_PORTRAIT_MAP, palette);
    creatureBufferById.clear();
    creatureEntries.forEach(({ id, map }) => {
      creatureBufferById.set(id, createCreatureBuffer(map, palette, id));
    });
  };

  const readDpr = () => Math.min(window.devicePixelRatio || 1, 1.5);

  const readLayoutSignature = () => {
    const dimensions = [layer, canvas, ...creatureEntries.map(({ canvas }) => canvas)]
      .flatMap((element) => {
        const bounds = element.getBoundingClientRect();
        return [
          Math.round(bounds.width * 100) / 100,
          Math.round(bounds.height * 100) / 100,
        ];
      });
    return [readDpr(), ...dimensions].join(":");
  };

  const paintAll = () => {
    if (destroyed || !centralContext || !centralBuffer) return;
    const dpr = readDpr();
    fitCanvasBacking(canvas, dpr);
    creatureEntries.forEach(({ canvas: creatureCanvas }) => {
      fitCanvasBacking(creatureCanvas, dpr);
    });

    drawContained(centralContext, canvas, centralBuffer);
    creatureEntries.forEach(({ id, canvas: creatureCanvas, context }) => {
      const buffer = creatureBufferById.get(id);
      if (buffer) drawFilled(context, creatureCanvas, buffer);
    });

    renderRevision += 1;
    canvas.dataset.renderRevision = String(renderRevision);
    creatureMetadataEntries.forEach(({ canvas: creatureCanvas }) => {
      creatureCanvas.dataset.renderRevision = String(renderRevision);
    });
    lastLayoutSignature = readLayoutSignature();
  };

  const paintIfLayoutChanged = () => {
    resizeFrame = 0;
    if (destroyed || !centralContext) return;
    if (readLayoutSignature() === lastLayoutSignature) return;
    paintAll();
  };

  const schedulePaint = () => {
    if (destroyed || resizeFrame) return;
    resizeFrame = requestAnimationFrame(paintIfLayoutChanged);
  };

  const setTheme = (nextPalette = "light") => {
    if (destroyed) return;
    paletteId = String(nextPalette);
    updatePaletteMetadata();
    if (!centralContext) return;
    rebuildRenderSources();
    paintAll();
  };

  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    resizeObserver?.disconnect();
    window.removeEventListener("resize", schedulePaint);
    if (resizeFrame) cancelAnimationFrame(resizeFrame);
    resizeFrame = 0;
    centralBuffer = null;
    creatureBufferById.clear();
  };

  if (!centralContext) {
    layer.dataset.asciiReady = "unavailable";
    return { setTheme, destroy };
  }

  rebuildRenderSources();
  resizeObserver = typeof ResizeObserver === "function"
    ? new ResizeObserver(schedulePaint)
    : null;
  resizeObserver?.observe(layer);
  resizeObserver?.observe(canvas);
  creatureEntries.forEach(({ canvas: creatureCanvas }) => {
    resizeObserver?.observe(creatureCanvas);
  });
  window.addEventListener("resize", schedulePaint);
  layer.dataset.asciiReady = "true";
  schedulePaint();

  return { setTheme, destroy };
}
