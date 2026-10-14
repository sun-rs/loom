import { createServer } from "node:http";
import { readFile, stat, mkdir } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import assert from "node:assert/strict";
import { chromium } from "playwright";

// Build-only smoke test. No Raft server, credentials, or provider execution.
const root = resolve("frontends/raft/packages/web/dist");
const output = resolve(
  process.env.LOOM_OFFICIAL_WEB_EVIDENCE ?? "/tmp/loom-official-web-baseline",
);
await mkdir(output, { recursive: true });
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(
      new URL(req.url, "http://localhost").pathname,
    );
    let path = resolve(root, "." + pathname);
    if (path !== root && !path.startsWith(root + sep)) {
      res.writeHead(403).end();
      return;
    }
    if (pathname.startsWith("/api/") || pathname.startsWith("/socket.io")) {
      res.writeHead(503, { "content-type": "application/json" }).end(
        JSON.stringify({
          error:
            "Upstream services intentionally unavailable in source baseline",
        }),
      );
      return;
    }
    try {
      if (!(await stat(path)).isFile()) path = resolve(root, "index.html");
    } catch {
      path = resolve(root, "index.html");
    }
    res
      .writeHead(200, {
        "content-type": mime[extname(path)] ?? "application/octet-stream",
      })
      .end(await readFile(path));
  } catch {
    res.writeHead(500).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: 1,
      serviceWorkers: "block",
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/*", (route) =>
      new URL(route.request().url()).origin === origin
        ? route.continue()
        : route.abort(),
    );
    await page.goto(origin, { waitUntil: "networkidle" });
    await page.locator('input[type="email"]').waitFor({ state: "visible" });
    await page.locator('input[type="password"]').waitFor({ state: "visible" });
    const text = await page.locator("body").innerText();
    assert.ok(text.trim().length > 0, "Official app rendered empty body");
    assert.deepEqual(errors, [], "Uncaught browser errors");
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
      "Official startup shell overflows viewport",
    );
    await page.screenshot({
      path: resolve(output, `${viewport.width}.png`),
      fullPage: true,
    });
    results.push({
      viewport,
      errors,
      text,
      horizontalOverflow: await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    });
    await context.close();
  }
  const { writeFile } = await import("node:fs/promises");
  await writeFile(
    resolve(output, "browser.json"),
    JSON.stringify(
      { kind: "upstream-startup-only-not-Loom-acceptance", results },
      null,
      2,
    ) + "\n",
  );
  console.log(JSON.stringify(results));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
