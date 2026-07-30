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
const REQUESTED_VIEWPORT = process.env.RESPONSIVE_VIEWPORT;
const ACTIVE_VIEWPORTS = REQUESTED_VIEWPORT
  ? VIEWPORTS.filter(({ width, height }) => `${width}x${height}` === REQUESTED_VIEWPORT)
  : VIEWPORTS;
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
      response.writeHead(200, {
        "content-length": fileStats.size,
        "content-type": MIME_TYPES.get(extname(canonicalFilePath).toLowerCase()) ?? "application/octet-stream",
      });
      if (method === "HEAD") {
        response.end();
        return;
      }
      createReadStream(canonicalFilePath)
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

function rawResponse(baseURL, path, method = "GET") {
  const url = new URL(baseURL);
  return new Promise((resolveResponse, rejectResponse) => {
    const request = httpRequest({
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
        introPosition: getComputedStyle(required(".intro-column")).position,
        artifactPosition: getComputedStyle(required(".artifact-zone")).position,
        foldersPosition: getComputedStyle(required(".folder-column")).position,
      },
      shell: { ...box(shell), layoutWidth: shell.offsetWidth, layoutHeight: shell.offsetHeight },
      canvas: box(canvas),
      outerOrbit: { ...box(outerOrbit), layoutWidth: outerOrbit.offsetWidth, layoutHeight: outerOrbit.offsetHeight },
      innerOrbit: { ...box(innerOrbit), layoutWidth: innerOrbit.offsetWidth, layoutHeight: innerOrbit.offsetHeight },
      folder: { ...box(folder), layoutWidth: folder.offsetWidth, layoutHeight: folder.offsetHeight },
      intro: box(required(".intro-column")),
      foreground,
    };
  }, { foregroundSelectors: SNAPSHOT_SELECTORS });
}

async function snapshotRegions(page) {
  return page.evaluate((selectors) => Object.fromEntries(selectors.map((selector) => {
    const element = document.querySelector(selector);
    if (!element) throw new Error(`Cannot snapshot missing component: ${selector}`);
    const { x, y, width, height } = element.getBoundingClientRect();
    return [selector, { x, y, width, height }];
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
  const staticServer = await startStaticServer();
  let browser;
  let context;
  let page;
  let externallyOwned = false;
  let pageErrorListener;
  let requestFailedListener;
  let responseListener;

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
    pageErrorListener = (error) => pageErrors.push(error.message);
    requestFailedListener = (request) => {
      const failure = request.failure()?.errorText ?? "unknown failure";
      if (request.url().startsWith(staticServer.baseURL)) {
        resourceErrors.push(`${request.method()} ${request.url()}: ${failure}`);
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
    page.on("pageerror", pageErrorListener);
    page.on("requestfailed", requestFailedListener);
    page.on("response", responseListener);

    let response;
    try {
      response = await page.goto(`${staticServer.baseURL}/`, { waitUntil: "load" });
      await page.locator(".desktop-v2").waitFor({ state: "visible" });
      await page.locator(".stl-model-shell").waitFor({ state: "visible" });
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

    for (const viewport of ACTIVE_VIEWPORTS) {
      await t.test(`${viewport.width}x${viewport.height}`, { timeout: 10_000 }, async () => {
        await page.setViewportSize(viewport);
        const viewportResponse = await page.reload({ waitUntil: "load" });
        assert.ok(viewportResponse?.ok(), `${viewport.width}x${viewport.height}: viewport reload failed`);
        await page.locator(".desktop-v2").waitFor({ state: "visible" });
        await page.locator(".stl-model-shell").waitFor({ state: "visible" });
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
        await page.locator(".music-front").click();
        await page.locator(".music-easter.open").waitFor({ state: "visible" });
        await page.waitForTimeout(60);
        assert.deepEqual(pageErrors, [], `${label}: uncaught page/component errors after music interaction`);
        assert.deepEqual(resourceErrors, [], `${label}: local resources failed after music interaction`);
        const after = await snapshotRegions(page);
        for (const selector of SNAPSHOT_SELECTORS) {
          for (const property of ["x", "y", "width", "height"]) {
            const delta = Math.abs(after[selector][property] - before[selector][property]);
            assert.ok(
              delta <= PIXEL_TOLERANCE,
              `${label}: opening music player moved ${selector} ${property} by ${delta}px (before=${before[selector][property]}, after=${after[selector][property]})`,
            );
          }
        }
      });
    }
  } finally {
    if (page) {
      if (pageErrorListener) page.off("pageerror", pageErrorListener);
      if (requestFailedListener) page.off("requestfailed", requestFailedListener);
      if (responseListener) page.off("response", responseListener);
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
