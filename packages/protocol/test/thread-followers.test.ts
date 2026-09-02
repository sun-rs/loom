import assert from "node:assert/strict";
import test from "node:test";

import {
  HumanThreadFollowersRequestSchema,
  HumanThreadFollowersResponseSchema,
  HumanThreadFollowerRemoveRequestSchema,
  HumanThreadFollowerRemoveResponseSchema,
  HumanThreadFollowerRestoreRequestSchema,
  HumanThreadFollowerRestoreResponseSchema,
} from "../src/index.ts";

test("thread follower protocol keeps Human follow and Agent roster distinct", () => {
  assert.deepEqual(
    HumanThreadFollowersRequestSchema.parse({
      roomId: "room-a",
      threadId: "thread-a",
    }),
    { roomId: "room-a", threadId: "thread-a" },
  );
  assert.deepEqual(
    HumanThreadFollowersResponseSchema.parse({
      agentParticipantIds: ["agent-a"],
      canManage: true,
      following: false,
    }),
    {
      agentParticipantIds: ["agent-a"],
      canManage: true,
      following: false,
    },
  );
  assert.deepEqual(
    HumanThreadFollowerRemoveRequestSchema.parse({
      participantId: "agent-a",
      roomId: "room-a",
      threadId: "thread-a",
    }),
    {
      participantId: "agent-a",
      roomId: "room-a",
      threadId: "thread-a",
    },
  );
  assert.deepEqual(
    HumanThreadFollowerRemoveResponseSchema.parse({
      removed: true,
      undoExpiresAt: "2026-09-02T12:00:05.000Z",
      undoToken: "thread-follower-undo-a",
    }),
    {
      removed: true,
      undoExpiresAt: "2026-09-02T12:00:05.000Z",
      undoToken: "thread-follower-undo-a",
    },
  );
  assert.deepEqual(
    HumanThreadFollowerRestoreRequestSchema.parse({
      participantId: "agent-a",
      roomId: "room-a",
      threadId: "thread-a",
      undoToken: "thread-follower-undo-a",
    }),
    {
      participantId: "agent-a",
      roomId: "room-a",
      threadId: "thread-a",
      undoToken: "thread-follower-undo-a",
    },
  );
  assert.deepEqual(
    HumanThreadFollowerRestoreResponseSchema.parse({ restored: true }),
    { restored: true },
  );
});
