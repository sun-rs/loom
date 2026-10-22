import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
test("migration inventory covers every navigation destination and only cites existing implementation owners", () => {
  const inventory = JSON.parse(
    readFileSync("frontends/raft/loom/dependency-migration.json", "utf8"),
  );
  const nav = readFileSync("frontends/raft/loom/Navigation.tsx", "utf8")
    .split("export const destinations = [")[1]
    .split("] as const")[0];
  const ids = [...nav.matchAll(/id: "([^"]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(inventory.surfaces.map((s) => s.id).sort(), ids);
  for (const entry of [...inventory.surfaces, ...inventory.crossCutting]) {
    assert.ok(["mixed", "loom-native-composition"].includes(entry.status));
    assert.ok(entry.retainedBoundaries.length > 0);
    assert.equal(
      "remaining" in entry,
      false,
      "Permanent Loom owners must not masquerade as unfinished migration tasks",
    );
    assert.ok(entry.sources.length > 0);
    for (const path of entry.sources)
      assert.ok(existsSync("frontends/raft/" + path), path);
  }
  assert.equal(inventory.wholeSiteDependencyComplete, false);
});

test("remaining presentation work is enumerated separately from permanent Loom bindings", () => {
  const inventory = JSON.parse(
    readFileSync("frontends/raft/loom/dependency-migration.json", "utf8"),
  );
  assert.ok(Array.isArray(inventory.openMigrationWork));
  assert.equal(
    new Set(inventory.openMigrationWork.map((x) => x.id)).size,
    inventory.openMigrationWork.length,
  );
  for (const item of inventory.openMigrationWork) {
    assert.ok(item.acceptance && item.sourceBoundary && item.files.length);
    for (const file of item.files)
      assert.ok(existsSync("frontends/raft/" + file), file);
  }
});

test("fixed-source migration closure accounts for all reviewed composition groups", () => {
  const inventory = JSON.parse(
    readFileSync("frontends/raft/loom/dependency-migration.json", "utf8"),
  );
  assert.equal(inventory.plannedMigrationComplete, true);
  assert.deepEqual(inventory.openMigrationWork, []);
  for (const id of [
    "identity-master-detail",
    "resource-only-shell",
    "local-exclusive-compositions",
  ]) {
    const group = inventory.reviewedCompositionGroups.find((x) => x.id === id);
    assert.ok(
      group?.decision &&
        Object.keys(group.bindings).length &&
        group.evidence.length,
    );
    for (const file of Object.keys(group.bindings))
      assert.ok(existsSync("frontends/raft/loom/" + file));
  }
  assert.equal(
    inventory.wholeSiteDependencyComplete,
    false,
    "Closure does not claim zero local composition or arbitrary latest upstream parity",
  );
});
