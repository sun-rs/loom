import assert from "node:assert/strict";
import test from "node:test";
import {
  roleInstanceFixture,
  startInstanceRun,
  startInstanceRunFromQueue,
} from "./role-instance-fixture.ts";

function setup(options: { ambiguous?: boolean; busy?: boolean } = {}) {
  const f = roleInstanceFixture();
  const peer = f.kernel.roles.instantiate(f.actor, {
    roleId: f.role.roleId,
    channelId: f.home.roomId,
    basedOnRoomSeq: f.head(f.home.roomId),
    idempotencyKey: "peer",
  }).instance;
  const handle = (id: string) =>
    String(
      f.db
        .prepare("SELECT handle FROM principals WHERE principal_id=?")
        .get(id)!.handle,
    );
  const present = (run: ReturnType<typeof startInstanceRun>) => {
    f.kernel.presentWorkerMessages(run.execution);
    f.kernel.markPresentedDeliverySent(f.host, {
      activationId: run.activation.activationId,
      consumerId: "worker",
      runAttemptId: run.run.runAttemptId,
    });
  };
  const a = startInstanceRun(f);
  present(a);
  if (options.ambiguous)
    f.kernel.postWorkerMessage(a.execution, {
      body: `@${handle(peer.instanceId)} Another request.`,
      basedOnRoomSeq: a.scope.toSeq,
      idempotencyKey: "earlier-request",
    });
  const request = f.kernel.submitWorkerFinalOutput(a.execution, {
    body: `@${handle(peer.instanceId)} Please review the design.`,
    basedOnRoomSeq: a.scope.toSeq,
  });
  assert.ok("event" in request);
  if (!options.busy) a.finish(0);
  const b = startInstanceRunFromQueue({ ...f, instance: peer });
  present(b);
  return { f, peer, a, b, request, present, handle };
}

for (const boundary of [
  "progress",
  "removed",
  "generation",
  "unpresented",
  "explicit",
  "ambiguous",
] as const) {
  test(`automatic reply return preserves ${boundary} boundary`, () => {
    const { f, b, handle } = setup({ ambiguous: boundary === "ambiguous" });
    try {
      if (boundary === "removed") f.detachFromChannel();
      if (boundary === "generation")
        f.db
          .prepare(
            `INSERT INTO role_instance_sessions
        (instance_id,generation,bound,updated_at) VALUES (?,1,0,?)
        ON CONFLICT(instance_id) DO UPDATE SET generation=1`,
          )
          .run(f.instance.instanceId, new Date().toISOString());
      if (boundary === "unpresented")
        f.db
          .prepare(
            "UPDATE activation_presented_windows SET sent_at=NULL WHERE run_attempt_id=?",
          )
          .run(b.run.runAttemptId);
      const result = f.kernel.postWorkerMessage(b.execution, {
        body:
          boundary === "explicit"
            ? `@${handle(f.owner.principal.principalId)} Reply to Human.`
            : "Reply without a mention.",
        basedOnRoomSeq: b.scope.toSeq,
        ...(boundary !== "progress" ? { final: true as const } : {}),
        idempotencyKey: "answer",
      });
      assert.ok("event" in result);
      assert.equal(result.event.payload.replyReturn, undefined);
      assert.deepEqual(result.activationIds, []);
    } finally {
      f.close();
    }
  });
}

