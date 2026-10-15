import test from "node:test";
import assert from "node:assert/strict";
import {
  LoomTaskClient,
  toOfficialTask,
} from "../../frontends/raft/loom/task-client.ts";
import { taskWorkflowStatus } from "@rah-os/protocol";
test("task projection uses canonical workflow, not execution phase", () => {
  for (const state of [
    "todo",
    "claimed",
    "waiting_input",
    "blocked",
    "submitted",
    "completed",
    "cancelled",
  ] as const) {
    const task = {
      taskId: "t",
      roomId: "r",
      sourceMessageId: "m",
      threadId: "th",
      state,
      creatorId: "h",
      taskNumber: 1,
      title: "Work",
      createdAt: "2026-10-15T00:00:00Z",
      updatedAt: "2026-10-15T00:00:00Z",
    };
    const result = toOfficialTask(task as any, "Room", []);
    assert.equal(result.status, taskWorkflowStatus(state));
    assert.equal(result.messageId, "m");
    assert.equal(result.id, "t");
  }
});
test("task update freezes task, room causal basis and workflow across lost response", async () => {
  const calls: any[] = [];
  let lost = true;
  const task = { taskId: "t", roomId: "r", state: "todo", creatorId: "h" };
  const client = {
    request: async (op: string, p: any) => {
      calls.push([op, p]);
      if (op === "task.get") return { task };
      if (op === "room.sync")
        return {
          cursorBefore: 1,
          cursorAfter: 1,
          latestRoomSeq: 1,
          ...(p.afterSeq ? {} : { eventFloorSeq: 1, snapshotSeq: 1 }),
          events: [],
          snapshot: p.afterSeq ? null : { room: { roomId: "r" }, members: [] },
        };
      if (op === "room.acknowledge") return { acknowledgedThrough: 1 };
      if (op === "task.workflow.update") {
        if (lost) {
          lost = false;
          throw Error("lost");
        }
        return { task: { ...task, state: "completed" } };
      }
      throw Error(op);
    },
  };
  const bridge = new LoomTaskClient(client as any, "r", "t");
  await bridge.refresh();
  await bridge.update("done");
  assert.equal(bridge.writes.state, "unknown");
  await bridge.writes.retry();
  const writes = calls.filter(([op]) => op === "task.workflow.update");
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[0], writes[1]);
  assert.equal(writes[0][1].taskId, "t");
  assert.equal(writes[0][1].workflowStatus, "done");
  assert.equal(writes[0][1].basedOnRoomSeq, 1);
});
test("task detail rejects a foreign task before a write", async () => {
  const client = {
    request: async (op: string) => {
      if (op === "task.get")
        return { task: { taskId: "other", roomId: "elsewhere" } };
      if (op === "room.sync")
        return {
          cursorBefore: 0,
          cursorAfter: 0,
          latestRoomSeq: 0,
          events: [],
          snapshot: { room: { roomId: "r" }, members: [] },
        };
      return { acknowledgedThrough: 0 };
    },
  };
  const bridge = new LoomTaskClient(client as any, "r", "t");
  await assert.rejects(bridge.refresh(), /任务/);
  await assert.rejects(bridge.update("done"), /读取/);
});
