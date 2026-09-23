import assert from "node:assert/strict";
import test from "node:test";
import type { WorkerSyncResult } from "../src/types.ts";
import { projectWorkerMessageCheck } from "../src/worker-message-projection.ts";

test("projection preserves unknown and action-changing facts, including an audit-only page cursor", () => {
  const types = [
    "run.started",
    "task.cancelled",
    "task.assigned",
    "input.resolved",
    "membership.removed",
    "future.new_fact",
  ];
  const delivery = {
    cursorBefore: 0,
    cursorAfter: 6,
    latestRoomSeq: 7,
    snapshot: null,
    events: types.map((type, i) => ({ type, roomSeq: i + 1 })),
  } as WorkerSyncResult;
  assert.deepEqual(
    projectWorkerMessageCheck(delivery).events.map((e) => e.type),
    types.slice(1),
  );
  assert.equal(delivery.events.length, 6);
  const auditOnly = projectWorkerMessageCheck({
    ...delivery,
    events: delivery.events.slice(0, 1),
    cursorAfter: 1,
  });
  assert.deepEqual(auditOnly.events, []);
  assert.equal(auditOnly.cursorAfter, 1);
});
