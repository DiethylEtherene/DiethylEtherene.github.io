/* ascii-generator.js — client-side image/doodle → ASCII pipeline.
   Nothing leaves the browser: every step is canvas + typed arrays. */

export const RAMPS = {
  signal:   { label: "SIGNAL",   density: " .,:;+*xX#%@", edge: "+xX#%@" },
  creature: { label: "CREATURE", density: " .,:;+xX#@",   edge: "+x#@" },
  block:    { label: "BLOCK",    density: " ░▒▓█", edge: "▓█" },
  binary:   { label: "BINARY",   density: " ..::0011",    edge: "01" },
  hatch:    { label: "HATCH",    density: " `-~=+*%$@",   edge: "/|\\_" },
};

export const PALETTES = {
  signal:    { label: "SIGNAL",    base: "#2a5468", edge: "#0c3d55", accent: "#ff2b8d" },
  deepwater: { label: "DEEPWATER", base: "#2f9fa8", edge: "#8bf0ff", accent: "#ff3c9f" },
  mint:      { label: "MINT",      base: "#0d8f78", edge: "#6dffd0", accent: "#0d7ea6" },
  mono:      { label: "MONO",      base: "#5a6a76", edge: "#0f1a22", accent: "#0f1a22" },
};

const MAX_BYTES = 12 * 1024 * 1024;
const OK_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/bmp", "image/avif"];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const CHAR_ASPECT = 0.55; // glyph width / glyph height

export function validateFile(file) {
  if (!file) return "No file selected";
  if (!file.type.startsWith("image/")) return "Not an image — PNG, JPG or WEBP only";
  if (OK_TYPES.indexOf(file.type) === -1 && !file.type.startsWith("image/")) return "Unsupported image format";
  if (file.size > MAX_BYTES) return "File too large — 12 MB max";
  return null;
}

export function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not decode that image")); };
    img.src = url;
  });
}

/** Downscale into a working canvas so the pipeline stays fast. */
export function toWorking(source, maxDim = 680) {
  const sw = source.naturalWidth || source.width;
  const sh = source.naturalHeight || source.height;
  const scale = Math.min(1, maxDim / Math.max(sw, sh));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sw * scale));
  canvas.height = Math.max(1, Math.round(sh * scale));
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

const dist = (r1, g1, b1, r2, g2, b2) =>
  Math.sqrt((r1 - r2) * (r1 - r2) * 0.4 + (g1 - g2) * (g1 - g2) * 0.45 + (b1 - b2) * (b1 - b2) * 0.15);

/**
 * Border-seeded flood fill against the sampled edge colour.
 * Returns Uint8ClampedArray coverage 0 (background) … 255 (subject).
 * onProgress(0..1) is called a handful of times so the UI can show a real bar.
 */
export async function buildMask(canvas, tolerance, onProgress) {
  const { width: w, height: h } = canvas;
  const px = canvas.getContext("2d").getImageData(0, 0, w, h).data;
  const n = w * h;

  // reference colour = median-ish average of the border ring
  let rs = 0, gs = 0, bs = 0, count = 0;
  const ring = 2;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (x >= ring && x < w - ring && y >= ring && y < h - ring) continue;
      const i = (y * w + x) * 4;
      rs += px[i]; gs += px[i + 1]; bs += px[i + 2]; count += 1;
    }
  }
  const rr = rs / count, rg = gs / count, rb = bs / count;

  const tol = 24 + tolerance * 116; // slider 0..1 → colour distance
  const bg = new Uint8Array(n);
  const stack = new Int32Array(n);
  let top = 0;
  for (let x = 0; x < w; x += 1) { stack[top++] = x; stack[top++] = (h - 1) * w + x; }
  for (let y = 0; y < h; y += 1) { stack[top++] = y * w; stack[top++] = y * w + w - 1; }

  let processed = 0;
  while (top > 0) {
    const idx = stack[--top];
    if (bg[idx]) continue;
    const i = idx * 4;
    if (dist(px[i], px[i + 1], px[i + 2], rr, rg, rb) > tol) continue;
    bg[idx] = 1;
    const x = idx % w, y = (idx - x) / w;
    if (x > 0) stack[top++] = idx - 1;
    if (x < w - 1) stack[top++] = idx + 1;
    if (y > 0) stack[top++] = idx - w;
    if (y < h - 1) stack[top++] = idx + w;
    processed += 1;
    if ((processed & 8191) === 0) {
      onProgress?.(clamp(processed / n, 0, 0.92));
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  onProgress?.(0.95);

  // coverage + 1px feather so glyph edges don't alias hard
  const cover = new Uint8ClampedArray(n);
  for (let idx = 0; idx < n; idx += 1) cover[idx] = bg[idx] ? 0 : 255;
  const soft = new Uint8ClampedArray(n);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const idx = y * w + x;
      let sum = 0, k = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          sum += cover[ny * w + nx]; k += 1;
        }
      }
      soft[idx] = sum / k;
    }
  }
  onProgress?.(1);
  return soft;
}

