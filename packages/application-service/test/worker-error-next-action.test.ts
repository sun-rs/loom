import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { RoomKernel } from "@rah-os/kernel";
import {
  WORKER_MESSAGE_RESOLVE_NOT_FOUND_NEXT_ACTION,
  WorkerErrorResponseSchema,
} from "@rah-os/protocol";
import { WorkerApplicationService } from "../src/index.ts";

/**
 * Raft attaches a recovery instruction where the failing command and the code
 * together identify the situation, and attaches nothing elsewhere. RAH's
 * dispatch is that place, so the two assertions below are the whole contract:
 * `message resolve` + `not_found` carries upstream's wording
 * (`main.js@30190674`), and a code with no upstream counterpart carries no
 * field at all rather than prose RAH authored for itself.
 */
test("a Worker failure carries a recovery instruction only where Raft has one", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rah-error-next-action-"));
  const kernel = new RoomKernel({ databasePath: join(dir, "room.db") });
  const service = new WorkerApplicationService({ kernel });
  try {
    kernel.initialize();
    const human = kernel.provisionPrincipal({ handle: "human", kind: "human" });
    const agent = kernel.provisionPrincipal({
      handle: "reader",
      kind: "agent",
    });
    const actor = kernel.authenticateAccessToken(human.accessToken);
    const room = kernel.createRoom(actor, {
      name: "Errors",
      slug: "errors",
    });
    kernel.addMember(actor, {
      roomId: room.roomId,
      principalId: agent.principal.principalId,
    });
    kernel.postMessage(actor, {
      roomId: room.roomId,
      body: "Wake the reader",
      recipients: [
        { participantId: agent.principal.principalId, reason: "mention" },
      ],
      idempotencyKey: "wake",
    });
    const host = kernel.authenticateHostAccessToken(
      kernel.provisionHostCredential({
        hostId: "host",
        participantIds: [agent.principal.principalId],
      }).accessToken,
    );
    kernel.heartbeatHost(host);
    const activation = kernel.leaseNextActivation(host, { leaseMs: 60_000 });
    assert.ok(activation);
    const run = kernel.createRunAttempt(host, {
      activationId: activation.activationId,
    });
    const runtime = {
      runAttemptId: run.runAttemptId,
      runtimeRunId: "runtime",
      recoveryDescriptor: {
        driver: "fake",
        metadata: {},
        recoveryKey: "runtime",
      },
    };
    kernel.prepareRunAttemptRuntime(host, runtime);
    kernel.markRunAttemptRunning(host, runtime);
    await service.start();
    const credential = service.issueActivationCredential(host, {
      activationId: activation.activationId,
      consumerId: "reader",
      hostId: host.hostId,
      participantId: agent.principal.principalId,
      roomId: room.roomId,
      runAttemptId: run.runAttemptId,
      toSeq: activation.toSeq,
    });
    const call = (path: string, body: unknown = {}) =>
      fetch(`${service.origin}/v1/worker/${path}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${credential.accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });
    const missing = "11111111-1111-4111-8111-111111111111";
    const resolved = await call("messages/resolve", { messageId: missing });
    assert.equal(resolved.status, 404);
    const resolveBody = WorkerErrorResponseSchema.parse(await resolved.json());
    assert.equal(resolveBody.error.code, "not_found");
    assert.equal(
      resolveBody.error.suggestedNextAction,
      WORKER_MESSAGE_RESOLVE_NOT_FOUND_NEXT_ACTION,
    );
    // A read refused for a reason Raft attaches no wording to says so by
    // omitting the field; the CLI then renders no `Next action:` line.
    const foreign = await call("messages/history", { roomId: "foreign" });
    assert.equal(foreign.status, 400);
    const foreignBody = WorkerErrorResponseSchema.parse(await foreign.json());
    assert.equal(foreignBody.error.suggestedNextAction, undefined);
    assert.equal("suggestedNextAction" in foreignBody.error, false);
    // The 409 causal fence is RAH-only: Raft has no code for it, so it stays
    // without guidance rather than gaining prose RAH invented.
    const forged = await call("messages/post", {
      body: "must not be authorized by reads",
      basedOnRoomSeq: 9_999,
      idempotencyKey: "forged-future-write",
    });
    assert.equal(forged.status, 409);
    const forgedBody = WorkerErrorResponseSchema.parse(await forged.json());
    assert.equal(forgedBody.error.suggestedNextAction, undefined);
  } finally {
    await service.close();
    kernel.close();
    rmSync(dir, { force: true, recursive: true });
  }
});
