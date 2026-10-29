import test from "node:test";
import assert from "node:assert/strict";
import { partitionNativeChanges } from "./mobile-candidate-inventory.mjs";
test("new and changed native files outside the selected closure remain in the upgrade report", () => {
  const changes = [
    { status: "M", path: "compose/Pane.kt" },
    { status: "A", path: "compose/NewHost.kt" },
    { status: "D", path: "compose/OldBridge.kt" },
  ];
  const report = partitionNativeChanges(["compose/Pane.kt"], changes);
  assert.deepEqual(report.selected, [changes[0]]);
  assert.deepEqual(report.outsideLock, changes.slice(1));
});
