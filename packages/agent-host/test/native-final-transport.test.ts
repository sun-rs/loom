import assert from "node:assert/strict";
import test from "node:test";
import type { WorkerMessagePresentResponse } from "@rah-os/protocol";
import {
  nativeFinalSequence,
  nativeFinalEnvelope,
} from "../src/native-final-transport.ts";
import { nativeFinalTextInstructions } from "../src/final-output-instructions.js";

function present(): WorkerMessagePresentResponse {
  return {
    fromSeq: 4,
    toSeq: 4,
    presentedThroughSeq: 4,
    contentDigest: `sha256:${"a".repeat(64)}`,
    presentedSeqs: [4],
    directedSeqs: [4],
    noticeCount: 0,
    renderedAt: "2026-10-09T00:00:00.000Z",
    events: [
      {
        eventId: "event-4",
        roomId: "room-a",
        roomSeq: 4,
        type: "message.posted",
        actorId: "human-a",
        aggregateType: "message",
        aggregateId: "message-a",
        payload: { body: "hello", messageId: "message-a" },
        idempotencyKey: "key-4",
        schemaVersion: 1,
        createdAt: "2026-10-09T00:00:00.000Z",
      },
    ],
  };
}

test("native text binds only a complete single directed message target, never a newer head", () => {
  const p = present();
  assert.equal(nativeFinalSequence(p), 4);
  for (const invalid of [
    { ...p, presentedThroughSeq: 3 },
    { ...p, noticeCount: 1 },
    { ...p, directedSeqs: [] },
    { ...p, events: [] },
    { ...p, events: [{ ...p.events[0]!, type: "task.created" }] },
    {
      ...p,
      toSeq: 5,
      presentedThroughSeq: 5,
      directedSeqs: [4, 5],
      events: [
        ...p.events,
        { ...p.events[0]!, roomSeq: 5, payload: { threadId: "thread-b" } },
      ],
    },
  ])
    assert.equal(nativeFinalSequence(invalid), undefined);
  assert.equal(
    nativeFinalSequence({
      ...p,
      fromSeq: 4,
      events: [
        { ...p.events[0]!, roomSeq: 2, payload: { threadId: "old-thread" } },
        ...p.events,
      ],
    }),
    4,
  );
});

test("native final serialization preserves arbitrary body and rejects missing delivery or empty final", () => {
  const text = 'hello "quoted"\n{"not":"a command"}';
  assert.deepEqual(JSON.parse(nativeFinalEnvelope(text, 4)), {
    kind: "room.reply",
    version: 1,
    body: text,
    final: true,
    basedOnRoomSeq: 4,
  });
  for (const [body, seq] of [
    ["", 4],
    ["ok", undefined],
    [undefined, 4],
  ] as const)
    assert.equal(nativeFinalEnvelope(body, seq), "");
});

test("native final guidance is explicit, keeps Worker operations, and requires no model JSON", () => {
  assert.equal(nativeFinalTextInstructions("original", false), "original");
  const guide = nativeFinalTextInstructions("original", true);
  assert.match(guide, /wake selects native-final-text/);
  assert.match(guide, /ordinary final assistant text/);
  assert.match(guide, /Other operations retain the Worker tools/);
  assert.doesNotMatch(guide, /\{"kind"/);
});
