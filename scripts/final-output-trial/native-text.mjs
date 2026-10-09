// Laboratory boundary only: no daemon/runtime imports this module.
// The provider adapter must independently prove a current, complete native
// final. This module never extracts intent from stdout, exit code or prose.
import assert from "node:assert/strict";
import { WorkerFinalOutput } from "../../packages/agent-host/src/worker-final-output.ts";

export function createNativeTextTrial(options) {
  const { mode, sessionId, turnId, launchId, deliveredSeq, binding } = options;
  assert.equal(mode, "native-final-text/v1", "Explicit Run mode required");
  for (const value of [
    sessionId,
    turnId,
    launchId,
    binding?.runAttemptId,
    binding?.accessToken,
  ])
    assert.ok(
      typeof value === "string" && value.trim(),
      "Missing original identity",
    );
  assert.ok(
    Number.isSafeInteger(deliveredSeq) && deliveredSeq >= 0,
    "Invalid delivered sequence",
  );
  assert.equal(typeof binding.isActive, "function");
  // Reuse the dedicated transaction-level final-output slot, including its
  // cross-facade final conflict checks. The model emits no JSON; this adapter
  // serializes its already-bound explicit intent for the existing transport.
  const isActive = binding.isActive;
  const execution = new WorkerFinalOutput({
    origin: options.workerApiOrigin,
    fetcher: options.fetcher ?? fetch,
    accessToken: binding.accessToken,
    isActive,
  });
  let firstBody;
  return async (terminal) => {
    assert.equal(terminal.sessionId, sessionId, "Foreign session");
    assert.equal(terminal.turnId, turnId, "Foreign turn");
    assert.equal(terminal.launchId, launchId, "Foreign launch");
    assert.equal(terminal.status, "completed", "Incomplete native final");
    assert.ok(
      Array.isArray(terminal.finalTexts) && terminal.finalTexts.length === 1,
      "Ambiguous native final",
    );
    const body = terminal.finalTexts[0];
    assert.ok(typeof body === "string" && body.trim(), "Empty native final");
    assert.ok(
      Buffer.byteLength(body, "utf8") <= 65536,
      "Native final exceeds buffer",
    );
    if (!isActive())
      return {
        state: "rejected",
        detail: "Original execution ended; nothing was sent.",
      };
    if (firstBody !== undefined && body !== firstBody)
      return {
        state: "rejected",
        detail: "Conflicting final body; nothing was sent.",
      };
    firstBody = body;
    return execution.submit(
      JSON.stringify({
        kind: "room.reply",
        version: 1,
        body,
        final: true,
        basedOnRoomSeq: deliveredSeq,
      }),
    );
  };
}
