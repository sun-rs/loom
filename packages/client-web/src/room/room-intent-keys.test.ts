import assert from "node:assert/strict";
import test from "node:test";

import { RoomIntentKeys } from "./room-intent-keys";

test("Room intents keep one command identity across response-loss retries", () => {
  const intents = new RoomIntentKeys();
  const first = intents.key("post-message", "room-a|hello|");
  assert.equal(intents.key("post-message", "room-a|hello|"), first);
  assert.notEqual(intents.key("post-message", "room-a|changed|"), first);

  intents.complete("post-message", "room-a|hello|");
  assert.notEqual(intents.key("post-message", "room-a|hello|"), first);
});

test("Room intents freeze the first causal request while the Room head advances", () => {
  const intents = new RoomIntentKeys();
  const semanticIntent = "room-a|task-a|accept";
  const first = intents.request(
    "decide-task",
    semanticIntent,
    (idempotencyKey) => ({
      taskId: "task-a",
      basedOnRoomSeq: 40,
      idempotencyKey,
    }),
  );
  const retry = intents.request(
    "decide-task",
    semanticIntent,
    (idempotencyKey) => ({
      taskId: "task-a",
      basedOnRoomSeq: 52,
      idempotencyKey,
    }),
  );
  assert.strictEqual(retry, first);
  assert.equal(retry.basedOnRoomSeq, 40);

  intents.complete("decide-task", semanticIntent);
  const next = intents.request(
    "decide-task",
    semanticIntent,
    (idempotencyKey) => ({
      taskId: "task-a",
      basedOnRoomSeq: 53,
      idempotencyKey,
    }),
  );
  assert.notEqual(next.idempotencyKey, first.idempotencyKey);
  assert.equal(next.basedOnRoomSeq, 53);
});
