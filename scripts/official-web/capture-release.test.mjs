import test from "node:test";
import assert from "node:assert/strict";
import {
  discoverResources,
  resolveAsset,
  sourcePath,
} from "./capture-release.mjs";
const origin = "https://app.raft.build";
test("whole-release discovery includes lazy chunks, exports, workers and Vite dependency tables", () => {
  const code =
    'import x from "./vendor-a.js";export {x} from "./shared-b.js";const page=()=>import("./Tasks-c.js");new Worker(new URL("./worker-d.js",import.meta.url));const deps=["assets/Role-e.js","assets/panel-f.css"];const api="/api/users";';
  const urls = discoverResources(
    code,
    "application/javascript",
    origin + "/assets/main.js",
  );
  assert.deepEqual(
    [...urls].sort(),
    [
      "panel-f.css",
      "Role-e.js",
      "shared-b.js",
      "Tasks-c.js",
      "vendor-a.js",
      "worker-d.js",
    ]
      .map((x) => origin + "/assets/" + x)
      .sort(),
  );
});
test("HTML captures all language catalogs and static entrypoints, excluding data URLs and business links", () => {
  const html =
    '<script type="module" src="/assets/index.js"></script><link rel="stylesheet" href="/assets/app.css"><script type="application/json">{"en":"/assets/en.js","zh":"/assets/zh.js"}</script><img src="data:image/png;base64,x"><a href="/api/messages">API</a>';
  assert.deepEqual(
    [...discoverResources(html, "text/html", origin + "/index.html")].sort(),
    ["app.css", "en.js", "index.js", "zh.js"]
      .map((x) => origin + "/assets/" + x)
      .sort(),
  );
});
test("CSS follows imports and font resources without reading inline SVG as network paths", () => {
  const css =
    '@import "https://fonts.googleapis.com/css2?family=Space+Grotesk";@font-face{src:url(../fonts/space.woff2)}.a{background:url("data:image/svg+xml,<svg>(x)</svg>")}';
  assert.deepEqual(
    [...discoverResources(css, "text/css", origin + "/assets/app.css")].sort(),
    [
      origin + "/fonts/space.woff2",
      "https://fonts.googleapis.com/css2?family=Space+Grotesk",
    ].sort(),
  );
});
test("static capture never follows user data, traversal, external application endpoints or placeholder routes", () => {
  for (const value of [
    "/api/messages",
    "/v3/client/roles/list",
    "data:image/png;base64,x",
    "https://outside.test/app.js",
    "/assets/${name}.js",
  ])
    assert.equal(resolveAsset(value, origin + "/assets/main.js"), null, value);
  assert.notEqual(
    sourcePath(origin + "/favicon.ico?v=1"),
    sourcePath(origin + "/favicon.ico?v=2"),
  );
  assert.ok(!sourcePath(origin + "/assets/x.js").includes(".."));
  assert.throws(() => sourcePath(origin + "/assets/%2f..%2f..%2fescape.js"));
  assert.equal(resolveAsset("https://fonts.googleapis.com/", origin), null);
});
test("bundler require-scope debug labels are not executable network imports", () => {
  const code =
    'var scope=createRequireScope("/node_modules/.pnpm/debug/lib/main.js");import "./real.js";';
  assert.deepEqual(
    [...discoverResources(code, "text/javascript", origin + "/assets/a.js")],
    [origin + "/assets/real.js"],
  );
});
