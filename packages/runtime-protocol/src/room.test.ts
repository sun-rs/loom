import assert from "node:assert/strict";
import test from "node:test";

import {
  validateAcknowledgeRoomMessageRequest,
  validateAddRoomMemberRequest,
  validateCreateRoomRequest,
  validatePostRoomMessageRequest,
  validateSyncRoomRequest,
} from "./room";

test("Room command validators keep actor identity outside client-controlled bodies", () => {
  assert.throws(
    () => validateCreateRoomRequest({
      actorId: "principal-owner",
      workspaceKey: "workspace-main",
      kind: "channel",
      slug: "general",
      name: "General",
      idempotencyKey: "create-general",
    }),
    /unknown field actorId/,
  );
  assert.throws(
    () => validateAddRoomMemberRequest({
      roomId: "room-general",
      principalId: "agent-one",
      role: "member",
      basedOnRoomSeq: -1,
      idempotencyKey: "member-agent-one",
    }),
    /basedOnRoomSeq/,
  );
});

test("Room message requests expose mentions but not server-owned Attention reasons", () => {
  assert.throws(
    () => validatePostRoomMessageRequest({
      roomId: "room-general",
      body: "@agent please inspect this",
      attentionRecipientIds: ["agent-one"],
      attentionReason: "room_policy",
      idempotencyKey: "message-one",
    }),
    /unknown field attentionRecipientIds|unknown field attentionReason/,
  );
  assert.throws(
    () => validatePostRoomMessageRequest({
      roomId: "room-general",
      body: "hello",
      mentionedPrincipalIds: ["agent-one", "agent-one"],
      idempotencyKey: "message-one",
    }),
    /duplicates/,
  );
  assert.throws(
    () => validatePostRoomMessageRequest({
      roomId: "room-general",
      body: "hello",
      mentionedPrincipalIds: new Array(101).fill("agent-one"),
      idempotencyKey: "message-one",
    }),
    /at most 100 mentions/,
  );
  assert.deepEqual(
    validatePostRoomMessageRequest({
      roomId: "room-general",
      body: "hello",
      mentionedPrincipalIds: ["agent-z", "agent-a"],
      idempotencyKey: "message-one",
    }).mentionedPrincipalIds,
    ["agent-a", "agent-z"],
  );
  for (const body of ["abc\u0000def", "abc\ud800def", "abc\udc00def"]) {
    assert.throws(
      () => validatePostRoomMessageRequest({
        roomId: "room-general",
        body,
        idempotencyKey: "unsafe-message",
      }),
      /U\+0000|well-formed Unicode/,
    );
  }
  assert.equal(
    validatePostRoomMessageRequest({
      roomId: "room-general",
      body: "valid emoji: 🧭",
      idempotencyKey: "emoji-message",
    }).body,
    "valid emoji: 🧭",
  );
});

test("Room creation normalizes semantic defaults before idempotency", () => {
  const implicit = validateCreateRoomRequest({
    workspaceKey: "workspace-main",
    kind: "channel",
    slug: "general",
    name: "  General  ",
    idempotencyKey: "create-general",
  });
  const explicit = validateCreateRoomRequest({
    workspaceKey: "workspace-main",
    kind: "channel",
    slug: "general",
    name: "General",
    visibility: "private",
    idempotencyKey: "create-general",
  });
  assert.deepEqual(implicit, explicit);
  assert.throws(
    () => validateCreateRoomRequest({
      workspaceKey: "workspace-main",
      kind: "control",
      slug: "control",
      name: "Control",
      idempotencyKey: "create-control",
    }),
    /channel or direct/,
  );
  assert.throws(
    () => validateCreateRoomRequest({
      workspaceKey: "workspace-main",
      kind: "channel",
      slug: "public",
      name: "Public",
      visibility: "public",
      idempotencyKey: "create-public",
    }),
    /private until workspace ACL/,
  );
  for (const name of ["Room\u0000name", "Room\ud800name", "Room\udc00name"]) {
    assert.throws(
      () => validateCreateRoomRequest({
        workspaceKey: "workspace-main",
        kind: "channel",
        slug: "unsafe-name",
        name,
        idempotencyKey: "unsafe-name",
      }),
      /U\+0000|well-formed Unicode/,
    );
  }
});

test("Room sync freezes a bounded cursor window", () => {
  assert.throws(
    () => validateSyncRoomRequest({
      roomId: "room-general",
      bootstrap: "latest",
      afterSeq: 4,
    }),
    /cannot include afterSeq or throughSeq/,
  );
  assert.throws(
    () => validateSyncRoomRequest({
      roomId: "room-general",
      bootstrap: "latest",
      throughSeq: 4,
    }),
    /cannot include afterSeq or throughSeq/,
  );
  assert.throws(
    () => validateSyncRoomRequest({ roomId: "room-general", limit: 501 }),
    /between 1 and 500/,
  );
});

test("Room acknowledgement requires a causal Room head", () => {
  assert.throws(
    () => validateAcknowledgeRoomMessageRequest({
      roomId: "room-general",
      messageId: "message-one",
      basedOnRoomSeq: "3",
      idempotencyKey: "ack-one",
    }),
    /basedOnRoomSeq/,
  );
});
