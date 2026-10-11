import assert from "node:assert/strict";
import test from "node:test";
import {
  roleInstanceFixture,
  startInstanceRun,
  startInstanceRunFromQueue,
} from "./role-instance-fixture.ts";

function parallelPeers() {
  const f = roleInstanceFixture();
  const peer = f.kernel.roles.instantiate(f.actor, {
    roleId: f.role.roleId,
    channelId: f.home.roomId,
    basedOnRoomSeq: f.head(f.home.roomId),
    idempotencyKey: "peer-instance",
  });
  const b = startInstanceRun({ ...f, instance: peer.instance });
  const a = startInstanceRun(f);
  f.kernel.presentWorkerMessages(a.execution);
  f.kernel.markPresentedDeliverySent(f.host, {
    activationId: a.activation.activationId,
    consumerId: "worker",
    runAttemptId: a.run.runAttemptId,
  });
  f.kernel.workerTargetContext.read(a.execution, { channel: "#home" });
  let sends = 0;
  const peerPost = (body: string) => {
    f.kernel.workerTargetContext.read(b.execution, { channel: "#home" });
    const result = f.kernel.postWorkerMessage(b.execution, {
      channel: "#home",
      body,
      idempotencyKey: `peer-${++sends}`,
    });
    assert.ok(
      "event" in result,
      "peer setup must publish through authenticated Worker",
    );
    return result;
  };
  return {
    f,
    a,
    b,
    peerPost,
    handle: String(
      f.db
        .prepare("SELECT handle FROM principals WHERE principal_id=?")
        .get(f.instance.instanceId)!.handle,
    ),
  };
}

for (const transport of ["worker", "worker-target", "native-final"] as const) {
  const send = (p: ReturnType<typeof parallelPeers>) =>
    transport !== "native-final"
      ? p.f.kernel.postWorkerMessage(p.a.execution, {
          ...(transport === "worker-target" ? { channel: "#home" } : {}),
          body: "Independent completed reply",
          basedOnRoomSeq: p.a.scope.toSeq,
          final: true,
          idempotencyKey: "answer",
        })
      : p.f.kernel.submitWorkerFinalOutput(p.a.execution, {
          body: "Independent completed reply",
          basedOnRoomSeq: p.a.scope.toSeq,
        });
  test(`${transport}: undirected peer append preserves causal floor, unread delta, and idempotency`, () => {
    const p = parallelPeers(),
      { f, a, b } = p;
    try {
      const peer = p.peerPost("Independent peer result; no request to A");
      const answer = send(p);
      assert.ok(
        "event" in answer,
        "ordinary undirected peer chat must not hold an already generating reply",
      );
      assert.equal(answer.event.payload.basedOnRoomSeq, a.scope.toSeq);
      assert.ok(answer.event.roomSeq > peer.event.roomSeq);
      const replay = send(p);
      assert.ok("event" in replay && replay.deduplicated);
      const cursor = f.db
        .prepare(
          "SELECT last_seq FROM subscription_cursors WHERE room_id=? AND participant_id=? AND consumer_id='worker'",
        )
        .get(f.home.roomId, f.instance.instanceId);
      assert.equal(
        Number(cursor!.last_seq),
        a.scope.toSeq,
        "publication cannot ACK unseen peer",
      );
      assert.equal(
        f.db
          .prepare(
            "SELECT count(*) n FROM worker_message_presentations WHERE participant_id=? AND room_seq=?",
          )
          .get(f.instance.instanceId, peer.event.roomSeq)!.n,
        0,
      );
      a.finish(0);
      b.finish(0);
      f.kernel.postMessage(f.actor, {
        roomId: f.home.roomId,
        body: "Now review the peer result",
        recipients: [
          { participantId: f.instance.instanceId, reason: "mention" },
        ],
        idempotencyKey: "next",
      });
      const next = startInstanceRunFromQueue(f);
      const delivery = f.kernel.presentWorkerMessages(next.execution);
      assert.match(
        JSON.stringify(delivery.events),
        /Independent peer result; no request to A/,
      );
    } finally {
      f.close();
    }
  });
  for (const blocker of ["human", "mention", "all"] as const) {
    test(`${transport}: later undirected peer cannot hide earlier ${blocker} fact`, () => {
      const p = parallelPeers(),
        { f } = p;
      try {
        if (blocker === "human")
          f.kernel.postMessage(f.actor, {
            roomId: f.home.roomId,
            body: "Human correction",
            recipients: [],
            idempotencyKey: "correction",
          });
        else
          p.peerPost(
            blocker === "all"
              ? "@all new requested action"
              : `@${p.handle} new requested action`,
          );
        p.peerPost("Later ordinary peer observation");
        const answer = send(p);
        assert.ok("state" in answer && answer.state === "held");
      } finally {
        f.close();
      }
    });
  }
}

