import assert from "node:assert/strict";
import test from "node:test";

import {
  validateCreateRoomTaskRequest,
  validateRoomCommandHttpEnvelope,
  validateRoomHumanCommandRequest,
} from "./room-command";

test("Room Human command requests are exact and task reviewers are canonicalized", () => {
  assert.deepEqual(validateCreateRoomTaskRequest({
    roomId: "room-one",
    sourceMessageId: "message-one",
    title: "  Ship the fix  ",
    assigneeId: "agent-one",
    reviewerIds: ["reviewer-two", "reviewer-one"],
    dependencyTaskIds: [],
    basedOnRoomSeq: 2,
    idempotencyKey: "task-one",
  }), {
    roomId: "room-one",
    sourceMessageId: "message-one",
    title: "Ship the fix",
    assigneeId: "agent-one",
    reviewerIds: ["reviewer-one", "reviewer-two"],
    basedOnRoomSeq: 2,
    idempotencyKey: "task-one",
  });
  assert.throws(() => validateRoomHumanCommandRequest("post_message", {
    roomId: "room-one",
    actorId: "forged",
    body: "hello",
    idempotencyKey: "message-one",
  }), /unknown field actorId/);
  assert.throws(() => validateCreateRoomTaskRequest({
    roomId: "room-one",
    sourceMessageId: "message-one",
    title: "Invalid self review",
    assigneeId: "agent-one",
    reviewerIds: ["agent-one"],
    basedOnRoomSeq: 2,
    idempotencyKey: "task-self-review",
  }), /cannot also be a reviewer/);
  assert.throws(() => validateCreateRoomTaskRequest({
    roomId: "room-one",
    sourceMessageId: "message-one",
    title: "bad\u0000title",
    reviewerIds: ["reviewer-one"],
    basedOnRoomSeq: 2,
    idempotencyKey: "task-unsafe-title",
  }), /U\+0000/);
});

test("Room command receipts bind the exact requested operation", () => {
  assert.deepEqual(validateRoomCommandHttpEnvelope({
    ok: true,
    data: {
      operation: "post_message",
      roomId: "room-one",
      aggregateId: "message-one",
      roomSeq: 2,
      deduplicated: false,
    },
  }, "post_message"), {
    ok: true,
    data: {
      operation: "post_message",
      roomId: "room-one",
      aggregateId: "message-one",
      roomSeq: 2,
      deduplicated: false,
    },
  });
  assert.throws(() => validateRoomCommandHttpEnvelope({
    ok: true,
    data: {
      operation: "add_member",
      roomId: "room-one",
      aggregateId: "message-one",
      roomSeq: 2,
      deduplicated: false,
    },
  }, "post_message"), /does not match/);
});

test("Room command error envelopes accept only the canonical bounded code set", () => {
  assert.deepEqual(
    validateRoomCommandHttpEnvelope(
      { ok: false, error: { code: "conflict", message: "try again" } },
      "post_message",
    ),
    { ok: false, error: { code: "conflict", message: "try again" } },
  );
  for (const error of [
    { code: "definitely_not_a_room_error", message: "unknown" },
    { code: "conflict", message: "" },
    { code: "conflict", message: "x".repeat(513) },
  ]) {
    assert.throws(
      () =>
        validateRoomCommandHttpEnvelope(
          { ok: false, error },
          "post_message",
        ),
      /Room command error is invalid/,
    );
  }
});
