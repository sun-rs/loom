import test from "node:test";
import assert from "node:assert/strict";
import { routeChannelWorkspace } from "../src/client-channel-workspace-routes.ts";
test("workspace route authorizes channel membership before and after async host reads", async () => {
  let allowed = true;
  let calls = 0;
  const room = {
    roomId: "r",
    channelWorkspace: {
      kind: "channel_home",
      primaryDirectory: "/allowed",
      additionalDirectories: [],
    },
  };
  const human = { listRooms: () => (allowed ? [room] : []) };
  const port = async () => {
    calls++;
    allowed = false;
    return { kind: "changes", entries: [], truncated: false };
  };
  const run = () =>
    routeChannelWorkspace(
      human as never,
      {} as never,
      {
        roomId: "r",
        operation: "changes",
        rootId: "runtime-project",
        path: "",
        includeHidden: false,
      },
      port as never,
    );
  await assert.rejects(run(), /access/);
  assert.equal(calls, 1);
  await assert.rejects(run(), /access/);
  assert.equal(calls, 1);
});
