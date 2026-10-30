import test from "node:test";
import assert from "node:assert/strict";
import { NativeCommands } from "../../frontends/raft/adapter123/commands.ts";
const session = () => ({
  syncUntilCurrent: async () => ({
    caughtUp: true,
    state: { latestRoomSeq: 7 },
  }),
});
test("native send holds the same UI promise on unknown, never sends a replacement, and verifies the frozen SDK intent explicitly", async () => {
  const calls: any[] = [];
  const bridge = {
    client: {
      request: async (op: string, payload: any) => {
        calls.push([op, structuredClone(payload)]);
        if (calls.length === 1) throw Error("response lost");
        return {
          event: {
            payload: { messageId: "message", body: "hello" },
            roomId: "channel",
            roomSeq: 8,
            actorId: "human",
            createdAt: "2026-10-30T00:00:00Z",
          },
        };
      },
    },
    identity: async () => ({
      workspace: { controlRoomId: "control", workspaceId: "workspace" },
      user: { id: "human", name: "Sun", displayName: "Sun" },
    }),
  } as any;
  const commands = new NativeCommands(bridge, session as any);
  let settled = false;
  const pending = commands
    .write("post", "/v2/messages", { channelId: "channel", content: "hello" })
    .then((r) => {
      settled = true;
      return r;
    });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(commands.writes.state, "unknown");
  assert.equal(settled, false);
  assert.equal(calls.length, 1);
  await assert.rejects(
    () =>
      commands.write("post", "/v2/messages", {
        channelId: "channel",
        content: "another",
      }),
    /上一项/,
  );
  assert.equal(calls.length, 1);
  await commands.verify();
  const result = await pending;
  assert.equal(result.message.id, "message");
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(commands.writes.state, "idle");
});
test("native viewport acknowledgment sends its observed Room frontier; it never marks unseen messages or deliveries read", async () => {
  const calls: any[] = [];
  const bridge = {
    client: {
      request: async (op: string, input: any) => {
        calls.push([op, input]);
        return { readThroughSeq: 17, doneThroughSeq: 0 };
      },
    },
    identity: async () => ({
      workspace: { workspaceId: "w" },
      user: { id: "human" },
    }),
  } as any;
  const commands = new NativeCommands(bridge, session as any);
  await commands.write("post", "/channels/room-A/read", { seq: 17 });
  assert.deepEqual(calls, [
    [
      "activity.mark",
      { roomId: "room-A", throughSeq: 17, action: "read", source: "viewport" },
    ],
  ]);
});
