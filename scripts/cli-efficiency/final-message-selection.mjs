import assert from "node:assert/strict";

/** Benchmark evidence only: raw Kernel rows plus public Message/RunAttempt records.
 * Select by durable final provenance, never by body or total author-post count.
 * Callers still verify successful execution, delivery ACK and original CLI text.
 */
export function selectFinalMessage({
  messages,
  markers,
  events,
  runs,
  roomId,
  actorId,
  threadId,
}) {
  const identity = (value) =>
    assert.ok(
      typeof value === "string" && value.trim().length > 0,
      "Required identity must be nonempty",
    );
  const sequence = (value) =>
    assert.ok(
      Number.isSafeInteger(value) && value >= 0,
      "Sequence must be a nonnegative safe integer",
    );
  identity(roomId);
  identity(actorId);
  if (threadId !== undefined) identity(threadId);
  for (const marker of markers) {
    for (const key of [
      "run_attempt_id",
      "activation_id",
      "room_id",
      "event_id",
    ])
      identity(marker[key]);
    sequence(marker.room_seq);
  }
  for (const event of events) {
    for (const key of ["event_id", "room_id", "actor_id", "aggregate_id"])
      identity(event[key]);
    sequence(event.room_seq);
  }
  for (const message of messages) {
    for (const key of ["messageId", "roomId", "actorId"])
      identity(message[key]);
    sequence(message.roomSeq);
  }
  for (const run of runs) {
    for (const key of [
      "runAttemptId",
      "activationId",
      "participantId",
      "roomId",
    ])
      identity(run[key]);
  }
  assert.equal(
    markers.length,
    1,
    "Expected exactly one committed final marker",
  );
  const marker = markers[0];
  assert.ok(
    marker.submission_kind === "final-output" ||
      marker.submission_kind === null,
    "Unknown final marker source",
  );
  const transport =
    marker.submission_kind === null ? "worker-final" : "native-final-output";
  assert.equal(marker.room_id, roomId);
  const matchingRuns = runs.filter(
    (run) => run.runAttemptId === marker.run_attempt_id,
  );
  assert.equal(
    matchingRuns.length,
    1,
    "Final marker must belong to this turn's Run",
  );
  assert.equal(marker.activation_id, matchingRuns[0].activationId);
  assert.equal(matchingRuns[0].participantId, actorId);
  assert.equal(matchingRuns[0].roomId, roomId);
  const matchingEvents = events.filter(
    (event) => event.event_id === marker.event_id,
  );
  assert.equal(
    matchingEvents.length,
    1,
    "Final marker must resolve one durable event",
  );
  const event = matchingEvents[0];
  assert.equal(event.type, "message.posted");
  assert.equal(event.room_id, roomId);
  assert.equal(event.room_seq, marker.room_seq);
  assert.equal(event.actor_id, actorId);
  assert.equal(
    new Set(messages.map((message) => message.messageId)).size,
    messages.length,
  );
  const selected = messages.filter(
    (message) => message.messageId === event.aggregate_id,
  );
  assert.equal(
    selected.length,
    1,
    "Final event must resolve one observed message",
  );
  const finalMessage = selected[0];
  assert.equal(finalMessage.roomId, roomId);
  assert.equal(finalMessage.roomSeq, marker.room_seq);
  assert.equal(finalMessage.actorId, actorId);
  assert.equal(finalMessage.threadId, threadId);
  return {
    transport,
    finalMessage,
    otherMessages: messages.filter((message) => message !== finalMessage),
  };
}
