import assert from "node:assert/strict";
import test from "node:test";
import { WorkerApplicationService } from "../../packages/application-service/src/index.ts";
import {
  roleInstanceFixture,
  startInstanceRun,
} from "../../packages/kernel/test/role-instance-fixture.ts";
import { createNativeTextTrial } from "./native-text.mjs";

// Provider adapters must prove these facts from native events; these tests
// exercise only the authenticated publication boundary, with no model calls.
const final = (extra = {}) => ({
  sessionId: "session",
  turnId: "turn",
  launchId: "launch",
  status: "completed",
  finalTexts: ["FAKE native reply"],
  ...extra,
});
const result = (value) => value;
async function fixture({ delivered = true } = {}) {
  const f = roleInstanceFixture();
  const service = new WorkerApplicationService({ kernel: f.kernel });
  await service.start();
  const work = startInstanceRun(f);
  f.kernel.presentWorkerMessages(work.execution);
  const credential = service.issueActivationCredential(f.host, work.scope);
  if (delivered) {
    const presentation = await fetch(
      service.origin + "/v1/worker/message-present",
      {
        method: "POST",
        headers: {
          authorization: "Bearer " + credential.accessToken,
          "content-type": "application/json",
        },
        body: "{}",
      },
    );
    assert.equal(presentation.status, 200);
    await presentation.json();
  }
  if (delivered)
    f.kernel.markPresentedDeliverySent(f.host, {
      activationId: work.activation.activationId,
      consumerId: "worker",
      runAttemptId: work.run.runAttemptId,
    });
  let active = true;
  const options = {
    mode: "native-final-text/v1",
    sessionId: "session",
    turnId: "turn",
    launchId: "launch",
    deliveredSeq: work.activation.toSeq,
    workerApiOrigin: service.origin,
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
    revoke: () => {
      active = false;
    },
    messages: () =>
      f.db
        .prepare(
          "SELECT count(*) AS n FROM messages WHERE body='FAKE native reply'",
        )
        .get().n,
    markers: () =>
      f.db
        .prepare(
          "SELECT count(*) AS n FROM run_attempt_final_replies WHERE run_attempt_id=?",
        )
        .get(work.run.runAttemptId).n,
    async close() {
      active = false;
      await service.close();
      f.close();
    },
  };
}

test("native text requires explicit mode and frozen nonempty original identities", async () => {
  const x = await fixture();
  try {
    for (const field of [
      "mode",
      "sessionId",
      "turnId",
      "launchId",
      "deliveredSeq",
    ])
      assert.throws(() =>
        createNativeTextTrial({ ...x.options, [field]: undefined }),
      );
    for (const deliveredSeq of [-1, 0.5, NaN, Infinity])
      assert.throws(() =>
        createNativeTextTrial({ ...x.options, deliveredSeq }),
      );
    assert.equal(x.messages(), 0);
  } finally {
    await x.close();
  }
});

test("one native final uses Worker identity and real delivery ACK without receipt injection or model followup", async () => {
  const x = await fixture();
  try {
    const submit = createNativeTextTrial(x.options);
    x.options.deliveredSeq += 100;
    x.options.sessionId = "mutated-after-binding";
    x.options.binding.accessToken = "mutated-after-binding";
    const [a, b] = await Promise.all([submit(final()), submit(final())]);
    assert.deepEqual(a, b);
    assert.equal(result(a).state, "published", JSON.stringify(result(a)));
    assert.equal(x.messages(), 1);
    assert.equal(x.markers(), 1);
    assert.equal(
      result(await submit(final({ finalTexts: ["changed"] }))).state,
      "rejected",
    );
    const event = x.f.db
      .prepare(
        "SELECT e.actor_id FROM room_events e JOIN run_attempt_final_replies f ON e.event_id=f.event_id WHERE f.run_attempt_id=?",
      )
      .get(x.work.run.runAttemptId);
    assert.equal(event.actor_id, x.f.instance.instanceId);
    // Publication is not the Run termination or Activation completion owner.
    assert.equal(
      x.f.db
        .prepare("SELECT state FROM activations WHERE activation_id=?")
        .get(x.work.activation.activationId).state,
      "leased",
    );
    x.work.finish(0);
    x.f.kernel.completeActivation(x.f.host, {
      activationId: x.work.activation.activationId,
      consumerId: "worker",
    });
  } finally {
    await x.close();
  }
});

