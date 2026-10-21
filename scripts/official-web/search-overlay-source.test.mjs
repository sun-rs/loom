import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
test("overlay body comes from pinned official source with explicit search-content binding", async () => {
  const { generateSearchOverlay } =
    await import("./generate-search-overlay.mjs");
  assert.equal(
    readFileSync(
      "frontends/raft/loom/OfficialSearchOverlay.generated.tsx",
      "utf8",
    ),
    generateSearchOverlay(),
  );
  assert.doesNotMatch(
    readFileSync("frontends/raft/loom/vite.config.ts", "utf8"),
    /importer\?\.endsWith\("\/components\/search\/SearchOverlay.tsx"\)/,
  );
  const anchor = readFileSync(
    "frontends/raft/packages/web/src/components/search/searchOverlayAnchor.ts",
    "utf8",
  );
  assert.match(anchor, /@loom\/raft-web-source\/searchOverlayAnchor/);
  assert.doesNotMatch(anchor, /function searchOverlayCardStyle/);
});
test("search overlay uses official modal without legacy backdrop blur", () => {
  const pkg = JSON.parse(
    readFileSync(
      "frontends/raft/upstream/raft-web-source/package.json",
      "utf8",
    ),
  );
  assert.equal(
    pkg.exports["./Modal"],
    "./packages/web/src/components/Modal.tsx",
  );
  assert.match(
    readFileSync(
      "frontends/raft/loom/OfficialSearchOverlay.generated.tsx",
      "utf8",
    ),
    /@loom\/raft-web-source\/Modal/,
  );
});
