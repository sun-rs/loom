import assert from "node:assert/strict";
import test from "node:test";

import {
  toRoomEventDto,
  validateRoomBootstrapReadRequest,
  validateRoomEventReadRequest,
  validateRoomInboxReadRequest,
} from "./room-read";

const commonEvent = {
  eventId: "event-1",
  roomId: "room-general",
  roomSeq: 3,
  actorId: "human-owner",
  aggregateType: "message",
  aggregateId: "message-1",
  idempotencyKey: "post-1",
  schemaVersion: 1 as const,
  createdAt: "2026-09-05T08:00:00.000Z",
};

test("Room read requests never accept browser-controlled actor or Inbox participant identity", () => {
  assert.throws(
    () => validateRoomBootstrapReadRequest({
      roomId: "room-general",
      actorId: "human-owner",
    }),
    /unknown field actorId/,
  );
  assert.throws(
    () => validateRoomEventReadRequest({
      roomId: "room-general",
      cursor: "cursor",
      participantId: "agent-one",
    }),
    /unknown field participantId/,
  );
  assert.throws(
    () => validateRoomInboxReadRequest({ participantId: "agent-one" }),
    /unknown field participantId/,
  );
});

test("Room read requests bound opaque cursor and page sizes", () => {
  assert.deepEqual(
    validateRoomBootstrapReadRequest({ roomId: "room-general", limit: 25 }),
    { roomId: "room-general", limit: 25 },
  );
  assert.throws(
    () => validateRoomEventReadRequest({ roomId: "room-general", cursor: "" }),
    /cursor/,
  );
  assert.throws(
    () => validateRoomInboxReadRequest({ cursor: "x".repeat(4_097) }),
    /cursor/,
  );
  assert.throws(
    () => validateRoomBootstrapReadRequest({ roomId: "room-general", limit: 501 }),
    /between 1 and 500/,
  );
});

test("Room transport events are a strict discriminated union without command receipts", () => {
  const posted = toRoomEventDto({
    ...commonEvent,
    type: "message.posted",
    payload: {
      body: "hello",
      attention: [{ principalId: "agent-one", reason: "mention" }],
      createdAt: commonEvent.createdAt,
    },
  });
  assert.equal(posted.type, "message.posted");
  assert.equal("idempotencyKey" in posted, false);
  if (posted.type !== "message.posted") throw new Error("expected posted event");
  assert.equal(posted.payload.body, "hello");
  assert.deepEqual(posted.payload.attention, [
    { principalId: "agent-one", reason: "mention" },
  ]);

  assert.throws(
    () => toRoomEventDto({ ...commonEvent, type: "future.event", payload: {} }),
    /unsupported Room event type/,
  );
  assert.throws(
    () => toRoomEventDto({
      ...commonEvent,
      type: "message.posted",
      payload: { body: "hello", attention: [], createdAt: commonEvent.createdAt, extra: true },
    }),
    /unknown field extra/,
  );
  assert.throws(
    () => toRoomEventDto({
      ...commonEvent,
      type: "message.acknowledged",
      payload: {
        messageId: "different-message",
        participantId: "human-owner",
        acknowledgedAt: commonEvent.createdAt,
      },
    }),
    /aggregateId/,
  );
});

test("Room transport event variants validate the projection evidence they carry", () => {
  const room = toRoomEventDto({
    ...commonEvent,
    roomSeq: 1,
    type: "room.created",
    aggregateType: "room",
    aggregateId: "room-general",
    payload: {
      room: {
        roomId: "room-general",
        workspaceKey: "workspace-main",
        kind: "channel",
        slug: "general",
        name: "General",
        visibility: "private",
        createdAt: commonEvent.createdAt,
      },
      ownerMembership: {
        roomId: "room-general",
        principalId: "human-owner",
        role: "owner",
        joinedAt: commonEvent.createdAt,
      },
      ownerPrincipal: {
        principalId: "human-owner",
        handle: "owner",
        kind: "human",
        createdAt: commonEvent.createdAt,
      },
    },
  });
  assert.equal(room.type, "room.created");
  if (room.type !== "room.created") throw new Error("expected room event");
  assert.equal(room.payload.ownerMembership.principalId, room.payload.ownerPrincipal.principalId);
  assert.throws(
    () => toRoomEventDto({
      ...commonEvent,
      roomSeq: 1,
      type: "room.created",
      aggregateType: "room",
      aggregateId: "room-general",
      payload: {
        room: room.payload.room,
        ownerMembership: room.payload.ownerMembership,
        ownerPrincipal: { ...room.payload.ownerPrincipal, kind: "agent" },
      },
    }),
    /owner identity graph/,
  );

  const membership = toRoomEventDto({
    ...commonEvent,
    roomSeq: 2,
    type: "membership.added",
    aggregateType: "membership",
    aggregateId: "agent-one",
    payload: {
      membership: {
        roomId: "room-general",
        principalId: "agent-one",
        role: "member",
        joinedAt: commonEvent.createdAt,
      },
      principal: {
        principalId: "agent-one",
        handle: "agent-one",
        kind: "agent",
        displayName: "Agent One",
        createdAt: commonEvent.createdAt,
      },
    },
  });
  assert.equal(membership.type, "membership.added");
  if (membership.type !== "membership.added") throw new Error("expected membership event");
  assert.equal(membership.payload.principal.principalId, "agent-one");

  assert.throws(
    () => toRoomEventDto({
      ...commonEvent,
      roomSeq: 2,
      type: "membership.added",
      aggregateType: "membership",
      aggregateId: "agent-one",
      payload: {
        membership: {
          roomId: "room-general",
          principalId: "agent-one",
          role: "member",
          joinedAt: commonEvent.createdAt,
        },
      },
    }),
    /Principal/,
  );

  const acknowledged = toRoomEventDto({
    ...commonEvent,
    type: "message.acknowledged",
    payload: {
      messageId: "message-1",
      participantId: "human-owner",
      acknowledgedAt: commonEvent.createdAt,
    },
  });
  assert.equal(acknowledged.type, "message.acknowledged");
});
