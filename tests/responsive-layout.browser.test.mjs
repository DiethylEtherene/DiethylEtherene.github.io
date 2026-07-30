import assert from "node:assert/strict";
import { createReadStream } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import { createServer, request as httpRequest } from "node:http";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { chromium } from "playwright";

const SITE_ROOT = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), "../site"));
const VIEWPORTS = [
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
  { width: 2560, height: 1440 },
];
const SEAM_PAIRS = [[860, 861], [879, 880]];
const REQUESTED_VIEWPORT = process.env.RESPONSIVE_VIEWPORT;
const REQUESTED_VIEWPORT_ENTRY = VIEWPORTS.find(
  ({ width, height }) => `${width}x${height}` === REQUESTED_VIEWPORT,
);
const ACTIVE_VIEWPORTS = (() => {
  if (!REQUESTED_VIEWPORT) return VIEWPORTS;
  if (!REQUESTED_VIEWPORT_ENTRY) return [];
  const widths = new Set([REQUESTED_VIEWPORT_ENTRY.width]);
  SEAM_PAIRS
    .find((pair) => pair.includes(REQUESTED_VIEWPORT_ENTRY.width))
    ?.forEach((width) => widths.add(width));
  return VIEWPORTS.filter(({ width }) => widths.has(width));
})();
const SNAPSHOT_SELECTORS = [
  ".intro-column",
  ".artifact-zone",
  ".folder-column",
  ".utility-dock",
  ".final-theme-picker",
];
const MIME_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".stl", "model/stl"],
  [".mp3", "audio/mpeg"],
]);
const PIXEL_TOLERANCE = 0.5;
const RESPONSIVE_SENTINEL_TOLERANCE = 0.02;
const FOLDER_ASPECT_RATIO = 205 / 124;
const REQUIRED_RESOURCE_PATHS = ["/", "/files/desktop-composition-v2.html"];

function isWithinRoot(root, candidate) {
  const fromRoot = relative(root, candidate);
  return fromRoot === ""
    || (fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot));
}

function requestPathToFile(rawUrl) {
  const rawPath = rawUrl.split("?", 1)[0].split("#", 1)[0];
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(rawPath);
  } catch {
    return { status: 400, message: "Malformed URL encoding" };
  }

  const pathSegments = decodedPath.replaceAll("\\", "/").split("/");
  if (decodedPath.includes("\0") || pathSegments.includes("..")) {
    return { status: 403, message: "Path traversal rejected" };
  }

  const relativePath = pathSegments.filter(Boolean).join("/") || "index.html";
  const filePath = resolve(SITE_ROOT, relativePath);
  if (!isWithinRoot(SITE_ROOT, filePath)) {
    return { status: 403, message: "Path traversal rejected" };
  }
  return { filePath };
}

async function startStaticServer() {
  const server = createServer(async (request, response) => {
    const method = request.method ?? "GET";
    if (method !== "GET" && method !== "HEAD") {
      response.writeHead(405, {
        Allow: "GET, HEAD",
        "content-type": "text/plain; charset=utf-8",
      });
      response.end("Method not allowed");
      return;
    }

    const result = requestPathToFile(request.url ?? "/");
    if (!result.filePath) {
      response.writeHead(result.status, { "content-type": "text/plain; charset=utf-8" });
      response.end(result.message);
      return;
    }

    try {
      const canonicalFilePath = await realpath(result.filePath);
      if (!isWithinRoot(SITE_ROOT, canonicalFilePath)) {
        response.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
        response.end("Path traversal rejected");
        return;
      }

      const fileStats = await stat(canonicalFilePath);
      if (!fileStats.isFile()) throw new Error("Not a file");
      let start = 0;
      let end = fileStats.size - 1;
      let status = 200;
      const range = request.headers.range;
      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range);
        if (!match || (!match[1] && !match[2])) {
          response.writeHead(416, {
            "accept-ranges": "bytes",
            "content-range": `bytes */${fileStats.size}`,
          });
          response.end();
          return;
        }
        if (match[1]) {
          start = Number(match[1]);
          end = match[2] ? Math.min(Number(match[2]), end) : end;
        } else {
          const suffixLength = Number(match[2]);
          start = Math.max(0, fileStats.size - suffixLength);
        }
        if (
          !Number.isSafeInteger(start)
          || !Number.isSafeInteger(end)
          || start < 0
          || start > end
          || start >= fileStats.size
        ) {
          response.writeHead(416, {
            "accept-ranges": "bytes",
            "content-range": `bytes */${fileStats.size}`,
          });
          response.end();
          return;
        }
        status = 206;
      }
      response.writeHead(status, {
        "accept-ranges": "bytes",
        "content-length": end - start + 1,
        "content-type": MIME_TYPES.get(extname(canonicalFilePath).toLowerCase()) ?? "application/octet-stream",
        ...(status === 206 ? { "content-range": `bytes ${start}-${end}/${fileStats.size}` } : {}),
      });
      if (method === "HEAD") {
        response.end();
        return;
      }
      createReadStream(canonicalFilePath, { start, end })
        .on("error", () => response.destroy())
        .pipe(response);
    } catch (error) {
      if (!response.headersSent) {
        response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        response.end("Not found");
      } else {
        response.destroy(error);
      }
    }
  });

  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object", "Static server did not expose a TCP address");
  return {
    baseURL: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolveClose, rejectClose) => {
      server.close((error) => error ? rejectClose(error) : resolveClose());
    }),
  };
}

