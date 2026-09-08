import assert from "node:assert/strict";
import test from "node:test";
import {
  closeGlobalTaskSearch,
  globalTaskDetailFromSearch,
} from "../src/global-task-detail-route.ts";
import { normalizeDiscoveryParams } from "../src/raft-discovery-controls.ts";

test("Task modal deep links survive filter normalization and close without losing the board filters", () => {
  const input =
    "?surface=tasks&room=r&target=task&task=t&thread=r%3Am&threadId=th&channel=r&channel=r2&creator=h&assignee=a&view=list";
  assert.deepEqual(
    globalTaskDetailFromSearch(`?${normalizeDiscoveryParams(input, "tasks")}`),
    { roomId: "r", taskId: "t", rootMessageId: "m" },
  );
  const closed = new URLSearchParams(closeGlobalTaskSearch(input));
  assert.equal(globalTaskDetailFromSearch(`?${closed}`), undefined);
  assert.deepEqual(closed.getAll("channel"), ["r", "r2"]);
  for (const [key, value] of [
    ["creator", "h"],
    ["assignee", "a"],
    ["view", "list"],
  ])
    assert.equal(closed.get(key!), value);
  for (const key of ["task", "thread", "threadId", "target"])
    assert.equal(closed.has(key), false);
  assert.equal(
    globalTaskDetailFromSearch("?surface=room&target=task&task=t&room=r"),
    undefined,
  );
  assert.equal(
    globalTaskDetailFromSearch("?surface=tasks&target=task&task=t"),
    undefined,
  );
});