test("foreign/currently incomplete evidence cannot send, and mutating caller options cannot rebind a turn", async () => {
  const x = await fixture();
  try {
    let sends = 0;
    const options = {
      ...x.options,
      fetcher: async () => {
        sends++;
        throw Error("unexpected request");
      },
    };
    const submit = createNativeTextTrial(options);
    options.sessionId = "foreign";
    options.deliveredSeq++;
    for (const change of [
      { sessionId: "foreign" },
      { turnId: "old" },
      { launchId: "other" },
      { status: "running" },
      { status: "cancelled" },
      { finalTexts: [] },
      { finalTexts: ["a", "b"] },
      { finalTexts: [" "] },
      { finalTexts: ["x".repeat(65537)] },
    ])
      await assert.rejects(submit(final(change)));
    assert.equal(sends, 0);
  } finally {
    await x.close();
  }
});

test("new Human facts hold the reply without ACK or final marker", async () => {
  const x = await fixture();
  try {
    const before = x.f.db.prepare("SELECT * FROM subscription_cursors").all();
    x.f.kernel.postMessage(x.f.actor, {
      roomId: x.f.home.roomId,
      body: "changed requirements",
      idempotencyKey: "new-fact",
      recipients: [],
    });
    const reply = result(await createNativeTextTrial(x.options)(final()));
    assert.equal(reply.state, "held", JSON.stringify(reply));
    assert.match(reply.detail, /draft/);
    assert.equal(x.messages(), 0);
    assert.equal(x.markers(), 0);
    assert.deepEqual(
      x.f.db.prepare("SELECT * FROM subscription_cursors").all(),
      before,
    );
  } finally {
    await x.close();
  }
});

test("commit followed by response loss remains unknown and cannot send again", async () => {
  const x = await fixture();
  try {
    let sends = 0;
    const submit = createNativeTextTrial({
      ...x.options,
      fetcher: async (...args) => {
        sends++;
        const response = await fetch(...args);
        await response.text();
        throw Error("lost response");
      },
    });
    assert.equal(result(await submit(final())).state, "unknown");
    assert.equal(result(await submit(final())).state, "unknown");
    assert.equal(sends, 1);
    assert.equal(x.messages(), 1);
    assert.equal(x.markers(), 1);
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

test("reconstruction with confirmed durable success uses the same idempotency slot", async () => {
  const x = await fixture();
  try {
    const first = result(await createNativeTextTrial(x.options)(final()));
    const replay = result(await createNativeTextTrial(x.options)(final()));
    assert.equal(first.state, "published");
    assert.equal(replay.state, "published");
    assert.equal(first.detail, replay.detail);
    assert.equal(x.messages(), 1);
    assert.equal(x.markers(), 1);
  } finally {
    await x.close();
  }
});

test("native final must occupy the existing transaction-level final-output slot", async () => {
  const x = await fixture();
  try {
    await createNativeTextTrial(x.options)(final());
    const marker = x.f.db
      .prepare(
        "SELECT submission_kind FROM run_attempt_final_replies WHERE run_attempt_id=?",
      )
      .get(x.work.run.runAttemptId);
    assert.equal(marker.submission_kind, "final-output");
  } finally {
    await x.close();
  }
});

test("tool and native finals cannot both commit, in either order", async () => {
  for (const toolFirst of [true, false]) {
    const x = await fixture();
    try {
      const submit = createNativeTextTrial(x.options);
      const tool = async () => {
        const response = await fetch(
          x.options.workerApiOrigin + "/v1/worker/messages/post",
          {
            method: "POST",
            headers: {
              authorization: "Bearer " + x.options.binding.accessToken,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              body: "FAKE native reply",
              final: true,
              basedOnRoomSeq:
                x.f.db
                  .prepare(
                    "SELECT max(room_seq) AS seq FROM room_events WHERE room_id=? AND actor_id=? AND type='message.posted'",
                  )
                  .get(x.f.home.roomId, x.f.instance.instanceId).seq ??
                x.options.deliveredSeq,
              idempotencyKey: "different-tool-call",
            }),
          },
        );
        await response.text();
        return response.status;
      };
      if (toolFirst) {
        assert.equal(await tool(), 200);
        assert.equal((await submit(final())).state, "rejected");
      } else {
        assert.equal((await submit(final())).state, "published");
        assert.equal(await tool(), 409);
      }
      assert.equal(x.messages(), 1);
      assert.equal(x.markers(), 1);
    } finally {
      await x.close();
    }
  }
});

test("missing delivery, local revocation and ended durable Run never publish", async () => {
  for (const kind of ["undelivered", "revoked", "ended", "removed-member"]) {
    const x = await fixture({ delivered: kind !== "undelivered" });
    try {
      const submit = createNativeTextTrial(x.options);
      if (kind === "revoked") x.revoke();
      if (kind === "ended") x.work.finish(0);
      if (kind === "removed-member") x.f.detachFromChannel();
      assert.equal((await submit(final())).state, "rejected", kind);
      assert.equal(x.messages(), 0, kind);
      assert.equal(x.markers(), 0, kind);
    } finally {
      await x.close();
    }
  }
});
