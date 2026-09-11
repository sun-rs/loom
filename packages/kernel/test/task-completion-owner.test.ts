import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { RoomKernel } from "../src/index.ts";
import { RoomEventWriter } from "../src/room-event-writer.ts";
import { ActivationObligationService } from "../src/activation-obligation-service.ts";
import { completeTaskTransaction } from "../src/task-completion.ts";
import { inImmediateTransaction } from "../src/sqlite-transaction.ts";

test("shared completion retains real actor, review gate, dependency attention and replay", () => {
  const dir = mkdtempSync(join(tmpdir(), "rah-complete-owner-"));
  const kernel = new RoomKernel({ databasePath: join(dir, "db") });
  kernel.initialize();
  const db = new DatabaseSync(join(dir, "db"));
  try {
    const human = kernel.provisionPrincipal({ handle: "owner", kind: "human" });
    const agent = kernel.provisionPrincipal({
      handle: "worker",
      kind: "agent",
    });
    const actor = kernel.authenticateAccessToken(human.accessToken);
    const room = kernel.createRoom(actor, { name: "Work", slug: "work" });
    kernel.addMember(actor, {
      roomId: room.roomId,
      principalId: agent.principal.principalId,
    });
    const task = kernel.createTask(actor, {
      roomId: room.roomId,
      title: "First",
      idempotencyKey: "first",
      dependencyTaskIds: [],
      collaboratorIds: [],
      reviewerIds: [],
    });
    const next = kernel.createTask(actor, {
      roomId: room.roomId,
      title: "Next",
      idempotencyKey: "next",
      dependencyTaskIds: [task.task.taskId],
      collaboratorIds: [],
      reviewerIds: [],
    });
    db.prepare(
      "UPDATE tasks SET state='submitted',submission_summary='Actual result',submitted_at='2026-09-11T00:00:00Z',assignee_id=? WHERE task_id=?",
    ).run(agent.principal.principalId, task.task.taskId);
    const createId = (prefix: string) => prefix + "_" + randomUUID();
    const events = new RoomEventWriter({
      database: db,
      createId,
      now: () => new Date(),
      obligations: new ActivationObligationService({ database: db, createId }),
    });
    let deny = true;
    let freshness = 0;
    const ctx = {
      database: db,
      events,
      now: () => new Date(),
      assertFresh: () => {
        freshness++;
      },
      assertCompletionAllowed: () => {
        if (deny) throw new Error("review missing");
      },
    };
    const input = {
      taskId: task.task.taskId,
      idempotencyKey: "complete",
      basedOnRoomSeq: next.event.roomSeq,
    };
    const complete = () =>
      inImmediateTransaction(db, () =>
        completeTaskTransaction(ctx, agent.principal.principalId, input),
      );
    assert.throws(complete, /review missing/);
    assert.equal(
      db.prepare("SELECT state FROM tasks WHERE task_id=?").get(input.taskId)!
        .state,
      "submitted",
    );
    deny = false;
    const result = complete();
    assert.equal(result.task.state, "completed");
    assert.equal(result.event.actorId, agent.principal.principalId);
    assert.deepEqual(result.event.payload.readyTaskIds, [next.task.taskId]);
    assert.ok(result.activationIds.length > 0);
    const seen = freshness;
    const replay = complete();
    assert.equal(replay.deduplicated, true);
    assert.equal(freshness, seen);
    assert.deepEqual(replay.activationIds, []);
    assert.equal(
      db
        .prepare(
          "SELECT COUNT(*) n FROM room_events WHERE type='task.completed'",
        )
        .get()!.n,
      1,
    );
  } finally {
    db.close();
    kernel.close();
    rmSync(dir, { force: true, recursive: true });
  }
});
