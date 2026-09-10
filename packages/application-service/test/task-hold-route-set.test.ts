import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * Upstream's hold set is exhaustive, not a sample. `isFreshnessHeldResponse`
 * has exactly three call sites in the extracted CLI — task claim, task update
 * and task amend — and only those three response schemas union into
 * `agentApiHeldFreshnessResponseSchema`. Every other task command returns a
 * plain result with no held variant.
 *
 * So widening RAH's hold set is not a refinement, it is innovation past the
 * contract. This pins the set; a change to it has to arrive with new evidence
 * and a new statement here.
 *
 * Deliberately outside the set, each for a stated reason:
 *  - release/assign/unassign/create/convert/delete: their Raft counterparts
 *    (unclaim, assign, create, convert, delete) demonstrably have no hold.
 *  - start, submit, review: shards of Raft's single `task update`, which RAH
 *    does not have as one command. The status mapping is legible but the hold
 *    mapping is not settled by the client bundle.
 *  - block, unblock, request-input, progress: RAH-only. `blocked` is not a Raft
 *    task status anywhere in the product, so upstream settles nothing for them.
 */
test("the Task freshness hold covers exactly the routes whose Raft counterpart holds", () => {
  const source = readFileSync(
    new URL("../src/worker-application-service.ts", import.meta.url),
    "utf8",
  );
  const block = source.slice(
    source.indexOf("const TASK_FRESHNESS_HOLD_ROUTES"),
  );
  const declared = [
    ...block.slice(0, block.indexOf("]")).matchAll(/"(\/v1\/worker\/[^"]+)"/gu),
  ].map((match) => match[1]);
  assert.deepEqual(declared.sort(), [
    "/v1/worker/tasks/amend",
    "/v1/worker/tasks/claim",
    "/v1/worker/tasks/claim-message",
  ]);
});
