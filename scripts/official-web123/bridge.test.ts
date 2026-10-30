import { nativeAvatarUrl } from "../../frontends/raft/adapter123/avatars.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { NativeReadBridge } from "../../frontends/raft/adapter123/read-bridge.ts";
test("native Agent list projects Role IDs while channel senders remain instance IDs; read bridge cannot execute writes", async () => {
  const calls: any[] = [];
  const client = {
    request: async (name: string, body: any) => {
      calls.push([name, body]);
      switch (name) {
        case "workspace.list":
          return {
            workspaces: [
              {
                workspaceId: "workspace",
                controlRoomId: "control",
                state: "active",
                name: "Loom",
                slug: "loom",
                createdAt: "2026-10-30T00:00:00Z",
              },
            ],
          };
        case "principal.me":
          return {
            principal: { principalId: "human", handle: "Sun", kind: "human" },
          };
        case "role.list":
          return {
            roles: [
              {
                roleId: "role",
                controlRoomId: "control",
                createdAt: "2026-10-30T00:00:00Z",
                updatedAt: "2026-10-30T00:00:00Z",
                configuration: {
                  displayName: "Tom",
                  handle: "Tom",
                  description: "Remark",
                  instructions: "SECRET PROMPT",
                  avatarKey: "pixel:owl",
                },
              },
            ],
            instances: [
              {
                instanceId: "instance",
                agentId: "agent",
                roleId: "role",
                channelId: "channel",
              },
            ],
          };
        case "agent.list":
          return {
            agents: [
              {
                definition: {
                  agentId: "agent",
                  participantId: "instance",
                  state: "enabled",
                },
                handle: "Tom-1",
                instanceChannelId: "channel",
                currentRevision: {
                  displayName: "Tom-1",
                  avatarKey: "pixel:robot",
                },
              },
            ],
          };
        case "agent.presence.list":
          return { agents: [] };
        case "agent.get":
          return { policy: { modelIntent: { fallback: "disabled" } } };
        case "host.runtime.list":
          return { runtimes: [] };
        case "room.list":
          return {
            rooms: [
              {
                roomId: "channel",
                workspaceId: "workspace",
                kind: "channel",
                name: "Discussion",
                createdAt: "2026-10-30T00:00:00Z",
              },
            ],
          };
        default:
          throw Error("unexpected SDK read " + name);
      }
    },
  } as any;
  const bridge = new NativeReadBridge(client);
  const roles = await bridge.read("/agents");
  assert.equal(roles[0].id, "role");
  assert.equal(roles[0].name, "Tom");
  assert.equal(roles[0].description, "Remark");
  assert.equal(JSON.stringify(roles).includes("SECRET PROMPT"), false);
  const instance = await bridge.read("/agents/instance");
  assert.equal(instance.id, "instance");
  assert.equal(instance.name, "Tom-1");
  assert.equal(instance.avatarUrl, nativeAvatarUrl("pixel:owl"));
  await assert.rejects(() => bridge.read("/agents/role/stop"), /UNBOUND/);
  assert.ok(
    calls.every(
      ([name]) => !name.endsWith(".revise") && !name.endsWith(".post"),
    ),
  );
});
test("native member reads use current membership rather than an old Room bootstrap, without replay or read acknowledgement", async () => {
  const calls: any[] = [];
  const old = { principalId: "old", handle: "Old", kind: "agent" };
  const fresh = { principalId: "new", handle: "New", kind: "agent" };
  const bridge = new NativeReadBridge({
    request: async (op: string, input: any) => {
      calls.push([op, input]);
      if (op === "room.member.list")
        return { memberships: [{ principalId: "new" }] };
      if (op === "room.sync") return { snapshot: { members: [fresh] } };
      throw Error(op);
    },
  } as any);
  const state = {
    snapshot: { members: [old] },
    cursor: 27,
    acknowledgedThrough: 19,
  };
  bridge.channel = () =>
    ({ room: { state, syncUntilCurrent: async () => {} } }) as any;
  assert.deepEqual((await bridge.channelView("channel")).members, [fresh]);
  assert.deepEqual(
    calls.map(([op]) => op),
    ["room.member.list", "room.sync"],
  );
  assert.equal(calls[1][1].bootstrap, "latest");
  assert.equal(calls[1][1].limit, 1);
  assert.equal(state.cursor, 27);
  assert.equal(state.acknowledgedThrough, 19);
});