function rawResponse(baseURL, path, method = "GET", headers = {}) {
  const url = new URL(baseURL);
  return new Promise((resolveResponse, rejectResponse) => {
    const request = httpRequest({
      headers,
      hostname: url.hostname,
      method,
      port: url.port,
      path,
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.once("end", () => resolveResponse({
        body: Buffer.concat(chunks),
        headers: response.headers,
        status: response.statusCode,
      }));
    });
    request.once("error", rejectResponse);
    request.end();
  });
}

async function openBrowser() {
  const cdpURL = process.env.PLAYWRIGHT_CDP_URL;
  if (cdpURL) {
    try {
      return { browser: await chromium.connectOverCDP(cdpURL, { timeout: 10_000 }), externallyOwned: true };
    } catch (error) {
      throw new Error(`Could not connect to PLAYWRIGHT_CDP_URL (${cdpURL}): ${error.message}`, { cause: error });
    }
  }

  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  try {
    return {
      browser: await chromium.launch({
        headless: true,
        timeout: 15_000,
        ...(executablePath ? { executablePath } : {}),
      }),
      externallyOwned: false,
    };
  } catch (error) {
    throw new Error(
      `Could not launch Chromium. Install Playwright Chromium, set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, or set PLAYWRIGHT_CDP_URL. ${error.message}`,
      { cause: error },
    );
  }
}

async function waitForPortfolioReady(page, label) {
  try {
    await Promise.all([
      page.locator('.stl-model-shell[data-ready="true"]').waitFor({ state: "attached" }),
      page.locator('.desktop-v2[data-app-ready="true"]').waitFor({ state: "attached" }),
    ]);
  } catch (error) {
    throw new Error(`${label}: portfolio app did not reach explicit model-and-player readiness`, {
      cause: error,
    });
  }
}

async function waitForPlaylistResourceReady(page, label, runtimeMetrics) {
  runtimeMetrics.playlistReadinessProbes += 1;
  await page.locator(".playlist-audio").evaluate((audio) => {
    if (audio.error) {
      throw new Error(`playlist audio failed with media error ${audio.error.code}`);
    }
    if (audio.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA) return;
    return new Promise((resolveReady, rejectReady) => {
      const cleanup = () => {
        clearTimeout(timeout);
        audio.removeEventListener("canplaythrough", onReady);
        audio.removeEventListener("error", onError);
      };
      const onReady = () => {
        cleanup();
        resolveReady();
      };
      const onError = () => {
        const code = audio.error?.code ?? "unknown";
        cleanup();
        rejectReady(new Error(`playlist audio failed with media error ${code}`));
      };
      const timeout = setTimeout(() => {
        cleanup();
        rejectReady(new Error("playlist audio did not fully buffer within 5 seconds"));
      }, 5_000);
      audio.addEventListener("canplaythrough", onReady, { once: true });
      audio.addEventListener("error", onError, { once: true });
    });
  }).catch((error) => {
    throw new Error(`${label}: playlist resource did not reach buffered readiness`, { cause: error });
  });
}

