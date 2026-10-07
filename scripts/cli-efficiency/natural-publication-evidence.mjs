import assert from "node:assert/strict";
// Diagnostic native IDs select a Run; canonical event/ACK checks remain with
// the caller. No model-supplied handle constitutes authenticated identity.
export function selectNaturalPublicationRun({
  runs,
  receipts,
  messageId,
  roomSeq,
  sessionId,
  activationId,
}) {
  const success = (r) =>
    r.state === "exited" && (r.exitCode === undefined || r.exitCode === 0);
  if (runs.length === 1) {
    assert.ok(success(runs[0]), "Unsuccessful natural Run");
    assert.equal(runs[0].activationId, activationId);
    return runs[0];
  }
  const matched = receipts.filter(
    (r) =>
      r.messageId === messageId &&
      (r.roomSeq === undefined || r.roomSeq === roomSeq),
  );
  assert.equal(matched.length, 1, "Missing unique native publication receipt");
  const p = matched[0].nativePublication;
  assert.ok(
    p?.provider === "opencode" &&
      p.sessionId === sessionId &&
      typeof p.messageId === "string" &&
      p.messageId &&
      typeof p.nativeTurnId === "string" &&
      p.nativeTurnId,
    "Missing exact native publication association",
  );
  const candidates = runs.filter((r) => r.nativeTurnId === p.nativeTurnId);
  assert.equal(candidates.length, 1, "Ambiguous native publication Run");
  const run = candidates[0];
  assert.ok(success(run), "Unsuccessful publishing Run");
  assert.equal(
    run.activationId,
    activationId,
    "Publication Activation mismatch",
  );
  return run;
}
