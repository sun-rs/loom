import assert from "node:assert/strict";
import test from "node:test";

import {
  AgentExecutionWorkspaceSchema,
  AgentWorkspaceRootsSchema,
  ChannelAttachedDirectorySchema,
  ClientRoomCreateRequestSchema,
  ClientRoomUpdateRequestSchema,
  HostExecutionWorkspaceBindingSchema,
  RoomSchema,
} from "../src/index.ts";

const create = {
  basedOnControlRoomSeq: 3,
  idempotencyKey: "create-1",
  kind: "channel" as const,
  name: "build",
  slug: "build",
  workspaceId: "workspace-1",
};

test("channel creation accepts zero or more normalized absolute attached directories", () => {
  assert.equal(
    ClientRoomCreateRequestSchema.parse(create).additionalDirectories,
    undefined,
  );
  assert.deepEqual(
    ClientRoomCreateRequestSchema.parse({
      ...create,
      additionalDirectories: ["/work/app", "/work/lib"],
    }).additionalDirectories,
    ["/work/app", "/work/lib"],
  );
  for (const invalid of [
    "relative/path",
    "/",
    "/work/app/",
    "/work//app",
    "/work/./app",
    "/work/../app",
    "/work/a\u0000b",
    "/work/a\nb",
  ])
    assert.equal(
      ChannelAttachedDirectorySchema.safeParse(invalid).success,
      false,
      invalid,
    );
  assert.equal(
    ClientRoomCreateRequestSchema.safeParse({
      ...create,
      additionalDirectories: ["/work/app", "/work/app"],
    }).success,
    false,
    "duplicates are refused",
  );
  assert.equal(
    ClientRoomCreateRequestSchema.safeParse({
      ...create,
      additionalDirectories: Array.from({ length: 17 }, (_, i) => `/w/${i}`),
    }).success,
    false,
    "at most 16 attached directories",
  );
});

test("channel workspace is immutable after creation: the update command has no workspace fields", () => {
  const update = {
    basedOnRoomSeq: 4,
    idempotencyKey: "update-1",
    name: "build",
    roomId: "room-1",
    visibility: "private" as const,
  };
  assert.equal(ClientRoomUpdateRequestSchema.safeParse(update).success, true);
  for (const field of ["additionalDirectories", "channelWorkspace"])
    assert.equal(
      ClientRoomUpdateRequestSchema.safeParse({ ...update, [field]: [] })
        .success,
      false,
      field,
    );
});

test("the Room projection carries the channel workspace; legacy rooms omit it", () => {
  const room = {
    createdAt: "2026-09-26T00:00:00.000Z",
    kind: "channel" as const,
    name: "build",
    roomId: "room-1",
    slug: "build",
    workspaceId: "workspace-1",
  };
  assert.equal(RoomSchema.parse(room).channelWorkspace, undefined);
  assert.deepEqual(
    RoomSchema.parse({
      ...room,
      channelWorkspace: {
        kind: "channel_home",
        additionalDirectories: ["/work/app"],
      },
    }).channelWorkspace,
    { kind: "channel_home", additionalDirectories: ["/work/app"] },
  );
});

test("an instance execution workspace may be its channel home; the Host binding carries room and attached directories", () => {
  assert.deepEqual(
    AgentExecutionWorkspaceSchema.parse({
      kind: "channel_home",
      roomId: "room-1",
    }),
    { kind: "channel_home", roomId: "room-1" },
  );
  assert.equal(
    AgentExecutionWorkspaceSchema.safeParse({ kind: "channel_home" }).success,
    false,
  );
  const binding = HostExecutionWorkspaceBindingSchema.parse({
    participantId: "instance-1",
    agentDefinitionRevisionId: "revision-1",
    workspaceDefinitionId: "workspace-1",
    executionWorkspace: { kind: "channel_home", roomId: "room-1" },
    additionalDirectories: ["/work/app"],
  });
  assert.deepEqual(binding.additionalDirectories, ["/work/app"]);
  assert.equal(
    HostExecutionWorkspaceBindingSchema.safeParse({
      participantId: "instance-1",
      agentDefinitionRevisionId: "revision-1",
      workspaceDefinitionId: "workspace-1",
      executionWorkspace: { kind: "agent_private" },
      additionalDirectories: ["/work/app"],
    }).success,
    false,
    "attached directories exist only for a channel home",
  );
});

test("workspace roots list the channel home and one root per attached directory", () => {
  const roots = AgentWorkspaceRootsSchema.parse({
    defaultRootId: "agent-workspace",
    roots: [
      {
        label: "Agent 工作区",
        rootId: "agent-workspace",
        rootKind: "agent-workspace",
        rootPath: "/memory/alice",
        state: "ready",
      },
      {
        label: "room-1",
        rootId: "runtime-project",
        rootKind: "runtime-project",
        rootPath: "/homes/room-1",
        state: "ready",
      },
      {
        label: "app",
        rootId: "attached-project-1",
        rootKind: "attached-project-1",
        rootPath: "/work/app",
        state: "ready",
      },
      {
        label: "lib",
        rootId: "attached-project-2",
        rootKind: "attached-project-2",
        rootPath: "/work/lib",
        state: "ready",
      },
    ],
  });
  assert.equal(roots.roots.length, 4);
  assert.equal(
    AgentWorkspaceRootsSchema.safeParse({
      ...roots,
      roots: [
        ...roots.roots.slice(0, 2),
        { ...roots.roots[2], rootId: "attached-project-0" },
      ],
    }).success,
    false,
  );
});
