import test from "node:test";
import assert from "node:assert/strict";
import { readResource } from "../../frontends/raft/adapter123/read-resources.ts";
test("native mute and collapse settings reflect existing per-Human workspace preferences, never invented message frontiers", async () => {
  const bridge: any = {
    identity: async () => ({
      workspace: { workspaceId: "w" },
      server: { id: "w" },
      user: {},
    }),
    rooms: async () => [{ roomId: "r", kind: "channel" }],
    client: {
      request: async (op: string) => {
        assert.equal(op, "sidebar.get");
        return {
          preferences: {
            version: 8,
            mutedActivity: ["room:r"],
            expandedLongMessages: ["room:r"],
            mutedWorkspace: true,
          },
        };
      },
    },
  };
  assert.deepEqual(
    (await readResource(
      bridge,
      new URL("http://fixture/channels/r/notification-settings"),
    ))!.data,
    {
      activityMuted: true,
      activityMuteSupported: true,
      muteFromSeq: null,
      prefsVersion: 8,
    },
  );
  assert.deepEqual(
    (await readResource(
      bridge,
      new URL("http://fixture/channels/r/message-display-settings"),
    ))!.data,
    { collapseLongMessages: false, prefsVersion: 8 },
  );
  assert.deepEqual(
    (await readResource(
      bridge,
      new URL("http://fixture/servers/w/notification-settings"),
    ))!.data,
    { serverPushMuted: true, prefsVersion: 8 },
  );
});