for (const transport of ["native-final", "worker", "worker-target"] as const) {
  test(`${transport}: a plain final returns once to its directed requester, without a reply loop`, () => {
    const { f, b, request, present } = setup();
    try {
      if (transport === "worker-target")
        f.kernel.workerTargetContext.read(b.execution, { channel: "#home" });
      const send = () =>
        transport === "native-final"
          ? f.kernel.submitWorkerFinalOutput(b.execution, {
              body: "Design approved. Continue implementation.",
              basedOnRoomSeq: b.scope.toSeq,
            })
          : f.kernel.postWorkerMessage(b.execution, {
              ...(transport === "worker-target" ? { channel: "#home" } : {}),
              body: "Design approved. Continue implementation.",
              basedOnRoomSeq: b.scope.toSeq,
              final: true,
              idempotencyKey: "reply",
            });
      const reply = send();
      assert.ok("event" in reply);
      assert.equal(reply.activationIds.length, 1);
      assert.deepEqual(reply.event.payload.mentions, []);
      assert.deepEqual(reply.event.payload.replyReturn, {
        sourceEventId: request.event.eventId,
        participantId: f.instance.instanceId,
      });
      const duplicate = send();
      assert.ok("event" in duplicate && duplicate.deduplicated);
      assert.deepEqual(duplicate.activationIds, []);
      b.finish(0);
      const resumed = startInstanceRunFromQueue(f);
      present(resumed);
      const final = f.kernel.submitWorkerFinalOutput(resumed.execution, {
        body: "Implementation completed.",
        basedOnRoomSeq: resumed.scope.toSeq,
      });
      assert.ok("event" in final);
      assert.deepEqual(final.activationIds, []);
      assert.equal(final.event.payload.replyReturn, undefined);
      resumed.finish(0);
    } finally {
      f.close();
    }
  });
}

test("a return queues durably while its requester is still busy in the same lane", () => {
  const { f, a, b } = setup({ busy: true });
  try {
    const reply = f.kernel.submitWorkerFinalOutput(b.execution, {
      body: "Reviewed; continue.",
      basedOnRoomSeq: b.scope.toSeq,
    });
    assert.ok("event" in reply);
    assert.equal(reply.activationIds.length, 1);
    assert.equal(
      f.kernel.leaseNextActivation(f.host, { leaseMs: 30000 }),
      null,
    );
    assert.equal(
      f.db
        .prepare("SELECT reason FROM inbox_items WHERE event_id=?")
        .get(reply.event.eventId)!.reason,
      "reply",
    );
    assert.equal(
      f.db
        .prepare(
          "SELECT count(*) n FROM instance_wake_chain WHERE event_id=? AND admitted=1",
        )
        .get(reply.event.eventId)!.n,
      1,
    );
    a.finish(0);
    b.finish(0);
    const next = startInstanceRunFromQueue(f);
    assert.equal(next.activation.toSeq, reply.event.roomSeq);
  } finally {
    f.close();
  }
});

test("an explicit earlier reply consumes the return; a later plain final adds no duplicate wake", () => {
  const { f, b, handle } = setup();
  try {
    const explicit = f.kernel.postWorkerMessage(b.execution, {
      body: `@${handle(f.instance.instanceId)} Review result.`,
      basedOnRoomSeq: b.scope.toSeq,
      idempotencyKey: "explicit",
    });
    assert.ok("event" in explicit);
    assert.equal(explicit.activationIds.length, 1);
    const final = f.kernel.submitWorkerFinalOutput(b.execution, {
      body: "Review finished.",
      basedOnRoomSeq: b.scope.toSeq,
    });
    assert.ok("event" in final);
    assert.equal(final.event.payload.replyReturn, undefined);
    assert.deepEqual(final.activationIds, []);
  } finally {
    f.close();
  }
});

test("automatic returns share the existing channel chain limit", () => {
  const { f, b } = setup();
  try {
    f.db
      .prepare("UPDATE instance_wake_guards SET streak=100 WHERE room_id=?")
      .run(f.home.roomId);
    const final = f.kernel.submitWorkerFinalOutput(b.execution, {
      body: "Review finished.",
      basedOnRoomSeq: b.scope.toSeq,
    });
    assert.ok("event" in final);
    assert.ok(final.event.payload.replyReturn);
    assert.deepEqual(final.activationIds, []);
    assert.equal(
      f.db
        .prepare("SELECT admitted FROM instance_wake_chain WHERE event_id=?")
        .get(final.event.eventId)!.admitted,
      0,
    );
  } finally {
    f.close();
  }
});
