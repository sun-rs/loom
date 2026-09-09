import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { WorkerApplicationService } from "@rah-os/application-service";
import { RoomKernel } from "@rah-os/kernel";
import { WORKER_MESSAGE_RESOLVE_NOT_FOUND_NEXT_ACTION } from "@rah-os/protocol";

import { runWorkerCliCommand } from "../src/index.ts";
import {
  cliError,
  renderWorkerCliError,
  workerServerFailureError,
} from "../src/worker-cli-error.ts";

/**
 * `277bd23` could only drive a server-supplied `Next action:` through a fake
 * response body, because `WorkerErrorResponseSchema` had no field to carry one.
 * This drives the real server: the Worker API attaches Raft's `message resolve`
 * wording (`main.js@30190674`), the transport keeps it, and `renderError`'s
 * `Next action:` line is what the Agent reads on stderr.
 */
test("a server-supplied recovery instruction reaches the Agent's stderr, and its absence prints no line", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-cli-next-action-"));
  chmodSync(directory, 0o700);
  const kernel = new RoomKernel({ databasePath: join(directory, "room.db") });
  const service = new WorkerApplicationService({ kernel });
  try {
    kernel.initialize();
    const human = kernel.provisionPrincipal({
      handle: "next-action-human",
      kind: "human",
    });
    const agent = kernel.provisionPrincipal({
      handle: "next-action-agent",
      kind: "agent",
    });
    const actor = kernel.authenticateAccessToken(human.accessToken);
    const room = kernel.createRoom(actor, {
      name: "Next action",
      slug: "next-action",
    });
    kernel.addMember(actor, {
      principalId: agent.principal.principalId,
      roomId: room.roomId,
    });
    kernel.postMessage(actor, {
      body: "Wake the reader",
      idempotencyKey: "wake",
      recipients: [
        { participantId: agent.principal.principalId, reason: "mention" },
      ],
      roomId: room.roomId,
    });
    const host = kernel.authenticateHostAccessToken(
      kernel.provisionHostCredential({
        hostId: "next-action-host",
        participantIds: [agent.principal.principalId],
      }).accessToken,
    );
    kernel.heartbeatHost(host);
    const activation = kernel.leaseNextActivation(host, { leaseMs: 60_000 });
    assert.ok(activation);
    const run = kernel.createRunAttempt(host, {
      activationId: activation.activationId,
    });
    const runtimeRun = {
      recoveryDescriptor: {
        driver: "fake",
        metadata: {},
        recoveryKey: "runtime",
      },
      runAttemptId: run.runAttemptId,
      runtimeRunId: "runtime",
    };
    kernel.prepareRunAttemptRuntime(host, runtimeRun);
    kernel.markRunAttemptRunning(host, runtimeRun);
    await service.start();
    const credential = service.issueActivationCredential(host, {
      activationId: activation.activationId,
      consumerId: "next-action",
      hostId: host.hostId,
      participantId: agent.principal.principalId,
      roomId: room.roomId,
      runAttemptId: run.runAttemptId,
      toSeq: activation.toSeq,
    });
    const tokenPath = join(directory, "token");
    writeFileSync(tokenPath, credential.accessToken, { mode: 0o600 });
    let stdout = "";
    let stderr = "";
    const runtime = {
      env: {
        RAH_ACTIVATION_ID: activation.activationId,
        RAH_WORKER_API_URL: service.origin,
        RAH_WORKER_SESSION_FILE: tokenPath,
      },
      fetch,
      stderr: { write: (value: string) => (stderr += value) },
      stdout: { write: (value: string) => (stdout += value) },
    };

    assert.equal(
      await runWorkerCliCommand(
        [
          "worker",
          "message-resolve",
          "--message-id",
          "11111111-1111-4111-8111-111111111111",
        ],
        runtime,
      ),
      1,
    );
    assert.equal(stdout, "");
    const lines = stderr.split("\n");
    assert.match(lines[0]!, /^Error: Worker API HTTP 404: /u);
    assert.equal(lines[1], "Code: NOT_FOUND");
    assert.equal(
      lines[2],
      `Next action: ${WORKER_MESSAGE_RESOLVE_NOT_FOUND_NEXT_ACTION}`,
    );

    // The same route with a code Raft attaches no wording to prints the code
    // and nothing else: an absent instruction is an absent line, never an
    // instruction RAH wrote for itself.
    stdout = "";
    stderr = "";
    credential.revoke();
    assert.equal(
      await runWorkerCliCommand(
        [
          "worker",
          "message-resolve",
          "--message-id",
          "11111111-1111-4111-8111-111111111111",
        ],
        runtime,
      ),
      1,
    );
    assert.equal(stdout, "");
    assert.match(stderr, /^Error: Worker API HTTP 401: /u);
    assert.match(stderr, /\nCode: unauthenticated\n$/u);
    assert.doesNotMatch(stderr, /Next action:/u);
  } finally {
    await service.close();
    kernel.close();
    rmSync(directory, { force: true, recursive: true });
  }
});

/**
 * The JSON envelope carries the same instruction under `next_action`
 * (`main.js@29839306`). Which failures render as JSON is upstream's choice, not
 * a formatting preference: Raft sets `outputMode` from `opts.json` at exactly
 * two sites — the held send and mention partial delivery — and `apiFailureError`
 * passes none (`main.js@29998456`), so an API failure prints the text block even
 * under `--json`. RAH replicates that, which leaves this the envelope's own
 * contract for a server-supplied action rather than a reachable CLI mode.
 */
test("the JSON error envelope carries a server-supplied action as next_action", () => {
  let stderr = "";
  const failure = workerServerFailureError(
    {
      error: {
        code: "not_found",
        message: "message is unavailable",
        suggestedNextAction: WORKER_MESSAGE_RESOLVE_NOT_FOUND_NEXT_ACTION,
      },
    },
    404,
    "READ_FAILED",
  );
  assert.equal(failure.code, "NOT_FOUND");
  assert.equal(
    failure.suggestedNextAction,
    WORKER_MESSAGE_RESOLVE_NOT_FOUND_NEXT_ACTION,
  );
  renderWorkerCliError(
    { write: (value: string) => (stderr += value) },
    cliError(failure.code, failure.message, {
      outputMode: "json",
      suggestedNextAction: failure.suggestedNextAction,
    }),
  );
  const envelope = JSON.parse(stderr) as {
    error: { code: string; next_action: string };
    ok: boolean;
  };
  assert.equal(envelope.ok, false);
  assert.equal(envelope.error.code, "NOT_FOUND");
  assert.equal(
    envelope.error.next_action,
    WORKER_MESSAGE_RESOLVE_NOT_FOUND_NEXT_ACTION,
  );
});
