import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(
  new URL("../../frontends/raft/package.json", import.meta.url),
);
const postcss = require("postcss");
test("short viewport reuses compact composer without changing message typography or navigation", () => {
  const css = postcss.parse(
    readFileSync("frontends/raft/loom/mobile.css", "utf8"),
  );
  const media = css.nodes.find(
    (n) =>
      n.type === "atrule" &&
      n.name === "media" &&
      n.params.includes("(max-height: 600px)"),
  );
  assert.ok(media, "short viewport needs compact composer");
  const selectors = [];
  media.walkRules((r) => selectors.push(r.selector));
  assert.ok(
    selectors.every((s) => s.includes("composer")),
    "only composer gets height exception",
  );
  assert.ok(
    selectors.some(
      (s) =>
        s.includes("textarea:focus") &&
        s.includes("placeholder-shown") &&
        s.includes("data-has-accessories"),
    ),
    "draft/focus/attachment guard retained",
  );
  assert.ok(
    selectors.some((s) => s.includes("aria-checked")),
    "task selection prevents collapse",
  );
  assert.match(
    media.toString(),
    /grid-template-columns: 44px minmax\(0, 1fr\) 44px/,
  );
  assert.match(
    media.toString(),
    /\(pointer: coarse\)/,
    "touch composer keeps same policy",
  );
});
