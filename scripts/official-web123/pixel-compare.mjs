import {
  nativePopulated,
  sdkPopulated,
  roomId,
  lastMessage,
} from "./populated-fixture.mjs";
import assert from "node:assert/strict";
import { comparePixels } from "./pixels.mjs";
import {
  readFileSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  statSync,
} from "node:fs";
import { createServer } from "node:http";
import { resolve, extname } from "node:path";
import { createRequire } from "node:module";
import { chromium } from "playwright";
import {
  nativeRead,
  sdkRead,
  nativeUser,
  slug,
  instant,
} from "./pixel-fixture.mjs";
const require = createRequire(
    resolve("frontends/raft/upstream/web-1.21.23/packages/web/package.json"),
  ),
  sharp = require("sharp");
const fontRoot = resolve("frontends/raft/loom/fonts"),
  fontFaces = readFileSync(fontRoot + "/faces.css", "utf8"),
  fontFiles = JSON.parse(
    readFileSync(fontRoot + "/provenance.json", "utf8"),
  ).files;
const out = process.env.LOOM_WEB123_PIXEL_EVIDENCE ?? "/tmp/loom-web123-pixel";
mkdirSync(out, { recursive: true });
const roots = {
  reference: resolve("frontends/raft/upstream/web-1.21.23/packages/web/dist"),
  loom: resolve("frontends/raft/dist-native123"),
};
const servers = {};
for (const [k, root] of Object.entries(roots)) {
  const server = createServer((req, res) => {
    let path = resolve(
      root,
      "." + decodeURIComponent(new URL(req.url, "http://localhost").pathname),
    );
    if (!path.startsWith(root + "/") && path !== root) {
      res.writeHead(403).end();
      return;
    }
    if (!existsSync(path) || statSync(path).isDirectory())
      path = root + "/index.html";
    const types = {
      ".js": "text/javascript",
      ".css": "text/css",
      ".html": "text/html",
      ".json": "application/json",
      ".woff2": "font/woff2",
      ".svg": "image/svg+xml",
      ".png": "image/png",
    };
    res.setHeader(
      "content-type",
      types[extname(path)] ?? "application/octet-stream",
    );
    res.end(readFileSync(path));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  servers[k] = server;
}
const browser = await chromium.launch({ headless: true }),
  results = [],
  gaps = [],
  calibrations = [];
try {
  for (const width of [1440, 390]) {
    const captures = {};
    for (const arm of ["reference", "loom"]) {
      const origin = "http://127.0.0.1:" + servers[arm].address().port;
      const context = await browser.newContext({
          viewport: { width, height: width === 390 ? 844 : 1000 },
          locale: "zh-CN",
          timezoneId: "Asia/Shanghai",
          serviceWorkers: "block",
          colorScheme: "light",
          deviceScaleFactor: 1,
        }),
        page = await context.newPage(),
        unbound = [],
        errors = [],
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
          if (location.pathname.includes("/s/")) {
            const token =
              "eyJhbGciOiJub25lIn0." +
              btoa(
                JSON.stringify({
                  sub: user.id,
                  userId: user.id,
                  exp: Date.now() / 1000 + 3600,
                }),
              ) +
              ".fixture";
            localStorage.setItem("slock_access_token", token);
          }
        },
        { user: nativeUser },
      );
      let populated = false;
      await context.route("**/*", (route) => {
        const request = route.request(),
          u = new URL(request.url()),
          path = u.pathname;
        if (u.hostname === "fonts.googleapis.com")
          return route.fulfill({
            status: 200,
            contentType: "text/css",
            body: fontFaces,
          });
        if (u.hostname === "fonts.gstatic.com") {
          const file = fontFiles.find((f) => f.url === u.href);
          if (file)
            return route.fulfill({
              status: 200,
              contentType: "font/woff2",
              body: readFileSync(fontRoot + "/" + file.file),
            });
          if (u.pathname.endsWith("ieVn2YZDLWuGJpnzaiwFXS9tYtpd59CxCis4.woff2"))
            return route.fulfill({
              status: 200,
              contentType: "font/woff2",
              body: readFileSync(
                resolve("frontends/raft/adapter123/assets/quote.woff2"),
              ),
            });
        }
        if (path.startsWith("/v3/") || path.startsWith("/v1/local/")) {
          const data = populated
            ? sdkPopulated(path, request.postDataJSON() ?? {})
            : sdkRead(path);
          if (arm === "loom" && data !== undefined)
            return route.fulfill({ status: 200, json: data });
        }
        if (path.startsWith("/api/")) {
          const nativePath = path.slice(4),
            data = populated
              ? nativePopulated(nativePath, request.method())
              : nativeRead(nativePath);
          if (
            data !== undefined &&
            (request.method() === "GET" ||
              (populated && nativePath.endsWith("/read")))
          )
            return route.fulfill({ status: 200, json: data });
          if (nativePath === "/feature-flags/evaluate")
            return route.fulfill({
              status: 200,
              json: {
                evaluations: (request.postDataJSON()?.keys ?? []).map(
                  (key) => ({ key, enabled: false }),
                ),
              },
            });
          if (nativePath === "/auth/me/timezone-observation")
            return route.fulfill({ status: 200, json: nativeUser });
          unbound.push({ path, method: request.method() });
          return route.fulfill({
            status: 501,
            json: { error: "UNBOUND_PIXEL_FIXTURE" },
          });
        }
        if (u.origin === origin) return route.continue();
        unbound.push({ path, method: request.method() });
        return route.abort();
      });
      captures[arm] = {};
      for (const [state, path] of [
        ["chat", "/"],
        ["activity", "/activity"],
        ["tasks", "/tasks"],
        ["members", "/members"],
        ["computers", "/computers"],
        ["appearance", "/settings/appearance"],
        ["conversation", "/channel/" + roomId],
      ].filter(
        ([state]) =>
          !process.env.LOOM_NATIVE_PIXEL_STATES ||
          process.env.LOOM_NATIVE_PIXEL_STATES.split(",").includes(state),
      )) {
        populated = state === "conversation";
        await page.goto(origin + "/s/" + slug + path);
        await page
          .locator("body button:visible")
          .first()
          .waitFor({ timeout: 12000 });
        await page.waitForFunction(
          () => !document.querySelector('[role="progressbar"]'),
        );
        if (populated)
          await page
            .getByText(lastMessage, { exact: true })
            .waitFor()
            .catch(async (error) => {
              await page.screenshot({
                path: out + "/failed-" + arm + "-" + width + ".png",
              });
              writeFileSync(
                out + "/failure.json",
                JSON.stringify(
                  {
                    arm,
                    width,
                    url: page.url(),
                    error: error.message,
                    errors,
                    unbound,
                    body: await page.locator("body").innerText(),
                  },
                  null,
                  2,
                ),
              );
              throw error;
            });
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(2500);
        const file = out + "/" + arm + "-" + width + "-" + state + ".png";
        await page.screenshot({ path: file, animations: "disabled" });
        captures[arm][state] = file;
        assert.equal(
          new URL(page.url()).pathname,
          "/s/" + slug + path,
          "unexpected route/redirect",
        );
        const fonts = await page.evaluate(() =>
          Array.from(document.fonts)
            .filter((f) => f.status === "loaded")
            .map((f) => f.family),
        );
        assert.ok(
          fonts.some((f) => f.includes("Space Grotesk")),
          "official text font must be loaded",
        );
        if (arm === "reference" && state === "chat") {
          await page.evaluate(
            () =>
              (document.getElementById("root").style.transform =
                "translateX(1px)"),
          );
          const changed = await page.screenshot({ animations: "disabled" });
          await page.evaluate(
            () => (document.getElementById("root").style.transform = ""),
          );
          const original = await sharp(file)
              .ensureAlpha()
              .raw()
              .toBuffer({ resolveWithObject: true }),
            shifted = await sharp(changed)
              .ensureAlpha()
              .raw()
              .toBuffer({ resolveWithObject: true });
          const result = comparePixels(original, shifted);
          assert.ok(
            result.differingPixels > 0,
            "one-pixel browser displacement must fail comparison",
          );
          calibrations.push({
            width,
            displacement: 1,
            differingPixels: result.differingPixels,
          });
        }
      }
      gaps.push({ arm, width, errors, unbound, consoleErrors });
      assert.ok(
        unbound.every(
          (r) =>
            r.path === "/api/billing/subscription" ||
            /^\/api\/attachments\/upload-sessions\/[^/]+\/active$/.test(r.path),
        ),
        "unexpected unbound native fixture route",
      );
      const unexpected = consoleErrors.filter(
        (text) =>
          !text.startsWith(
            "[Push] Failed to register service worker: TypeError: Cannot read properties of undefined",
          ) &&
          !(
            arm === "reference" &&
            unbound.length &&
            text ===
              "Failed to load resource: the server responded with a status of 501 (Not Implemented)"
          ),
      );
      assert.deepEqual(errors, [], "browser runtime errors");
      assert.deepEqual(
        unexpected,
        [],
        "unexpected fixture/adapter errors; equality of broken pages cannot pass",
      );
      await context.close();
    }
    for (const state of Object.keys(captures.reference)) {
      const a = await sharp(captures.reference[state])
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true }),
        b = await sharp(captures.loom[state])
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });
      const { diff, ...stats } = comparePixels(a, b);
      if (stats.differingPixels)
        await sharp(diff, { raw: a.info })
          .png()
          .toFile(out + "/diff-" + width + "-" + state + ".png");
      results.push({ width, state, ...stats });
    }
  }
  writeFileSync(
    out + "/report.json",
    JSON.stringify(
      {
        source: "db5e399",
        ui: "0.7.0",
        reference: "Unchanged original full App build",
        loom: "Original full App + SDK boundary; independent SDK fixture DTOs",
        fixtureOnly: true,
        productionData: false,
        unmasked: true,
        fixedClock: instant,
        calibrations,
        results,
        gaps,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(JSON.stringify(results));
  assert.ok(
    results.every((r) => r.differingPixels === 0),
    "native pixel differences remain; inspect report and diff images",
  );
} finally {
  await browser.close();
  for (const server of Object.values(servers))
    await new Promise((r) => server.close(r));
}