async function settleResponsiveResize(page, viewport) {
  const expected = expectedResponsiveSentinels(viewport);
  try {
    await page.waitForFunction(
      ({ expectedSentinels, tolerance }) => {
        const theme = document.querySelector(".final-theme-picker");
        const music = document.querySelector(".music-easter");
        if (!theme || !music) return false;
        const themeStyle = getComputedStyle(theme);
        const musicStyle = getComputedStyle(music);
        const observed = {
          innerWidth,
          innerHeight,
          themeRight: Number.parseFloat(themeStyle.right),
          themeBottom: Number.parseFloat(themeStyle.bottom),
          musicLeft: Number.parseFloat(musicStyle.left),
          musicBottom: Number.parseFloat(musicStyle.bottom),
        };
        return Object.entries(expectedSentinels).every(
          ([name, value]) => Math.abs(observed[name] - value) <= tolerance,
        );
      },
      {
        expectedSentinels: expected,
        tolerance: RESPONSIVE_SENTINEL_TOLERANCE,
      },
      {
        polling: "raf",
        timeout: 2_500,
      },
    );
  } catch (error) {
    const observed = await readResponsiveSentinels(page);
    throw new Error(
      `${viewport.width}x${viewport.height}: responsive sentinels did not settle; expected=${JSON.stringify(expected)} observed=${JSON.stringify(observed)}`,
      { cause: error },
    );
  }
  await page.evaluate(() => new Promise((resolveSettled) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(resolveSettled);
    });
  }));
}

function expectedResponsiveSentinels(viewport) {
  const sideInset = viewport.width <= 1023
    ? Math.min(32, Math.max(16, viewport.width * 0.04))
    : 24;
  return {
    innerWidth: viewport.width,
    innerHeight: viewport.height,
    themeRight: sideInset,
    themeBottom: viewport.width <= 699 ? 88 : viewport.width <= 1023 ? 70 : 16,
    musicLeft: sideInset,
    musicBottom: viewport.width <= 699 ? 150 : viewport.width <= 1023 ? 70 : 16,
  };
}

async function readResponsiveSentinels(page) {
  return page.evaluate(() => {
    const required = (selector) => {
      const element = document.querySelector(selector);
      if (!element) throw new Error(`Responsive sentinel missing: ${selector}`);
      return element;
    };
    const themeStyle = getComputedStyle(required(".final-theme-picker"));
    const musicStyle = getComputedStyle(required(".music-easter"));
    return {
      innerWidth,
      innerHeight,
      themeRight: Number.parseFloat(themeStyle.right),
      themeBottom: Number.parseFloat(themeStyle.bottom),
      musicLeft: Number.parseFloat(musicStyle.left),
      musicBottom: Number.parseFloat(musicStyle.bottom),
    };
  });
}

function assertResponsiveSentinels(viewport, observed) {
  const expected = expectedResponsiveSentinels(viewport);
  const mismatches = Object.entries(expected)
    .filter(([name, value]) => Math.abs(observed[name] - value) > RESPONSIVE_SENTINEL_TOLERANCE)
    .map(([name, value]) => `${name}=${observed[name]} (expected ${value})`);
  assert.equal(
    mismatches.length,
    0,
    `${viewport.width}x${viewport.height}: responsive sentinel mismatch: ${mismatches.join(", ")}`,
  );
}

