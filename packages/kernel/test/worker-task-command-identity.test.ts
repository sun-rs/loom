import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { RoomKernel } from "../src/room-kernel.ts";
import {
  resolveWorkerTaskCommandCausality,
  workerTaskCommandReadPosition,
  workerTaskReworkRoundSeq,
} from "../src/worker-task-command-identity.ts";

/**
 * The server-side identity of a Task command: what makes a retry the same
 * command, and what makes a rework round a different one.
 */
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "rah-task-identity-"));
  const databasePath = join(directory, "room.db");
  const kernel = new RoomKernel({ databasePath });
  kernel.initialize();
  const human = kernel.provisionPrincipal({ kind: "human", handle: "human" });
  const agent = kernel.provisionPrincipal({ kind: "agent", handle: "agent" });
  const actor = kernel.authenticateAccessToken(human.accessToken);
  const room = kernel.createRoom(actor, { name: "Identity", slug: "identity" });
  kernel.addMember(actor, {
    roomId: room.roomId,
    principalId: agent.principal.principalId,
  });
  const task = kernel.createTask(actor, {
    roomId: room.roomId,
    title: "Rework me",
    assigneeId: agent.principal.principalId,
    collaboratorIds: [],
    reviewerIds: [],
    dependencyTaskIds: [],
    idempotencyKey: "task",
  });
  const database = new DatabaseSync(databasePath);
  const head = () =>
    Number(
      database
        .prepare("SELECT next_seq-1 AS n FROM rooms WHERE room_id=?")
        .get(room.roomId)!.n,
    );
  const scope = {
    activationId: "activation_identity",
    consumerId: "consumer",
    hostId: "host",
    participantId: agent.principal.principalId,
    roomId: room.roomId,
    runAttemptId: "run_identity",
    toSeq: head(),
  };
  return {
    actor,
    agent,
    database,
    head,
    kernel,
    room,
    scope,
    task,
    key(input: {
      operation: string;
      subjectId?: string;
      content?: readonly (string | null)[];
    }) {
      return resolveWorkerTaskCommandCausality(database, scope, input)
        .idempotencyKey;
    },
    close() {
      database.close();
      kernel.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

test("the derived key is stable for one command and distinct for a different one", () => {
  const f = fixture();
  try {
    const claim = {
      operation: "task-claim",
      subjectId: f.task.task.taskId,
    } as const;
    assert.equal(f.key(claim), f.key(claim), "a retry is the same command");
    assert.notEqual(
      f.key(claim),
      f.key({ operation: "task-start", subjectId: f.task.task.taskId }),
      "a different operation is a different command",
    );
    assert.notEqual(
      f.key(claim),
      f.key({ operation: "task-claim", subjectId: "task_other" }),
      "a different Task is a different command",
    );
    assert.notEqual(
      f.key({
        operation: "task-progress",
        subjectId: f.task.task.taskId,
        content: ["half way"],
      }),
      f.key({
        operation: "task-progress",
        subjectId: f.task.task.taskId,
        content: ["nearly done"],
      }),
      "different prose is a different command",
    );
    assert.ok(f.key(claim).startsWith("derived-task-"));
  } finally {
    f.close();
  }
});

test("a reopening event starts a new round, so the same command hashes differently", () => {
  const f = fixture();
  try {
    const claim = {
      operation: "task-claim",
      subjectId: f.task.task.taskId,
    } as const;
    const firstRound = f.key(claim);
    assert.equal(
      workerTaskReworkRoundSeq(f.database, f.room.roomId, f.task.task.taskId),
      0,
    );
    f.kernel.cancelTask(f.actor, {
      taskId: f.task.task.taskId,
      reason: "Rejected from the Task status menu",
      basedOnRoomSeq: f.head(),
      idempotencyKey: "cancel",
    });
    const reopened = f.kernel.reopenTask(f.actor, {
      taskId: f.task.task.taskId,
      basedOnRoomSeq: f.head(),
      idempotencyKey: "reopen",
    });
    assert.equal(
      workerTaskReworkRoundSeq(f.database, f.room.roomId, f.task.task.taskId),
      reopened.event.roomSeq,
    );
    const secondRound = f.key(claim);
    assert.notEqual(
      secondRound,
      firstRound,
      "the rework round must not replay the rejected round's claim",
    );
    assert.equal(secondRound, f.key(claim), "the new round is itself stable");
    assert.notEqual(
      f.key({ operation: "task-claim", subjectId: "task_untouched" }),
      secondRound,
      "the round belongs to the reopened Task alone",
    );
  } finally {
    f.close();
  }
});

test("a changes_requested review opens a round the same way a reopen does", () => {
  const f = fixture();
  try {
    const before = f.key({
      operation: "task-submit",
      subjectId: f.task.task.taskId,
      content: ["result"],
    });
    const roomSeq = f.head() + 1;
    f.database
      .prepare(
        `INSERT INTO room_events(event_id, room_id, room_seq, type, actor_id, aggregate_type, aggregate_id, payload_json, idempotency_key, schema_version, created_at)
         VALUES(?, ?, ?, 'review.submitted', ?, 'review', ?, ?, ?, 1, ?)`,
      )
      .run(
        "review-event",
        f.room.roomId,
        roomSeq,
        f.agent.principal.principalId,
        "review_1",
        JSON.stringify({
          disposition: "changes_requested",
          taskId: f.task.task.taskId,
        }),
        "review-key",
        new Date().toISOString(),
      );
    f.database
      .prepare("UPDATE rooms SET next_seq=? WHERE room_id=?")
      .run(roomSeq + 1, f.room.roomId);
    assert.equal(
      workerTaskReworkRoundSeq(f.database, f.room.roomId, f.task.task.taskId),
      roomSeq,
    );
    assert.notEqual(
      f.key({
        operation: "task-submit",
        subjectId: f.task.task.taskId,
        content: ["result"],
      }),
      before,
    );
  } finally {
    f.close();
  }
});

test("the read position is the Activation head, moved on by this Run's own Task events", () => {
  const f = fixture();
  try {
    assert.equal(
      workerTaskCommandReadPosition(f.database, f.scope),
      f.scope.toSeq,
      "with no Run of its own, the Activation head is the position",
    );
    const roomSeq = f.head() + 1;
    f.database
      .prepare(
        `INSERT INTO room_events(event_id, room_id, room_seq, type, actor_id, aggregate_type, aggregate_id, payload_json, idempotency_key, schema_version, created_at)
         VALUES(?, ?, ?, 'task.claimed', ?, 'task', ?, ?, ?, 1, ?)`,
      )
      .run(
        "own-claim",
        f.room.roomId,
        roomSeq,
        f.agent.principal.principalId,
        f.task.task.taskId,
        JSON.stringify({
          taskId: f.task.task.taskId,
          runAttemptId: f.scope.runAttemptId,
        }),
        "own-claim-key",
        new Date().toISOString(),
      );
    assert.equal(
      workerTaskCommandReadPosition(f.database, f.scope),
      roomSeq,
      "this Run's own committed Task event moves it forward",
    );
    f.database
      .prepare(
        `INSERT INTO room_events(event_id, room_id, room_seq, type, actor_id, aggregate_type, aggregate_id, payload_json, idempotency_key, schema_version, created_at)
         VALUES(?, ?, ?, 'task.claimed', ?, 'task', ?, ?, ?, 1, ?)`,
      )
      .run(
        "other-run-claim",
        f.room.roomId,
        roomSeq + 1,
        f.agent.principal.principalId,
        f.task.task.taskId,
        JSON.stringify({
          taskId: f.task.task.taskId,
          runAttemptId: "run_other",
        }),
        "other-run-key",
        new Date().toISOString(),
      );
    assert.equal(
      workerTaskCommandReadPosition(f.database, f.scope),
      roomSeq,
      "another RunAttempt's event is not an anchor for this one",
    );
  } finally {
    f.close();
  }
});

test("Human reopen-to-progress and assignee edits advance the Worker command round", () => {
  const f = fixture();
  try {
    let prior = workerTaskReworkRoundSeq(
      f.database,
      f.room.roomId,
      f.task.task.taskId,
    );
    for (const workflowStatus of ["done", "in_progress"] as const) {
      const r = f.kernel.updateTaskWorkflowStatus(f.actor, {
        taskId: f.task.task.taskId,
        basedOnRoomSeq: f.head(),
        idempotencyKey: `manual-${workflowStatus}`,
        workflowStatus,
      });
      const next = workerTaskReworkRoundSeq(
        f.database,
        f.room.roomId,
        f.task.task.taskId,
      );
      assert.equal(next, r.event.roomSeq);
      assert.ok(next > prior);
      prior = next;
    }
    const assigned = f.kernel.assignTask(f.actor, {
      taskId: f.task.task.taskId,
      basedOnRoomSeq: f.head(),
      idempotencyKey: "manual-self",
      assigneeId: f.task.task.creatorId,
    });
    assert.equal(
      workerTaskReworkRoundSeq(f.database, f.room.roomId, f.task.task.taskId),
      assigned.event.roomSeq,
    );
  } finally {
    f.close();
  }
});
