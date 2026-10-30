import test from "node:test";
import assert from "node:assert/strict";
import { NativeCommands } from "../../frontends/raft/adapter123/commands.ts";
import { observedAgentControls } from "../../frontends/raft/adapter123/agent-controls.ts";
import { RahClientError } from "@rah-os/client-sdk";
const prefs = () => ({
  version: 4,
  pinned: [],
  channelOrder: [],
  dmOrder: [],
  hiddenDms: [],
  customSections: [],
  sectionOrder: [],
  channelPanelTabOrder: [],
  mutedActivity: [],
  mutedWorkspace: false,
  expandedLongMessages: [],
  channelSortMode: "manual",
  dmSortMode: "manual",
  pinnedSortMode: "manual",
});
function fixture() {
  const calls: any[] = [],
    p = prefs();
  const role: any = {
    roleId: "role",
    roleRevisionId: "revision",
    configuration: { displayName: "Tom", instructions: "prompt" },
  };
  const instances = [
    {
      roleId: "role",
      instanceId: "instance-a",
      agentId: "agent-a",
      channelId: "channel",
    },
    {
      roleId: "role",
      instanceId: "instance-b",
      agentId: "agent-b",
      channelId: "other",
    },
  ];
  const catalog: any = {
    roles: [role],
    deletedRoles: [],
    instances,
    agents: instances.map((i) => ({
      definition: {
        agentId: i.agentId,
        participantId: i.instanceId,
        state: "enabled",
      },
    })),
  };
  const room: any = {
    roomId: "channel",
    name: "Before",
    visibility: "private",
    description: "before",
    kind: "channel",
  };
  const bridge: any = {
    identity: async () => ({
      workspace: { workspaceId: "w", controlRoomId: "control" },
      server: { id: "w" },
      user: { id: "human" },
    }),
    catalog: async () => catalog,
    rooms: async () => [room],
    agent: async (id: string) => ({ id }),
    channelDto: (r: any) => ({ id: r.roomId, name: r.name }),
    client: {
      request: async (op: string, input: any) => {
        calls.push([op, structuredClone(input)]);
        if (op === "sidebar.get") return { preferences: p };
        if (op === "sidebar.patch") {
          Object.assign(p, input.patch);
          p.version++;
          return { preferences: p };
        }
        if (op === "room.update") return { room: { ...room, ...input } };
        if (op === "room.archive" || op === "room.unarchive")
          return {
            room: { ...room, archivedAt: op === "room.archive" ? "now" : null },
          };
        if (op === "room.delete")
          return { roomId: input.roomId, deletedAt: "now" };
        return {};
      },
    },
  };
  const commands = new NativeCommands(
    bridge,
    () =>
      ({
        syncUntilCurrent: async () => ({
          caughtUp: true,
          state: { latestRoomSeq: 8 },
        }),
      }) as any,
  );
  return { commands, calls, p, room, catalog };
}
test("native channel edit/archive/delete preserve Room identity and historical visibility and use the Room causal owner", async () => {
  const f = fixture();
  assert.deepEqual(
    await f.commands.write("patch", "/channels/channel", {
      name: "After",
      description: "updated",
    }),
    { id: "channel", name: "After" },
  );
  const input = f.calls.find(([op]) => op === "room.update")![1];
  assert.equal(input.visibility, "private");
  assert.equal(input.basedOnRoomSeq, 8);
  assert.equal(input.roomId, "channel");
  await f.commands.write("post", "/channels/channel/archive");
  await f.commands.write("post", "/channels/channel/unarchive");
  await f.commands.write("delete", "/channels/channel");
  assert.deepEqual(
    f.calls.filter(([op]) => op.startsWith("room.")).map(([op]) => op),
    ["room.update", "room.archive", "room.unarchive", "room.delete"],
  );
});
test("native notification/display preferences keep unrelated keys and reject stale observed versions", async () => {
  const f = fixture();
  f.p.mutedActivity = ["room:unrelated"];
  const result: any = await f.commands.write(
    "patch",
    "/channels/channel/notification-settings",
    { activityMuted: true, loomPrefsVersion: 4 },
  );
  assert.equal(result.activityMuted, true);
  assert.equal(result.prefsVersion, 5);
  assert.deepEqual(f.p.mutedActivity, ["room:unrelated", "room:channel"]);
  await assert.rejects(
    () =>
      f.commands.write("patch", "/channels/channel/message-display-settings", {
        collapseLongMessages: false,
        loomPrefsVersion: 4,
      }),
    (e: any) => e.status === 409,
  );
  await f.commands.write(
    "patch",
    "/channels/channel/message-display-settings",
    { collapseLongMessages: false, loomPrefsVersion: 5 },
  );
  assert.deepEqual(f.p.expandedLongMessages, ["room:channel"]);
  const writes = f.calls.filter(([op]) => op === "sidebar.patch");
  assert.equal(writes.length, 2);
  assert.deepEqual(Object.keys(writes[1][1].patch), ["expandedLongMessages"]);
});
test("Role deletion only deletes configuration; instance deletion removes its actual membership", async () => {
  const f = fixture();
  await f.commands.write("delete", "/agents/role", { workspace: "keep" });
  assert.equal(f.calls.at(-1)[0], "role.delete");
  assert.equal(f.calls.at(-1)[1].expectedRoleRevisionId, "revision");
  assert.equal(
    f.calls.some(([op]) => op === "agent.manage"),
    false,
  );
  await f.commands.write("delete", "/agents/instance-a", { workspace: "keep" });
  assert.equal(f.calls.at(-1)[0], "room.member.remove");
  assert.equal(f.calls.at(-1)[1].principalId, "instance-a");
  await assert.rejects(
    () => f.commands.write("delete", "/agents/role", { workspace: "delete" }),
    /工作区/,
  );
});
test("Role start/stop targets frozen instances' real Agent IDs; reset modes never discard workspaces", async () => {
  const f = fixture();
  await f.commands.write("post", "/agents/role/stop");
  assert.deepEqual(
    f.calls.map(([, p]) => [p.agentId, p.state]),
    [
      ["agent-a", "disabled"],
      ["agent-b", "disabled"],
    ],
  );
  f.calls.length = 0;
  await f.commands.write("post", "/agents/instance-a/start");
  assert.equal(f.calls[0][1].agentId, "agent-a");
  assert.equal(f.calls[0][1].state, "enabled");
  f.calls.length = 0;
  await f.commands.write("post", "/agents/instance-a/reset", {
    mode: "session",
  });
  assert.equal(f.calls[0][0], "instance.session.reset");
  assert.equal(f.calls[0][1].instanceId, "instance-a");
  assert.equal(Object.hasOwn(f.calls[0][1], "adoptRoleRevisionId"), false);
  await assert.rejects(
    () => f.commands.write("post", "/agents/role/reset", { mode: "full" }),
    /工作区|不支持/,
  );
});
test("lifecycle cache refresh waits for the authoritative result and never synthesizes working/offline presence", async () => {
  let finish: () => void = () => {},
    refreshed = 0;
  const controls = observedAgentControls(
    () =>
      new Promise<void>((r) => {
        finish = r;
      }),
    async () => {
      refreshed++;
    },
    () => {},
  );
  const result = controls.startAgent("instance");
  assert.equal(refreshed, 0);
  finish();
  await result;
  assert.equal(refreshed, 1);
});
test("a Role editor cannot overwrite a newer immutable revision", async () => {
  const f = fixture();
  await assert.rejects(
    () =>
      f.commands.write("patch", "/agents/role", {
        description: "stale",
        loomExpectedRoleRevisionId: "older",
      }),
    (e: any) => e.status === 409,
  );
  assert.equal(f.calls.length, 0);
});
test("native member selection creates distinct instances from Roles, while removal checks the actual channel", async () => {
  const f = fixture();
  const result: any = await f.commands.write(
    "post",
    "/channels/channel/members/batch",
    { agentIds: ["role"], userIds: [] },
  );
  assert.deepEqual(result.added.agentIds, ["role"]);
  assert.equal(f.calls[0][0], "role.instantiate");
  assert.equal(f.calls[0][1].channelId, "channel");
  await assert.rejects(
    () =>
      f.commands.write("delete", "/channels/other/members/agent/instance-a"),
    /频道/,
  );
  await f.commands.write(
    "delete",
    "/channels/channel/members/agent/instance-a",
  );
  assert.equal(f.calls.at(-1)[1].principalId, "instance-a");
});
test("Role batch controls skip removed instances and stop after a confirmed rejection", async () => {
  const f = fixture();
  f.catalog.agents[0].definition.state = "tombstoned";
  await f.commands.write("post", "/agents/role/stop");
  assert.deepEqual(
    f.calls.map(([, p]) => p.agentId),
    ["agent-b"],
  );
  const g = fixture(),
    attempts: any[] = [];
  (g.commands.bridge.client as any).request = async (
    op: string,
    input: any,
  ) => {
    attempts.push([op, input]);
    throw new RahClientError("forbidden", "denied", 403);
  };
  await assert.rejects(
    () => g.commands.write("post", "/agents/role/stop"),
    /denied/,
  );
  assert.equal(attempts.length, 1);
});
test("preserving-session restart uses the instance state lane and never the forbidden legacy Agent reset", async () => {
  const f = fixture();
  await f.commands.write("post", "/agents/instance-a/reset", {
    mode: "restart",
  });
  assert.deepEqual(
    f.calls.map(([op, p]) => [op, p.agentId, p.state]),
    [
      ["agent.manage", "agent-a", "disabled"],
      ["agent.manage", "agent-a", "enabled"],
    ],
  );
});
