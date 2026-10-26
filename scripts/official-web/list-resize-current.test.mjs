import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { currentColumnRegistry } from "../../frontends/raft/loom/current-column-registry.js";
const read = (n) => readFileSync("frontends/raft/loom/" + n, "utf8");
test("list resizing uses current official keyboard/cancel lifecycle and preserves independent preferences", () => {
  for (const name of ["DiscoveryPage", "MemoryPage"]) {
    const source = read(name + ".tsx");
    assert.match(source, /<ListColumnResize/);
    assert.doesNotMatch(source, /PanelResizeHandle|panel\.handleResize/);
  }
  assert.doesNotMatch(read("useCurrentListPanel.ts"), /useResizablePanel/);
  assert.deepEqual(currentColumnRegistry.list.legacyStorageKeys, [
    "loom:activityPanelWidth",
  ]);
  assert.equal(
    currentColumnRegistry.memoryList.storageKey,
    "loom:columnWidth:memoryList",
  );
  assert.deepEqual(currentColumnRegistry.memoryList.legacyStorageKeys, [
    "loom:memoryPanelWidth",
  ]);
  assert.match(read("useCurrentListPanel.ts"), /maxWidth/);
});
