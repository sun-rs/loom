import assert from "node:assert/strict";
import test from "node:test";

import {
  ClientRoomCreateRequestSchema,
  ClientRoomUpdateRequestSchema,
  MembershipRoleSchema,
  MessageSchema,
  RoomKindSchema,
  RoomMembershipSchema,
  RoomSchema,
  ThreadSchema,
  WorkspaceSchema,
} from "../src/index.ts";

test("managed Channel creation carries Raft metadata and initial Agents", () => {
  const input = {
    basedOnControlRoomSeq: 3,
    description: "Coordinate the release.",
    idempotencyKey: "create-release-room",
    initialAgentParticipantIds: ["agent-alice", "agent-kimi"],
    kind: "channel" as const,
    name: "Release",
    slug: "release",
    visibility: "private" as const,
    workspaceId: "workspace-main",
  };
  assert.deepEqual(ClientRoomCreateRequestSchema.parse(input), input);
});

test("managed Channel update carries the latest Room sequence and editable Raft metadata", () => {
  const input = {
    basedOnRoomSeq: 7,
    description: "Coordinate the release train.",
    idempotencyKey: "update-release-room",
    name: "Release train",
    roomId: "room-release",
    visibility: "public" as const,
  };
  assert.deepEqual(ClientRoomUpdateRequestSchema.parse(input), input);
  assert.throws(() =>
    ClientRoomUpdateRequestSchema.parse({
      ...input,
      name: "",
    }),
  );
});

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
    MessageSchema.parse({
      actorId: "principal-alice",
      body: "Canonical collaboration state",
      createdAt: "2026-08-26T00:00:00.000Z",
      messageId: "message-root",
      roomId: "room-core",
      roomSeq: 1,
    }),
    {
      actorId: "principal-alice",
      body: "Canonical collaboration state",
      createdAt: "2026-08-26T00:00:00.000Z",
      messageId: "message-root",
      roomId: "room-core",
      roomSeq: 1,
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
