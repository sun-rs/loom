import assert from "node:assert/strict";
import test from "node:test";
import { WorkerApplicationService } from "../../packages/application-service/src/index.ts";
import {
  roleInstanceFixture,
  startInstanceRun,
} from "../../packages/kernel/test/role-instance-fixture.ts";
import { createFinalOutputTrial, parseFinalReply } from "./submission.mjs";

const envelope = (body = "FAKE explicit final reply") =>
  JSON.stringify({ kind: "room.reply", version: 1, body, final: true });
const terminal = (text = envelope(), extra = {}) => ({
  sessionId: "session",
  turnId: "turn",
  status: "completed",
  finalTexts: [text],
  ...extra,
});

test("explicit final schema rejects diagnostic prose, ambiguous JSON, forged authority and incomplete intents", () => {
  assert.equal(parseFinalReply(envelope()).body, "FAKE explicit final reply");
  for (const text of [
    "done",
    "```json\n" + envelope() + "\n```",
    envelope() + envelope(),
    envelope().slice(0, -1),
    '{"kind":"room.reply","version":1,"body":"a","body":"b","final":true}',
    JSON.stringify({
      kind: "room.reply",
      version: 1,
      body: "x",
      final: true,
      actorId: "owner",
    }),
    JSON.stringify({ kind: "room.reply", version: 1, body: "x", final: false }),
  ])
    assert.throws(() => parseFinalReply(text));
});

async function fixture({ acknowledge = true } = {}) {
  const f = roleInstanceFixture();
  const service = new WorkerApplicationService({ kernel: f.kernel });
  await service.start();
  const work = startInstanceRun(f);
  f.kernel.presentWorkerMessages(work.execution);
  f.kernel.markPresentedDeliverySent(f.host, {
    activationId: work.activation.activationId,
    consumerId: "worker",
    runAttemptId: work.run.runAttemptId,
  });
  if (acknowledge) {
    const delivery = f.kernel.syncWorker(work.execution, {});
    f.kernel.acknowledgeWorkerCursor(work.execution, {
      throughSeq: delivery.cursorAfter,
    });
  }
  const credential = service.issueActivationCredential(f.host, work.scope);
  let active = true;
  const options = {
    workerApiOrigin: service.origin,
    sessionId: "session",
    turnId: "turn",
    binding: {
      runAttemptId: work.run.runAttemptId,
      accessToken: credential.accessToken,
      isActive: () => active,
    },
  };
  return {
    f,
    work,
    options,
    close: async () => {
      active = false;
      await service.close();
      f.close();
    },
    revoke: () => {
      active = false;
    },
  };
}
const bodyOf = (r) => JSON.parse(r.content[0].text);

test("completed native candidate publishes once under original Worker identity; replay or changed output cannot duplicate it", async () => {
  const x = await fixture();
  try {
    const submit = createFinalOutputTrial(x.options);
    const result = await submit(terminal());
    assert.equal(result.isError, false);
    const receipt = bodyOf(result);
    assert.equal(receipt.state, "published");
    const published = x.f.db
      .prepare(
        "SELECT actor_id, room_id, room_seq FROM room_events WHERE aggregate_id=? AND type='message.posted'",
      )
      .get(receipt.messageId);
    assert.deepEqual(
      { ...published },
      {
        actor_id: x.f.instance.instanceId,
        room_id: x.f.home.roomId,
        room_seq: receipt.roomSeq,
      },
    );
    assert.deepEqual(await submit(terminal()), result);
    assert.equal(
      bodyOf(await submit(terminal(envelope("changed")))).error.code,
      "CALL_CONFLICT",
    );
    assert.equal(
      x.f.db
        .prepare("SELECT count(*) AS n FROM messages WHERE body=?")
        .get("FAKE explicit final reply").n,
      1,
    );
    assert.equal(
      x.f.db
        .prepare("SELECT state FROM activations WHERE activation_id=?")
        .get(x.work.activation.activationId).state,
      "leased",
    );
  } finally {
    await x.close();
  }
});

test("foreign, cancelled, failed, intermediate or ambiguous terminal evidence sends nothing", async () => {
  const x = await fixture();
  try {
    let sends = 0;
    const submit = createFinalOutputTrial({
      ...x.options,
      fetcher: () => {
        sends++;
        throw Error("must not send");
      },
    });
    for (const extra of [
      { sessionId: "foreign" },
      { turnId: "later" },
      { status: "cancelled" },
      { status: "failed" },
      { status: "running" },
      { finalTexts: [] },
      { finalTexts: [envelope(), envelope()] },
    ])
      await assert.rejects(submit(terminal(envelope(), extra)));
    assert.equal(sends, 0);
  } finally {
    await x.close();
  }
});

