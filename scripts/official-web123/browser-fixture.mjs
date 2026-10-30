import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve, extname } from "node:path";
import { createServer } from "node:http";
import { nativeUser, instant } from "./pixel-fixture.mjs";
const fontRoot = resolve("frontends/raft/loom/fonts"),
  fontFaces = readFileSync(fontRoot + "/faces.css", "utf8"),
  fontFiles = JSON.parse(
    readFileSync(fontRoot + "/provenance.json", "utf8"),
  ).files;
export async function staticBuilds() {
  const servers = {},
    origins = {};
  for (const [arm, root] of Object.entries({
    reference: resolve("frontends/raft/upstream/web-1.21.23/packages/web/dist"),
    loom: resolve("frontends/raft/dist-native123"),
  })) {
    const server = createServer((req, res) => {
      let file = resolve(
        root,
        "." + decodeURIComponent(new URL(req.url, "http://localhost").pathname),
      );
      if (!file.startsWith(root + "/") && file !== root)
        return res.writeHead(403).end();
      if (!existsSync(file) || statSync(file).isDirectory())
        file = root + "/index.html";
      res.setHeader(
        "Content-Type",
        {
          ".js": "text/javascript",
          ".css": "text/css",
          ".html": "text/html",
          ".woff2": "font/woff2",
          ".svg": "image/svg+xml",
          ".png": "image/png",
          ".json": "application/json",
        }[extname(file)] ?? "application/octet-stream",
      );
      res.end(readFileSync(file));
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    servers[arm] = server;
    origins[arm] = "http://127.0.0.1:" + server.address().port;
  }
  return {
    origins,
    close: () =>
      Promise.all(
        Object.values(servers).map((s) => new Promise((r) => s.close(r))),
      ),
  };
}
export async function fixturePage(
  browser,
  origin,
  fixture,
  { width = 1440, height = 1000 } = {},
) {
  const context = await browser.newContext({
      viewport: { width, height },
      locale: "zh-CN",
      timezoneId: "Asia/Shanghai",
      serviceWorkers: "block",
      colorScheme: "light",
      deviceScaleFactor: 1,
    }),
    page = await context.newPage();
  const errors = [],
    unbound = [],
    consoleErrors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (e) => {
    if (e.type() === "error") consoleErrors.push(e.text());
  });
  await page.clock.setFixedTime(new Date(instant));
  page.setDefaultTimeout(12000);
  await context.routeWebSocket("**/*", (s) => s.close());
  await context.addInitScript(
    ({ user }) => {
      localStorage.setItem("slock_locale", "zh-CN");
      localStorage.setItem(
        "slock_access_token",
        "eyJhbGciOiJub25lIn0." +
          btoa(
            JSON.stringify({
              sub: user.id,
              userId: user.id,
              exp: Date.now() / 1000 + 3600,
            }),
          ) +
          ".fixture",
      );
    },
    { user: nativeUser },
  );
  await context.route("**/*", async (route) => {
    const req = route.request(),
      u = new URL(req.url()),
      path = u.pathname;
    if (u.hostname === "fonts.googleapis.com")
      return route.fulfill({ contentType: "text/css", body: fontFaces });
    if (u.hostname === "fonts.gstatic.com") {
      const file = fontFiles.find((f) => f.url === u.href);
      if (file)
        return route.fulfill({
          contentType: "font/woff2",
          body: readFileSync(fontRoot + "/" + file.file),
        });
    }
    if (
      path.startsWith("/api/") ||
      path.startsWith("/v3/") ||
      path.startsWith("/v1/local/")
    ) {
      const input = req.postData() ? req.postDataJSON() : {};
      if (path === "/api/feature-flags/evaluate")
        return route.fulfill({
          json: {
            evaluations: (input.keys ?? []).map((key) => ({
              key,
              enabled: false,
            })),
          },
        });
      if (path === "/api/auth/me/timezone-observation")
        return route.fulfill({ json: nativeUser });
      const result = fixture.handle(path, req.method(), input);
      if (result) return route.fulfill(result);
      unbound.push({ path, method: req.method() });
      return route.fulfill({
        status: 501,
        json: { error: "UNBOUND_INTERACTION_FIXTURE" },
      });
    }
    if (u.origin === origin) return route.continue();
    unbound.push({ path, method: req.method() });
    return route.abort();
  });
  return { context, page, errors, unbound, consoleErrors };
}
