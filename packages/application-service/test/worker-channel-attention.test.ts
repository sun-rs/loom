import { allowsAgentChannelAttention } from "../../kernel/src/agent-channel-attention.ts";
import { request as httpRequest } from "node:http";
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { RoomKernel } from "@rah-os/kernel";
import { WorkerApplicationService } from "../src/index.ts";

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "rah-mute-")),
    path = join(directory, "room.db");
  const kernel = new RoomKernel({ databasePath: path });
  kernel.initialize();
  const human = kernel.provisionPrincipal({ kind: "human", handle: "human" }),
    agent = kernel.provisionPrincipal({ kind: "agent", handle: "quiet" }),
    other = kernel.provisionPrincipal({ kind: "agent", handle: "other" });
  const actor = kernel.authenticateAccessToken(human.accessToken),
    room = kernel.createRoom(actor, { name: "Channel", slug: "channel" });
  for (const id of [agent.principal.principalId, other.principal.principalId])
    kernel.addMember(actor, { roomId: room.roomId, principalId: id });
  kernel.postRoomMessage(actor, {
    roomId: room.roomId,
    body: "Begin",
    idempotencyKey: "begin",
    recipients: [
      { participantId: agent.principal.principalId, reason: "mention" },
    ],
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
    runtimeRunId: "fake",
    recoveryDescriptor: { driver: "fake", recoveryKey: "mute", metadata: {} },
  };
  kernel.prepareRunAttemptRuntime(host, runtime);
  kernel.markRunAttemptRunning(host, runtime);
  const service = new WorkerApplicationService({ kernel });
  await service.start();
  const credential = service.issueActivationCredential(host, {
    activationId: activation.activationId,
    consumerId: "mute-test",
    hostId: host.hostId,
    participantId: agent.principal.principalId,
    roomId: room.roomId,
    runAttemptId: run.runAttemptId,
    toSeq: activation.toSeq,
  });
  const call = async (path: string, body: unknown = {}) => {
    const r = await fetch(`${service.origin}/v1/worker/${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${credential.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    return { status: r.status, body: (await r.json()) as any };
  };
  await call("sync");
  const db = new DatabaseSync(path),
    token = join(directory, "token");
  writeFileSync(token, credential.accessToken, { mode: 0o600 });
  const cli = async (args: string[]) =>
    promisify(execFile)(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import {runWorkerCliCommand} from ${JSON.stringify(new URL("../../agent-host/src/worker-cli.ts", import.meta.url).href)};process.exitCode=await runWorkerCliCommand(process.argv.slice(1));`,
        "worker",
        ...args,
      ],
      {
        env: {
          ...process.env,
          RAH_WORKER_API_URL: service.origin!,
          RAH_WORKER_SESSION_FILE: token,
        },
        timeout: 20000,
      },
    );
  const latest = () =>
    Number(
      db
        .prepare("SELECT next_seq-1 AS n FROM rooms WHERE room_id=?")
        .get(room.roomId)!.n,
    );
  const delivered = (
    eventId: string,
    participantId = agent.principal.principalId,
  ) =>
    db
      .prepare(
        "SELECT * FROM inbox_items WHERE event_id=? AND participant_id=?",
      )
      .get(eventId, participantId);
  const post = (key: string, mention = false) =>
    kernel.postRoomMessage(actor, {
      roomId: room.roomId,
      body: mention ? "@quiet please reply" : "ordinary news",
      idempotencyKey: key,
      recipients: mention
        ? [{ participantId: agent.principal.principalId, reason: "mention" }]
        : [],
      basedOnRoomSeq: latest(),
    });
  let handlesClosed = false;
  const closeHandles = async () => {
    if (handlesClosed) return;
    handlesClosed = true;
    await service.close();
    db.close();
    kernel.close();
  };
  return {
    directory,
    path,
    kernel,
    db,
    human,
    actor,
    agent,
    other,
    room,
    activation,
    run,
    host,
    runtime,
    service,
    credential,
    call,
    cli,
    latest,
    delivered,
    post,
    closeHandles,
    async close() {
      await closeHandles();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

test("Agent self mute suppresses ordinary future Channel delivery, preserves mentions/others and resumes on unmute without stopping Run", async () => {
  const f = await fixture();
  try {
    const command = {
      basedOnRoomSeq: f.activation.toSeq,
      idempotencyKey: "mute",
    };
    const muted = await f.call("channels/mute", command);
    assert.equal(muted.status, 200, JSON.stringify(muted.body));
    assert.equal(muted.body.activityMuted, true);
    const ordinary = f.post("ordinary");
    assert.equal(f.delivered(ordinary.event.eventId), undefined);
    assert.ok(
      f.delivered(ordinary.event.eventId, f.other.principal.principalId),
    );
    assert.ok(f.delivered(f.post("mention", true).event.eventId));
    assert.equal(
      (await f.call("channels/mute", command)).body.event.eventId,
      muted.body.event.eventId,
    );
    assert.equal((await f.call("channels/unmute", command)).status, 409);
    assert.equal(
      (await f.call("channels/unmute", { ...command, idempotencyKey: "stale" }))
        .status,
      409,
    );
    // Raft's `channel mute|unmute` acknowledges in text
    // (`formatChannelMuteResult`, `main.js@30113763`).
    const unmuted = await f.cli([
      "channel-unmute",
      "--based-on-room-seq",
      String(muted.body.event.roomSeq),
      "--idempotency-key",
      "unmute",
    ]);
    assert.match(unmuted.stdout, /^Activity muted: no$/mu, unmuted.stderr);
    assert.ok(f.delivered(f.post("resumed").event.eventId));
    assert.equal(f.delivered(ordinary.event.eventId), undefined);
    const replay = await f.call("channels/mute", command);
    assert.equal(replay.body.deduplicated, true);
    assert.equal(replay.body.activityMuted, false);
    assert.equal(
      f.db
        .prepare("SELECT state FROM run_attempts WHERE run_attempt_id=?")
        .get(f.run.runAttemptId)!.state,
      "running",
    );
  } finally {
    await f.close();
  }
});

test("Channel mute leaves followed Thread delivery and directly assigned Task responsibility independent, but filters open Task news", async () => {
  const f = await fixture();
  try {
    const root = f.post("thread-root");
    const thread = f.kernel.createThread(f.actor, {
      roomId: f.room.roomId,
      rootMessageId: root.event.aggregateId,
      recipientIds: [f.agent.principal.principalId],
      basedOnRoomSeq: f.latest(),
      idempotencyKey: "thread",
    });
    const mute = await f.call("channels/mute", {
      basedOnRoomSeq: f.activation.toSeq,
      idempotencyKey: "mute",
    });
    assert.equal(mute.status, 200, JSON.stringify(mute.body));
    const reply = f.kernel.replyThread(f.actor, {
      roomId: f.room.roomId,
      threadId: thread.thread.threadId,
      body: "ordinary followed reply",
      recipientIds: [],
      basedOnRoomSeq: f.latest(),
      idempotencyKey: "reply",
    });
    assert.ok(f.delivered(reply.event.eventId));
    const open = f.kernel.createTask(f.actor, {
      roomId: f.room.roomId,
      title: "Open task",
      collaboratorIds: [],
      reviewerIds: [],
      dependencyTaskIds: [],
      idempotencyKey: "open",
    });
    assert.equal(f.delivered(open.event.eventId), undefined);
    const mentioned = f.kernel.createTask(f.actor, {
      roomId: f.room.roomId,
      title: "@quiet requested work",
      collaboratorIds: [],
      reviewerIds: [],
      dependencyTaskIds: [],
      idempotencyKey: "mentioned-task",
    });
    assert.ok(f.delivered(mentioned.event.eventId));
    const assigned = f.kernel.createTask(f.actor, {
      roomId: f.room.roomId,
      title: "Assigned task",
      assigneeId: f.agent.principal.principalId,
      collaboratorIds: [],
      reviewerIds: [],
      dependencyTaskIds: [],
      idempotencyKey: "assigned",
    });
    assert.ok(f.delivered(assigned.event.eventId));
    const amended = f.kernel.taskAmendments.human(f.actor, {
      taskId: assigned.task.taskId,
      title: "Ordinary card change",
      basedOnRoomSeq: f.latest(),
      idempotencyKey: "amend",
    });
    assert.equal(f.delivered(amended.event.eventId), undefined);
    const unfollow = await f.call("threads/unfollow", {
      threadId: thread.thread.threadId,
      basedOnRoomSeq: f.activation.toSeq,
      idempotencyKey: "unfollow",
    });
    assert.equal(unfollow.status, 200, JSON.stringify(unfollow.body));
    const quietReply = f.kernel.replyThread(f.actor, {
      roomId: f.room.roomId,
      threadId: thread.thread.threadId,
      body: "after unfollow",
      recipientIds: [],
      basedOnRoomSeq: f.latest(),
      idempotencyKey: "quiet-reply",
    });
    assert.equal(f.delivered(quietReply.event.eventId), undefined);
    const exactReply = f.kernel.replyThread(f.actor, {
      roomId: f.room.roomId,
      threadId: thread.thread.threadId,
      body: "@quiet please review",
      recipientIds: [f.agent.principal.principalId],
      basedOnRoomSeq: f.latest(),
      idempotencyKey: "mention-reply",
    });
    assert.ok(f.delivered(exactReply.event.eventId));
  } finally {
    await f.close();
  }
});

test("Channel mute is durable across Kernel reopen and rejects forged target, revoked bearer and departed membership", async () => {
  const f = await fixture();
  try {
    const command = {
      basedOnRoomSeq: f.activation.toSeq,
      idempotencyKey: "mute",
    };
    assert.equal(
      (
        await f.call("channels/mute", {
          ...command,
          participantId: f.other.principal.principalId,
        })
      ).status,
      400,
    );
    assert.equal(
      (await f.call("channels/mute", { ...command, roomId: "other-room" }))
        .status,
      400,
    );
    const mute = await f.call("channels/mute", command);
    assert.equal(mute.status, 200, JSON.stringify(mute.body));
    const reopened = new RoomKernel({ databasePath: f.path });
    reopened.initialize();
    try {
      const result = reopened.postRoomMessage(
        reopened.authenticateAccessToken(f.human.accessToken),
        {
          roomId: f.room.roomId,
          body: "after restart",
          recipients: [],
          basedOnRoomSeq: f.latest(),
          idempotencyKey: "after-restart",
        },
      );
      assert.equal(f.delivered(result.event.eventId), undefined);
    } finally {
      reopened.close();
    }
    f.db
      .prepare("DELETE FROM memberships WHERE room_id=? AND principal_id=?")
      .run(f.room.roomId, f.agent.principal.principalId);
    assert.equal((await f.call("channels/mute", command)).status, 403);
    f.credential.revoke();
    assert.equal(
      (
        await f.call("channels/unmute", {
          basedOnRoomSeq: mute.body.event.roomSeq,
          idempotencyKey: "revoked",
        })
      ).status,
      401,
    );
  } finally {
    await f.close();
  }
});

test("Muted Channel does not affect canonical DM, Human settings, or typed completion responsibilities", async () => {
  const f = await fixture();
  try {
    const prefs = f.db.prepare("SELECT * FROM human_sidebar_preferences").all();
    const mute = await f.cli([
      "channel-mute",
      "--based-on-room-seq",
      String(f.activation.toSeq),
      "--idempotency-key",
      "mute",
    ]);
    assert.match(mute.stdout, /^Activity muted: yes$/mu, mute.stderr);
    assert.deepEqual(
      f.db.prepare("SELECT * FROM human_sidebar_preferences").all(),
      prefs,
    );
    const workspace = f.kernel.createWorkspace(f.actor, {
      name: "DM scope",
      slug: "dm-scope",
      idempotencyKey: "ws",
    });
    f.kernel.addMember(f.actor, {
      roomId: workspace.controlRoom.roomId,
      principalId: f.agent.principal.principalId,
    });
    const direct = f.kernel.openDirectRoom(f.actor, {
      workspaceId: workspace.workspace.workspaceId,
      peerPrincipalId: f.agent.principal.principalId,
      basedOnControlRoomSeq: f.kernel.sync(f.actor, {
        roomId: workspace.controlRoom.roomId,
        consumerId: "dm-head",
      }).latestRoomSeq,
      idempotencyKey: "dm",
    });
    const dm = f.kernel.postRoomMessage(f.actor, {
      roomId: direct.roomId,
      body: "Direct request",
      recipients: [],
      idempotencyKey: "dm-message",
    });
    assert.ok(f.delivered(dm.event.eventId));
    const task = f.kernel.createTask(f.actor, {
      roomId: f.room.roomId,
      title: "Assigned",
      assigneeId: f.agent.principal.principalId,
      collaboratorIds: [],
      reviewerIds: [],
      dependencyTaskIds: [],
      idempotencyKey: "assigned",
    });
    const event = {
      ...task.event,
      payload: { readyTaskIds: [task.task.taskId] },
    };
    const recipient = {
      participantId: f.agent.principal.principalId,
      reason: "dependency_resolved" as const,
    };
    assert.equal(allowsAgentChannelAttention(f.db, event, recipient), true);
    assert.equal(
      allowsAgentChannelAttention(
        f.db,
        { ...event, payload: { readyTaskIds: [] } },
        recipient,
      ),
      false,
    );
    for (const reason of [
      "room_policy",
      "task_available",
      "task_updated",
    ] as const)
      assert.equal(
        allowsAgentChannelAttention(
          f.db,
          { ...event, payload: {} },
          { ...recipient, reason },
        ),
        false,
      );
    assert.equal(
      allowsAgentChannelAttention(f.db, event, {
        ...recipient,
        reason: "input_resolved",
      }),
      true,
    );
    assert.equal(
      allowsAgentChannelAttention(f.db, event, {
        ...recipient,
        reason: "task_updated",
        obligations: [
          { kind: "task_owner_follow_up", taskId: task.task.taskId },
        ],
      }),
      true,
    );
    assert.equal(
      allowsAgentChannelAttention(f.db, event, {
        ...recipient,
        reason: "task_review",
        obligations: [
          {
            kind: "task_review",
            taskId: task.task.taskId,
            submissionId: "canonical-submission",
          },
        ],
      }),
      true,
    );
  } finally {
    await f.close();
  }
});

test("Mute upload rechecks bearer and membership after awaited JSON, with no partial preference/event mutation", async () => {
  for (const mode of ["bearer", "membership"] as const) {
    const f = await fixture();
    try {
      const before = f.db
        .prepare("SELECT COUNT(*) AS n FROM room_events")
        .get()!.n;
      const body = JSON.stringify({
        basedOnRoomSeq: f.activation.toSeq,
        idempotencyKey: "during-upload",
      });
      let request!: ReturnType<typeof httpRequest>;
      const continued = Promise.withResolvers<void>();
      const response = new Promise<{
        status: number | undefined;
        body: string;
      }>((resolve, reject) => {
        request = httpRequest(
          `${f.service.origin}/v1/worker/channels/mute`,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${f.credential.accessToken}`,
              "content-type": "application/json",
              expect: "100-continue",
            },
          },
          (r) => {
            let value = "";
            r.on("data", (c) => (value += String(c)));
            r.on("end", () => resolve({ status: r.statusCode, body: value }));
          },
        );
        request.on("error", reject);
        request.on("continue", () => continued.resolve());
      });
      request.flushHeaders();
      await continued.promise;
      request.write(body.slice(0, 10));
      if (mode === "bearer") f.credential.revoke();
      else
        f.db
          .prepare("DELETE FROM memberships WHERE room_id=? AND principal_id=?")
          .run(f.room.roomId, f.agent.principal.principalId);
      request.end(body.slice(10));
      const result = await response;
      assert.equal(result.status, mode === "bearer" ? 401 : 403, result.body);
      assert.equal(
        f.db.prepare("SELECT COUNT(*) AS n FROM room_events").get()!.n,
        before,
      );
      assert.equal(
        f.db.prepare("SELECT COUNT(*) AS n FROM agent_channel_attention").get()!
          .n,
        0,
      );
    } finally {
      await f.close();
    }
  }
});

test("Channel mute survives closing every database owner and reopening, without reconstructing accepted attention", async () => {
  const f = await fixture();
  try {
    const muted = await f.call("channels/mute", {
      basedOnRoomSeq: f.activation.toSeq,
      idempotencyKey: "persistent-mute",
    });
    assert.equal(muted.status, 200);
    const latest = f.latest();
    const previouslyAccepted = f.db
      .prepare(
        "SELECT inbox_item_id FROM inbox_items WHERE participant_id=? ORDER BY inbox_item_id",
      )
      .all(f.agent.principal.principalId);
    await f.closeHandles();
    const reopened = new RoomKernel({ databasePath: f.path });
    reopened.initialize();
    const db = new DatabaseSync(f.path);
    try {
      const posted = reopened.postRoomMessage(
        reopened.authenticateAccessToken(f.human.accessToken),
        {
          roomId: f.room.roomId,
          body: "ordinary after physical reopen",
          basedOnRoomSeq: latest,
          idempotencyKey: "reopened-news",
          recipients: [],
        },
      );
      assert.equal(
        db
          .prepare(
            "SELECT 1 FROM inbox_items WHERE event_id=? AND participant_id=?",
          )
          .get(posted.event.eventId, f.agent.principal.principalId),
        undefined,
      );
      assert.deepEqual(
        db
          .prepare(
            "SELECT inbox_item_id FROM inbox_items WHERE participant_id=? ORDER BY inbox_item_id",
          )
          .all(f.agent.principal.principalId),
        previouslyAccepted,
      );
      assert.equal(
        db
          .prepare(
            "SELECT activity_muted FROM agent_channel_attention WHERE participant_id=? AND room_id=?",
          )
          .get(f.agent.principal.principalId, f.room.roomId)!.activity_muted,
        1,
      );
    } finally {
      db.close();
      reopened.close();
    }
  } finally {
    await f.close();
  }
});

test("Channel mute retains archive guard and atomic event/projection/outbox rollback", async () => {
  const f = await fixture();
  try {
    const counts = () =>
      ["room_events", "outbox", "agent_channel_attention"].map(
        (table) => f.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n,
      );
    const before = counts();
    const previousHead = f.latest();
    const command = {
      basedOnRoomSeq: f.activation.toSeq,
      idempotencyKey: "atomic-mute",
    };
    f.db
      .prepare("UPDATE rooms SET archived_at=? WHERE room_id=?")
      .run(new Date().toISOString(), f.room.roomId);
    assert.equal((await f.call("channels/mute", command)).status, 409);
    assert.deepEqual(counts(), before);
    f.db
      .prepare("UPDATE rooms SET archived_at=NULL WHERE room_id=?")
      .run(f.room.roomId);
    f.db.exec(
      "CREATE TRIGGER fail_mute_projection BEFORE INSERT ON agent_channel_attention BEGIN SELECT RAISE(ABORT,'test projection write failure'); END;",
    );
    assert.equal((await f.call("channels/mute", command)).status, 500);
    assert.deepEqual(counts(), before);
    assert.equal(f.latest(), previousHead);
    f.db.exec("DROP TRIGGER fail_mute_projection");
    const result = await f.call("channels/mute", command);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.deduplicated, false);
    assert.equal(result.body.event.roomSeq, previousHead + 1);
    assert.equal(
      f.db
        .prepare(
          "SELECT COUNT(*) AS n FROM room_events WHERE idempotency_key='atomic-mute'",
        )
        .get()!.n,
      1,
    );
    assert.equal(
      (await f.call("channels/mute", command)).body.deduplicated,
      true,
    );
  } finally {
    await f.close();
  }
});

test("targeted mute uses joined Channel context, preserves origin authority and reauthenticates replay", async () => {
  const f = await fixture();
  try {
    const target = f.kernel.createRoom(f.actor, {
      name: "Second",
      slug: "second",
    });
    for (const principalId of [
      f.agent.principal.principalId,
      f.other.principal.principalId,
    ])
      f.kernel.addMember(f.actor, { roomId: target.roomId, principalId });
    // Make target sequence values distinct from origin delivery so an accidental
    // grant cursor merge cannot hide behind coincidentally equal integers.
    for (let i = 0; i < 10; i++)
      f.kernel.postRoomMessage(f.actor, {
        roomId: target.roomId,
        body: `earlier ${i}`,
        recipients: [],
        idempotencyKey: `earlier-${i}`,
      });
    const originalHead = f.latest();
    const context = await f.call("rooms/read", { channel: "#second" });
    assert.equal(context.status, 200);
    const command = {
      channel: "#second",
      contextReceipt: context.body.contextReceipt,
      basedOnRoomSeq: context.body.throughRoomSeq,
      idempotencyKey: "target-mute",
    };
    const muted = await f.call("channels/mute", command);
    assert.equal(muted.status, 200, JSON.stringify(muted.body));
    assert.equal(muted.body.roomId, target.roomId);
    assert.equal(f.latest(), originalHead);
    assert.equal(
      (await f.call("acknowledge", { throughSeq: muted.body.event.roomSeq }))
        .status,
      409,
    );
    assert.equal(
      (
        await f.call("messages/post", {
          body: "must not use target cursor in origin",
          threadId: null,
          basedOnRoomSeq: muted.body.event.roomSeq,
          idempotencyKey: "no-origin-authority",
        })
      ).status,
      409,
    );
    assert.equal(f.latest(), originalHead);
    const news = f.kernel.postRoomMessage(f.actor, {
      roomId: target.roomId,
      body: "News",
      recipients: [],
      idempotencyKey: "target-news",
      basedOnRoomSeq: muted.body.event.roomSeq,
    });
    assert.equal(f.delivered(news.event.eventId), undefined);
    assert.ok(f.delivered(news.event.eventId, f.other.principal.principalId));
    assert.ok(f.delivered(f.post("origin-still-enabled").event.eventId));
    assert.equal(
      (await f.call("channels/mute", command)).body.event.eventId,
      muted.body.event.eventId,
    );
    assert.equal(
      (
        await f.call("channels/unmute", {
          ...command,
          idempotencyKey: "stale-target",
        })
      ).status,
      409,
    );
    const fresh = await f.call("rooms/read", { channel: "#second" });
    const unmuted = await f.cli([
      "channel-unmute",
      "--target",
      "#second",
      "--context-receipt",
      fresh.body.contextReceipt,
      "--based-on-room-seq",
      String(fresh.body.throughRoomSeq),
      "--idempotency-key",
      "target-unmute",
    ]);
    assert.match(unmuted.stdout, /^Unmuted #second\.$/mu, unmuted.stderr);
    assert.match(unmuted.stdout, /^Activity muted: no$/mu);
    const next = f.kernel.postRoomMessage(f.actor, {
      roomId: target.roomId,
      body: "Resumed",
      recipients: [],
      idempotencyKey: "resumed-target",
      basedOnRoomSeq: Number(
        f.db
          .prepare("SELECT next_seq-1 AS n FROM rooms WHERE room_id=?")
          .get(target.roomId)!.n,
      ),
    });
    assert.ok(f.delivered(next.event.eventId));
    // Simulate a revoked membership at the authority boundary. Public leave
    // correctly refuses queued follow-up work and is tested separately.
    f.db
      .prepare("DELETE FROM memberships WHERE room_id=? AND principal_id=?")
      .run(target.roomId, f.agent.principal.principalId);
    assert.notEqual((await f.call("channels/mute", command)).status, 200);
  } finally {
    await f.close();
  }
});

test("targeted mute rejects forged, missing, foreign Room and Thread context without a partial setting", async () => {
  const f = await fixture();
  try {
    const second = f.kernel.createRoom(f.actor, {
      name: "Second",
      slug: "second",
    });
    f.kernel.addMember(f.actor, {
      roomId: second.roomId,
      principalId: f.agent.principal.principalId,
    });
    const third = f.kernel.createRoom(f.actor, {
      name: "Third",
      slug: "third",
    });
    f.kernel.addMember(f.actor, {
      roomId: third.roomId,
      principalId: f.agent.principal.principalId,
    });
    const context = (await f.call("rooms/read", { channel: "#second" })).body;
    const command = {
      channel: "#second",
      contextReceipt: context.contextReceipt,
      basedOnRoomSeq: context.throughRoomSeq,
      idempotencyKey: "deny",
    };
    // A target no longer needs a receipt — Raft's `channel mute --target` is
    // the minimal form, covered in worker-minimal-commands.test.ts. What a
    // PRESENTED receipt must still do is fail when it is forged, tampered with,
    // issued for another Room, or points at a Thread.
    for (const input of [
      {
        ...command,
        contextReceipt: command.contextReceipt.slice(0, -8) + "tampered",
      },
      { ...command, channel: "#third" },
      { ...command, channel: "#not-joined" },
    ])
      assert.notEqual((await f.call("channels/mute", input)).status, 200);
    const parent = f.kernel.postRoomMessage(f.actor, {
      roomId: second.roomId,
      body: "Thread",
      recipients: [],
      idempotencyKey: "root",
    });
    const thread = f.kernel.createThread(f.actor, {
      roomId: second.roomId,
      rootMessageId: parent.event.aggregateId,
      recipientIds: [],
      idempotencyKey: "thread",
      basedOnRoomSeq: parent.event.roomSeq,
    });
    const target = `#second:${thread.thread.threadId}`;
    const threaded = (await f.call("rooms/read", { channel: target })).body;
    assert.notEqual(
      (
        await f.call("channels/mute", {
          ...command,
          channel: target,
          contextReceipt: threaded.contextReceipt,
          basedOnRoomSeq: threaded.throughRoomSeq,
        })
      ).status,
      200,
    );
    assert.equal(
      f.db.prepare("SELECT count(*) AS n FROM agent_channel_attention").get()!
        .n,
      0,
    );
  } finally {
    await f.close();
  }
});
