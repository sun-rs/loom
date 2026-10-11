import assert from "node:assert/strict";
import test from "node:test";
import { ClientApplicationService } from "../../application-service/src/index.ts";
import { HttpRahClient } from "../../client-sdk/src/index.ts";
import { createHumanApplicationPort } from "../src/index.ts";
import {
  roleInstanceFixture,
  startInstanceRun,
  startInstanceRunFromQueue,
} from "./role-instance-fixture.ts";

// Existing Human policy: abandon blocked execution, then explicitly request fresh
// work after reviewing the new facts. This never resends a saved answer or reuses its credentials.
test("native final held by a new fact recovers through explicit Human abandon and fresh requested work", async () => {
  const f = roleInstanceFixture();
  const service = new ClientApplicationService({
    human: createHumanApplicationPort(f.kernel),
    health: () => {
      throw Error("unused");
    },
  });
  try {
    await service.start();
    const client = new HttpRahClient({
      baseUrl: service.origin,
      accessToken: () => f.owner.accessToken,
    });
    const old = startInstanceRun(f);
    f.kernel.presentWorkerMessages(old.execution);
    f.kernel.markPresentedDeliverySent(f.host, {
      activationId: old.activation.activationId,
      consumerId: "worker",
      runAttemptId: old.run.runAttemptId,
    });
    const newer = f.kernel.postMessage(f.actor, {
      roomId: f.home.roomId,
      body: "new fact: use the corrected value",
      recipients: [{ participantId: f.instance.instanceId, reason: "mention" }],
      idempotencyKey: "new-fact",
    });
    const held = f.kernel.submitWorkerFinalOutput(old.execution, {
      body: "outdated answer must not be resent",
      basedOnRoomSeq: old.scope.toSeq,
    });
    assert.ok("state" in held && held.state === "held");
    const replay = f.kernel.submitWorkerFinalOutput(old.execution, {
      body: "outdated answer must not be resent",
      basedOnRoomSeq: old.scope.toSeq,
    });
    assert.ok("state" in replay && replay.heldDraftId === held.heldDraftId);
    assert.equal(
      f.db
        .prepare(
          "SELECT count(*) n FROM worker_message_presentations WHERE participant_id=? AND room_seq=?",
        )
        .get(f.instance.instanceId, newer.event.roomSeq)!.n,
      0,
      "Host-held response and replay never present newer facts to the model",
    );
    assert.equal(
      f.db.prepare("SELECT count(*) n FROM run_attempt_final_replies").get()!.n,
      0,
    );
    f.kernel.recordRuntimeTermination(f.host, {
      runAttemptId: old.run.runAttemptId,
      runtimeRunId: old.runtime.runtimeRunId,
      exit: { code: 0 },
    });
    f.kernel.finishRunAttempt(f.host, {
      runAttemptId: old.run.runAttemptId,
      state: "failed",
      exitCode: 0,
    });
    f.kernel.retryActivation(f.host, {
      activationId: old.activation.activationId,
      error: "Final output saved, not published; Human recovery required",
      retryAfterMs: 0,
      retryDisposition: "action_required",
    });
    const failedRun = f.db
      .prepare("SELECT * FROM run_attempts WHERE run_attempt_id=?")
      .get(old.run.runAttemptId);
    assert.equal(
      f.kernel.leaseNextActivation(f.host, { leaseMs: 10000 }),
      null,
    );
    const abandon = {
      instanceId: f.instance.instanceId,
      activationId: old.activation.activationId,
      basedOnRoomSeq: f.head(f.home.roomId),
      idempotencyKey: "human-abandon-held",
    };
    await client.request("instance.activation.abandon", abandon);
    assert.equal(
      (await client.request("instance.activation.abandon", abandon))
        .deduplicated,
      true,
    );
    assert.deepEqual(
      f.db
        .prepare("SELECT * FROM run_attempts WHERE run_attempt_id=?")
        .get(old.run.runAttemptId),
      failedRun,
    );
    assert.throws(() =>
      f.kernel.submitWorkerFinalOutput(old.execution, {
        body: "outdated answer must not be resent",
        basedOnRoomSeq: old.scope.toSeq,
      }),
    );
    // Retry quarantine merged the earlier follow-up into the failed interval.
    // Abandon is withdrawal, not retry; Human must explicitly request new work.
    assert.equal(
      f.kernel.leaseNextActivation(f.host, { leaseMs: 10000 }),
      null,
    );
    f.kernel.postMessage(f.actor, {
      roomId: f.home.roomId,
      body: "Please answer again using the corrected value",
      recipients: [{ participantId: f.instance.instanceId, reason: "mention" }],
      idempotencyKey: "human-recovery-request",
    });
    const next = startInstanceRunFromQueue(f);
    assert.notEqual(next.activation.activationId, old.activation.activationId);
    assert.notEqual(next.run.runAttemptId, old.run.runAttemptId);
    const present = f.kernel.presentWorkerMessages(next.execution);
    assert.ok(
      present.events.some((event) => event.eventId === newer.event.eventId),
    );
    f.kernel.markPresentedDeliverySent(f.host, {
      activationId: next.activation.activationId,
      consumerId: "worker",
      runAttemptId: next.run.runAttemptId,
    });
    const answer = {
      body: "new answer using the corrected value",
      basedOnRoomSeq: next.scope.toSeq,
    };
    const sent = f.kernel.submitWorkerFinalOutput(next.execution, answer);
    assert.ok("event" in sent && !sent.deduplicated);
    const duplicate = f.kernel.submitWorkerFinalOutput(next.execution, answer);
    assert.ok("event" in duplicate && duplicate.deduplicated);
    assert.ok(
      Number(
        f.db
          .prepare(
            "SELECT last_seq FROM subscription_cursors WHERE room_id=? AND participant_id=? AND consumer_id=\'worker\'",
          )
          .get(f.home.roomId, f.instance.instanceId)!.last_seq,
      ) >= next.scope.toSeq,
      "native final must ACK before fixture cleanup",
    );
    next.finish(0);
    assert.equal(
      f.db
        .prepare("SELECT count(*) n FROM messages WHERE actor_id=?")
        .get(f.instance.instanceId)!.n,
      1,
    );
    assert.equal(
      f.db.prepare("SELECT count(*) n FROM run_attempt_final_replies").get()!.n,
      1,
    );
    const draft = f.db
      .prepare(
        "SELECT body,state FROM held_message_drafts WHERE held_draft_id=?",
      )
      .get(held.heldDraftId)!;
    assert.equal(draft.body, "outdated answer must not be resent");
    assert.equal(draft.state, "replaced");
    assert.equal(
      f.kernel.leaseNextActivation(f.host, { leaseMs: 10000 }),
      null,
    );
  } finally {
    await service.close();
    f.close();
  }
});
