import test from "node:test";
import assert from "node:assert/strict";
import {
  TaskBoardClient,
  canEditBoardTask,
} from "../../frontends/raft/loom/task-board-client.ts";
import { WriteIntentSlot } from "@rah-os/client-core/write-intent";
const row: any = {
  canManageAnyTask: false,
  task: {
    taskId: "t",
    roomId: "r",
    state: "todo",
    creatorId: "h",
    assigneeId: "peer",
  },
};
test("Task board obeys creator/manager permissions and protocol transitions before sending", async () => {
  const client: any = {
    request: () => {
      throw Error("unexpected network");
    },
  };
  const board = new TaskBoardClient(client);
  assert.equal(canEditBoardTask(row, "peer"), false);
  assert.equal(canEditBoardTask(row, undefined), false);
  assert.equal(canEditBoardTask(row, "h"), true);
  assert.equal(
    canEditBoardTask({ ...row, canManageAnyTask: true }, "peer"),
    true,
  );
  assert.throws(() => board.update(row, "done", "h", () => {}), /不支持/);
  assert.throws(
    () => board.update(row, "in_progress", "peer", () => {}),
    /权限/,
  );
  await board.update(row, "todo", "h", () => {});
});
test("Embedded task edits reuse the channel slot and reject foreign tasks", () => {
  const writes = new WriteIntentSlot();
  const board = new TaskBoardClient(
    {} as any,
    { channel: { writes, roomId: "r" } } as any,
  );
  assert.equal(board.writes, writes);
  assert.throws(
    () =>
      board.update(
        { ...row, task: { ...row.task, roomId: "other" } },
        "in_progress",
        "h",
        () => {},
      ),
    /当前频道/,
  );
});
