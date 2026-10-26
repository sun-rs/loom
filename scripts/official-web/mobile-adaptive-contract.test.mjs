import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  readAdaptiveContract,
  compareAdaptiveContracts,
} from "./mobile-adaptive-contract.mjs";
const root = "frontends/raft/upstream/raft-mobile-source";
test("native layout contract includes navigation, density-normalized split and actual detail minimum", () => {
  const c = readAdaptiveContract(root);
  assert.equal(c.dualPaneMinimum, 840);
  assert.equal(c.densityNormalized, true);
  assert.equal(c.defaultDesktopMode, true);
  assert.equal(c.railRequiresDualPane, true);
  assert.deepEqual(c.sidebar, { default: 240, min: 200, max: 400 });
  assert.deepEqual(c.list, { default: 380, min: 240, max: 640 });
  assert.equal(c.detailMinimum, 360);
  assert.deepEqual(c.sideThread, {
    windowMinimum: 1200,
    mainMinimum: 440,
    column: 400,
    divider: 1,
    requiresMeasuredDetail: true,
  });
});
test("semantic diff names changed layout rule and preserves local implementation limits", () => {
  const a = readAdaptiveContract(root),
    b = readAdaptiveContract(root, (p) =>
      readFileSync(root + "/" + p, "utf8").replace(
        "DualPaneMinimumWidthDp = 840f",
        "DualPaneMinimumWidthDp = 900f",
      ),
    );
  assert.deepEqual(compareAdaptiveContracts(a, b), [
    { rule: "dualPaneMinimum", before: 840, after: 900 },
  ]);
  const coverage = JSON.parse(
    readFileSync("frontends/raft/loom/native-adaptive-bindings.json", "utf8"),
  );
  assert.equal(coverage.wholeProductParity, false);
  assert.ok(
    coverage.rules.every(
      (r) => r.sourcePaths.length && r.consumers.length && r.status,
    ),
  );
  assert.ok(
    coverage.rules.some((r) => ["pending", "partial"].includes(r.status)),
  );
});
test("unknown native shape fails explicitly instead of silently retaining old constants", () => {
  assert.throws(
    () => readAdaptiveContract(root, () => ""),
    /Native adaptive contract changed/,
  );
});

test("all imported native originals retain upstream hashes and binding targets exist", async () => {
  const { createHash } = await import("node:crypto");
  const { existsSync } = await import("node:fs");
  const lock = JSON.parse(readFileSync(root + "/source-lock.json", "utf8"));
  for (const f of lock.files)
    assert.equal(
      createHash("sha256")
        .update(readFileSync(root + "/" + f.path))
        .digest("hex"),
      f.sha256,
      f.path,
    );
  const map = JSON.parse(
    readFileSync("frontends/raft/loom/native-adaptive-bindings.json", "utf8"),
  );
  for (const r of map.rules) {
    for (const source of r.sourcePaths)
      assert.ok(lock.files.some((f) => f.path === source));
    for (const consumer of r.consumers)
      assert.ok(existsSync(consumer), consumer);
  }
});
