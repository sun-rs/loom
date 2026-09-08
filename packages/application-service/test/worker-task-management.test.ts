import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { RoomKernel } from "@rah-os/kernel";
import { WorkerApplicationService } from "../src/index.ts";
import { WorkerTaskMutationResponseSchema } from "@rah-os/protocol";

async function fixture(
  options: {
    attachmentOnly?: boolean;
    legacyRoles?: boolean;
    blocked?: boolean;
  } = {},
) {
  const directory = mkdtempSync(join(tmpdir(), "rah-task-management-"));
  const kernel = new RoomKernel({ databasePath: join(directory, "room.db") });
  const database = new DatabaseSync(join(directory, "room.db"));
  kernel.initialize();
  const human = kernel.provisionPrincipal({ kind: "human", handle: "human" });
  const agent = kernel.provisionPrincipal({ kind: "agent", handle: "creator" });
  const helper = kernel.provisionPrincipal({ kind: "agent", handle: "helper" });
  const actor = kernel.authenticateAccessToken(human.accessToken);
  const room = kernel.createRoom(actor, {
    name: "Management",
    slug: "management",
  });
  for (const principalId of [
    agent.principal.principalId,
    helper.principal.principalId,
  ])
    kernel.addMember(actor, { roomId: room.roomId, principalId });
  const humanTask = kernel.createTask(actor, {
    roomId: room.roomId,
    title: "Human owned",
    collaboratorIds: [],
    reviewerIds: [],
    dependencyTaskIds: [],
    idempotencyKey: "human-task",
  });
  // Historical blocked projection fixture. The daemon chain below exercises the real block command.
  if (options.blocked) {
    database
      .prepare(
        "UPDATE tasks SET assignee_id=?,state='blocked',blocked_reason='waiting',blocked_at=? WHERE task_id=?",
      )
      .run(
        agent.principal.principalId,
        new Date().toISOString(),
        humanTask.task.taskId,
      );
    const n = Number(
      database
        .prepare("SELECT next_seq AS n FROM rooms WHERE room_id=?")
        .get(room.roomId)!.n,
    );
    database
      .prepare(
        "INSERT INTO room_events SELECT ?,room_id,?,'task.blocked',?,aggregate_type,aggregate_id,?, ?,schema_version,created_at FROM room_events WHERE event_id=?",
      )
      .run(
        "fixture-blocked",
        n,
        agent.principal.principalId,
        JSON.stringify({
          taskId: humanTask.task.taskId,
          reason: "waiting",
          runAttemptId: "prior-run",
        }),
        "fixture-blocked",
        humanTask.event.eventId,
      );
    database
      .prepare("UPDATE rooms SET next_seq=next_seq+1 WHERE room_id=?")
      .run(room.roomId);
  }
  const source = kernel.postMessage(actor, {
    roomId: room.roomId,
    body: options.attachmentOnly ? "" : "Retain this as future work",
    ...(options.attachmentOnly
      ? {
          attachments: [
            {
              attachmentId: "audit-attachment",
              filename: "audit.txt",
              mimeType: "text/plain",
              size: 1,
              sha256: "a".repeat(64),
            },
          ],
        }
      : {}),
    idempotencyKey: "source",
    recipients: [
      { participantId: agent.principal.principalId, reason: "mention" },
    ],
  });
  const legacy = options.legacyRoles
    ? kernel.createTask(kernel.authenticateAccessToken(agent.accessToken), {
        roomId: room.roomId,
        title: "Legacy review",
        assigneeId: agent.principal.principalId,
        reviewerIds: [helper.principal.principalId],
        collaboratorIds: [],
        dependencyTaskIds: [],
        basedOnRoomSeq: Number(
          database
            .prepare("SELECT next_seq-1 AS n FROM rooms WHERE room_id=?")
            .get(room.roomId)!.n,
        ),
        idempotencyKey: "legacy",
      })
    : undefined;
  if (options.blocked)
    database
      .prepare(
        "UPDATE activations SET from_seq=? WHERE participant_id=? AND room_id=?",
      )
      .run(source.event.roomSeq, agent.principal.principalId, room.roomId);
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
    runtimeRunId: "fake",
    recoveryDescriptor: { driver: "fake", recoveryKey: "fake", metadata: {} },
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
      method: "POST",
      headers: {
        authorization: `Bearer ${credential.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  const sync = await call("sync");
  assert.equal(sync.status, 200);
  return {
    directory,
    database,
    kernel,
    service,
    actor,
    agent,
    helper,
    room,
    activation,
    source,
    humanTask,
    legacy,
    call,
    credential,
    async close() {
      await service.close();
      database.close();
      kernel.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

test("Worker creator assigns and unassigns idle tasks through canonical owner, without claiming them", async () => {
  const f = await fixture();
  try {
    const created = await f.call("tasks/create", {
      title: "Delegate later",
      basedOnRoomSeq: f.activation.toSeq,
      idempotencyKey: "create",
    });
    assert.equal(created.status, 200);
    const c = WorkerTaskMutationResponseSchema.parse(created.body);
    const assignment = {
      taskId: c.task.taskId,
      assigneeId: f.helper.principal.principalId,
      basedOnRoomSeq: c.event.roomSeq,
      idempotencyKey: "assign",
    };
    const assigned = await f.call("tasks/assign", assignment);
    assert.equal(assigned.status, 200, JSON.stringify(assigned.body));
    const a = WorkerTaskMutationResponseSchema.parse(assigned.body);
    assert.equal(a.task.assigneeId, f.helper.principal.principalId);
    assert.equal(a.task.state, "todo");
    assert.equal(a.task.claimedBy, undefined);
    const replay = await f.call("tasks/assign", assignment);
    assert.equal(replay.status, 200);
    assert.equal(
      WorkerTaskMutationResponseSchema.parse(replay.body).event.eventId,
      a.event.eventId,
    );
    const conflict = await f.call("tasks/assign", {
      ...assignment,
      assigneeId: f.agent.principal.principalId,
    });
    assert.equal(conflict.status, 409);
    const cleared = await f.call("tasks/assign", {
      taskId: c.task.taskId,
      assigneeId: null,
      basedOnRoomSeq: a.event.roomSeq,
      idempotencyKey: "unassign",
    });
    assert.equal(cleared.status, 200);
    const u = WorkerTaskMutationResponseSchema.parse(cleared.body);
    assert.equal(u.task.assigneeId, undefined);
    assert.equal(u.task.claimedBy, undefined);
    const foreign = await f.call("tasks/assign", {
      taskId: f.humanTask.task.taskId,
      assigneeId: f.agent.principal.principalId,
      basedOnRoomSeq: u.event.roomSeq,
      idempotencyKey: "foreign",
    });
    assert.equal(foreign.status, 403);
    const injected = await f.call("tasks/assign", {
      ...assignment,
      actorId: f.actor.principalId,
    });
    assert.equal(injected.status, 400);
  } finally {
    await f.close();
  }
});

test("converting an old visible top-level message retains one canonical Task and never claims it", async () => {
  const f = await fixture();
  try {
    const request = {
      messageId: f.source.event.aggregateId,
      basedOnRoomSeq: f.activation.toSeq,
      idempotencyKey: "convert",
    };
    const response = await f.call("tasks/convert", request);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    const converted = WorkerTaskMutationResponseSchema.parse(response.body);
    assert.equal(converted.task.sourceMessageId, f.source.event.aggregateId);
    assert.equal(converted.task.title, "Retain this as future work");
    assert.equal(converted.task.state, "todo");
    assert.equal(converted.task.claimedBy, undefined);
    assert.equal(converted.task.assigneeId, undefined);
    assert.equal(converted.task.creatorId, f.agent.principal.principalId);
    const replay = await f.call("tasks/convert", request);
    assert.equal(replay.status, 200);
    assert.equal(
      WorkerTaskMutationResponseSchema.parse(replay.body).task.taskId,
      converted.task.taskId,
    );
    const collision = await f.call("tasks/convert", {
      ...request,
      basedOnRoomSeq: converted.event.roomSeq,
      idempotencyKey: "second-convert",
    });
    assert.equal(collision.status, 409);
    const list = await f.call("tasks/list");
    assert.equal(list.status, 200);
    const future = f.kernel.postMessage(f.actor, {
      roomId: f.room.roomId,
      body: "New fact",
      idempotencyKey: "future",
      recipients: [],
    });
    const forbidden = await f.call("tasks/convert", {
      messageId: future.event.aggregateId,
      basedOnRoomSeq: converted.event.roomSeq,
      idempotencyKey: "future-convert",
    });
    assert.equal(forbidden.status, 403);
  } finally {
    await f.close();
  }
});

test("assignment rejects active ownership and stale Task facts, while a valid replay survives target membership changes", async () => {
  const f = await fixture();
  try {
    const own = WorkerTaskMutationResponseSchema.parse(
      (
        await f.call("tasks/create", {
          title: "Self-owned",
          assigneeId: f.agent.principal.principalId,
          basedOnRoomSeq: f.activation.toSeq,
          idempotencyKey: "self",
        })
      ).body,
    );
    const started = WorkerTaskMutationResponseSchema.parse(
      (
        await f.call("tasks/start", {
          taskId: own.task.taskId,
          basedOnRoomSeq: own.event.roomSeq,
          idempotencyKey: "start",
        })
      ).body,
    );
    assert.equal(
      (
        await f.call("tasks/assign", {
          taskId: own.task.taskId,
          assigneeId: f.helper.principal.principalId,
          basedOnRoomSeq: started.event.roomSeq,
          idempotencyKey: "steal",
        })
      ).status,
      409,
    );
    const created = WorkerTaskMutationResponseSchema.parse(
      (
        await f.call("tasks/create", {
          title: "Idle",
          basedOnRoomSeq: started.event.roomSeq,
          idempotencyKey: "idle",
        })
      ).body,
    );
    const request = {
      taskId: created.task.taskId,
      assigneeId: f.helper.principal.principalId,
      basedOnRoomSeq: created.event.roomSeq,
      idempotencyKey: "assignment",
    };
    const assigned = WorkerTaskMutationResponseSchema.parse(
      (await f.call("tasks/assign", request)).body,
    );
    // Fault-inject current membership revocation while preserving the accepted event.
    f.database
      .prepare("DELETE FROM memberships WHERE room_id=? AND principal_id=?")
      .run(f.room.roomId, f.helper.principal.principalId);
    const replay = await f.call("tasks/assign", request);
    assert.equal(replay.status, 200);
    assert.equal(
      WorkerTaskMutationResponseSchema.parse(replay.body).event.eventId,
      assigned.event.eventId,
    );
    assert.equal(
      (
        await f.call("tasks/assign", {
          ...request,
          idempotencyKey: "departed-target",
          basedOnRoomSeq: assigned.event.roomSeq,
        })
      ).status,
      403,
    );
    f.kernel.postMessage(f.actor, {
      roomId: f.room.roomId,
      body: "New requirement",
      idempotencyKey: "new-fact",
      recipients: [
        { participantId: f.agent.principal.principalId, reason: "mention" },
      ],
    });
    assert.equal(
      (
        await f.call("tasks/assign", {
          ...request,
          assigneeId: null,
          idempotencyKey: "stale-clear",
          basedOnRoomSeq: assigned.event.roomSeq,
        })
      ).status,
      409,
    );
    f.credential.revoke();
    assert.equal((await f.call("tasks/assign", request)).status, 401);
  } finally {
    await f.close();
  }
});

test("real Node child converts a Message, assigns and clears its Task, and reads the canonical history", async () => {
  const f = await fixture();
  try {
    const tokenPath = join(f.directory, "worker-token");
    writeFileSync(tokenPath, f.credential.accessToken, { mode: 0o600 });
    const cli = new URL("../../agent-host/src/worker-cli.ts", import.meta.url)
      .href;
    const invoke = async (args: string[]) => {
      const result = await promisify(execFile)(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `import {runWorkerCliCommand} from ${JSON.stringify(cli)};process.exitCode=await runWorkerCliCommand(process.argv.slice(1));`,
          "worker",
          ...args,
        ],
        {
          env: {
            ...process.env,
            RAH_WORKER_API_URL: f.service.origin!,
            RAH_WORKER_SESSION_FILE: tokenPath,
            RAH_ACTIVATION_ID: f.activation.activationId,
          },
          timeout: 20_000,
        },
      );
      return JSON.parse(result.stdout);
    };
    const converted = WorkerTaskMutationResponseSchema.parse(
      await invoke([
        "task-convert",
        "--message-id",
        f.source.event.aggregateId,
        "--based-on-room-seq",
        String(f.activation.toSeq),
        "--idempotency-key",
        "child-convert",
      ]),
    );
    const assigned = WorkerTaskMutationResponseSchema.parse(
      await invoke([
        "task-assign",
        "--task-id",
        converted.task.taskId,
        "--assignee",
        f.helper.principal.principalId,
        "--based-on-room-seq",
        String(converted.event.roomSeq),
        "--idempotency-key",
        "child-assign",
      ]),
    );
    const cleared = WorkerTaskMutationResponseSchema.parse(
      await invoke([
        "task-assign",
        "--task-id",
        converted.task.taskId,
        "--unassign",
        "--based-on-room-seq",
        String(assigned.event.roomSeq),
        "--idempotency-key",
        "child-clear",
      ]),
    );
    assert.equal(cleared.task.state, "todo");
    assert.equal(cleared.task.claimedBy, undefined);
    assert.equal(cleared.task.assigneeId, undefined);
    const history = await invoke([
      "task-history",
      "--task-id",
      converted.task.taskId,
    ]);
    assert.deepEqual(
      history.events.map((event: { type: string }) => event.type),
      ["task.unassigned", "task.assigned", "task.created"],
    );
    const current = f.kernel.getTask(f.actor, {
      roomId: f.room.roomId,
      taskId: converted.task.taskId,
    });
    assert.equal(current.threadId, converted.task.threadId);
    assert.equal(current.sourceMessageId, f.source.event.aggregateId);
    assert.equal(
      Number(
        f.database
          .prepare("SELECT COUNT(*) AS n FROM tasks WHERE source_message_id=?")
          .get(f.source.event.aggregateId)!.n,
      ),
      1,
    );
  } finally {
    await f.close();
  }
});

test("attachment-only conversion is a clear conflict and commits no Task or event", async () => {
  const f = await fixture({ attachmentOnly: true });
  try {
    const before = Number(
      f.database.prepare("SELECT COUNT(*) AS n FROM tasks").get()!.n,
    );
    const response = await f.call("tasks/convert", {
      messageId: f.source.event.aggregateId,
      basedOnRoomSeq: f.activation.toSeq,
      idempotencyKey: "attachment-convert",
    });
    assert.equal(
      Number(f.database.prepare("SELECT COUNT(*) AS n FROM tasks").get()!.n),
      before,
    );
    assert.equal(
      f.database
        .prepare(
          "SELECT 1 FROM room_events WHERE idempotency_key='attachment-convert'",
        )
        .get(),
      undefined,
    );
    assert.equal(response.status, 409, JSON.stringify(response.body));
  } finally {
    await f.close();
  }
});

test("assignment conflicts with a legacy secondary role and leaves its owner and roles intact", async () => {
  const f = await fixture({ legacyRoles: true });
  try {
    const request = {
      taskId: f.legacy!.task.taskId,
      assigneeId: f.helper.principal.principalId,
      basedOnRoomSeq: f.activation.toSeq,
      idempotencyKey: "role-overlap",
    };
    const assigned = await f.call("tasks/assign", request);
    assert.equal(assigned.status, 409, JSON.stringify(assigned.body));
    const current = f.kernel.getTask(f.actor, {
      roomId: f.room.roomId,
      taskId: f.legacy!.task.taskId,
    });
    assert.equal(current.assigneeId, f.agent.principal.principalId);
    assert.deepEqual(current.reviewerIds, [f.helper.principal.principalId]);
    assert.equal(
      f.database
        .prepare(
          "SELECT 1 FROM room_events WHERE idempotency_key='role-overlap'",
        )
        .get(),
      undefined,
    );
  } finally {
    await f.close();
  }
});

test("Worker resumes only its own delivered blocked Task and leaves claim to the next Activation", async () => {
  const f = await fixture({ blocked: true });
  try {
    const input = {
      taskId: f.humanTask.task.taskId,
      basedOnRoomSeq: f.activation.toSeq,
      idempotencyKey: "unblock",
    };
    const result = await f.call("tasks/unblock", input);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    const event = (
      result.body as { event: { eventId: string; roomSeq: number } }
    ).event;
    assert.equal(
      f.kernel.listTasks(f.actor, { roomId: f.room.roomId })[0]!.state,
      "todo",
    );
    assert.equal((await f.call("tasks/unblock", input)).status, 200);
    assert.equal(
      f.database
        .prepare(
          "SELECT COUNT(*) AS n FROM room_events WHERE type='task.unblocked'",
        )
        .get()!.n,
      1,
    );
    assert.equal(
      (
        await f.call("tasks/unblock", {
          ...input,
          actorId: f.actor.principalId,
        })
      ).status,
      400,
    );
    // The historical task.created was not delivered; task.unblocked belongs to the next Activation.
    assert.equal(
      (
        await f.call("tasks/claim", {
          ...input,
          idempotencyKey: "too-soon",
          basedOnRoomSeq: event.roomSeq,
        })
      ).status,
      403,
    );
    f.credential.revoke();
    assert.equal((await f.call("tasks/unblock", input)).status, 401);
  } finally {
    await f.close();
  }
});

test("Worker unblock refuses foreign blockers, ownership changes, stale facts, dependencies and pending input", async () => {
  for (const kind of [
    "blocker",
    "owner",
    "future-block",
    "dependency",
    "input",
    "stale",
    "membership",
  ] as const) {
    const f = await fixture({ blocked: true });
    try {
      const taskId = f.humanTask.task.taskId;
      if (kind === "blocker")
        f.database
          .prepare(
            "UPDATE room_events SET actor_id=? WHERE event_id='fixture-blocked'",
          )
          .run(f.helper.principal.principalId);
      if (kind === "owner")
        f.database
          .prepare("UPDATE tasks SET assignee_id=? WHERE task_id=?")
          .run(f.helper.principal.principalId, taskId);
      if (kind === "future-block")
        f.database
          .prepare(
            "UPDATE room_events SET room_seq=? WHERE event_id='fixture-blocked'",
          )
          .run(f.activation.toSeq + 100);
      if (kind === "dependency") {
        const d = f.kernel.createTask(f.actor, {
          roomId: f.room.roomId,
          title: "dependency",
          collaboratorIds: [],
          reviewerIds: [],
          dependencyTaskIds: [],
          basedOnRoomSeq: Number(
            f.database
              .prepare("SELECT next_seq-1 AS n FROM rooms WHERE room_id=?")
              .get(f.room.roomId)!.n,
          ),
          idempotencyKey: "dependency",
        });
        f.database
          .prepare(
            "INSERT INTO task_dependencies(task_id,dependency_task_id,created_at) VALUES(?,?,?)",
          )
          .run(taskId, d.task.taskId, new Date().toISOString());
      }
      if (kind === "input")
        f.database
          .prepare(
            "INSERT INTO input_requests(input_request_id,room_id,task_id,requester_id,responder_id,question,state,created_at,updated_at) VALUES('input',?,?,?,?,?,'pending',?,?)",
          )
          .run(
            f.room.roomId,
            taskId,
            f.agent.principal.principalId,
            f.actor.principalId,
            "Question",
            new Date().toISOString(),
            new Date().toISOString(),
          );
      if (kind === "stale")
        f.kernel.postMessage(f.actor, {
          roomId: f.room.roomId,
          body: "Updated requirement",
          recipients: [
            { participantId: f.agent.principal.principalId, reason: "mention" },
          ],
          idempotencyKey: "new",
        });
      if (kind === "membership")
        f.database
          .prepare("DELETE FROM memberships WHERE room_id=? AND principal_id=?")
          .run(f.room.roomId, f.agent.principal.principalId);
      const result = await f.call("tasks/unblock", {
        taskId,
        basedOnRoomSeq: f.activation.toSeq,
        idempotencyKey: "unblock",
      });
      assert.equal(
        result.status,
        ["blocker", "owner", "future-block", "membership"].includes(kind)
          ? 403
          : 409,
        kind + JSON.stringify(result.body),
      );
      assert.equal(
        f.database
          .prepare("SELECT state FROM tasks WHERE task_id=?")
          .get(taskId)!.state,
        "blocked",
      );
      assert.equal(
        f.database
          .prepare(
            "SELECT COUNT(*) AS n FROM room_events WHERE type='task.unblocked'",
          )
          .get()!.n,
        0,
      );
    } finally {
      await f.close();
    }
  }
});
