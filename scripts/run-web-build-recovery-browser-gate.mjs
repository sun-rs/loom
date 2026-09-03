import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryDirectory = resolve(scriptDirectory, "..");
const staticDirectory = join(
  repositoryDirectory,
  "apps",
  "web",
  "dist-workbench",
);
const metadata = JSON.parse(
  await readFile(join(staticDirectory, ".rah-web-build.json"), "utf8"),
);
assert.equal(metadata.schemaVersion, 1);
assert.match(metadata.webBuildId, /^[a-f0-9]{64}$/u);

let advertisedBuildId = "replacement-build";
const server = createServer((request, response) => {
  void serve(request, response).catch((error) => {
    response.statusCode = 500;
    response.setHeader("content-type", "text/plain; charset=utf-8");
    response.end(error instanceof Error ? error.message : String(error));
  });
});
await new Promise((resolvePromise, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolvePromise);
});
const address = server.address();
assert(address && typeof address !== "string");
const origin = `http://127.0.0.1:${String(address.port)}`;
const deepLink = `${origin}/?room=room-recovery&surface=settings&settingsSection=notifications`;

const browser = await chromium.launch({ headless: true });
try {
  await verifyDesktop();
  await verifyMobile();
  process.stdout.write(
    `${JSON.stringify({
      desktopScreenshot: "/tmp/rah-web-build-recovery-desktop.png",
      mobileScreenshot: "/tmp/rah-web-build-recovery-mobile.png",
      origin,
      webBuildId: metadata.webBuildId,
    })}\n`,
  );
} finally {
  await browser.close();
  await new Promise((resolvePromise, reject) => {
    server.close((error) => (error ? reject(error) : resolvePromise()));
  });
}

async function verifyDesktop() {
  advertisedBuildId = "replacement-build-desktop";
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();
  await page.goto(deepLink, { waitUntil: "domcontentloaded" });
  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ state: "visible" });
  await page.screenshot({
    path: "/tmp/rah-web-build-recovery-desktop.png",
    fullPage: false,
  });
  assert.equal(
    await page.evaluate(() => document.activeElement?.textContent?.trim()),
    "立即刷新",
  );
  assert.equal(page.url(), deepLink);
  await page.getByRole("button", { name: "仍然继续", exact: true }).click();
  await page.getByRole("status").waitFor({ state: "visible" });
  assert.match(await page.getByRole("status").innerText(), /有新版本/u);

  advertisedBuildId = metadata.webBuildId;
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded" }),
    page
      .getByRole("status")
      .getByRole("button", { name: "刷新", exact: true })
      .click(),
  ]);
  await page.waitForTimeout(250);
  assert.equal(page.url(), deepLink);
  assert.equal(await page.getByRole("dialog").count(), 0);
  assert.equal(await page.getByRole("status").count(), 0);
  await context.close();
}

async function verifyMobile() {
  advertisedBuildId = "replacement-build-mobile";
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  await page.goto(deepLink, { waitUntil: "domcontentloaded" });
  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ state: "visible" });
  const card = page.locator(".rah-web-build-refresh-card");
  const refresh = page.getByRole("button", { name: "立即刷新", exact: true });
  const continueAnyway = page.getByRole("button", {
    name: "仍然继续",
    exact: true,
  });
  const [cardBox, refreshBox, continueBox] = await Promise.all([
    card.boundingBox(),
    refresh.boundingBox(),
    continueAnyway.boundingBox(),
  ]);
  assert(cardBox && refreshBox && continueBox);
  assert(cardBox.x >= 0 && cardBox.x + cardBox.width <= 390);
  assert.equal(Math.round(refreshBox.width), Math.round(continueBox.width));
  assert(continueBox.y > refreshBox.y + refreshBox.height);
  await page.screenshot({
    path: "/tmp/rah-web-build-recovery-mobile.png",
    fullPage: false,
  });

  advertisedBuildId = metadata.webBuildId;
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded" }),
    refresh.click(),
  ]);
  await page.waitForTimeout(250);
  assert.equal(page.url(), deepLink);
  assert.equal(await page.getByRole("dialog").count(), 0);
  await context.close();
}

async function serve(request, response) {
  response.setHeader("x-rah-web-build-id", advertisedBuildId);
  response.setHeader("cache-control", "no-store");
  const url = new URL(request.url ?? "/", origin);
  if (url.pathname.startsWith("/v") || url.pathname.startsWith("/_rah/")) {
    response.statusCode = 503;
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.end(JSON.stringify({ code: "test_gateway_unavailable" }));
    return;
  }
  const relativePath =
    url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  const filePath = resolve(staticDirectory, relativePath);
  if (!filePath.startsWith(`${staticDirectory}${sep}`)) {
    response.statusCode = 404;
    response.end();
    return;
  }
  try {
    if (!(await stat(filePath)).isFile()) throw new Error("not a file");
    const body = await readFile(filePath);
    response.statusCode = 200;
    response.setHeader("content-type", contentType(filePath));
    response.end(request.method === "HEAD" ? undefined : body);
  } catch {
    response.statusCode = 404;
    response.end();
  }
}

function contentType(filePath) {
  return (
    {
      ".css": "text/css; charset=utf-8",
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".svg": "image/svg+xml",
      ".woff": "font/woff",
      ".woff2": "font/woff2",
    }[extname(filePath)] ?? "application/octet-stream"
  );
}
