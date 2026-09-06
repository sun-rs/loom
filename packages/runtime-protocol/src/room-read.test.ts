import assert from "node:assert/strict";
import test from "node:test";

import {
  ROOM_READ_HTTP_STATUS_BY_ERROR_CODE,
  toRoomEventDto,
  validateRoomReadHttpEnvelope,
  validateRoomBootstrapReadRequest,
  validateRoomEventReadRequest,
  validateRoomInboxReadRequest,
  validateRoomListReadRequest,
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

test("Room read wire status semantics have one immutable protocol owner", () => {
  assert.equal(Object.isFrozen(ROOM_READ_HTTP_STATUS_BY_ERROR_CODE), true);
  assert.deepEqual(ROOM_READ_HTTP_STATUS_BY_ERROR_CODE, {
    unauthenticated: 401,
    forbidden: 403,
    not_found: 404,
    invalid_argument: 400,
    conflict: 409,
    stale_context: 409,
    idempotency_conflict: 409,
    resource_exhausted: 413,
    unavailable: 503,
    internal: 500,
  });
});

test("Room read requests never accept browser-controlled actor or Inbox participant identity", () => {
  assert.throws(
    () =>
      validateRoomBootstrapReadRequest({
        roomId: "room-general",
        actorId: "human-owner",
      }),
    /unknown field actorId/,
  );
  assert.throws(
    () =>
      validateRoomEventReadRequest({
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
  assert.throws(
    () => validateRoomListReadRequest({ actorId: "human-owner" }),
    /unknown field actorId/,
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
    () =>
      validateRoomBootstrapReadRequest({ roomId: "room-general", limit: 501 }),
    /between 1 and 500/,
  );
  assert.deepEqual(validateRoomListReadRequest({ limit: 20 }), { limit: 20 });
  assert.deepEqual(validateRoomInboxReadRequest({ start: "latest" }), { start: "latest" });
  assert.throws(
    () => validateRoomInboxReadRequest({ start: "latest", cursor: "cursor" }),
    /do not accept a cursor or filters/,
  );
  assert.throws(
    () => validateRoomInboxReadRequest({ start: "oldest" }),
    /must be latest/,
  );
  assert.deepEqual(
    validateRoomInboxReadRequest({
      roomId: "room-general",
      pendingOnly: true,
      messageIds: ["message-one"],
      taskIds: ["task-one"],
      limit: 10,
    }),
    {
      roomId: "room-general",
      pendingOnly: true,
      messageIds: ["message-one"],
      taskIds: ["task-one"],
      limit: 10,
    },
  );
  assert.throws(
    () => validateRoomInboxReadRequest({ messageIds: ["message-one"] }),
    /require roomId/,
  );
  assert.throws(
    () =>
      validateRoomInboxReadRequest({
        roomId: "room-general",
        cursor: "cursor",
        pendingOnly: true,
      }),
    /do not accept a global cursor/,
  );
  assert.throws(
    () =>
      validateRoomInboxReadRequest({
        roomId: "room-general",
        messageIds: ["message-one", "message-one"],
      }),
    /duplicates/,
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
  if (posted.type !== "message.posted")
    throw new Error("expected posted event");
  assert.equal(posted.payload.body, "hello");
  assert.deepEqual(posted.payload.attention, [
    { principalId: "agent-one", reason: "mention" },
  ]);

  assert.throws(
    () => toRoomEventDto({ ...commonEvent, type: "future.event", payload: {} }),
    /unsupported Room event type/,
  );
  assert.throws(
    () =>
      toRoomEventDto({
        ...commonEvent,
        type: "message.posted",
        payload: {
          body: "hello",
          attention: [],
          createdAt: commonEvent.createdAt,
          extra: true,
        },
      }),
    /unknown field extra/,
  );
  assert.throws(
    () =>
      toRoomEventDto({
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
  assert.equal(
    room.payload.ownerMembership.principalId,
    room.payload.ownerPrincipal.principalId,
  );
  assert.throws(
    () =>
      toRoomEventDto({
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
  if (membership.type !== "membership.added")
    throw new Error("expected membership event");
  assert.equal(membership.payload.principal.principalId, "agent-one");

  assert.throws(
    () =>
      toRoomEventDto({
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

  const inboxAcknowledged = toRoomEventDto({
    ...commonEvent,
    type: "inbox.acknowledged",
    aggregateType: "inbox",
    aggregateId: "inbox-one",
    payload: {
      inboxItemId: "inbox-one",
      eventId: "event-one",
      participantId: "human-owner",
      acknowledgedAt: commonEvent.createdAt,
    },
  });
  assert.equal(inboxAcknowledged.type, "inbox.acknowledged");
});

test("Room Task events reject forged lifecycle enums and evidence digests", () => {
  const reviewBase = {
    ...commonEvent,
    type: "review.submitted",
    aggregateType: "review",
    aggregateId: "review-one",
    payload: {
      taskId: "task-one",
      submissionId: "submission-one",
      submissionDigest: `sha256:${"a".repeat(64)}`,
      disposition: "approved",
      resultingTaskState: "submitted",
    },
  };
  assert.throws(
    () =>
      toRoomEventDto({
        ...reviewBase,
        payload: { ...reviewBase.payload, disposition: "nonsense" },
      } as never),
    /disposition is invalid/u,
  );
  assert.throws(
    () =>
      toRoomEventDto({
        ...reviewBase,
        payload: { ...reviewBase.payload, resultingTaskState: "banana" },
      } as never),
    /resultingTaskState is invalid/u,
  );
  assert.throws(
    () =>
      toRoomEventDto({
        ...reviewBase,
        payload: { ...reviewBase.payload, submissionDigest: "digest-one" },
      } as never),
    /submissionDigest is invalid/u,
  );
  assert.throws(
    () =>
      toRoomEventDto({
        ...reviewBase,
        payload: { ...reviewBase.payload, resultingTaskState: "todo" },
      } as never),
    /disposition and resultingTaskState are inconsistent/u,
  );

  const createdBase = {
    ...commonEvent,
    type: "task.created",
    aggregateType: "task",
    aggregateId: "task-one",
    payload: {
      taskId: "task-one",
      taskNumber: 1,
      sourceMessageId: "message-one",
      threadId: "thread-one",
      assigneeId: "agent-one",
      reviewerIds: ["agent-two"],
      dependencyTaskIds: [],
    },
  };
  assert.throws(
    () =>
      toRoomEventDto({
        ...createdBase,
        payload: { ...createdBase.payload, reviewerIds: [] },
      } as never),
    /at least one reviewer/u,
  );
  assert.throws(
    () =>
      toRoomEventDto({
        ...createdBase,
        payload: { ...createdBase.payload, reviewerIds: ["agent-one"] },
      } as never),
    /cannot also be a reviewer/u,
  );
  assert.throws(
    () =>
      toRoomEventDto({
        ...createdBase,
        payload: { ...createdBase.payload, dependencyTaskIds: ["task-one"] },
      } as never),
    /depend on itself/u,
  );
});

test("Room Task and Inbox read contracts reject contradictory canonical state", () => {
  const cancelledTask = {
    taskId: "task-one",
    roomId: "room-one",
    taskNumber: 1,
    sourceMessageId: "message-one",
    threadId: "thread-one",
    creatorId: "human-owner",
    assigneeId: "agent-one",
    reviewerIds: ["agent-two"],
    dependencyTaskIds: [],
    title: "Ship it",
    state: "cancelled",
    createdAt: commonEvent.createdAt,
    updatedAt: commonEvent.createdAt,
  };
  assert.throws(
    () =>
      validateRoomReadHttpEnvelope(
        {
          ok: true,
          data: {
            mode: "task_list",
            roomId: "room-one",
            items: [cancelledTask],
            hasMore: false,
          },
        },
        "task_list",
      ),
    /cancellation state is inconsistent/u,
  );

  const forgedInbox = {
    inboxSeq: 1,
    inboxItemId: "inbox-one",
    roomId: "room-one",
    participantId: "agent-one",
    eventId: "event-one",
    eventSeq: 1,
    eventType: "task.created",
    aggregateType: "task",
    aggregateId: "task-one",
    taskId: "task-two",
    reason: "task_assignment",
    disposition: "activation",
    state: "pending",
    createdAt: commonEvent.createdAt,
  };
  assert.throws(
    () =>
      validateRoomReadHttpEnvelope(
        {
          ok: true,
          data: {
            mode: "inbox_page",
            items: [forgedInbox],
            inboxCursor: "cursor-one",
          },
        },
        "inbox_page",
      ),
    /event target contract is inconsistent/u,
  );
});

test("Room response envelope validates the complete Room-list identity graph", () => {
  const room = {
    roomId: "room-general",
    workspaceKey: "workspace-main",
    kind: "direct" as const,
    slug: "general",
    name: "General",
    visibility: "private" as const,
    createdAt: commonEvent.createdAt,
  };
  const membership = {
    roomId: room.roomId,
    principalId: "human-owner",
    role: "owner" as const,
    joinedAt: commonEvent.createdAt,
  };
  const directPeer = {
    principalId: "agent-one",
    handle: "agent-one",
    kind: "agent" as const,
    displayName: "Agent One",
    createdAt: commonEvent.createdAt,
  };
  const envelope = validateRoomReadHttpEnvelope(
    {
      ok: true,
      data: {
        mode: "room_list",
        items: [
          {
            room,
            membership,
            latestRoomSeq: 2,
            participantCount: 2,
            pendingAttentionCount: 0,
            directPeer,
          },
        ],
        hasMore: true,
        roomListCursor: "next-page",
      },
    },
    "room_list",
  );
  assert.equal(envelope.ok, true);

  assert.throws(
    () =>
      validateRoomReadHttpEnvelope(
        {
          ok: true,
          data: { mode: "room_list", items: [null], hasMore: false },
        },
        "room_list",
      ),
    /RoomListItem/,
  );
  assert.throws(
    () =>
      validateRoomReadHttpEnvelope(
        {
          ok: true,
          data: {
            mode: "room_list",
            items: [
              {
                room,
                membership,
                latestRoomSeq: 2,
                participantCount: 2,
                pendingAttentionCount: 0,
              },
            ],
            hasMore: false,
          },
        },
        "room_list",
      ),
    /peer projection/,
  );
  assert.throws(
    () =>
      validateRoomReadHttpEnvelope(
        {
          ok: true,
          data: { mode: "room_list", items: [], hasMore: true },
        },
        "room_list",
      ),
    /roomListCursor/,
  );
  assert.throws(
    () =>
      validateRoomReadHttpEnvelope(
        {
          ok: true,
          data: { mode: "inbox_page", items: [], inboxCursor: "inbox" },
        },
        "room_list",
      ),
    /expected Room response mode/,
  );
});

test("Room response pages cannot claim more data without making progress", () => {
  assert.throws(
    () =>
      validateRoomReadHttpEnvelope(
        {
          ok: true,
          data: {
            mode: "event_page",
            events: [],
            latestRoomSeq: 0,
            hasMore: true,
            eventCursor: "next-event-page",
          },
        },
        "event_page",
      ),
    /must make progress/,
  );
  assert.throws(
    () =>
      validateRoomReadHttpEnvelope(
        {
          ok: true,
          data: {
            mode: "older_messages",
            messages: [],
            hasMore: true,
            olderMessagesCursor: "next-message-page",
          },
        },
        "older_messages",
      ),
    /must make progress/,
  );
  assert.throws(
    () =>
      validateRoomReadHttpEnvelope(
        {
          ok: true,
          data: {
            mode: "room_list",
            items: [],
            hasMore: true,
            roomListCursor: "next-room-page",
          },
        },
        "room_list",
      ),
    /must make progress/,
  );
});