async function readGeometry(page) {
  return page.evaluate(({ foregroundSelectors }) => {
    const box = (element) => {
      const rect = element.getBoundingClientRect();
      return {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        right: rect.right,
        bottom: rect.bottom,
      };
    };
    const required = (selector) => {
      const element = document.querySelector(selector);
      if (!element) throw new Error(`Required component missing: ${selector}`);
      return element;
    };
    const isVisible = (element, rect) => {
      if (rect.width <= 0 || rect.height <= 0 || element.getClientRects().length === 0) {
        return false;
      }
      if (typeof element.checkVisibility === "function") {
        return element.checkVisibility({
          checkOpacity: true,
          checkVisibilityCSS: true,
          contentVisibilityAuto: true,
        });
      }
      for (let current = element; current; current = current.parentElement) {
        const style = getComputedStyle(current);
        if (
          style.display === "none"
          || style.visibility === "hidden"
          || style.visibility === "collapse"
          || style.contentVisibility === "hidden"
          || Number(style.opacity) === 0
        ) {
          return false;
        }
      }
      return true;
    };
    const desktop = required(".desktop-v2");
    const shell = required(".stl-model-shell");
    const canvas = required(".stl-model-shell canvas");
    const outerOrbit = required(".orbit-a");
    const innerOrbit = required(".orbit-b");
    const folder = required(".folder");
    const foreground = foregroundSelectors.map((selector) => {
      const element = required(selector);
      const rect = box(element);
      return {
        selector,
        visible: isVisible(element, rect),
        ...rect,
      };
    });

    return {
      document: {
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      },
      desktop: box(desktop),
      desktopLayout: {
        display: getComputedStyle(desktop).display,
        flexDirection: getComputedStyle(desktop).flexDirection,
        introPosition: getComputedStyle(required(".intro-column")).position,
        artifactPosition: getComputedStyle(required(".artifact-zone")).position,
        foldersPosition: getComputedStyle(required(".folder-column")).position,
      },
      artifact: box(required(".artifact-zone")),
      shell: { ...box(shell), layoutWidth: shell.offsetWidth, layoutHeight: shell.offsetHeight },
      canvas: box(canvas),
      outerOrbit: { ...box(outerOrbit), layoutWidth: outerOrbit.offsetWidth, layoutHeight: outerOrbit.offsetHeight },
      innerOrbit: { ...box(innerOrbit), layoutWidth: innerOrbit.offsetWidth, layoutHeight: innerOrbit.offsetHeight },
      folder: { ...box(folder), layoutWidth: folder.offsetWidth, layoutHeight: folder.offsetHeight },
      folders: Array.from(document.querySelectorAll(".folder"), (element) => ({
        ...box(element),
        layoutX: element.offsetLeft,
        layoutY: element.offsetTop,
      })),
      folderColumn: {
        ...box(required(".folder-column")),
        display: getComputedStyle(required(".folder-column")).display,
      },
      intro: box(required(".intro-column")),
      music: box(required(".music-easter")),
      dock: box(required(".utility-dock")),
      theme: box(required(".final-theme-picker")),
      ascii: {
        field: box(required(".ascii-central-field")),
        mantaOpacity: Number(getComputedStyle(required(".ascii-manta-canvas")).opacity),
        jellyDisplay: getComputedStyle(required(".ascii-jellyfish-canvas")).display,
        scanDisplay: getComputedStyle(required(".ascii-scan")).display,
      },
      foreground,
    };
  }, { foregroundSelectors: SNAPSHOT_SELECTORS });
}

async function snapshotRegions(page) {
  return page.evaluate((selectors) => Object.fromEntries(selectors.map((selector) => {
    const element = document.querySelector(selector);
    if (!element) throw new Error(`Cannot snapshot missing component: ${selector}`);
    const { x, y, width, height } = element.getBoundingClientRect();
    return [selector, {
      x: x + window.scrollX,
      y: y + window.scrollY,
      width,
      height,
    }];
  })), SNAPSHOT_SELECTORS);
}

function assertSquare(label, geometry, viewport) {
  assert.ok(
    Math.abs(geometry.layoutWidth - geometry.layoutHeight) <= PIXEL_TOLERANCE,
    `${viewport}: ${label} must be square; measured ${geometry.layoutWidth}x${geometry.layoutHeight}`,
  );
}

function assertContained(label, child, parent, viewport) {
  assert.ok(
    child.x >= parent.x - PIXEL_TOLERANCE
      && child.y >= parent.y - PIXEL_TOLERANCE
      && child.right <= parent.right + PIXEL_TOLERANCE
      && child.bottom <= parent.bottom + PIXEL_TOLERANCE,
    `${viewport}: visible ${label} must stay inside .desktop-v2; child=${JSON.stringify(child)} desktop=${JSON.stringify(parent)}`,
  );
}

function assertDisjoint(label, first, second, viewport) {
  const disjoint = first.right <= second.x + PIXEL_TOLERANCE
    || second.right <= first.x + PIXEL_TOLERANCE
    || first.bottom <= second.y + PIXEL_TOLERANCE
    || second.bottom <= first.y + PIXEL_TOLERANCE;
  assert.ok(
    disjoint,
    `${viewport}: ${label} must not overlap; first=${JSON.stringify(first)} second=${JSON.stringify(second)}`,
  );
}

