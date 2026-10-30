import test from "node:test";
import assert from "node:assert/strict";
import {
  ClientRoomMembersListResponseSchema,
  ClientRoomTimelineResponseSchema,
  ClientRoomSyncResponseSchema,
  SidebarResponseSchema,
} from "@rah-os/protocol";
import { sdkPopulated } from "./populated-fixture.mjs";
import { sdkRead } from "./pixel-fixture.mjs";
import { FakeRahClient } from "@rah-os/client-sdk";
import { RoomSession } from "@rah-os/client-core";
import { interactionFixture, channels } from "./interaction-fixture.mjs";
import { fixtureDirectories } from "./fixture-directories.mjs";
test("pixel reference SDK fixtures obey real Room snapshot/timeline schemas, including canonical mention spans", () => {
  assert.doesNotThrow(() =>
    ClientRoomSyncResponseSchema.parse(sdkPopulated("/v3/client/rooms/sync")),
  );
  assert.doesNotThrow(() =>
    ClientRoomTimelineResponseSchema.parse(
      sdkPopulated("/v3/client/rooms/timeline"),
    ),
  );
});
test("pixel sidebar fixture satisfies its entire SDK response and cold/warm Room reads follow the actual replay contract", async () => {
  assert.doesNotThrow(() =>
    SidebarResponseSchema.parse(sdkRead("/v3/client/sidebar/get")),
  );
  const client = new FakeRahClient(async (op, input: any) =>
    sdkPopulated(
      op === "room.sync"
        ? "/v3/client/rooms/sync"
        : "/v3/client/rooms/acknowledge",
      input,
    ),
  );
  const room = new RoomSession({
    client,
    consumerId: "fixture",
    roomId: "fixture-conversation",
  });
  await room.syncUntilCurrent();
  await room.syncUntilCurrent();
  assert.equal(room.state.cursor, 3);
});
test("interaction SDK fixture enforces real sidebar schema, CAS and same-intent replay", () => {
  const f = interactionFixture("loom"),
    request = {
      workspaceId: "fixture-workspace",
      expectedVersion: 0,
      idempotencyKey: "fixture-pin",
      patch: { pinned: ["room:" + channels[0].id] },
    };
  const first = f.handle("/v3/client/sidebar/patch", "POST", request);
  assert.doesNotThrow(() => SidebarResponseSchema.parse(first.json));
  assert.deepEqual(
    f.handle("/v3/client/sidebar/patch", "POST", request),
    first,
  );
  assert.equal(f.writes.length, 1);
  assert.equal(
    f.handle("/v3/client/sidebar/patch", "POST", {
      ...request,
      idempotencyKey: "stale",
    }).status,
    409,
  );
  assert.throws(() =>
    f.handle("/v3/client/sidebar/patch", "POST", {
      ...request,
      patch: { unrecognized: true },
    }),
  );
});
test("temporary Core cleanup keeps attached/user directories and only selects recorded platform homes", () => {
  assert.deepEqual(
    fixtureDirectories([
      {
        roomId: "room-a",
        channelWorkspace: {
          primaryDirectory: "/tmp/platform/room-a",
          additionalDirectories: ["/Users/sun/Documents"],
        },
      },
      {
        roomId: "room-b",
        channelWorkspace: { primaryDirectory: "/Users/sun/Documents" },
      },
      {
        roomId: "relative",
        channelWorkspace: { primaryDirectory: "relative" },
      },
      { roomId: "none" },
    ]),
    ["/tmp/platform/room-a"],
  );
});

test("current membership oracle uses the real SDK schema independently of the native HTTP roster", () => {
  assert.doesNotThrow(() =>
    ClientRoomMembersListResponseSchema.parse(
      sdkPopulated("/v3/client/rooms/members/list"),
    ),
  );
  const f = interactionFixture("loom");
  assert.doesNotThrow(() =>
    ClientRoomMembersListResponseSchema.parse(
      f.handle("/v3/client/rooms/members/list", "POST", {
        roomId: channels[0].id,
      }).json,
    ),
  );
});
