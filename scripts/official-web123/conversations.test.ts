import test from "node:test";
import assert from "node:assert/strict";
import { NativeCommands } from "../../frontends/raft/adapter123/commands.ts";
import { DEFAULT_SIDEBAR_PREFERENCES } from "@rah-os/protocol";
import { RahClientError } from "@rah-os/client-sdk";
function fixture() {
  const calls: any[] = [],
    rooms: any[] = [],
    instances: any[] = [];
  const role = {
    roleId: "role",
    roleRevisionId: "rev",
    configuration: { displayName: "Tom" },
  };
  const preferences = structuredClone({
    ...DEFAULT_SIDEBAR_PREFERENCES,
    version: 3,
    mutedActivity: ["room:unrelated"],
  });
  let rejectPlacement = false,
    loseInstantiation = false;
  const bridge: any = {
    identity: async () => ({
      workspace: { workspaceId: "w", controlRoomId: "control" },
      server: { id: "w" },
      user: { id: "human" },
    }),
    catalog: async () => ({ roles: [role], instances }),
    rooms: async () => rooms,
    invalidate: () => {},
    read: async (path: string) => {
      assert.equal(path, "/channels/dm");
      return rooms
        .filter((r) => preferences.dmOrder.includes("room:" + r.roomId))
        .map((r) => ({
          id: r.roomId,
          type: "dm",
          peerId: instances.find((i) => i.channelId === r.roomId)?.instanceId,
        }));
    },
    client: {
      request: async (op: string, input: any) => {
        calls.push([op, structuredClone(input)]);
        if (op === "sidebar.get")
          return { preferences: structuredClone(preferences) };
        if (op === "room.create") {
          const room = { roomId: "created", kind: "channel", name: input.name };
          rooms.push(room);
          return { room };
        }
        if (op === "role.instantiate") {
          let instance = instances.find((i) => i.channelId === input.channelId);
          if (!instance) {
            instance = {
              roleId: input.roleId,
              instanceId: "new-instance",
              channelId: input.channelId,
              agentId: "new-agent",
            };
            instances.push(instance);
          }
          if (loseInstantiation) {
            loseInstantiation = false;
            throw new TypeError("accepted reply lost");
          }
          return { instance };
        }
        if (op === "sidebar.patch") {
          if (rejectPlacement) {
            rejectPlacement = false;
            throw new RahClientError("stale_sidebar", "sidebar changed", 409);
          }
          Object.assign(preferences, input.patch);
          preferences.version++;
          return { preferences: structuredClone(preferences) };
        }
        throw Error(op);
      },
    },
  };
  const commands = new NativeCommands(
    bridge,
    () =>
      ({
        syncUntilCurrent: async () => ({
          caughtUp: true,
          state: { latestRoomSeq: 12 },
        }),
      }) as any,
  );
  return {
    commands,
    calls,
    rooms,
    instances,
    preferences,
    rejectPlacement: () => {
      rejectPlacement = true;
    },
    loseInstantiation: () => {
      loseInstantiation = true;
    },
  };
}
test("native Role DM creates a normal Channel plus one new instance and explicitly classifies it, preserving unrelated preferences", async () => {
  const f = fixture(),
    r: any = await f.commands.write("post", "/channels/dm", {
      agentId: "role",
    });
  assert.equal(r.id, "created");
  assert.equal(r.peerId, "new-instance");
  assert.deepEqual(
    f.calls.filter(([op]) => op !== "sidebar.get").map(([op]) => op),
    ["room.create", "role.instantiate", "sidebar.patch"],
  );
  assert.equal(
    f.calls.find(([op]) => op === "room.create")![1].kind,
    "channel",
  );
  assert.equal(
    f.calls.find(([op]) => op === "role.instantiate")![1].channelId,
    "created",
  );
  assert.equal(
    f.calls.some(([op]) => op === "room.direct.open"),
    false,
  );
  assert.deepEqual(f.preferences.mutedActivity, ["room:unrelated"]);
});
test("reopening Role DM reuses only an explicitly placed single-instance Channel, including a hidden DM", async () => {
  const f = fixture();
  f.rooms.push(
    { roomId: "existing", kind: "channel" },
    { roomId: "ordinary", kind: "channel" },
  );
  f.instances.push(
    { instanceId: "peer", roleId: "role", channelId: "existing" },
    { instanceId: "ordinary-peer", roleId: "role", channelId: "ordinary" },
  );
  f.preferences.dmOrder = ["room:existing"];
  f.preferences.hiddenDms = ["room:existing"];
  const r: any = await f.commands.write("post", "/channels/dm", {
    agentId: "role",
  });
  assert.equal(r.id, "existing");
  assert.deepEqual(f.preferences.hiddenDms, []);
  assert.equal(
    f.calls.some(([op]) => op === "room.create" || op === "role.instantiate"),
    false,
  );
});
test("known placement failure retains confirmed creation steps for explicit continuation; never creates a second room or instance", async () => {
  const f = fixture();
  f.rejectPlacement();
  await assert.rejects(
    () => f.commands.write("post", "/channels/dm", { agentId: "role" }),
    /sidebar changed/,
  );
  const r: any = await f.commands.write("post", "/channels/dm", {
    agentId: "role",
  });
  assert.equal(r.id, "created");
  assert.equal(f.calls.filter(([op]) => op === "room.create").length, 1);
  assert.equal(f.calls.filter(([op]) => op === "role.instantiate").length, 1);
});
test("unknown accepted instance creation holds the original native request and exact key; placement waits for verification", async () => {
  const f = fixture();
  f.loseInstantiation();
  let settled = false;
  const pending = f.commands
    .write("post", "/channels/dm", { agentId: "role" })
    .then((r) => {
      settled = true;
      return r;
    });
  for (let i = 0; i < 20 && f.commands.writes.state !== "unknown"; i++)
    await new Promise((r) => setImmediate(r));
  assert.equal(f.commands.writes.state, "unknown");
  assert.equal(settled, false);
  assert.equal(
    f.calls.some(([op]) => op === "sidebar.patch"),
    false,
  );
  await f.commands.verify();
  await pending;
  const sends = f.calls.filter(([op]) => op === "role.instantiate");
  assert.equal(sends.length, 2);
  assert.deepEqual(sends[0][1], sends[1][1]);
  assert.equal(f.instances.length, 1);
  assert.equal(f.rooms.length, 1);
});
test("native root DM refuses Instance and other-Human identities instead of leaking a Channel-private box into global DM", async () => {
  const f = fixture();
  f.instances.push({
    instanceId: "instance",
    roleId: "role",
    channelId: "group",
  });
  await assert.rejects(
    () => f.commands.write("post", "/channels/dm", { agentId: "instance" }),
    /Role/,
  );
  await assert.rejects(
    () => f.commands.write("post", "/channels/dm", { userId: "other" }),
    /Human|Role/,
  );
  assert.deepEqual(f.calls, []);
});
