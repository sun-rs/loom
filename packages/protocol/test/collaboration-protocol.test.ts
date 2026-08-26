import assert from "node:assert/strict";
import test from "node:test";

import {
  MembershipRoleSchema,
  RoomKindSchema,
  RoomMembershipSchema,
  RoomSchema,
  ThreadSchema,
  WorkspaceSchema,
} from "../src/index.ts";

test("Workspace, Room roles, and Thread are strict provider-independent collaboration objects", () => {
  assert.deepEqual(
    WorkspaceSchema.parse({
      createdAt: "2026-08-26T00:00:00.000Z",
      name: "RAH OS",
      slug: "rah-os",
      state: "active",
      workspaceId: "workspace-rah-os",
    }),
    {
      createdAt: "2026-08-26T00:00:00.000Z",
      name: "RAH OS",
      slug: "rah-os",
      state: "active",
      workspaceId: "workspace-rah-os",
    },
  );
  assert.equal(RoomKindSchema.parse("control"), "control");
  assert.equal(MembershipRoleSchema.parse("owner"), "owner");
  assert.deepEqual(
    RoomSchema.parse({
      createdAt: "2026-08-26T00:00:00.000Z",
      kind: "channel",
      name: "Core",
      roomId: "room-core",
      slug: "core",
      workspaceId: "workspace-rah-os",
    }),
    {
      createdAt: "2026-08-26T00:00:00.000Z",
      kind: "channel",
      name: "Core",
      roomId: "room-core",
      slug: "core",
      workspaceId: "workspace-rah-os",
    },
  );
  assert.deepEqual(
    RoomMembershipSchema.parse({
      joinedAt: "2026-08-26T00:00:00.000Z",
      principalId: "principal-alice",
      role: "admin",
      roomId: "room-core",
    }),
    {
      joinedAt: "2026-08-26T00:00:00.000Z",
      principalId: "principal-alice",
      role: "admin",
      roomId: "room-core",
    },
  );
  assert.deepEqual(
    ThreadSchema.parse({
      createdAt: "2026-08-26T00:00:00.000Z",
      createdBy: "principal-alice",
      replyCount: 0,
      roomId: "room-core",
      rootMessageId: "message-root",
      threadId: "thread-root",
    }),
    {
      createdAt: "2026-08-26T00:00:00.000Z",
      createdBy: "principal-alice",
      replyCount: 0,
      roomId: "room-core",
      rootMessageId: "message-root",
      threadId: "thread-root",
    },
  );

  assert.throws(() => RoomKindSchema.parse("session"));
  assert.throws(() => MembershipRoleSchema.parse("agent-admin"));
  assert.throws(() =>
    ThreadSchema.parse({
      createdAt: "2026-08-26T00:00:00.000Z",
      createdBy: "principal-alice",
      providerSessionId: "provider-session",
      replyCount: 0,
      roomId: "room-core",
      rootMessageId: "message-root",
      threadId: "thread-root",
    }),
  );
});
