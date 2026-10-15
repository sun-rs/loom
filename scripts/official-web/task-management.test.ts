import test from "node:test";
import assert from "node:assert/strict";
import { LoomTaskClient } from "../../frontends/raft/loom/task-client.ts";
import {
  TaskHistoryReader,
  toTaskHistoryEvent,
} from "../../frontends/raft/loom/task-history.ts";
for (const assigneeId of ["member-b", null])
  test(`task assignment ${assigneeId} freezes identity and exact retry after a lost response`, async () => {
    const writes: any[] = [];
    let lost = true;
    const client = {
      request: async (op: string, p: any) => {
        if (op === "task.get") return { task: { taskId: "t", roomId: "r" } };
        if (op === "principal.me")
          return { principal: { principalId: "human" } };
        if (op === "room.sync")
          return {
            cursorBefore: 1,
            cursorAfter: 1,
            latestRoomSeq: 1,
            ...(p.afterSeq ? {} : { eventFloorSeq: 1, snapshotSeq: 1 }),
            events: [],
            snapshot: p.afterSeq
              ? null
              : { room: { roomId: "r" }, members: [] },
          };
        if (op === "room.acknowledge") return { acknowledgedThrough: 1 };
        if (op === "task.assign" || op === "task.unassign") {
          writes.push([op, p]);
          if (lost) {
            lost = false;
            throw Error("lost committed response");
          }
          return { task: { taskId: "t", roomId: "r" } };
        }
        throw Error(op);
      },
    };
    const bridge = new LoomTaskClient(client as any, "r", "t");
    await bridge.refresh();
    await bridge.assign(assigneeId);
    assert.equal(bridge.writes.state, "unknown");
    await bridge.writes.retry();
    assert.equal(writes.length, 2);
    assert.deepEqual(writes[0], writes[1]);
    assert.equal(writes[0][0], assigneeId ? "task.assign" : "task.unassign");
    assert.equal(writes[0][1].taskId, "t");
    assert.equal(writes[0][1].basedOnRoomSeq, 1);
  });
test("history pages preserve task identity and frozen query scope", async () => {
  let wrong = false;
  const client = {
    request: async (_op: string, p: any) => ({
      taskId: wrong ? "foreign" : "t",
      frozenThroughRoomSeq: 10,
      events: p.cursor
        ? [{ eventId: "e1", roomSeq: 1, type: "task.created" }]
        : [{ eventId: "e2", roomSeq: 2, type: "task.assigned" }],
      ...(p.cursor ? {} : { nextCursor: "older" }),
    }),
  };
  const reader = new TaskHistoryReader(client as any, "r", "t");
  await reader.refresh();
  wrong = true;
  await assert.rejects(reader.older(), /任务/);
  assert.equal(reader.events.length, 1);
  wrong = false;
  await reader.older();
  assert.deepEqual(
    reader.events.map((e) => e.eventId),
    ["e2", "e1"],
  );
});
test("history renders canonical workflow and readable names, not IDs or provider state", () => {
  const event = toTaskHistoryEvent(
    {
      eventId: "e",
      roomSeq: 9,
      type: "task.assigned",
      actorId: "h",
      assigneeId: "a",
      createdAt: "now",
    },
    3,
    [
      { principalId: "h", kind: "human", handle: "owner" },
      { principalId: "a", kind: "agent", handle: "Tom-2" },
    ] as any,
  );
  assert.equal(event.actorName, "owner");
  assert.equal(event.eventType, "assignee_changed");
  assert.equal(event.payload.assigneeId, "a");
  assert.equal(event.payload.assigneeType, "agent");
  const state = toTaskHistoryEvent(
    {
      eventId: "s",
      roomSeq: 10,
      type: "task.workflow_updated",
      actorId: "unknown",
      workflowStatus: "in_review",
      previousWorkflowStatus: "in_progress",
      createdAt: "now",
    },
    3,
    [],
  );
  assert.equal(state.eventType, "status_changed");
  assert.equal(state.payload.to, "in_review");
  assert.equal(state.actorName, "已离开的成员");
});
