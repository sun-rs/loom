import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * Raft holds three commands: task claim, task update, task amend
 * (`isFreshnessHeldResponse` has exactly three call sites in the extracted CLI,
 * and only those three response schemas union into
 * `agentApiHeldFreshnessResponseSchema`).
 *
 * RAH now has the explicit update-status facade, matching Raft's held response
 * union (SEA 1.0.18 main.js:17274ff and 730404ff). It also keeps the existing
 * task-submit alias. This adds no hold behavior to unrelated lifecycle commands;
 * done/closed authority remains a separate policy boundary.
 *
 * This pins the set so it cannot be widened without evidence. It is not a
 * statement that the set is complete.
 *
 * Excluded, each for a stated reason:
 *  - release/assign/unassign/create/convert/delete: their Raft counterparts
 *    (unclaim, assign, create, convert, delete) have no hold branch. Note this
 *    proves only that upstream's CLI does not render a hold there; it does not
 *    prove the Raft server applies no concurrency check.
 *  - start, review: the remaining shards of `task update`. The evidence carries
 *    counterexamples rather than merely lacking support — `unclaim` reaches
 *    `todo` without holding and `task create --assignee @yourself` reaches
 *    `in_progress` without holding — so the target status cannot decide it.
 *  - block, unblock, request-input, progress: RAH-only. `blocked` is not a Raft
 *    task status anywhere in the product, so upstream settles nothing.
 *  - done/closed inputs exist but retain the current Human-management denial.
 */
test("the Task freshness hold covers exactly the routes evidence has settled", () => {
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
    "/v1/worker/tasks/submit",
    "/v1/worker/tasks/update-status",
  ]);
});
