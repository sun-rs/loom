import assert from "node:assert/strict";
import test from "node:test";

import type { RoomEvent } from "@rah-os/protocol";

import {
  messageMentionReadStateIndex,
  messageMentionReadStates,
  messageReferenceReadStateRecordsIndex,
} from "../src/message-reference-read-state.ts";

const event = (
  roomSeq: number,
  type: string,
  aggregateId: string,
  payload: Record<string, unknown>,
): RoomEvent => ({
  actorId: "human-owner",
  aggregateId,
  aggregateType: type === "message.posted" ? "message" : "inbox",
  createdAt: `2026-09-02T00:00:0${roomSeq}.000Z`,
  eventId: `event-${roomSeq}`,
  idempotencyKey: `event-key-${roomSeq}`,
  payload,
  roomId: "room-design",
  roomSeq,
  schemaVersion: 1,
  type,
});

test("mention read dots derive only from canonical recipients and inbox acknowledgement", () => {
  const events = [
    event(5, "message.posted", "message-1", {
      messageId: "message-1",
      recipients: [
        { participantId: "agent-alice", reason: "mention" },
        { participantId: "agent-bob", reason: "manual" },
      ],
    }),
    event(6, "inbox.acknowledged", "agent-alice", {
      participantId: "agent-alice",
      throughSeq: 5,
    }),
  ];
  assert.deepEqual(messageMentionReadStates("message-1", events), {
    "agent-alice": "read",
  });
  assert.deepEqual(messageMentionReadStateIndex(events).get("message-1"), {
    "agent-alice": "read",
  });
});

test("an unacknowledged exact mention remains unread and unrelated receipts do not count", () => {
  const events = [
    event(5, "message.posted", "message-1", {
      messageId: "message-1",
      recipients: [{ participantId: "agent-alice", reason: "mention" }],
    }),
    event(6, "inbox.acknowledged", "agent-bob", {
      participantId: "agent-bob",
      throughSeq: 99,
    }),
  ];
  assert.deepEqual(messageMentionReadStates("message-1", events), {
    "agent-alice": "unread",
  });
  assert.deepEqual(messageMentionReadStates("missing", events), {});
});

test("bounded canonical receipt records project to the same Message lookup", () => {
  assert.deepEqual(
    messageReferenceReadStateRecordsIndex([
      {
        messageId: "message-1",
        principalId: "agent-alice",
        readState: "read",
      },
      {
        messageId: "message-1",
        principalId: "agent-bob",
        readState: "unread",
      },
    ]).get("message-1"),
    { "agent-alice": "read", "agent-bob": "unread" },
  );
});
