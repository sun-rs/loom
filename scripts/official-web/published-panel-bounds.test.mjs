import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { officialPanelLayout } from "../../frontends/raft/upstream/published-2026-10-22/panel-layout.ts";
test("sidebar bounds come from the byte-exact current published official registry", () => {
  const base = "frontends/raft/upstream/published-2026-10-22/";
  const source = readFileSync(base + "panel-layout.ts", "utf8"),
    manifest = JSON.parse(readFileSync(base + "manifest.json", "utf8"));
  const declaration = source.slice(
    source.indexOf("var Dq="),
    source.indexOf("\nexport"),
  );
  assert.equal(
    createHash("sha256").update(declaration).digest("hex"),
    manifest.declarationSha256,
  );
  assert.deepEqual(
    [
      officialPanelLayout.sidebar.min,
      officialPanelLayout.sidebar.max,
      officialPanelLayout.sidebar.defaultWidth,
    ],
    [200, 400, 240],
  );
  assert.match(
    readFileSync("frontends/raft/packages/web/src/lib/panelBounds.ts", "utf8"),
    /officialPanelLayout.sidebar/,
  );
});
