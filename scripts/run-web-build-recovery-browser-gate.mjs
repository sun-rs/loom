import {
  recoveryAssetPath,
  recoveryShell,
} from "../packages/daemon/src/web-recovery-assets.ts";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium, webkit } from "playwright";

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

const browser = await (
  process.env.RAH_RECOVERY_ENGINE === "webkit" ? webkit : chromium
).launch({ headless: true });
try {
  const regressions = await Promise.allSettled([
    verifyDelayedProbe(),
    verifyResponseDelivery(),
  ]);
  assert.deepEqual(
    regressions.filter((r) => r.status === "rejected"),
    [],
  );
  await verifyNetworkImportFailure();
  await verifyDesktop();
  await verifyMobile();
  await verifyHistoricalResponse();
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
    await page.evaluate(() => document.activeElement?.getAttribute("role")),
    "dialog",
  );
  for (const button of await dialog.getByRole("button").all()) {
    await button.hover();
    await page.waitForTimeout(150);
    const style = await button.evaluate((n) => {
      const s = getComputedStyle(n);
      return { transform: s.transform, outline: s.outlineColor };
    });
    assert.equal(style.transform, "matrix(1, 0, 0, 1, 0, -1)");
    assert.notEqual(style.outline, "rgb(255, 212, 59)");
  }
  assert.equal(
    await page.locator("[data-refresh]").evaluate((n) => n.tagName),
    "A",
  );
  assert.ok(await page.locator("[data-refresh]").getAttribute("href"));
  assert.equal(page.url(), deepLink);
  await page.getByRole("button", { name: "仍然继续", exact: true }).click();
  assert.equal(await page.locator(".rah-web-build-refresh-banner").count(), 0);
  assert.equal(await page.locator("#root").evaluate((n) => n.inert), false);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForTimeout(200);
  assert.equal(await page.getByRole("dialog").count(), 0);
  advertisedBuildId = metadata.webBuildId;
  await page.reload({ waitUntil: "domcontentloaded" });
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

  await page.evaluate(() =>
    Object.defineProperty(navigator.serviceWorker, "getRegistrations", {
      configurable: true,
      value: () => new Promise(() => {}),
    }),
  );
  advertisedBuildId = metadata.webBuildId;
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 5000 }),
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
  if (
    url.pathname.startsWith("/v") ||
    (url.pathname.startsWith("/_rah/") &&
      !url.pathname.startsWith("/_rah/recover/"))
  ) {
    response.statusCode = 503;
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.end(JSON.stringify({ code: "test_gateway_unavailable" }));
    return;
  }
  const relativePath =
    url.pathname === "/"
      ? "index.html"
      : (recoveryAssetPath(url.pathname) ?? url.pathname).slice(1);
  const filePath = resolve(staticDirectory, relativePath);
  if (!filePath.startsWith(`${staticDirectory}${sep}`)) {
    response.statusCode = 404;
    response.end();
    return;
  }
  try {
    if (!(await stat(filePath)).isFile()) throw new Error("not a file");
    let body = await readFile(filePath);
    if (url.searchParams.has("rah_recover") && relativePath === "index.html") {
      body = Buffer.from(
        recoveryShell(body.toString(), url.searchParams.get("rah_recover")),
      );
    }
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

async function verifyHistoricalResponse() {
  advertisedBuildId = metadata.webBuildId;
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(deepLink, { waitUntil: "domcontentloaded" });
  await page.route("**/historical-response", (route) =>
    route.fulfill({
      status: 200,
      headers: { "x-rah-web-build-id": "cached-old-build" },
      body: "old cached resource",
    }),
  );
  const completed = await page.evaluate(async () =>
    Promise.race([
      fetch("/historical-response").then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), 1500)),
    ]),
  );
  assert.equal(
    completed,
    true,
    "historical resource must not block a current page",
  );
  assert.equal(await page.getByRole("dialog").count(), 0);
  await context.close();
}

async function verifyDelayedProbe() {
  advertisedBuildId = metadata.webBuildId;
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  try {
    const page = await context.newPage();
    await page.route("**/*rah_build_probe=*", () => {});
    await page.goto(deepLink, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () => document.querySelector("#root")?.childElementCount > 0,
      {},
      { timeout: 2500 },
    );
  } finally {
    await context.close();
  }
}

async function verifyResponseDelivery() {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(deepLink, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () => document.querySelector("#root")?.childElementCount > 0,
    );
    await page.route("**/*rah_build_probe=*", (route) =>
      route.fulfill({
        status: 200,
        headers: { "x-rah-web-build-id": "confirmed-next-build" },
        body: "",
      }),
    );
    await page.route("**/accepted-data", (route) =>
      route.fulfill({
        status: 200,
        headers: { "x-rah-web-build-id": "confirmed-next-build" },
        contentType: "application/json",
        body: JSON.stringify({ accepted: true }),
      }),
    );
    const result = await page.evaluate(() =>
      Promise.race([
        fetch("/accepted-data").then((response) => response.json()),
        new Promise((resolve) => setTimeout(() => resolve("blocked"), 1500)),
      ]),
    );
    assert.deepEqual(
      result,
      { accepted: true },
      "a refresh prompt must not withhold successful API data",
    );
    await page.getByRole("dialog").waitFor();
    await page.getByRole("button", { name: "仍然继续", exact: true }).click();
    assert.equal(await page.locator("#root").evaluate((n) => n.inert), false);
  } finally {
    await context.close();
  }
}

async function verifyNetworkImportFailure() {
  advertisedBuildId = metadata.webBuildId;
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    serviceWorkers: "block",
  });
  try {
    const page = await context.newPage();

    await page.route("**/mount-app-*.js", (route) =>
      route.abort("internetdisconnected"),
    );
    await page.goto(deepLink, { waitUntil: "domcontentloaded" });
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    assert.match(await dialog.innerText(), /页面资源加载失败/);
    assert.doesNotMatch(await dialog.innerText(), /较旧的应用版本/);
    assert.equal(
      await dialog.locator("[data-continue]").count(),
      0,
      "cannot continue into an unmounted blank page",
    );
    for (let attempt = 0; attempt < 2; attempt++) {
      await Promise.all([
        page.waitForNavigation({
          waitUntil: "domcontentloaded",
          timeout: 5000,
        }),
        dialog.getByRole("button", { name: "重新加载", exact: true }).click(),
      ]);
      await dialog.waitFor();
      assert.match(await dialog.innerText(), /页面资源加载失败/);
      assert.doesNotMatch(await dialog.innerText(), /较旧的应用版本/);
    }
    await page.unroute("**/mount-app-*.js");
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 5000 }),
      dialog.getByRole("button", { name: "重新加载", exact: true }).click(),
    ]);
    await page.waitForFunction(
      () => document.querySelector("#root")?.childElementCount > 0,
    );
    assert.equal(await page.getByRole("dialog").count(), 0);
    assert.equal(page.url(), deepLink);
  } finally {
    await context.close();
  }
}
