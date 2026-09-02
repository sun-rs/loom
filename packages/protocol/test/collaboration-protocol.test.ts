import assert from "node:assert/strict";
import test from "node:test";

import {
  ClientRoomArchiveRequestSchema,
  ClientRoomCreateRequestSchema,
  ClientRoomDeleteRequestSchema,
  ClientRoomDeleteResponseSchema,
  ClientRoomLeaveRequestSchema,
  ClientRoomAgentSosResumeRequestSchema,
  ClientRoomAgentSosStopRequestSchema,
  ClientRoomUnarchiveRequestSchema,
  ClientRoomUpdateRequestSchema,
  MembershipRoleSchema,
  MessageSchema,
  RoomKindSchema,
  RoomMembershipSchema,
  RoomSchema,
  ThreadSchema,
  WorkspaceSchema,
} from "../src/index.ts";

test("Room Agent SOS commands are strict, causal, and require bounded recovery guidance", () => {
  const stop = {
    basedOnRoomSeq: 7,
    idempotencyKey: "room-sos-stop-1",
    roomId: "room-1",
  };
  assert.deepEqual(ClientRoomAgentSosStopRequestSchema.parse(stop), stop);
  assert.throws(() =>
    ClientRoomAgentSosStopRequestSchema.parse({
      ...stop,
      participantId: "must-remain-room-scoped",
    }),
  );

  const resume = {
    basedOnRoomSeq: 9,
    guidance: "先读取最新 Room 状态，再按新的分工继续。",
    idempotencyKey: "room-sos-resume-1",
    roomId: "room-1",
  };
  assert.deepEqual(ClientRoomAgentSosResumeRequestSchema.parse(resume), resume);
  assert.throws(() =>
    ClientRoomAgentSosResumeRequestSchema.parse({ ...resume, guidance: "  " }),
  );
  assert.throws(() =>
    ClientRoomAgentSosResumeRequestSchema.parse({
      ...resume,
      guidance: "x".repeat(4_001),
    }),
  );
});

test("Room lifecycle commands carry freshness and idempotency identities", () => {
  const input = {
    basedOnRoomSeq: 7,
    idempotencyKey: "room-archive-1",
    roomId: "room-1",
  };
  assert.deepEqual(ClientRoomArchiveRequestSchema.parse(input), input);
  assert.deepEqual(ClientRoomDeleteRequestSchema.parse(input), input);
  assert.deepEqual(
    ClientRoomLeaveRequestSchema.parse({
      ...input,
      idempotencyKey: "room-leave-1",
    }),
    { ...input, idempotencyKey: "room-leave-1" },
  );
  assert.deepEqual(
    ClientRoomUnarchiveRequestSchema.parse({
      ...input,
      idempotencyKey: "room-unarchive-1",
    }),
    { ...input, idempotencyKey: "room-unarchive-1" },
  );
  assert.throws(() =>
    ClientRoomArchiveRequestSchema.parse({ ...input, basedOnRoomSeq: -1 }),
  );
  assert.throws(() =>
    ClientRoomLeaveRequestSchema.parse({
      ...input,
      principalId: "must-be-server-owned",
    }),
  );
  assert.throws(() =>
    ClientRoomDeleteRequestSchema.parse({
      ...input,
      actorId: "must-be-server-owned",
    }),
  );
  assert.deepEqual(
    ClientRoomDeleteResponseSchema.parse({
      deduplicated: false,
      deletionId: "room-deletion-1",
      deletedAt: "2026-09-03T00:00:00.000Z",
      fileGc: { failed: 1, pending: 0, reclaimed: 2, total: 3 },
      roomId: "room-1",
      workspaceId: "workspace-1",
    }),
    {
      deduplicated: false,
      deletionId: "room-deletion-1",
      deletedAt: "2026-09-03T00:00:00.000Z",
      fileGc: { failed: 1, pending: 0, reclaimed: 2, total: 3 },
      roomId: "room-1",
      workspaceId: "workspace-1",
    },
  );
});

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
