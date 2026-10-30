import test from "node:test";
import assert from "node:assert/strict";
import { NativeReadBridge } from "../../frontends/raft/adapter123/read-bridge.ts";
import { DEFAULT_SIDEBAR_PREFERENCES } from "@rah-os/protocol";
test("standalone chats use explicit sidebar placement; instance-private boxes never leak into the root DM list", async () => {
  const rooms = [
    { roomId: "group", kind: "channel", name: "Group" },
    { roomId: "standalone", kind: "channel", name: "Tom" },
    {
      roomId: "private",
      kind: "direct",
      name: "Private",
      instancePrivateBox: {
        instanceId: "instance",
        channelId: "group",
        active: true,
      },
    },
  ];
  const bridge = new NativeReadBridge({
    request: async (op: string) => {
      if (op === "room.list") return { rooms };
      if (op === "sidebar.get")
        return {
          preferences: {
            ...DEFAULT_SIDEBAR_PREFERENCES,
            dmOrder: ["room:standalone"],
          },
        };
      throw Error(op);
    },
  } as any);
  bridge.identity = async () => ({
    workspace: { workspaceId: "w" },
    user: {},
    server: { id: "w" },
  });
  bridge.catalog = async () => ({
    instances: [
      {
        instanceId: "solo-instance",
        agentId: "solo-agent",
        channelId: "standalone",
      },
    ],
    agents: [
      {
        definition: { agentId: "solo-agent" },
        handle: "Tom-1",
        currentRevision: { displayName: "Tom-1" },
      },
    ],
    avatars: {},
  });
  assert.deepEqual(
    (await bridge.read("/channels")).map((r: any) => r.id),
    ["group"],
  );
  const dm = await bridge.read("/channels/dm");
  assert.equal(dm.length, 1);
  assert.equal(dm[0].id, "standalone");
  assert.equal(dm[0].type, "dm");
  assert.equal(dm[0].peerId, "solo-instance");
});
