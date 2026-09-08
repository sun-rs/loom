import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { RoomKernel } from "@rah-os/kernel";
import {
  WorkerHistoryResponseSchema,
  WorkerErrorResponseSchema,
} from "@rah-os/protocol";
import { WorkerApplicationService } from "../src/index.ts";

test("authenticated read routes expose current visible facts without advancing execution or acknowledgement authority", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rah-read-api-"));
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
      name: "Read API",
      slug: "read-api",
    });
    kernel.addMember(actor, {
      roomId: room.roomId,
      principalId: agent.principal.principalId,
    });
    const task = kernel.createTask(actor, {
      roomId: room.roomId,
      title: "Earlier task",
      collaboratorIds: [],
      reviewerIds: [],
      dependencyTaskIds: [],
      idempotencyKey: "task",
    });
    kernel.postMessage(actor, {
      roomId: room.roomId,
      body: "Read old tasks",
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
    const activation = kernel.leaseNextActivation(host, { leaseMs: 60000 });
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
    const sync = await call("sync");
    assert.equal(sync.status, 200);
    const later = kernel.postMessage(actor, {
      roomId: room.roomId,
      body: "New visible fact",
      recipients: [],
      idempotencyKey: "later",
    });
    for (const [path, body] of [
      ["messages/history", {}],
      ["messages/resolve", { messageId: later.event.aggregateId }],
      ["room/members", {}],
      ["server/info", {}],
      ["profiles/get", { target: "@human" }],
      ["tasks/list", {}],
      ["tasks/history", { taskId: task.task.taskId }],
    ] as const) {
      const result = await call(path, body);
      assert.equal(
        result.status,
        200,
        `${path}: ${await result.clone().text()}`,
      );
      assert.equal(
        JSON.stringify(await result.json()).includes(credential.accessToken),
        false,
      );
    }
    const history = WorkerHistoryResponseSchema.parse(
      await (await call("messages/history", {})).json(),
    );
    assert.equal(history.messages.at(-1)!.body, "New visible fact");
    assert.equal(
      (await call("messages/history", { roomId: "foreign" })).status,
      400,
    );
    assert.equal(
      (await call("tasks/list", { actorId: human.principal.principalId }))
        .status,
      400,
    );
    const rejectedWrite = await call("messages/post", {
      body: "must not be authorized by reads",
      basedOnRoomSeq: later.event.roomSeq,
      idempotencyKey: "forged-future-write",
    });
    assert.equal(rejectedWrite.status, 409);
    assert.equal(
      WorkerErrorResponseSchema.parse(await rejectedWrite.json()).error.code,
      "causal_cursor_not_delivered",
    );
    assert.equal(
      (await call("acknowledge", { throughSeq: later.event.roomSeq })).status,
      409,
    );
    credential.revoke();
    assert.equal((await call("messages/history", {})).status, 401);
  } finally {
    await service.close();
    kernel.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