/** Composite the working canvas with a coverage mask, for the "cleaned" preview. */
export function maskedCanvas(canvas, mask) {
  const { width: w, height: h } = canvas;
  const out = document.createElement("canvas");
  out.width = w; out.height = h;
  const ctx = out.getContext("2d");
  const src = canvas.getContext("2d").getImageData(0, 0, w, h);
  const data = src.data;
  for (let idx = 0; idx < w * h; idx += 1) data[idx * 4 + 3] = mask ? mask[idx] : data[idx * 4 + 3];
  ctx.putImageData(src, 0, 0);
  return out;
}

/**
 * Sample a canvas (+ optional mask) into a glyph grid.
 * opts: { cols, edge, rampKey, invert }
 */
export function buildGrid(canvas, mask, opts) {
  const { width: w, height: h } = canvas;
  const px = canvas.getContext("2d").getImageData(0, 0, w, h).data;
  const n = w * h;
  const gray = new Float32Array(n);
  const alpha = new Float32Array(n);
  for (let idx = 0; idx < n; idx += 1) {
    const i = idx * 4;
    gray[idx] = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) / 255;
    const a = (mask ? mask[idx] : px[i + 3]) / 255;
    alpha[idx] = a;
  }

  // sobel magnitude, gated by coverage
  const mag = new Float32Array(n);
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const idx = y * w + x;
      const g = (i) => gray[i] * alpha[i];
      const gx =
        -g(idx - w - 1) - 2 * g(idx - 1) - g(idx + w - 1) +
        g(idx - w + 1) + 2 * g(idx + 1) + g(idx + w + 1);
      const gy =
        -g(idx - w - 1) - 2 * g(idx - w) - g(idx - w + 1) +
        g(idx + w - 1) + 2 * g(idx + w) + g(idx + w + 1);
      mag[idx] = Math.sqrt(gx * gx + gy * gy) / 4;
    }
  }

  const cols = clamp(Math.round(opts.cols), 24, 220);
  const cellW = w / cols;
  const cellH = cellW / CHAR_ASPECT;
  const rows = clamp(Math.floor(h / cellH), 8, 260);
  const ramp = RAMPS[opts.rampKey] || RAMPS.signal;
  const edgeGate = 0.5 - clamp(opts.edge, 0, 1) * 0.44; // higher sensitivity → lower gate

  const cells = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const x0 = Math.floor(col * cellW), x1 = Math.min(w, Math.ceil((col + 1) * cellW));
      const y0 = Math.floor(row * cellH), y1 = Math.min(h, Math.ceil((row + 1) * cellH));
      let lum = 0, cov = 0, edgeSum = 0, edgeMax = 0, k = 0;
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const idx = y * w + x;
          lum += gray[idx]; cov += alpha[idx];
          edgeSum += mag[idx];
          if (mag[idx] > edgeMax) edgeMax = mag[idx];
          k += 1;
        }
      }
      if (!k) { cells.push(null); continue; }
      cov /= k; lum /= k; edgeSum /= k;
      if (cov < 0.14) { cells.push(null); continue; }

      const tone = opts.invert ? lum : 1 - lum;
      const isEdge = edgeMax > edgeGate && edgeSum > edgeGate * 0.22;
      const set = isEdge ? ramp.edge : ramp.density;
      const strength = clamp(tone * (0.35 + cov * 0.65), 0, 1);
      const gi = isEdge
        ? clamp(Math.floor(clamp(edgeMax, 0, 1) * set.length), 0, set.length - 1)
        : clamp(Math.floor(strength * set.length), 0, set.length - 1);
      const glyph = set[gi];
      if (!glyph || glyph === " ") { cells.push(null); continue; }
      cells.push({ glyph, isEdge, strength, cov, hot: isEdge && edgeMax > 0.82 });
    }
  }
  return { cols, rows, cells };
}

export function gridToText(grid) {
  const lines = [];
  for (let row = 0; row < grid.rows; row += 1) {
    let line = "";
    for (let col = 0; col < grid.cols; col += 1) {
      const cell = grid.cells[row * grid.cols + col];
      line += cell ? cell.glyph : " ";
    }
    lines.push(line.replace(/\s+$/, ""));
  }
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  return lines.join("\n");
}