test("desktop geometry authority owns the folder rail direction", async () => {
  const stylesheet = await readFile(resolve(SITE_ROOT, "files/responsive-layout.css"), "utf8");
  const folderRailRule = stylesheet.match(
    /#portfolio-consolidated\s+\.composition-wrap\s*>\s*\.desktop-v2\s*>\s*\.folder-column\s*\{([^}]*)\}/,
  );
  assert.ok(folderRailRule, "responsive layout stylesheet must define the direct folder rail rule");
  assert.match(
    folderRailRule[1],
    /\bflex-direction:\s*column\s*;/,
    "responsive layout stylesheet must own the folder rail column direction",
  );
});

test("responsive portfolio geometry remains balanced and interaction-stable", { timeout: 90_000 }, async (t) => {
  assert.ok(
    ACTIVE_VIEWPORTS.length > 0,
    `RESPONSIVE_VIEWPORT must match a configured viewport; received ${REQUESTED_VIEWPORT}`,
  );
  const requestedSeam = SEAM_PAIRS.find((pair) => pair.includes(REQUESTED_VIEWPORT_ENTRY?.width));
  if (requestedSeam) {
    assert.deepEqual(
      ACTIVE_VIEWPORTS.map(({ width }) => width),
      requestedSeam,
      `RESPONSIVE_VIEWPORT=${REQUESTED_VIEWPORT} must exercise both sides of its seam`,
    );
  }
  const staticServer = await startStaticServer();
  let browser;
  let context;
  let page;
  let externallyOwned = false;
  let pageErrorListener;
  let requestFailedListener;
  let responseListener;
  let frameNavigatedListener;

  try {
    const traversalResponse = await rawResponse(staticServer.baseURL, "/%2e%2e%2fpackage.json");
    assert.equal(
      traversalResponse.status,
      403,
      "Static server must reject traversal after URL decoding",
    );
    const postResponse = await rawResponse(staticServer.baseURL, "/", "POST");
    assert.equal(postResponse.status, 405, "Static server must reject methods other than GET and HEAD");
    assert.equal(postResponse.headers.allow, "GET, HEAD", "405 response must advertise allowed methods");
    const headResponse = await rawResponse(staticServer.baseURL, "/", "HEAD");
    assert.equal(headResponse.status, 200, "Static server must serve HEAD requests");
    assert.equal(headResponse.body.length, 0, "HEAD response must not contain a body");
    assert.ok(Number(headResponse.headers["content-length"]) > 0, "HEAD response must include file length");
    const rangeResponse = await rawResponse(
      staticServer.baseURL,
      "/files/audio/track-01.mp3",
      "GET",
      { Range: "bytes=0-99" },
    );
    assert.equal(rangeResponse.status, 206, "Static server must honor media byte ranges");
    assert.equal(rangeResponse.body.length, 100, "Static server must return only the requested bytes");
    assert.match(
      rangeResponse.headers["content-range"] ?? "",
      /^bytes 0-99\/\d+$/,
      "Static server must describe the fulfilled media range",
    );

    ({ browser, externallyOwned } = await openBrowser());
    context = await browser.newContext({
      reducedMotion: "reduce",
      viewport: ACTIVE_VIEWPORTS[0],
    });
    page = await context.newPage();
    page.setDefaultTimeout(5_000);
    page.setDefaultNavigationTimeout(15_000);

    const pageErrors = [];
    const resourceErrors = [];
    const successfulResources = new Set();
    const runtimeMetrics = {
      topLevelDocumentCommits: 0,
      playlistReadinessProbes: 0,
    };
    pageErrorListener = (error) => pageErrors.push(error.message);
    requestFailedListener = (request) => {
      const failure = request.failure()?.errorText ?? "unknown failure";
      if (request.url().startsWith(staticServer.baseURL)) {
        const range = request.headers().range;
        resourceErrors.push(
          `${request.method()} ${request.url()}: ${failure}${range ? ` (range ${range})` : ""}`,
        );
      }
    };
    responseListener = (localResponse) => {
      if (!localResponse.url().startsWith(staticServer.baseURL)) return;
      if (localResponse.status() >= 200 && localResponse.status() < 400) {
        successfulResources.add(new URL(localResponse.url()).pathname);
      } else {
        resourceErrors.push(`${localResponse.status()} ${localResponse.url()}`);
      }
    };
    frameNavigatedListener = (frame) => {
      if (
        frame === page.mainFrame()
        && frame.url().startsWith(staticServer.baseURL)
      ) {
        runtimeMetrics.topLevelDocumentCommits += 1;
      }
    };
    page.on("pageerror", pageErrorListener);
    page.on("requestfailed", requestFailedListener);
    page.on("response", responseListener);
    page.on("framenavigated", frameNavigatedListener);

    let response;
    try {
      response = await page.goto(`${staticServer.baseURL}/`, { waitUntil: "load" });
      await page.locator(".desktop-v2").waitFor({ state: "visible" });
      await page.locator(".stl-model-shell").waitFor({ state: "visible" });
      await waitForPortfolioReady(page, "initial load");
      await page.waitForLoadState("networkidle");
    } catch (error) {
      throw new Error(
        `Portfolio components did not load. pageErrors=${JSON.stringify(pageErrors)} resourceErrors=${JSON.stringify(resourceErrors)}`,
        { cause: error },
      );
    }
    assert.ok(response?.ok(), `Index request failed with ${response?.status() ?? "no response"}`);
    assert.deepEqual(pageErrors, [], "Uncaught page/component errors during initial load");
    assert.deepEqual(resourceErrors, [], "Local component resources failed during initial load");
    for (const requiredPath of REQUIRED_RESOURCE_PATHS) {
      assert.ok(
        successfulResources.has(requiredPath),
        `Required component resource did not complete successfully: ${requiredPath}`,
      );
    }

    await page.locator(".playlist-audio").evaluate((audio) => {
      audio.preload = "auto";
    });
    await page.locator(".music-front").click();
    await page.locator(".music-easter.open").waitFor({ state: "visible" });
    await waitForPlaylistResourceReady(page, "initial playlist setup", runtimeMetrics);
    await page.locator(".music-close").click();
    await page.locator(".music-easter:not(.open)").waitFor({ state: "visible" });

    const tabletSnapshots = new Map();
    const setupMetrics = { ...runtimeMetrics };
    assert.deepEqual(
      setupMetrics,
      {
        topLevelDocumentCommits: 1,
        playlistReadinessProbes: 1,
      },
      `Responsive setup must commit one document and run one readiness probe; observed ${JSON.stringify(setupMetrics)}`,
    );
    for (const viewport of ACTIVE_VIEWPORTS) {
      await t.test(`${viewport.width}x${viewport.height}`, { timeout: 10_000 }, async () => {
        await waitForPortfolioReady(page, `${viewport.width}x${viewport.height} pre-resize`);
        await page.setViewportSize(viewport);
        await settleResponsiveResize(page, viewport);
        const responsiveSentinels = await readResponsiveSentinels(page);
        assertResponsiveSentinels(viewport, responsiveSentinels);
        assert.deepEqual(pageErrors, [], `${viewport.width}x${viewport.height}: uncaught page/component errors`);
        assert.deepEqual(resourceErrors, [], `${viewport.width}x${viewport.height}: local component resources failed`);

        const label = `${viewport.width}x${viewport.height}`;
        const geometry = await readGeometry(page);
        assert.ok(
          geometry.document.scrollWidth <= geometry.document.clientWidth + PIXEL_TOLERANCE,
          `${label}: document must not overflow horizontally; scrollWidth=${geometry.document.scrollWidth}, clientWidth=${geometry.document.clientWidth}`,
        );
        for (const region of geometry.foreground.filter(({ visible }) => visible)) {
          assertContained(region.selector, region, geometry.desktop, label);
        }
        assertSquare("model shell", geometry.shell, label);
        assert.ok(
          Math.abs(geometry.canvas.width - geometry.canvas.height) <= PIXEL_TOLERANCE,
          `${label}: model canvas must be square; measured ${geometry.canvas.width}x${geometry.canvas.height}`,
        );
        assertSquare("outer orbit", geometry.outerOrbit, label);
        assertSquare("inner orbit", geometry.innerOrbit, label);
        assert.ok(
          geometry.outerOrbit.layoutWidth > geometry.shell.layoutWidth + PIXEL_TOLERANCE,
          `${label}: outer orbit must be larger than model shell; outer=${geometry.outerOrbit.layoutWidth}, shell=${geometry.shell.layoutWidth}`,
        );
        assert.ok(
          geometry.innerOrbit.layoutWidth < geometry.outerOrbit.layoutWidth - PIXEL_TOLERANCE,
          `${label}: inner orbit must be smaller than outer orbit; inner=${geometry.innerOrbit.layoutWidth}, outer=${geometry.outerOrbit.layoutWidth}`,
        );
        assert.ok(
          Math.abs((geometry.folder.layoutWidth / geometry.folder.layoutHeight) - FOLDER_ASPECT_RATIO) <= 0.01,
          `${label}: folder aspect ratio must be 205/124; measured ${geometry.folder.layoutWidth}/${geometry.folder.layoutHeight}`,
        );
        if (viewport.width <= 1023) {
          assert.equal(geometry.desktopLayout.display, "flex", `${label}: tablet surface must use flex flow`);
          assert.equal(geometry.desktopLayout.flexDirection, "column", `${label}: tablet flow must be a column`);
          assert.equal(geometry.desktopLayout.introPosition, "relative", `${label}: intro must be in normal flow`);
          assert.equal(geometry.desktopLayout.artifactPosition, "relative", `${label}: artifact must be in normal flow`);
          assert.equal(geometry.desktopLayout.foldersPosition, "relative", `${label}: folders must be in normal flow`);
          assert.equal(geometry.folderColumn.display, "grid", `${label}: tablet folders must use a grid`);
          assert.equal(geometry.ascii.jellyDisplay, "none", `${label}: tablet jellyfish must be hidden`);
          assert.equal(geometry.ascii.scanDisplay, "none", `${label}: tablet scan must be hidden`);
          assert.ok(geometry.ascii.mantaOpacity <= 0.5, `${label}: tablet manta must remain low-opacity`);
          assert.ok(
            geometry.ascii.field.x <= geometry.artifact.x + PIXEL_TOLERANCE
              && geometry.ascii.field.right >= geometry.artifact.right - PIXEL_TOLERANCE,
            `${label}: tablet ASCII field must span behind the artifact`,
          );
          tabletSnapshots.set(viewport.width, await snapshotRegions(page));

          if (viewport.width <= 479) {
            for (let index = 1; index < geometry.folders.length; index += 1) {
              assert.ok(
                geometry.folders[index].layoutY > geometry.folders[index - 1].layoutY + PIXEL_TOLERANCE,
                `${label}: phone folders must form one column`,
              );
            }
          } else {
            assert.ok(
              Math.abs(geometry.folders[0].layoutY - geometry.folders[1].layoutY) <= PIXEL_TOLERANCE,
              `${label}: tablet folders 1 and 2 must share the first row`,
            );
            assert.ok(
              Math.abs(geometry.folders[2].layoutY - geometry.folders[3].layoutY) <= PIXEL_TOLERANCE,
              `${label}: tablet folders 3 and 4 must share the second row`,
            );
            assert.ok(
              geometry.folders[1].layoutX > geometry.folders[0].layoutX + PIXEL_TOLERANCE,
              `${label}: tablet folders must form two columns`,
            );
          }
        }
        if (viewport.width >= 1024) {
          assert.equal(geometry.desktopLayout.display, "grid", `${label}: desktop surface must use a grid layout`);
          assert.equal(geometry.desktopLayout.introPosition, "relative", `${label}: intro must be a grid item`);
          assert.equal(geometry.desktopLayout.artifactPosition, "relative", `${label}: artifact must be a grid item`);
          assert.equal(geometry.desktopLayout.foldersPosition, "relative", `${label}: folders must be a grid item`);
          assert.ok(
            geometry.intro.width <= 361,
            `${label}: intro column must be at most 361px wide; measured ${geometry.intro.width}`,
          );
        }
        if (viewport.width >= 1440) {
          assert.ok(
            geometry.folder.layoutWidth > 205,
            `${label}: folders must grow beyond 205px; measured ${geometry.folder.layoutWidth}`,
          );
          assert.ok(
            geometry.shell.layoutWidth >= 380,
            `${label}: model shell must be at least 380px; measured ${geometry.shell.layoutWidth}`,
          );
          assert.ok(
            geometry.outerOrbit.layoutWidth >= 480,
            `${label}: outer orbit must be at least 480px; measured ${geometry.outerOrbit.layoutWidth}`,
          );
        }

        const before = await snapshotRegions(page);
        let interactionError;
        let interactionFailed = false;
        try {
          await page.locator(".music-front").click();
          await page.locator(".music-easter.open").waitFor({ state: "visible" });
          await page.waitForTimeout(60);
          assert.deepEqual(pageErrors, [], `${label}: uncaught page/component errors after music interaction`);
          assert.deepEqual(resourceErrors, [], `${label}: local resources failed after music interaction`);
          const after = await snapshotRegions(page);
          const openGeometry = await readGeometry(page);
          assertContained(".music-easter.open", openGeometry.music, openGeometry.desktop, label);
          assertDisjoint("open music player and theme control", openGeometry.music, openGeometry.theme, label);
          assertDisjoint("open music player and utility dock", openGeometry.music, openGeometry.dock, label);
          assertDisjoint("theme control and utility dock", openGeometry.theme, openGeometry.dock, label);
          for (const selector of SNAPSHOT_SELECTORS) {
            for (const property of ["x", "y", "width", "height"]) {
              const delta = Math.abs(after[selector][property] - before[selector][property]);
              assert.ok(
                delta <= PIXEL_TOLERANCE,
                `${label}: opening music player moved ${selector} ${property} by ${delta}px (before=${before[selector][property]}, after=${after[selector][property]})`,
              );
            }
          }
        } catch (error) {
          interactionFailed = true;
          interactionError = error;
          throw error;
        } finally {
          try {
            const playerIsOpen = await page.locator(".music-easter").evaluate(
              (element) => element.classList.contains("open"),
            );
            if (playerIsOpen) {
              await page.locator(".music-close").click();
              await page.locator(".music-easter:not(.open)").waitFor({ state: "visible" });
            }
          } catch (cleanupError) {
            if (!interactionFailed) throw cleanupError;
            try {
              if (interactionError && typeof interactionError === "object") {
                if (interactionError.cause === undefined) {
                  interactionError.cause = cleanupError;
                } else {
                  Object.defineProperty(interactionError, "cleanupError", {
                    configurable: true,
                    value: cleanupError,
                  });
                }
              }
            } catch {
              // Preserve the original interaction failure if diagnostics cannot be attached.
            }
          }
        }
      });
    }
    assert.deepEqual(
      runtimeMetrics,
      setupMetrics,
      `Viewport matrix must not add document commits or readiness probes; setup=${JSON.stringify(setupMetrics)} observed=${JSON.stringify(runtimeMetrics)}`,
    );
    for (const [firstWidth, secondWidth] of SEAM_PAIRS) {
      if (!tabletSnapshots.has(firstWidth) || !tabletSnapshots.has(secondWidth)) continue;
      const first = tabletSnapshots.get(firstWidth);
      const second = tabletSnapshots.get(secondWidth);
      for (const selector of [".intro-column", ".artifact-zone", ".folder-column"]) {
        for (const property of ["x", "y", "width", "height"]) {
          const delta = Math.abs(second[selector][property] - first[selector][property]);
          assert.ok(
            delta <= 2,
            `${firstWidth}/${secondWidth} seam: ${selector} ${property} changed by ${delta}px`,
          );
        }
      }
    }
  } finally {
    if (page) {
      if (pageErrorListener) page.off("pageerror", pageErrorListener);
      if (requestFailedListener) page.off("requestfailed", requestFailedListener);
      if (responseListener) page.off("response", responseListener);
      if (frameNavigatedListener) page.off("framenavigated", frameNavigatedListener);
    }
    await page?.close().catch(() => {});
    await context?.close().catch(() => {});
    // For connectOverCDP, close() releases this Playwright connection after its
    // owned context is gone; it does not kill the externally launched browser.
    await browser?.close().catch(() => {});
    await staticServer.close().catch(() => {});
    void externallyOwned;
  }
});
