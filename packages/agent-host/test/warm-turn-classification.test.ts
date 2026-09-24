import assert from "node:assert/strict";
import test from "node:test";

import { warmTurnDriverFailure } from "../src/codex-warm-adapter.ts";

/**
 * Seventh review P1-3 (Host side): a warm driver's error text is a failure of
 * the turn whatever its status, so an interrupted turn that also names an
 * independent error never quiesces as success after a final reply.
 */
const drained = (fields: Record<string, unknown>) => ({
  inFlightToolCount: 0,
  kind: "drained" as const,
  lastFrameSeq: 1,
  nativeTurnId: "turn-1",
  status: "completed",
  ...fields,
});

test("an interrupted final end that still names an error is a failure", () => {
  const failure = warmTurnDriverFailure(
    drained({
      status: "interrupted",
      endedAfterFinalReply: true,
      errorMessage: "FAKE notice provider failure",
    }),
  );
  assert.ok(failure !== undefined);
  assert.match(JSON.stringify(failure), /FAKE notice provider failure/u);
});

test("a clean final end is no failure; failed and rejected always are", () => {
  assert.equal(
    warmTurnDriverFailure(
      drained({ status: "interrupted", endedAfterFinalReply: true }),
    ),
    undefined,
  );
  assert.ok(warmTurnDriverFailure(drained({ status: "failed" })) !== undefined);
  assert.ok(
    warmTurnDriverFailure(drained({ status: "rejected" })) !== undefined,
  );
});
