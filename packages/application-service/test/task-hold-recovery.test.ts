import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { RoomKernel } from "@rah-os/kernel";
import { WorkerApplicationService } from "../src/index.ts";

/**
 * A freshness hold tells the Agent to read the newer context and rerun the
 * command if it is still correct. That instruction is only true if reading can
 * clear the hold; otherwise the retry carries the same frozen Activation head
 * and is held forever inside the Run.
 */
async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "rah-task-hold-recovery-"));
  const kernel = new RoomKernel({ databasePath: join(directory, "room.db") });
  const database = new DatabaseSync(join(directory, "room.db"));
  kernel.initialize();
  const human = kernel.provisionPrincipal({ handle: "owner", kind: "human" });
  const agent = kernel.provisionPrincipal({ handle: "worker", kind: "agent" });
  const actor = kernel.authenticateAccessToken(human.accessToken);
  const room = kernel.createRoom(actor, { name: "Hold", slug: "hold" });
  kernel.addMember(actor, {
    principalId: agent.principal.principalId,
    roomId: room.roomId,
  });
  const task = kernel.createTask(actor, {
    collaboratorIds: [],
    dependencyTaskIds: [],
    idempotencyKey: "task-1",
    reviewerIds: [],
    roomId: room.roomId,
    title: "First",
  });
  const second = kernel.createTask(actor, {
    collaboratorIds: [],
    dependencyTaskIds: [],
    idempotencyKey: "task-2",
    reviewerIds: [],
    roomId: room.roomId,
    title: "Second",
  });
  kernel.postMessage(actor, {
    body: "Wake up and claim",
    idempotencyKey: "wake",
    recipients: [
      { participantId: agent.principal.principalId, reason: "mention" },
    ],
    roomId: room.roomId,
  });
  const host = kernel.authenticateHostAccessToken(
    kernel.provisionHostCredential({
      hostId: "host",
      participantIds: [agent.principal.principalId],
    }).accessToken,
  );
  kernel.heartbeatHost(host);
  const activation = kernel.leaseNextActivation(host, { leaseMs: 60_000 })!;
  const run = kernel.createRunAttempt(host, {
    activationId: activation.activationId,
  });
  const runtime = {
    recoveryDescriptor: { driver: "fake", metadata: {}, recoveryKey: "fake" },
    runAttemptId: run.runAttemptId,
    runtimeRunId: "fake",
  };
  kernel.prepareRunAttemptRuntime(host, runtime);
  kernel.markRunAttemptRunning(host, runtime);
  const service = new WorkerApplicationService({ kernel });
  await service.start();
  const credential = service.issueActivationCredential(host, {
    activationId: activation.activationId,
    consumerId: "consumer",
    hostId: host.hostId,
    participantId: agent.principal.principalId,
    roomId: room.roomId,
    runAttemptId: run.runAttemptId,
    toSeq: activation.toSeq,
  });
  const call = async (path: string, body: unknown = {}) => {
    const response = await fetch(`${service.origin}/v1/worker/${path}`, {
      body: JSON.stringify(body),
      headers: {
        authorization: `Bearer ${credential.accessToken}`,
        "content-type": "application/json",
      },
      method: "POST",
    });
    return { body: await response.json(), status: response.status };
  };
  await call("sync");
  return {
    actor,
    agent,
    call,
    database,
    kernel,
    room,
    second,
    task,
    async close() {
      await service.close();
      database.close();
      kernel.close();
      rmSync(directory, { force: true, recursive: true });
    },
  };
}

test("a held task claim is cleared by reading the newer context, then retrying", async () => {
  const f = await fixture();
  try {
    // A peer speaks after the Activation head was frozen.
    // The Task fence blocks on a newer event about this Task, or one delivered
    // to this participant's inbox — so the peer message must reach the Agent.
    f.kernel.postMessage(f.actor, {
      body: "Careful, scope changed",
      idempotencyKey: "newer",
      recipients: [
        { participantId: f.agent.principal.principalId, reason: "mention" },
      ],
      roomId: f.room.roomId,
    });

    const held = await f.call("tasks/claim", {
      idempotencyKey: "claim-1",
      taskId: f.task.task.taskId,
    });
    assert.equal(held.status, 200, JSON.stringify(held.body));
    assert.equal((held.body as { state: string }).state, "held");
    assert.equal(
      (held.body as { shownMessageCount: number }).shownMessageCount,
      1,
      "the newer message must actually be shown",
    );
    assert.equal(
      f.database
        .prepare("SELECT assignee_id FROM tasks WHERE task_id=?")
        .get(f.task.task.taskId)!.assignee_id,
      null,
      "a hold applies nothing",
    );

    // Reading is the path the hold names.
    const read = await f.call("messages/history", { limit: 50 });
    assert.equal(read.status, 200, JSON.stringify(read.body));

    const retried = await f.call("tasks/claim", {
      idempotencyKey: "claim-2",
      taskId: f.task.task.taskId,
    });
    assert.equal(retried.status, 200, JSON.stringify(retried.body));
    assert.notEqual(
      (retried.body as { state?: string }).state,
      "held",
      "reading the newer context must clear the hold, or the instruction is false",
    );
    assert.equal(
      f.database
        .prepare("SELECT assignee_id FROM tasks WHERE task_id=?")
        .get(f.task.task.taskId)!.assignee_id,
      f.agent.principal.principalId,
    );
  } finally {
    await f.close();
  }
});

