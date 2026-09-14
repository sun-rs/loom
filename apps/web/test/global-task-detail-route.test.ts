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
  assert.deepEqual(
    globalTaskDetailFromSearch("?surface=room&target=task&task=t&room=r"),
    { roomId: "r", taskId: "t" },
  );
  assert.equal(
    globalTaskDetailFromSearch("?surface=tasks&target=task&task=t"),
    undefined,
  );
});

test("chat task links open the shared task modal and close back to the channel", () => {
  const input = "?target=task&room=r&task=t&thread=r%3Am&threadId=th";
  assert.deepEqual(globalTaskDetailFromSearch(input), {
    roomId: "r",
    taskId: "t",
    rootMessageId: "m",
  });
  const closed = new URLSearchParams(closeGlobalTaskSearch(input));
  assert.equal(closed.get("room"), "r");
  assert.notEqual(closed.get("surface"), "tasks");
  assert.equal(closed.has("task"), false);
});
