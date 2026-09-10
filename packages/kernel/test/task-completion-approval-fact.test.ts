import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { RoomKernel } from "../src/index.ts";

/**
 * Raft's Workflow tells the Agent to set `done` "after approval (e.g. 'looks
 * good', 'merge it')" — the approval is Human prose in chat that the Agent
 * judges. RAH must not take a model's word for it, so before an Agent-facing
 * completion can exist there has to be a durable approval fact to check.
 *
 * Today there is exactly one: a Human being the actor that completes. The
 * reviewer-evidence fence is not a second one — `assertCompletionAllowed`
 * imposes nothing when the Task has no reviewers, and reviewers are only set at
 * creation. This pins that, so the gate is never mistaken for an approval fence
 * when the Agent entry is built.
 */
test("reviewer evidence is not an approval fence: it is vacuous without reviewers", () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-completion-approval-"));
  try {
    const kernel = new RoomKernel({ databasePath: join(directory, "room.db") });
    kernel.initialize();
    const human = kernel.provisionPrincipal({
      handle: "approver",
      kind: "human",
    });
    const agent = kernel.provisionPrincipal({ handle: "doer", kind: "agent" });
    const actor = kernel.authenticateAccessToken(human.accessToken);
    const room = kernel.createRoom(actor, { name: "Done", slug: "done" });
    kernel.addMember(actor, {
      principalId: agent.principal.principalId,
      roomId: room.roomId,
    });
    const task = kernel.createTask(actor, {
      collaboratorIds: [],
      dependencyTaskIds: [],
      idempotencyKey: "t1",
      // The ordinary case, and the one every acceptance run produces.
      reviewerIds: [],
      roomId: room.roomId,
      title: "Unreviewed",
    });

    assert.doesNotThrow(
      () => kernel.taskReviews.assertCompletionAllowed(task.task.taskId),
      "with no reviewers the completion gate checks nothing at all",
    );

    // So the only thing standing between a submitted Task and `completed` is
    // the actor being a Human. An Agent-facing completion that replaced that
    // check with submitter identity would let an Agent approve its own work.
    assert.equal(
      kernel.getTask(actor, {
        roomId: room.roomId,
        taskId: task.task.taskId,
      }).state,
      "todo",
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