test("native success does not bypass a new Human fact: held remains durable, not published or acknowledged", async () => {
  const x = await fixture();
  try {
    const cursors = x.f.db.prepare("SELECT * FROM subscription_cursors").all();
    x.f.kernel.postMessage(x.f.actor, {
      roomId: x.f.home.roomId,
      body: "A new Human fact",
      idempotencyKey: "new-fact",
      recipients: [],
    });
    const result = bodyOf(await createFinalOutputTrial(x.options)(terminal()));
    assert.equal(result.state, "held");
    assert.ok(result.heldDraftId);
    assert.deepEqual(
      x.f.db.prepare("SELECT * FROM subscription_cursors").all(),
      cursors,
    );
    assert.equal(
      x.f.db
        .prepare("SELECT body FROM held_message_drafts WHERE held_draft_id=?")
        .get(result.heldDraftId).body,
      "FAKE explicit final reply",
    );
    assert.equal(
      x.f.db
        .prepare("SELECT count(*) AS n FROM messages WHERE body=?")
        .get("FAKE explicit final reply").n,
      0,
    );
    assert.equal(
      x.f.db
        .prepare(
          "SELECT count(*) AS n FROM run_attempt_final_replies WHERE run_attempt_id=?",
        )
        .get(x.work.run.runAttemptId).n,
      0,
    );
  } finally {
    await x.close();
  }
});

test("lost response never triggers another send, and revoked original authority cannot be rebound", async () => {
  const x = await fixture();
  try {
    let sends = 0;
    const submit = createFinalOutputTrial({
      ...x.options,
      fetcher: async (...args) => {
        sends++;
        await fetch(...args);
        throw Error("response lost after commit");
      },
    });
    assert.equal(bodyOf(await submit(terminal())).error.code, "RESULT_UNKNOWN");
    assert.equal(bodyOf(await submit(terminal())).error.code, "RESULT_UNKNOWN");
    assert.equal(sends, 1);
    assert.equal(
      x.f.db
        .prepare("SELECT count(*) AS n FROM messages WHERE body=?")
        .get("FAKE explicit final reply").n,
      1,
    );
    x.revoke();
    assert.equal(bodyOf(await submit(terminal())).error.code, "UNBOUND_CALL");
    assert.equal(sends, 1);
  } finally {
    await x.close();
  }
});

test("the durable service fences an actually ended Run even if the local liveness hint is stale", async () => {
  const x = await fixture();
  try {
    const submit = createFinalOutputTrial(x.options);
    x.work.finish(0);
    const result = await submit(terminal());
    assert.equal(result.isError, true);
    assert.equal(
      x.f.db
        .prepare("SELECT count(*) AS n FROM messages WHERE body=?")
        .get("FAKE explicit final reply").n,
      0,
    );
  } finally {
    await x.close();
  }
});

test("reconstructing the laboratory submitter keeps the original durable idempotency identity", async () => {
  const x = await fixture();
  try {
    const first = bodyOf(await createFinalOutputTrial(x.options)(terminal()));
    const replay = bodyOf(await createFinalOutputTrial(x.options)(terminal()));
    assert.equal(replay.messageId, first.messageId);
    assert.equal(replay.deduplicated, true);
    assert.equal(
      x.f.db
        .prepare("SELECT count(*) AS n FROM messages WHERE body=?")
        .get("FAKE explicit final reply").n,
      1,
    );
  } finally {
    await x.close();
  }
});

test("the original terminal binding must contain nonempty session and turn IDs before any submission", async () => {
  const f = await fixture();
  try {
    let sends = 0;
    for (const field of ["sessionId", "turnId"]) {
      for (const value of [undefined, null, "", " ", 1]) {
        assert.throws(
          () =>
            createFinalOutputTrial({
              ...f.options,
              [field]: value,
              fetcher: async () => {
                sends++;
                throw new Error("unexpected request");
              },
            }),
          /identity/,
        );
      }
    }
    assert.equal(sends, 0);
  } finally {
    await f.close();
  }
});

test("laboratory final without prior consumer acknowledgement cannot publish", async () => {
  const x = await fixture({ acknowledge: false });
  try {
    const result = await createFinalOutputTrial(x.options)(terminal());
    assert.equal(result.isError, true);
    assert.match(JSON.stringify(bodyOf(result)), /final_delivery_unconfirmed/);
    assert.equal(
      x.f.db
        .prepare("SELECT count(*) AS n FROM messages WHERE body=?")
        .get("FAKE explicit final reply").n,
      0,
    );
  } finally {
    await x.close();
  }
});