test("a claim applied before a later hold stays applied and stays reported", async () => {
  const f = await fixture();
  try {
    const first = await f.call("tasks/claim", {
      idempotencyKey: "batch-1",
      taskId: f.task.task.taskId,
    });
    assert.equal(first.status, 200);
    assert.notEqual((first.body as { state?: string }).state, "held");

    // Someone speaks between the two requests of one fan-out.
    f.kernel.postMessage(f.actor, {
      body: "Interrupting",
      idempotencyKey: "between",
      recipients: [
        { participantId: f.agent.principal.principalId, reason: "mention" },
      ],
      roomId: f.room.roomId,
    });

    const second = await f.call("tasks/claim", {
      idempotencyKey: "batch-2",
      taskId: f.second.task.taskId,
    });
    assert.equal((second.body as { state: string }).state, "held");

    // The ledger keeps the first claim: a CLI that replaced the applied block
    // with the hold would be telling the Agent something untrue.
    assert.equal(
      f.database
        .prepare("SELECT assignee_id FROM tasks WHERE task_id=?")
        .get(f.task.task.taskId)!.assignee_id,
      f.agent.principal.principalId,
    );
  } finally {
    await f.close();
  }
});

/**
 * A read position is a maximum sequence, not proof that a particular fact was
 * shown. These two must hold together: reading the fact that caused the hold
 * clears it, and reading something else — however recent — does not.
 */
test("reading the Task change that caused the hold clears it", async () => {
  const f = await fixture();
  try {
    const latest = Number(
      f.database
        .prepare("SELECT next_seq-1 AS n FROM rooms WHERE room_id=?")
        .get(f.room.roomId)!.n,
    );
    f.kernel.taskAmendments.human(f.actor, {
      basedOnRoomSeq: latest,
      idempotencyKey: "human-change",
      taskId: f.task.task.taskId,
      title: "First, rescoped",
    });

    const held = await f.call("tasks/claim", {
      idempotencyKey: "claim-a",
      taskId: f.task.task.taskId,
    });
    assert.equal((held.body as { state?: string }).state, "held");

    const history = await f.call("tasks/history", {
      taskId: f.task.task.taskId,
    });
    assert.equal(history.status, 200, JSON.stringify(history.body));

    const retried = await f.call("tasks/claim", {
      idempotencyKey: "claim-b",
      taskId: f.task.task.taskId,
    });
    assert.notEqual(
      (retried.body as { state?: string }).state,
      "held",
      "reading the Task change the hold was about must clear it",
    );
  } finally {
    await f.close();
  }
});

test("reading an unrelated message does not clear a hold caused by a Task change", async () => {
  const f = await fixture();
  try {
    const latest = Number(
      f.database
        .prepare("SELECT next_seq-1 AS n FROM rooms WHERE room_id=?")
        .get(f.room.roomId)!.n,
    );
    f.kernel.taskAmendments.human(f.actor, {
      basedOnRoomSeq: latest,
      idempotencyKey: "human-change",
      taskId: f.task.task.taskId,
      title: "First, rescoped",
    });

    const held = await f.call("tasks/claim", {
      idempotencyKey: "claim-a",
      taskId: f.task.task.taskId,
    });
    assert.equal((held.body as { state?: string }).state, "held");

    // Something newer, and unrelated, that the Agent does read.
    f.kernel.postMessage(f.actor, {
      body: "Unrelated chatter",
      idempotencyKey: "unrelated",
      recipients: [],
      roomId: f.room.roomId,
    });
    const read = await f.call("messages/history", { limit: 50 });
    assert.equal(read.status, 200, JSON.stringify(read.body));

    const retried = await f.call("tasks/claim", {
      idempotencyKey: "claim-b",
      taskId: f.task.task.taskId,
    });
    assert.equal(
      (retried.body as { state?: string }).state,
      "held",
      "a larger sequence read elsewhere is not proof the Task change was seen",
    );
  } finally {
    await f.close();
  }
});
