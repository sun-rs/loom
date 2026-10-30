import test from "node:test";
import assert from "node:assert/strict";
import { NativeCommands } from "../../frontends/raft/adapter123/commands.ts";
import { RahClientError } from "@rah-os/client-sdk";
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
test("native sidebar writes keep the UI revision and unknown intent, and refuse a stale view before overwriting", async () => {
  const preferences: any = {
    version: 7,
    pinned: [],
    channelOrder: [],
    dmOrder: [],
    hiddenDms: [],
    customSections: [],
    sectionOrder: [],
    channelPanelTabOrder: [],
    channelSortMode: "manual",
    dmSortMode: "manual",
    pinnedSortMode: "manual",
  };
  const calls: any[] = [];
  const bridge: any = {
    identity: async () => ({
      workspace: { workspaceId: "w" },
      server: { id: "w" },
    }),
    sidebarPeers: async () => new Map(),
    client: {
      request: async (op: string, input: any) => {
        if (op === "sidebar.get") return { preferences };
        calls.push(structuredClone(input));
        if (calls.length === 1) throw Error("receipt lost");
        return { preferences: { ...preferences, ...input.patch, version: 8 } };
      },
    },
  };
  const commands = new NativeCommands(bridge, session as any);
  await assert.rejects(
    () =>
      commands.write("patch", "/servers/w/sidebar-order", {
        loomPrefsVersion: 6,
        pinned: [{ kind: "channel", id: "alpha" }],
      }),
    (e: any) => e instanceof RahClientError && e.status === 409,
  );
  assert.equal(calls.length, 0);
  let settled = false;
  const pending = commands
    .write("patch", "/servers/w/sidebar-order", {
      loomPrefsVersion: 7,
      pinned: [{ kind: "channel", id: "alpha" }],
    })
    .then((value) => {
      settled = true;
      return value;
    });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(settled, false);
  assert.equal(commands.writes.state, "unknown");
  // Verification must reuse the frozen payload even if another read sees a new version.
  preferences.version = 42;
  await commands.verify();
  const value: any = await pending;
  assert.deepEqual(value.pinned, [{ kind: "channel", id: "alpha" }]);
  assert.equal(value.sectionsVersion, 8);
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(calls[0].expectedVersion, 7);
  assert.deepEqual(calls[0].patch, { pinned: ["room:alpha"] });
});
