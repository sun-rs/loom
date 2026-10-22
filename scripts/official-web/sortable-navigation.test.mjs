import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { extractDeclaration } from "./generate-navigation-leaves.mjs";
const read = (p) => readFileSync(p, "utf8");
test("mounted sorting declarations remain byte-exact to locked published source", () => {
  const manifest = JSON.parse(
    read(
      "frontends/raft/upstream/published-2026-10-22/navigation-manifest.json",
    ),
  );
  const generated = read(
    "frontends/raft/loom/OfficialSortableNavigation.generated.js",
  );
  for (const name of ["HTt", "UTt", "WTt", "GTt", "KTt", "qTt", "JTt"]) {
    const body = extractDeclaration(generated, name);
    assert.equal(
      createHash("sha256").update(body).digest("hex"),
      manifest.declarations.find((d) => d.name === name).sha256,
    );
  }
  assert.doesNotMatch(generated, /from ['"].*(?:auth-store|api\/)/);
  assert.match(
    read("frontends/raft/loom/Navigation.tsx"),
    /<OfficialSortableNavigation/,
  );
});
test("device order discards unknown destinations and duplicates while restoring newly available tabs", async () => {
  const { normalizeRailOrder, defaultRailOrder } =
    await import("../../frontends/raft/loom/navigation-preferences.ts");
  assert.deepEqual(
    normalizeRailOrder(["memory", "memory", "cloud", null, 42, "channels"]),
    ["memory", "channels", "activity", "tasks", "agents", "computers"],
  );
  assert.deepEqual(normalizeRailOrder({ bad: true }), defaultRailOrder);
});
