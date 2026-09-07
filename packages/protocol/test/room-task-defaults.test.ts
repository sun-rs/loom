import assert from "node:assert/strict";
import test from "node:test";

import {
  ClientRoomSchema,
  ClientRoomUpdateRequestSchema,
  RoomTaskDefaultsSchema,
} from "../src/index.ts";

test("Room Task defaults accept an empty selection", () => {
  const parsed = RoomTaskDefaultsSchema.parse({
    defaultCollaboratorIds: [],
    defaultReviewerIds: [],
  });
  assert.equal(parsed.defaultAssigneeId, undefined);
  assert.deepEqual(parsed.defaultCollaboratorIds, []);
});

test("Room Task defaults reject duplicate participants", () => {
  assert.equal(
    RoomTaskDefaultsSchema.safeParse({
      defaultAssigneeId: "agent-one",
      defaultCollaboratorIds: ["agent-two", "agent-two"],
      defaultReviewerIds: [],
    }).success,
    false,
  );
  assert.equal(
    RoomTaskDefaultsSchema.safeParse({
      defaultAssigneeId: "agent-one",
      defaultCollaboratorIds: ["agent-two"],
      defaultReviewerIds: ["agent-two"],
    }).success,
    false,
  );
});

test("Room Task defaults reject reviewers without an assignee", () => {
  assert.equal(
    RoomTaskDefaultsSchema.safeParse({
      defaultCollaboratorIds: [],
      defaultReviewerIds: ["agent-two"],
    }).success,
    false,
  );
});

test("Room Task defaults reject the assignee in another role", () => {
  assert.equal(
    RoomTaskDefaultsSchema.safeParse({
      defaultAssigneeId: "agent-one",
      defaultCollaboratorIds: ["agent-one"],
      defaultReviewerIds: [],
    }).success,
    false,
  );
  assert.equal(
    RoomTaskDefaultsSchema.safeParse({
      defaultAssigneeId: "agent-one",
      defaultCollaboratorIds: [],
      defaultReviewerIds: ["agent-one"],
    }).success,
    false,
  );
});

test("Room update carries optional Task defaults and stays strict", () => {
  const accepted = ClientRoomUpdateRequestSchema.parse({
    basedOnRoomSeq: 3,
    idempotencyKey: "room-defaults",
    name: "Product",
    roomId: "room-one",
    taskDefaults: {
      defaultAssigneeId: "agent-one",
      defaultCollaboratorIds: ["agent-two"],
      defaultReviewerIds: ["agent-three"],
    },
    visibility: "private",
  });
  assert.equal(accepted.taskDefaults?.defaultAssigneeId, "agent-one");
  assert.equal(
    ClientRoomUpdateRequestSchema.safeParse({
      basedOnRoomSeq: 3,
      idempotencyKey: "room-defaults",
      name: "Product",
      roomId: "room-one",
      unknownField: true,
      visibility: "private",
    }).success,
    false,
  );
  assert.equal(
    ClientRoomUpdateRequestSchema.safeParse({
      basedOnRoomSeq: 3,
      idempotencyKey: "room-defaults",
      name: "Product",
      roomId: "room-one",
      taskDefaults: {
        defaultCollaboratorIds: ["agent-two"],
        defaultReviewerIds: [],
      },
      visibility: "private",
    }).success,
    false,
  );
});

test("Client Room projection keeps Task defaults optional", () => {
  const room = {
    createdAt: "2026-09-08T00:00:00.000Z",
    kind: "channel",
    name: "Product",
    roomId: "room-one",
    slug: "product",
    visibility: "private",
    workspaceId: "workspace-one",
  } as const;
  assert.equal(ClientRoomSchema.parse(room).taskDefaults, undefined);
  assert.deepEqual(
    ClientRoomSchema.parse({
      ...room,
      taskDefaults: {
        defaultAssigneeId: "agent-one",
        defaultCollaboratorIds: [],
        defaultReviewerIds: [],
      },
    }).taskDefaults,
    {
      defaultAssigneeId: "agent-one",
      defaultCollaboratorIds: [],
      defaultReviewerIds: [],
    },
  );
});
