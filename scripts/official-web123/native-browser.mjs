import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { resolve, extname } from "node:path";
import { chromium } from "playwright";
import { responseFor, user, server as workspace } from "./fixtures.mjs";
const root = resolve(
    process.env.LOOM_WEB123_DIST ??
      "frontends/raft/upstream/web-1.21.23/packages/web/dist",
  ),
  out = process.env.LOOM_WEB123_EVIDENCE ?? "/tmp/loom-web123-native";
mkdirSync(out, { recursive: true });
const server = createServer((req, res) => {
  const path = resolve(
    root,
    "." + decodeURIComponent(new URL(req.url, "http://localhost").pathname),
  );
  if (!path.startsWith(root + "/") && path !== root) {
    res.writeHead(403).end();
    return;
  }
  const file = existsSync(path) && extname(path) ? path : root + "/index.html";
  const types = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".woff2": "font/woff2",
    ".svg": "image/svg+xml",
    ".png": "image/png",
  };
  try {
    res.setHeader(
      "content-type",
      types[extname(file)] ?? "application/octet-stream",
    );
    res.end(readFileSync(file));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = "http://127.0.0.1:" + server.address().port;
const browser = await chromium.launch({ headless: true }),
  results = [];
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
        viewport: { width, height: width === 390 ? 844 : 1000 },
        locale: "zh-CN",
        timezoneId: "Asia/Shanghai",
        serviceWorkers: "block",
      }),
      page = await context.newPage(),
      unsupported = [],
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await context.routeWebSocket("**/*", (s) => s.close());
    await context.addInitScript(
      ({ user }) => {
        const token =
          "eyJhbGciOiJub25lIn0." +
          btoa(
            JSON.stringify({
              sub: user.id,
              userId: user.id,
              exp: Math.floor(Date.now() / 1000) + 3600,
            }),
          ) +
          ".fixture";
        localStorage.setItem("slock_access_token", token);
        localStorage.setItem("slock_locale", "zh-CN");
      },
      { user },
    );
    await context.route("**/*", (route) => {
      const r = route.request(),
        url = new URL(r.url());
      const fixture = responseFor(r);
      if (fixture !== undefined)
        return route.fulfill({ status: 200, json: fixture });
      if (
        url.origin === origin &&
        !url.pathname.startsWith("/api/") &&
        !url.pathname.startsWith("/socket.io")
      )
        return route.continue();
      unsupported.push({ method: r.method(), path: url.pathname });
      return route.fulfill({
        status: 501,
        json: { error: "UNBOUND_NATIVE_FIXTURE", path: url.pathname },
      });
    });
    await page.goto(origin + "/s/" + workspace.slug + "/");
    await page
      .getByRole("button", { name: workspace.name, exact: true })
      .waitFor({ timeout: 15000 });
    await page
      .locator("body")
      .screenshot({ path: out + "/native-" + width + ".png" });
    results.push({
      width,
      errors,
      unsupported,
      title: await page.title(),
      body: (await page.locator("body").innerText()).slice(0, 1500),
    });
    await context.close();
  }
  writeFileSync(
    out + "/report.json",
    JSON.stringify(
      { fixtureOnly: true, productionData: false, results },
      null,
      2,
    ) + "\n",
  );
  console.log(JSON.stringify(results));
  assert.deepEqual(
    results.flatMap((r) => r.errors),
    [],
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
