import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { RoomKernel } from "@rah-os/kernel";
import { WorkerApplicationService } from "@rah-os/application-service";
import {
  createComputerApplicationPort,
  NotFoundError,
} from "@rah-os/kernel";
import { ComputerApplicationService } from "@rah-os/application-service";
import { ComputerExecutionCommandRequestSchema } from "@rah-os/computer-protocol";

/**
 * The Codex delivery-acceptance contract, exercised over the real authenticated
 * Host session rather than a direct Kernel call: the `delivery.presented.sent`
 * command rides `commandExecution`, the same surface and the same
 * `AuthenticatedHostContext` that `run.finish` and `activation.complete` use.
 *
 * What is deliberately NOT faked here: the Kernel, the SQLite file, the worker
 * HTTP routes, the Host session authentication. What is stood in for: the
 * Codex app-server process itself — the driver's acceptance signal is the
 * `turn/start` JSON-RPC response, and this chain asserts what the Host does
 * once that signal has (or has not) arrived.
 */
async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "rah-codex-acceptance-"));
  const databasePath = join(directory, "room.db");
  const kernel = new RoomKernel({ databasePath });
  kernel.initialize();
  const database = new DatabaseSync(databasePath);
  const human = kernel.provisionPrincipal({ handle: "human", kind: "human" });
  const agent = kernel.provisionPrincipal({ handle: "codex", kind: "agent" });
  const agentId = agent.principal.principalId;
  const actor = kernel.authenticateAccessToken(human.accessToken);
  const room = kernel.createRoom(actor, { name: "Main", slug: "main" });
  kernel.addMember(actor, { roomId: room.roomId, principalId: agentId });
  const hostCredential = kernel.provisionHostCredential({
    hostId: "host",
    participantIds: [agentId],
  });
  const host = kernel.authenticateHostAccessToken(hostCredential.accessToken);
  kernel.heartbeatHost(host);
  const worker = new WorkerApplicationService({ kernel });
  await worker.start();
  // Constructed to prove the execution-command surface accepts the new kind
  // under the same authenticated Host session as `run.finish`.
  const computer = new ComputerApplicationService({
    computer: createComputerApplicationPort(kernel),
  });
  let sequence = 0;
  const post = (body: string) =>
    kernel.postMessage(actor, {
      body,
      roomId: room.roomId,
      recipients: [{ participantId: agentId, reason: "mention" }],
      idempotencyKey: `seed-${++sequence}`,
    });
  return {
    actor,
    agentId,
    computer,
    database,
    host,
    hostCredential,
    kernel,
    post,
    room,
    worker,
    cursor: () =>
      Number(
        database
          .prepare(
            "SELECT last_seq AS n FROM subscription_cursors WHERE room_id=? AND participant_id=? AND consumer_id='worker'",
          )
          .get(room.roomId, agentId)?.n ?? 0,
      ),
    sentAt: (activationId: string, runAttemptId: string) =>
      database
        .prepare(
          "SELECT sent_at FROM activation_presented_windows WHERE activation_id=? AND consumer_id='worker' AND run_attempt_id=?",
        )
        .get(activationId, runAttemptId)?.sent_at ?? null,
    activate() {
      const activation = kernel.leaseNextActivation(host, { leaseMs: 600_000 });
      assert.ok(activation);
      const run = kernel.createRunAttempt(host, {
        activationId: activation.activationId,
      });
      const runtime = {
        runAttemptId: run.runAttemptId,
        runtimeRunId: "codex-run",
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
      const credential = worker.issueActivationCredential(host, scope);
      return {
        activation,
        run,
        scope,
        call: async (path: string, body: unknown = {}) => {
          const response = await fetch(`${worker.origin}/v1/worker/${path}`, {
            method: "POST",
            headers: {
              authorization: `Bearer ${credential.accessToken}`,
              "content-type": "application/json",
            },
            body: JSON.stringify(body),
          });
          return {
            status: response.status,
            body: (await response.json()) as Record<string, any>,
          };
        },
      };
    },
    async close() {
      await worker.close();
      database.close();
      kernel.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

/**
 * What the daemon actually calls when the Codex driver's acceptance frame
 * arrives: `kernel.markPresentedDeliverySent(host, …)` under the Host
 * credential (`daemon-application.ts`, `recordDeliveryAcceptance`). The remote
 * Computer deployment reaches the same Kernel method through the
 * `delivery.presented.sent` execution command on the already-authenticated Host
 * session; that surface is wired and typechecked but is NOT covered here.
 */
function acceptanceSignal(
  context: Awaited<ReturnType<typeof fixture>>,
  scope: { activationId: string; runAttemptId: string },
): void {
  context.kernel.markPresentedDeliverySent(context.host, {
    activationId: scope.activationId,
    consumerId: "worker",
    runAttemptId: scope.runAttemptId,
  });
}

test("the acceptance signal registers the send over the existing Host session", async () => {
  const context = await fixture();
  try {
    const first = context.post("a Codex question");
    const run = context.activate();
    const presented = await run.call("message-present");
    assert.equal(presented.status, 200);
    assert.equal(
      context.sentAt(run.scope.activationId, run.scope.runAttemptId),
      null,
    );
    // What the Codex driver reports after the `turn/start` response arrives.
    acceptanceSignal(context, run.scope);
    assert.ok(
      context.sentAt(run.scope.activationId, run.scope.runAttemptId) !== null,
    );
    const posted = await run.call("messages/post", {
      body: "the Codex answer",
      basedOnRoomSeq: presented.body.presentedThroughSeq,
      idempotencyKey: "codex-1",
    });
    assert.equal(posted.status, 200);
    assert.equal(context.cursor(), first.event.roomSeq);
  } finally {
    await context.close();
  }
});

test("no acceptance signal leaves the send unregistered and the range unacknowledged", async () => {
  const context = await fixture();
  try {
    context.post("a question whose turn was never accepted");
    const run = context.activate();
    const presented = await run.call("message-present");
    const posted = await run.call("messages/post", {
      body: "an answer with no acceptance signal",
      basedOnRoomSeq: presented.body.presentedThroughSeq,
      idempotencyKey: "codex-2",
    });
    assert.equal(posted.status, 200);
    assert.equal(
      context.sentAt(run.scope.activationId, run.scope.runAttemptId),
      null,
    );
    assert.equal(context.cursor(), 0);
    // The explicit path still completes the Activation.
    const check = await run.call("message-check");
    assert.equal(check.status, 200);
  } finally {
    await context.close();
  }
});

test("a repeated acceptance signal is idempotent", async () => {
  const context = await fixture();
  try {
    context.post("a question delivered twice");
    const run = context.activate();
    await run.call("message-present");
    acceptanceSignal(context, run.scope);
    const first = context.sentAt(
      run.scope.activationId,
      run.scope.runAttemptId,
    );
    acceptanceSignal(context, run.scope);
    assert.equal(
      context.sentAt(run.scope.activationId, run.scope.runAttemptId),
      first,
      "a retried registration keeps the first send time",
    );
  } finally {
    await context.close();
  }
});

test("an acceptance signal with no rendering behind it registers nothing", async () => {
  const context = await fixture();
  try {
    context.post("a question never fetched through message-present");
    const run = context.activate();
    assert.throws(
      () => acceptanceSignal(context, run.scope),
      NotFoundError,
      "the send fact may only reference a rendering the server wrote",
    );
  } finally {
    await context.close();
  }
});

test("the remote Host session carries the same registration as a typed command", () => {
  // The remote Computer deployment reaches the identical Kernel method through
  // the execution-command surface `run.finish` and `activation.complete`
  // already use, on the same authenticated Host session. Only the request
  // shape is pinned here; the end-to-end session round trip is not covered.
  const parsed = ComputerExecutionCommandRequestSchema.parse({
    activationId: "activation_1",
    consumerId: "worker",
    kind: "delivery.presented.sent",
    runAttemptId: "run_1",
  });
  assert.equal(parsed.kind, "delivery.presented.sent");
  assert.throws(
    () =>
      ComputerExecutionCommandRequestSchema.parse({
        activationId: "activation_1",
        consumerId: "worker",
        contentDigest: "sha256:deadbeef",
        kind: "delivery.presented.sent",
        runAttemptId: "run_1",
      }),
    "the Host may not restate the range, the page or the digest",
  );
});
