import assert from "node:assert/strict";
import test from "node:test";
import { selectFinalMessage } from "./final-message-selection.mjs";
const fixture = () => ({
  roomId: "room",
  actorId: "actor",
  runs: [
    {
      runAttemptId: "run",
      activationId: "act",
      participantId: "actor",
      roomId: "room",
    },
  ],
  markers: [
    {
      run_attempt_id: "run",
      activation_id: "act",
      room_id: "room",
      event_id: "event",
      room_seq: 9,
      submission_kind: "final-output",
    },
  ],
  events: [
    {
      event_id: "event",
      room_id: "room",
      room_seq: 9,
      type: "message.posted",
      aggregate_id: "final",
      actor_id: "actor",
    },
  ],
  messages: [
    {
      messageId: "progress",
      roomId: "room",
      roomSeq: 8,
      actorId: "actor",
      body: "progress",
    },
    {
      messageId: "final",
      roomId: "room",
      roomSeq: 9,
      actorId: "actor",
      body: "answer",
    },
  ],
});
test("legal progress plus final resolves the exact marker and retains every other post", () => {
  const x = fixture(),
    r = selectFinalMessage(x);
  assert.equal(r.finalMessage.messageId, "final");
  assert.deepEqual(r.otherMessages, [x.messages[0]]);
});
test("duplicate final markers are rejected even if bodies equal", () => {
  const x = fixture();
  x.markers.push({ ...x.markers[0] });
  assert.throws(() => selectFinalMessage(x));
});
for (const kind of [
  "wrong-target",
  "wrong-actor",
  "wrong-run",
  "wrong-event",
  "missing-final",
  "duplicate-message",
])
  test(kind + " is rejected", () => {
    const x = fixture();
    if (kind === "wrong-target") x.markers[0].room_id = "other";
    if (kind === "wrong-actor") x.messages[1].actorId = "other";
    if (kind === "wrong-run") x.markers[0].run_attempt_id = "other";
    if (kind === "wrong-event") x.events[0].aggregate_id = "progress";
    if (kind === "missing-final") x.messages.pop();
    if (kind === "duplicate-message") x.messages.push({ ...x.messages[1] });
    assert.throws(() => selectFinalMessage(x));
  });

test("missing matching identities are rejected rather than matching undefined", () => {
  const x = fixture();
  delete x.actorId;
  delete x.events[0].actor_id;
  delete x.messages[1].actorId;
  assert.throws(() => selectFinalMessage(x));
});
test("unsafe matching sequence numbers are rejected", () => {
  const x = fixture();
  x.markers[0].room_seq =
    x.events[0].room_seq =
    x.messages[1].roomSeq =
      Number.MAX_SAFE_INTEGER + 1;
  assert.throws(() => selectFinalMessage(x));
});

test("explicit Worker final marker has its own transport, without pretending native-body publication", () => {
  const x = fixture();
  x.markers[0].submission_kind = null;
  const selected = selectFinalMessage(x);
  assert.equal(selected.transport, "worker-final");
  assert.equal(selected.finalMessage.messageId, "final");
});
for (const kind of [undefined, "unknown"]) {
  test(`missing or unknown final source ${String(kind)} is rejected`, () => {
    const x = fixture();
    if (kind === undefined) delete x.markers[0].submission_kind;
    else x.markers[0].submission_kind = kind;
    assert.throws(() => selectFinalMessage(x));
  });
}
