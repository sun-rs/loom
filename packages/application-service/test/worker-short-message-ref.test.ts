import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { RoomKernel } from "@rah-os/kernel";
import {
  WorkerHistoryResponseSchema,
  WorkerMessageResolveResponseSchema,
} from "@rah-os/protocol";
import { WorkerApplicationService } from "../src/index.ts";

/**
 * The compact wake names messages and Threads by an 8-char short ref (the
 * first UUID block of the canonical id). The Worker API accepts it wherever a
 * message id or a Thread suffix goes, resolves it only inside the caller's
 * joined Rooms, and refuses an ambiguous one instead of picking a message.
 */
test("the Worker API accepts unambiguous short message and Thread refs and refuses ambiguous ones", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rah-short-ref-"));
  // Deterministic ids: two messages share the `deadbeef` prefix.
  const forced = [
    "message_0c12aaaa-1111-4222-8333-444455556666",
    "message_deadbeef-1111-4222-8333-000000000001",
    "message_deadbeef-1111-4222-8333-000000000002",
  ];
  const kernel = new RoomKernel({
    databasePath: join(dir, "room.db"),
    createId: (prefix) =>
      prefix === "message" && forced.length > 0
        ? forced.shift()!
        : prefix === "thread"
          ? "thread_7e09cccc-1111-4222-8333-444455556666"
          : `${prefix}_${randomUUID()}`,
  });
  const service = new WorkerApplicationService({ kernel });
  try {
    kernel.initialize();
    const human = kernel.provisionPrincipal({ handle: "human", kind: "human" });
    const agent = kernel.provisionPrincipal({
      handle: "reader",
      kind: "agent",
    });
    const actor = kernel.authenticateAccessToken(human.accessToken);
    const room = kernel.createRoom(actor, { name: "Refs", slug: "refs" });
    kernel.addMember(actor, {
      roomId: room.roomId,
      principalId: agent.principal.principalId,
    });
    const root = kernel.postMessage(actor, {
      roomId: room.roomId,
      body: "root",
      recipients: [
        { participantId: agent.principal.principalId, reason: "mention" },
      ],
      idempotencyKey: "root",
    });
    for (const key of ["twin-1", "twin-2"])
      kernel.postMessage(actor, {
        roomId: room.roomId,
        body: key,
        recipients: [],
        idempotencyKey: key,
      });
    const thread = kernel.createThread(actor, {
      basedOnRoomSeq: root.event.roomSeq + 2,
      idempotencyKey: "thread",
      recipientIds: [],
      roomId: room.roomId,
      rootMessageId: root.event.aggregateId,
    });
    assert.equal(
      thread.thread.threadId,
      "thread_7e09cccc-1111-4222-8333-444455556666",
    );
    const host = kernel.authenticateHostAccessToken(
      kernel.provisionHostCredential({
        hostId: "host",
        participantIds: [agent.principal.principalId],
      }).accessToken,
    );
    kernel.heartbeatHost(host);
    const activation = kernel.leaseNextActivation(host, { leaseMs: 60000 });
    assert.ok(activation);
    const run = kernel.createRunAttempt(host, {
      activationId: activation.activationId,
    });
    const runtime = {
      runAttemptId: run.runAttemptId,
      runtimeRunId: "runtime",
      recoveryDescriptor: { driver: "fake", metadata: {}, recoveryKey: "r" },
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
    const call = (path: string, body: unknown) =>
      fetch(`${service.origin}/v1/worker/${path}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${credential.accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });

    // Short ref and full id resolve to the same canonical message.
    for (const messageId of ["0c12aaaa", root.event.aggregateId]) {
      const response = await call("messages/resolve", { messageId });
      assert.equal(response.status, 200, await response.clone().text());
      assert.equal(
        WorkerMessageResolveResponseSchema.parse(await response.json()).message
          .messageId,
        root.event.aggregateId,
      );
    }

    // An ambiguous short ref never picks one of the candidates.
    const ambiguous = await call("messages/resolve", { messageId: "deadbeef" });
    assert.equal(ambiguous.status, 409, await ambiguous.clone().text());
    assert.match(await ambiguous.text(), /ambiguous/u);

    // A short ref of a message outside the joined Rooms stays unavailable.
    const missing = await call("messages/resolve", { messageId: "99999999" });
    assert.equal(missing.status, 404);

    // Thread suffix: the short Thread ref and the short root-message ref.
    for (const channel of ["#refs:7e09cccc", "#refs:0c12aaaa"]) {
      const response = await call("messages/history", { channel });
      assert.equal(response.status, 200, await response.clone().text());
      WorkerHistoryResponseSchema.parse(await response.json());
    }
    const ambiguousThread = await call("messages/history", {
      channel: "#refs:deadbeef",
    });
    assert.equal(ambiguousThread.status, 404);
  } finally {
    await service.close();
    kernel.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
