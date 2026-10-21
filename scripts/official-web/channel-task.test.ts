import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LoomChannelClient } from "../../frontends/raft/loom/channel-client.ts";
import { ChannelTaskClient } from "../../frontends/raft/loom/channel-task-client.ts";
import {
  adaptTaskComposer,
  adaptTaskMessage,
} from "../../frontends/raft/loom/channel-task-adaptation.ts";
for (const action of ["create", "convert"] as const)
  test(`${action} shares the channel intent owner and replays the original task request`, async () => {
    const calls: any[] = [];
    let lost = true;
    const client = {
      request: async (op: string, p: any) => {
        calls.push([op, p]);
        if (op === "room.sync")
          return {
            cursorBefore: 1,
            cursorAfter: 1,
            latestRoomSeq: 1,
            ...(p.afterSeq ? {} : { eventFloorSeq: 1, snapshotSeq: 1 }),
            events: [],
            snapshot: p.afterSeq
              ? null
              : { room: { roomId: "r", kind: "channel" }, members: [] },
          };
        if (op === "room.acknowledge") return { acknowledgedThrough: 1 };
        if (op === `task.${action}`) {
          if (lost) {
            lost = false;
            throw Error("lost committed reply");
          }
          return { task: { taskId: "t", roomId: "r" } };
        }
        throw Error(op);
      },
    };
    const channel = new LoomChannelClient(client as any, "r", "test");
    await channel.room.syncUntilCurrent();
    const tasks = new ChannelTaskClient(channel);
    await tasks[action]("original");
    assert.equal(channel.writes.state, "unknown");
    assert.equal((await channel.send("must not send")).kind, "busy");
    await channel.writes.retry();
    const writes = calls.filter(([op]) => op.startsWith("task."));
    assert.equal(writes.length, 2);
    assert.deepEqual(writes[0], writes[1]);
    assert.equal(writes[0][1].basedOnRoomSeq, 1);
    assert.equal(writes[0][1].roomId, "r");
    assert.equal(
      writes[0][1][action === "create" ? "title" : "messageId"],
      "original",
    );
    assert.equal(
      calls.some(([op]) => op === "message.post"),
      false,
    );
  });
test("private rooms cannot expose channel task writes", async () => {
  const channel = {
    roomId: "private",
    room: { state: { snapshot: { room: { kind: "direct" } } } },
  };
  const tasks = new ChannelTaskClient(channel as any);
  await assert.rejects(async () => tasks.create("x"), /频道/);
  await assert.rejects(async () => tasks.convert("x"), /频道/);
});
test("native task toggle is delivered to the override and reset only after success", () => {
  const source = readFileSync(
    "frontends/raft/upstream/raft-web-source/packages/web/src/components/message/MessageInput.tsx",
    "utf8",
  );
  const result = adaptTaskComposer(source);
  assert.ok(
    result.includes("await onSendOverride(msg, mentionsToSend, submitAsTask);"),
  );
  assert.ok(result.includes("if (submitAsTask) setAlsoCreateTask(false);"));
  assert.throws(() => adaptTaskComposer("changed upstream"));
});
test("native message menu enables only connected read-only actions, preserves native popup and touch handlers", () => {
  const source = readFileSync(
    "frontends/raft/upstream/raft-web-source/packages/web/src/components/message/MessageItem.tsx",
    "utf8",
  );
  const result = adaptTaskMessage(source);
  assert.ok(result.includes("readOnlyProjection ? <LoomTaskMenu"));
  assert.ok(
    result.includes(
      "onTouchStart={readOnlyProjection && !loomTaskActions ? undefined : handleTouchStart}",
    ),
  );
  assert.ok(
    result.includes(
      "onClick={loomTaskActions ? () => loomTaskActions.open(linkedTask.id) : openLinkedTask}",
    ),
  );
  assert.ok(result.includes("ref={ctxMenuRef}"));
  assert.ok(result.includes("setTimeout(() => {"));
  assert.throws(() => adaptTaskMessage("changed upstream"));
});