test("peer attachment is not an ordinary-chat freshness exception", async () => {
  const p = parallelPeers(),
    { f, a, b } = p;
  try {
    const file = f.kernel.files.prepareWorkerMessage(b.execution, {
      filename: "evidence.txt",
      mimeType: "text/plain",
      size: 5,
      idempotencyKey: "attachment",
    });
    await f.kernel.files.uploadWorkerMessage(
      b.execution,
      file.attachmentId,
      (async function* () {
        yield Buffer.from("hello");
      })(),
    );
    f.kernel.workerTargetContext.read(b.execution, { channel: "#home" });
    const posted = f.kernel.postWorkerMessage(b.execution, {
      channel: "#home",
      body: "Attached evidence",
      attachmentIds: [file.attachmentId],
      idempotencyKey: "peer-attachment",
    });
    assert.ok("event" in posted);
    const answer = f.kernel.submitWorkerFinalOutput(a.execution, {
      body: "Old reply",
      basedOnRoomSeq: a.scope.toSeq,
    });
    assert.ok("state" in answer && answer.state === "held");
  } finally {
    f.close();
  }
});

test("Worker attachment publication does not gain ordinary reply exemption", async () => {
  const p = parallelPeers(),
    { f, a } = p;
  try {
    const file = f.kernel.files.prepareWorkerMessage(a.execution, {
      filename: "answer.txt",
      mimeType: "text/plain",
      size: 5,
      idempotencyKey: "answer-file",
    });
    await f.kernel.files.uploadWorkerMessage(
      a.execution,
      file.attachmentId,
      (async function* () {
        yield Buffer.from("hello");
      })(),
    );
    p.peerPost("Ordinary peer text");
    const answer = f.kernel.postWorkerMessage(a.execution, {
      body: "Old attachment",
      attachmentIds: [file.attachmentId],
      basedOnRoomSeq: a.scope.toSeq,
      idempotencyKey: "attachment-answer",
    });
    assert.ok("state" in answer && answer.state === "held");
  } finally {
    f.close();
  }
});

test("Task claim still rejects unread directed peer facts", () => {
  const p = parallelPeers(),
    { f, a } = p;
  try {
    const created = f.kernel.createTask(f.actor, {
      roomId: f.home.roomId,
      title: "Existing business work",
      assigneeId: f.instance.instanceId,
      collaboratorIds: [],
      reviewerIds: [],
      dependencyTaskIds: [],
      idempotencyKey: "task",
    });
    f.kernel.getWorkerTask(a.execution, { taskId: created.task.taskId });
    const floor = f.head(f.home.roomId);
    const peer = p.peerPost(`@${p.handle} new Task requirement`);
    assert.throws(
      () =>
        f.kernel.claimTask(a.execution, {
          taskId: created.task.taskId,
          basedOnRoomSeq: floor,
          idempotencyKey: "stale-claim",
          leaseMs: 60000,
        }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(
          (error as Error & { basedOnRoomSeq: number }).basedOnRoomSeq,
          floor,
        );
        assert.equal(
          (error as Error & { latestRoomSeq: number }).latestRoomSeq,
          peer.event.roomSeq,
        );
        return true;
      },
    );
  } finally {
    f.close();
  }
});

for (const transport of ["worker", "native-final"] as const) {
  test(`${transport}: Human message on a different target does not block home reply`, () => {
    const p = parallelPeers(),
      { f, a } = p;
    try {
      const other = f.channel("elsewhere");
      f.kernel.postMessage(f.actor, {
        roomId: other.roomId,
        body: "Unrelated Human fact",
        recipients: [],
        idempotencyKey: "elsewhere-fact",
      });
      const reply =
        transport === "worker"
          ? f.kernel.postWorkerMessage(a.execution, {
              body: "Home response",
              basedOnRoomSeq: a.scope.toSeq,
              final: true,
              idempotencyKey: "home-reply",
            })
          : f.kernel.submitWorkerFinalOutput(a.execution, {
              body: "Home response",
              basedOnRoomSeq: a.scope.toSeq,
            });
      assert.ok("event" in reply);
    } finally {
      f.close();
    }
  });
  test(`${transport}: legacy non-Role agent cannot gain peer exception`, () => {
    const p = parallelPeers(),
      { f, a } = p;
    try {
      const legacy = f.kernel.provisionPrincipal({
        handle: "legacy-writer",
        kind: "agent",
      });
      f.kernel.addMember(f.actor, {
        roomId: f.home.roomId,
        principalId: legacy.principal.principalId,
      });
      const actor = f.kernel.authenticateAccessToken(legacy.accessToken);
      f.kernel.postMessage(actor, {
        roomId: f.home.roomId,
        body: "Legacy author fact",
        basedOnRoomSeq: f.head(f.home.roomId),
        recipients: [],
        idempotencyKey: "legacy-message",
      });
      const reply =
        transport === "worker"
          ? f.kernel.postWorkerMessage(a.execution, {
              body: "Old reply",
              basedOnRoomSeq: a.scope.toSeq,
              final: true,
              idempotencyKey: "answer-legacy",
            })
          : f.kernel.submitWorkerFinalOutput(a.execution, {
              body: "Old reply",
              basedOnRoomSeq: a.scope.toSeq,
            });
      assert.ok("state" in reply && reply.state === "held");
    } finally {
      f.close();
    }
  });
}