/** Paint a grid onto a canvas. opts: { paletteKey, cell, aspect, background, scanlines }
    aspect = glyph width / height. Grids from buildGrid() already account for the
    monospace cell ratio, so they use CHAR_ASPECT; pre-baked maps (gridFromMap)
    were authored on square cells and pass aspect:1. */
export function renderGrid(grid, opts) {
  const palette = PALETTES[opts.paletteKey] || PALETTES.signal;
  const cw = opts.cell || 9;
  const ch = opts.cellH || cw / (opts.aspect || CHAR_ASPECT);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const canvas = opts.canvas || document.createElement("canvas");
  canvas.width = Math.round(grid.cols * cw * dpr);
  canvas.height = Math.round(grid.rows * ch * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, grid.cols * cw, grid.rows * ch);
  if (opts.background) {
    ctx.fillStyle = opts.background;
    ctx.fillRect(0, 0, grid.cols * cw, grid.rows * ch);
  }
  if (opts.scanlines) {
    ctx.fillStyle = palette.base;
    ctx.globalAlpha = 0.07;
    for (let row = 1; row < grid.rows; row += 2) ctx.fillRect(0, row * ch, grid.cols * cw, 1);
    ctx.globalAlpha = 1;
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${(ch * 0.92).toFixed(2)}px/1 "JetBrains Mono","Courier New",monospace`;
  for (let row = 0; row < grid.rows; row += 1) {
    for (let col = 0; col < grid.cols; col += 1) {
      const cell = grid.cells[row * grid.cols + col];
      if (!cell) continue;
      ctx.globalAlpha = cell.isEdge ? 0.55 + cell.cov * 0.45 : 0.3 + cell.strength * 0.7;
      ctx.fillStyle = cell.hot ? palette.accent : (cell.isEdge ? palette.edge : palette.base);
      ctx.fillText(cell.glyph, col * cw + cw / 2, row * ch + ch / 2);
    }
  }
  ctx.globalAlpha = 1;
  return canvas;
}

const decode64 = (encoded) => {
  const binary = atob(encoded);
  const values = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) values[i] = binary.charCodeAt(i);
  return values;
};

/** Turn one of the site's pre-baked creature maps into a grid we can render. */
export function gridFromMap(map, rampKey) {
  const density = decode64(map.density);
  const edges = decode64(map.edges || map.density);
  const ramp = RAMPS[rampKey] || RAMPS.signal;
  const cells = [];
  for (let i = 0; i < density.length; i += 1) {
    const tone = density[i] / 255;
    const edge = edges[i] / 255;
    const strength = clamp(tone * 0.92 + edge * 0.28, 0, 1);
    if (strength < 0.09) { cells.push(null); continue; }
    const isEdge = edge > 0.3;
    const set = isEdge ? ramp.edge : ramp.density;
    const gi = clamp(Math.floor(strength * set.length), 1, set.length - 1);
    const glyph = set[gi];
    if (!glyph || glyph === " ") { cells.push(null); continue; }
    cells.push({ glyph, isEdge, strength, cov: clamp(strength + 0.2, 0, 1), hot: isEdge && edge > 0.72 });
  }
  return { cols: map.columns, rows: map.rows, cells };
}

/** Luminance histogram of the subject only — real numbers for the telemetry panel. */
export function histogram(canvas, mask, buckets = 28) {
  const { width: w, height: h } = canvas;
  const px = canvas.getContext("2d").getImageData(0, 0, w, h).data;
  const bins = new Float32Array(buckets);
  let covered = 0;
  for (let idx = 0; idx < w * h; idx += 1) {
    const i = idx * 4;
    const a = (mask ? mask[idx] : px[i + 3]) / 255;
    if (a < 0.4) continue;
    covered += 1;
    const lum = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) / 255;
    bins[clamp(Math.floor(lum * buckets), 0, buckets - 1)] += 1;
  }
  const peak = bins.reduce((a, b) => Math.max(a, b), 1);
  return { bins: Array.from(bins, (v) => v / peak), coverage: covered / (w * h) };
}

export function countGlyphs(grid) {
  let filled = 0, edge = 0;
  grid.cells.forEach((cell) => { if (cell) { filled += 1; if (cell.isEdge) edge += 1; } });
  return { filled, edge, total: grid.cols * grid.rows };
}

export function downloadCanvas(canvas, name) {
  canvas.toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, "image/png");
}
