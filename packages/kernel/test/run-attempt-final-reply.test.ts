import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  ForbiddenError,
  KERNEL_SCHEMA_VERSION,
  RoomKernel,
} from "../src/index.ts";

/**
 * Final-reply marker (schema 67): a Worker post flagged `final` from the live
 * RunAttempt records that the reply to the delivered messages is committed,
 * and hints the Host in-process. The Host alone decides to end the native
 * turn. The marker is never an ACK, never a Task transition and never a Room
 * event of its own.
 */
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "rah-final-reply-"));
  const databasePath = join(directory, "room.db");
  const kernel = new RoomKernel({ databasePath });
  kernel.initialize();
  const database = new DatabaseSync(databasePath);
  const human = kernel.provisionPrincipal({ handle: "human", kind: "human" });
  const agent = kernel.provisionPrincipal({ handle: "worker", kind: "agent" });
  const agentId = agent.principal.principalId;
  const actor = kernel.authenticateAccessToken(human.accessToken);
  const room = kernel.createRoom(actor, { name: "Main", slug: "main" });
  kernel.addMember(actor, { roomId: room.roomId, principalId: agentId });
  const host = kernel.authenticateHostAccessToken(
    kernel.provisionHostCredential({
      hostId: "host",
      participantIds: [agentId],
    }).accessToken,
  );
  const otherHost = kernel.authenticateHostAccessToken(
    kernel.provisionHostCredential({
      hostId: "other-host",
      participantIds: [agentId],
    }).accessToken,
  );
  kernel.heartbeatHost(host);
  kernel.heartbeatHost(otherHost);
  let sequence = 0;
  return {
    database,
    host,
    kernel,
    otherHost,
    room,
    post(body: string) {
      return kernel.postMessage(actor, {
        body,
        roomId: room.roomId,
        recipients: [{ participantId: agentId, reason: "mention" }],
        idempotencyKey: `seed-${++sequence}`,
      });
    },
    activate() {
      const activation = kernel.leaseNextActivation(host, { leaseMs: 600_000 });
      assert.ok(activation, "an Activation must be queued");
      const run = kernel.createRunAttempt(host, {
        activationId: activation.activationId,
      });
      const runtime = {
        runAttemptId: run.runAttemptId,
        runtimeRunId: "runtime",
        recoveryDescriptor: {
          driver: "fake",
          recoveryKey: "fake",
          metadata: {},
        },
      };
      kernel.prepareRunAttemptRuntime(host, runtime);
      kernel.markRunAttemptRunning(host, runtime);
      const scope = {
        activationId: activation.activationId,
        consumerId: "worker",
        hostId: "host",
        participantId: agentId,
        roomId: room.roomId,
        runAttemptId: run.runAttemptId,
        toSeq: activation.toSeq,
      };
      return {
        activation,
        run,
        execution: kernel.authorizeWorkerExecution(host, scope),
      };
    },
    close() {
      database.close();
      kernel.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

test("schema 67 carries the final-reply marker table", () => {
  assert.equal(KERNEL_SCHEMA_VERSION, 68);
  const context = fixture();
  try {
    const columns = context.database
      .prepare("PRAGMA table_info(run_attempt_final_replies)")
      .all()
      .map((row) => row.name);
    assert.ok(columns.includes("run_attempt_id"));
    assert.ok(columns.includes("interrupt_sent"));
    assert.ok(columns.includes("preempted_follow_up"));
    assert.ok(columns.includes("interrupt_requested"));
    assert.ok(columns.includes("interrupt_accepted"));
    assert.ok(columns.includes("interrupt_terminal"));
  } finally {
    context.close();
  }
});

test("P2-1: an older Host's report keeps accepted and terminal unknown; requested follows sent", () => {
  const context = fixture();
  try {
    context.post("please answer");
    const run = context.activate();
    const runAttemptId = run.run.runAttemptId;
    context.kernel.postWorkerMessage(run.execution, {
      body: "the answer",
      final: true,
    });
    context.kernel.finalReplies.recordInterrupt(context.host, {
      runAttemptId,
      sent: true,
      preemptedFollowUp: true,
    });
    assert.deepEqual(
      context.kernel.finalReplies.read(context.host, { runAttemptId })
        ?.interrupt,
      {
        requested: true,
        accepted: "unknown",
        terminal: "unknown",
        sent: true,
        preemptedFollowUp: true,
      },
    );
  } finally {
    context.close();
  }
});

test("a final post records the marker once and hints the Host after commit", () => {
  const context = fixture();
  try {
    context.post("please answer");
    const run = context.activate();
    const hints: string[] = [];
    const unsubscribe = context.kernel.finalReplies.subscribe(
      (runAttemptId) => {
        // The hint fires after commit: the durable marker is already readable.
        assert.ok(
          context.kernel.finalReplies.read(context.host, { runAttemptId }),
          "marker visible when the hint fires",
        );
        hints.push(runAttemptId);
      },
    );
    assert.equal(
      context.kernel.finalReplies.read(context.host, {
        runAttemptId: run.run.runAttemptId,
      }),
      null,
    );
    const result = context.kernel.postWorkerMessage(run.execution, {
      body: "the answer",
      final: true,
    });
    assert.ok("event" in result);
    const marker = context.kernel.finalReplies.read(context.host, {
      runAttemptId: run.run.runAttemptId,
    });
    assert.equal(marker?.eventId, result.event.eventId);
    assert.equal(marker?.roomSeq, result.event.roomSeq);
    assert.equal(marker?.activationId, run.activation.activationId);
    assert.deepEqual(hints, [run.run.runAttemptId]);
    // The same final post replayed is deduplicated and keeps the first marker.
    context.kernel.postWorkerMessage(run.execution, {
      body: "the answer",
      final: true,
    });
    assert.equal(
      context.kernel.finalReplies.read(context.host, {
        runAttemptId: run.run.runAttemptId,
      })?.eventId,
      result.event.eventId,
    );
    unsubscribe();
  } finally {
    context.close();
  }
});

test("a post without final records nothing and hints nobody", () => {
  const context = fixture();
  try {
    context.post("please answer");
    const run = context.activate();
    const hints: string[] = [];
    context.kernel.finalReplies.subscribe((id) => hints.push(id));
    const result = context.kernel.postWorkerMessage(run.execution, {
      body: "progress: still working",
    });
    assert.ok("event" in result);
    assert.equal(
      context.kernel.finalReplies.read(context.host, {
        runAttemptId: run.run.runAttemptId,
      }),
      null,
    );
    assert.deepEqual(hints, []);
  } finally {
    context.close();
  }
});

test("a final post on the --target route records the marker but never ACKs by itself", () => {
  const context = fixture();
  try {
    context.post("please answer");
    const run = context.activate();
    // Unread target: the send is held as a draft, which is no reply.
    const held = context.kernel.postWorkerMessage(run.execution, {
      body: "the answer",
      channel: "#main",
      final: true,
    });
    assert.ok(!("event" in held));
    assert.equal(
      context.kernel.finalReplies.read(context.host, {
        runAttemptId: run.run.runAttemptId,
      }),
      null,
      "a held final post records no marker",
    );
    // The Host put the range in front of the run; the send now commits.
    context.kernel.presentWorkerMessages(run.execution);
    context.kernel.markPresentedDeliverySent(context.host, {
      activationId: run.activation.activationId,
      consumerId: "worker",
      runAttemptId: run.run.runAttemptId,
    });
    const result = context.kernel.postWorkerMessage(run.execution, {
      body: "the answer",
      channel: "#main",
      final: true,
    });
    assert.ok("event" in result, JSON.stringify(result));
    assert.ok(
      context.kernel.finalReplies.read(context.host, {
        runAttemptId: run.run.runAttemptId,
      }),
    );
    // No model-presented cursor on this route: nothing is acknowledged, so
    // the Activation cannot complete on `final` alone.
    assert.throws(
      () =>
        context.kernel.completeActivation(context.host, {
          activationId: run.activation.activationId,
          consumerId: "worker",
        }),
      /not acknowledged through sequence/u,
    );
  } finally {
    context.close();
  }
});

test("only the owning Host reads the marker; the interrupt report is recorded once and read by the usage API", () => {
  const context = fixture();
  try {
    context.post("please answer");
    const run = context.activate();
    const runAttemptId = run.run.runAttemptId;
    context.kernel.postWorkerMessage(run.execution, {
      body: "the answer",
      final: true,
    });
    assert.throws(
      () =>
        context.kernel.finalReplies.read(context.otherHost, { runAttemptId }),
      ForbiddenError,
    );
    assert.throws(
      () =>
        context.kernel.finalReplies.recordInterrupt(context.otherHost, {
          runAttemptId,
          sent: true,
          preemptedFollowUp: true,
        }),
      ForbiddenError,
    );
    context.kernel.finalReplies.recordInterrupt(context.host, {
      runAttemptId,
      requested: true,
      accepted: true,
      terminal: false,
      sent: true,
      preemptedFollowUp: false,
    });
    // First report wins; a replay cannot rewrite it.
    context.kernel.finalReplies.recordInterrupt(context.host, {
      runAttemptId,
      sent: false,
      preemptedFollowUp: "unknown",
    });
    const marker = context.kernel.finalReplies.read(context.host, {
      runAttemptId,
    });
    assert.deepEqual(marker?.interrupt, {
      requested: true,
      accepted: true,
      terminal: false,
      sent: true,
      preemptedFollowUp: false,
    });
  } finally {
    context.close();
  }
});

test("an interrupt report without a committed final reply is refused", () => {
  const context = fixture();
  try {
    context.post("please answer");
    const run = context.activate();
    assert.throws(
      () =>
        context.kernel.finalReplies.recordInterrupt(context.host, {
          runAttemptId: run.run.runAttemptId,
          sent: true,
          preemptedFollowUp: true,
        }),
      /no committed final reply/u,
    );
  } finally {
    context.close();
  }
});

test("P2-1: a schema 67 database without the interrupt fact columns gains them on upgrade", () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-final-reply-upgrade-"));
  const databasePath = join(directory, "room.db");
  try {
    const first = new RoomKernel({ databasePath });
    first.initialize();
    first.close();
    const legacy = new DatabaseSync(databasePath);
    for (const column of [
      "interrupt_requested",
      "interrupt_accepted",
      "interrupt_terminal",
    ])
      legacy.exec(
        `ALTER TABLE run_attempt_final_replies DROP COLUMN ${column}`,
      );
    // A schema 67 database (the facts arrive with schema 68).
    legacy.exec("PRAGMA user_version = 67");
    legacy.close();
    const kernel = new RoomKernel({ databasePath });
    kernel.initialize();
    kernel.close();
    const upgraded = new DatabaseSync(databasePath);
    const columns = upgraded
      .prepare("PRAGMA table_info(run_attempt_final_replies)")
      .all()
      .map((row) => row.name);
    upgraded.close();
    for (const column of [
      "interrupt_requested",
      "interrupt_accepted",
      "interrupt_terminal",
    ])
      assert.ok(columns.includes(column), column);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
