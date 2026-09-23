import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { RoomKernel } from "../src/index.ts";

function fixture(t: test.TestContext) {
  const directory = mkdtempSync(join(tmpdir(), "rah-runtime-notice-"));
  const kernel = new RoomKernel({ databasePath: join(directory, "room.db") });
  kernel.initialize();
  t.after(() => {
    kernel.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const human = kernel.provisionPrincipal({ handle: "human", kind: "human" });
  const agent = kernel.provisionPrincipal({ handle: "agent", kind: "agent" });
  const actor = kernel.authenticateAccessToken(human.accessToken);
  const room = kernel.createRoom(actor, { name: "A", slug: "a" });
  kernel.addMember(actor, {
    roomId: room.roomId,
    principalId: agent.principal.principalId,
  });
  let n = 0;
  const post = (roomId = room.roomId) =>
    kernel.postMessage(actor, {
      roomId,
      body: "new work",
      idempotencyKey: `message-${++n}`,
      recipients: [
        { participantId: agent.principal.principalId, reason: "mention" },
      ],
    });
  post();
  const host = kernel.authenticateHostAccessToken(
    kernel.provisionHostCredential({
      hostId: "host",
      participantIds: [agent.principal.principalId],
    }).accessToken,
  );
  kernel.heartbeatHost(host);
  const activation = kernel.leaseNextActivation(host, { leaseMs: 30000 });
  assert.ok(activation);
  const run = kernel.createRunAttempt(host, {
    activationId: activation.activationId,
  });
  const runtime = {
    runAttemptId: run.runAttemptId,
    runtimeRunId: "runtime",
    recoveryDescriptor: { driver: "fake", metadata: {}, recoveryKey: "key" },
  };
  kernel.prepareRunAttemptRuntime(host, runtime);
  kernel.markRunAttemptRunning(host, runtime);
  const input = {
    activationId: activation.activationId,
    runAttemptId: run.runAttemptId,
  };
  const execution = kernel.authorizeWorkerExecution(host, {
    activationId: activation.activationId,
    consumerId: "notice-test",
    hostId: host.hostId,
    participantId: agent.principal.principalId,
    roomId: room.roomId,
    runAttemptId: run.runAttemptId,
    toSeq: activation.toSeq,
  });
  return { kernel, actor, agent, room, post, host, input, execution };
}

test("pending runtime notice is bounded, target-specific and never acknowledges delivery", (t) => {
  const f = fixture(t);
  assert.equal(f.kernel.readPendingRuntimeNotice(f.host, f.input), undefined);
  const message = f.post();
  const before = f.kernel.listInbox(
    f.kernel.authenticateAccessToken(f.agent.accessToken),
    { roomId: f.room.roomId },
  );
  const notice = f.kernel.readPendingRuntimeNotice(f.host, f.input);
  assert.ok(notice);
  assert.match(notice.text, /#a/);
  assert.match(notice.text, /@human/);
  assert.ok(notice.text.includes(message.event.aggregateId));
  assert.match(notice.fingerprint, /^[a-f0-9]{64}$/);
  assert.deepEqual(f.kernel.readPendingRuntimeNotice(f.host, f.input), notice);
  assert.deepEqual(
    f.kernel.listInbox(f.kernel.authenticateAccessToken(f.agent.accessToken), {
      roomId: f.room.roomId,
    }),
    before,
  );
  const history = f.kernel.workerReads.history(f.execution, { channel: "#a" });
  assert.ok(
    history.messages.some((m) => m.messageId === message.event.aggregateId),
  );
  assert.equal(f.kernel.readPendingRuntimeNotice(f.host, f.input), undefined);
});

test("pending runtime notice rejects another Host and a mismatched Run", (t) => {
  const f = fixture(t);
  f.post();
  const other = f.kernel.authenticateHostAccessToken(
    f.kernel.provisionHostCredential({
      hostId: "other",
      participantIds: [f.agent.principal.principalId],
    }).accessToken,
  );
  f.kernel.heartbeatHost(other);
  assert.throws(
    () => f.kernel.readPendingRuntimeNotice(other, f.input),
    /valid lease/,
  );
  assert.throws(() =>
    f.kernel.readPendingRuntimeNotice(f.host, {
      ...f.input,
      runAttemptId: "wrong",
    }),
  );
});

test("cross-Room and separate Thread targets retain addresses and revoked membership hides them", (t) => {
  const f = fixture(t);
  const room = f.kernel.createRoom(f.actor, { name: "B", slug: "b" });
  f.kernel.addMember(f.actor, {
    roomId: room.roomId,
    principalId: f.agent.principal.principalId,
  });
  const root = f.post(room.roomId);
  const thread = f.kernel.createThread(f.actor, {
    roomId: room.roomId,
    rootMessageId: root.event.aggregateId,
    recipientIds: [],
    idempotencyKey: "thread",
    basedOnRoomSeq: root.event.roomSeq,
  }).thread;
  const reply = f.kernel.replyThread(f.actor, {
    roomId: room.roomId,
    threadId: thread.threadId,
    body: "thread reply",
    idempotencyKey: "reply",
    recipientIds: [f.agent.principal.principalId],
    basedOnRoomSeq: f.kernel.sync(f.actor, {
      roomId: room.roomId,
      consumerId: "test",
    }).latestRoomSeq,
  });
  const notice = f.kernel.readPendingRuntimeNotice(f.host, f.input);
  assert.ok(notice);
  assert.ok(notice.text.includes(`#b:${thread.threadId}`));
  assert.ok(notice.text.includes(reply.event.aggregateId));
  assert.match(notice.text, /2 changed targets/);
  const db = new DatabaseSync(f.kernel.databasePath);
  db.prepare("DELETE FROM memberships WHERE principal_id=? AND room_id=?").run(
    f.agent.principal.principalId,
    room.roomId,
  );
  assert.equal(f.kernel.readPendingRuntimeNotice(f.host, f.input), undefined);
  db.close();
});

test("many pending messages produce a bounded latest window and preserve the durable remainder", (t) => {
  const f = fixture(t);
  for (let i = 0; i < 25; i++) f.post();
  const latest = f.post();
  const notice = f.kernel.readPendingRuntimeNotice(f.host, f.input);
  assert.ok(notice);
  assert.match(notice.text, /20 unread messages shown \(more pending\)/);
  assert.ok(notice.text.includes(latest.event.aggregateId));
  assert.ok(Buffer.byteLength(notice.text) <= 4096);
  assert.ok(Buffer.byteLength(JSON.stringify(notice.text)) <= 5000);
  const inbox = f.kernel.listInbox(
    f.kernel.authenticateAccessToken(f.agent.accessToken),
    { roomId: f.room.roomId },
  );
  assert.equal(inbox.length, 27);
  assert.ok(inbox.every((item) => item.state === "pending"));
});

test("expired leases and finished attempts cannot obtain a runtime notice", (t) => {
  const f = fixture(t);
  f.post();
  const db = new DatabaseSync(f.kernel.databasePath);
  db.prepare(
    "UPDATE run_attempts SET state='exited' WHERE run_attempt_id=?",
  ).run(f.input.runAttemptId);
  assert.throws(
    () => f.kernel.readPendingRuntimeNotice(f.host, f.input),
    /current running attempt/,
  );
  db.prepare(
    "UPDATE run_attempts SET state='running' WHERE run_attempt_id=?",
  ).run(f.input.runAttemptId);
  db.prepare(
    "UPDATE activations SET lease_until_ms=0 WHERE activation_id=?",
  ).run(f.input.activationId);
  assert.throws(
    () => f.kernel.readPendingRuntimeNotice(f.host, f.input),
    /valid lease/,
  );
  db.close();
});

test("Direct Room notices use the peer handle and are readable by the running Worker", (t) => {
  const f = fixture(t);
  const workspace = f.kernel.createWorkspace(f.actor, {
    name: "W",
    slug: "w",
    idempotencyKey: "workspace",
  });
  f.kernel.addMember(f.actor, {
    roomId: workspace.controlRoom.roomId,
    principalId: f.agent.principal.principalId,
  });
  const dm = f.kernel.openDirectRoom(f.actor, {
    workspaceId: workspace.workspace.workspaceId,
    peerPrincipalId: f.agent.principal.principalId,
    basedOnControlRoomSeq: f.kernel.sync(f.actor, {
      roomId: workspace.controlRoom.roomId,
      consumerId: "dm-create",
    }).latestRoomSeq,
    idempotencyKey: "dm",
  });
  const message = f.post(dm.roomId);
  const notice = f.kernel.readPendingRuntimeNotice(f.host, f.input);
  assert.ok(notice);
  assert.match(notice.text, /dm:@human/);
  const history = f.kernel.workerReads.history(f.execution, {
    channel: "dm:@human",
  });
  assert.ok(
    history.messages.some((m) => m.messageId === message.event.aggregateId),
  );
  assert.equal(f.kernel.readPendingRuntimeNotice(f.host, f.input), undefined);
});

test("replaced Host generation cannot read pending notices", (t) => {
  const f = fixture(t);
  f.post();
  const db = new DatabaseSync(f.kernel.databasePath);
  db.prepare(
    "UPDATE agent_hosts SET instance_id='replacement' WHERE host_id=?",
  ).run(f.host.hostId);
  assert.throws(
    () => f.kernel.readPendingRuntimeNotice(f.host, f.input),
    /instance|generation|Host|host/,
  );
  db.close();
});

test("Room Stop suppresses pending notices before the next lease renewal", (t) => {
  const f = fixture(t);
  f.post();
  assert.ok(f.kernel.readPendingRuntimeNotice(f.host, f.input));
  const stopped = f.kernel.roomAgentSos.requestStop(f.actor, {
    basedOnRoomSeq: f.kernel.sync(f.actor, {
      roomId: f.room.roomId,
      consumerId: "stop-head",
    }).latestRoomSeq,
    idempotencyKey: "stop-runtime-notices",
    roomId: f.room.roomId,
  });
  assert.equal(stopped.operation.state, "stopping");
  assert.equal(stopped.operation.pendingTargetCount, 1);
  assert.equal(f.kernel.readPendingRuntimeNotice(f.host, f.input), undefined);
  assert.equal(
    f.kernel.listRunAttempts({ roomId: f.room.roomId })[0]?.state,
    "running",
  );
});

test("disabled Agent state prevents notices even while its execution lease is valid", (t) => {
  const f = fixture(t);
  f.post();
  assert.ok(f.kernel.readPendingRuntimeNotice(f.host, f.input));
  // This compatibility fixture predates AgentDefinition provisioning. Add its
  // authoritative state row directly to isolate this gate from Stop's separate
  // credential revocation, which would otherwise reject the Host first.
  const db = new DatabaseSync(f.kernel.databasePath);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO agent_definitions(agent_definition_id,participant_id,control_room_id,state,current_revision_id,created_at,updated_at) VALUES(?,?,?,'disabled',?,?,?)`,
  ).run(
    "notice-agent-definition",
    f.agent.principal.principalId,
    f.room.roomId,
    "notice-revision",
    now,
    now,
  );
  assert.throws(
    () => f.kernel.readPendingRuntimeNotice(f.host, f.input),
    /Agent .* is disabled/,
  );
  db.close();
});

test("successfully written event identities are excluded before the bounded Inbox window", (t) => {
  const f = fixture(t);
  const x = f.post();
  const first = f.kernel.readPendingRuntimeNotice(f.host, f.input);
  assert.ok(first);
  assert.deepEqual(first.eventIds, [x.event.eventId]);
  const y = f.post();
  const next = f.kernel.readPendingRuntimeNotice(f.host, {
    ...f.input,
    excludeEventIds: first.eventIds,
  });
  assert.ok(next);
  assert.deepEqual(next.eventIds, [y.event.eventId]);
  assert.ok(next.text.includes(y.event.aggregateId));
  assert.ok(!next.text.includes(x.event.aggregateId));
  const inbox = f.kernel.listInbox(
    f.kernel.authenticateAccessToken(f.agent.accessToken),
    { roomId: f.room.roomId },
  );
  assert.equal(inbox.filter((i) => i.state === "pending").length, 3);
});

test("runtime notice rejects oversized or invalid transient identity exclusions", (t) => {
  const f = fixture(t);
  f.post();
  assert.throws(
    () =>
      f.kernel.readPendingRuntimeNotice(f.host, {
        ...f.input,
        excludeEventIds: Array.from({ length: 257 }, (_, i) => `event-${i}`),
      }),
    /excludeEventIds/,
  );
  assert.throws(
    () =>
      f.kernel.readPendingRuntimeNotice(f.host, {
        ...f.input,
        excludeEventIds: ["x".repeat(201)],
      }),
    /excludeEventIds/,
  );
  assert.throws(
    () =>
      f.kernel.readPendingRuntimeNotice(f.host, {
        ...f.input,
        excludeEventIds: [""],
      }),
    /excludeEventIds/,
  );
});

test("excluding a full notice window exposes older pending identities instead of starving them", (t) => {
  const f = fixture(t);
  for (let i = 0; i < 25; i++) f.post();
  const first = f.kernel.readPendingRuntimeNotice(f.host, f.input);
  assert.ok(first);
  assert.equal(first.eventIds.length, 20);
  const next = f.kernel.readPendingRuntimeNotice(f.host, {
    ...f.input,
    excludeEventIds: first.eventIds,
  });
  assert.ok(next);
  assert.equal(next.eventIds.length, 5);
  assert.ok(next.eventIds.every((id) => !first.eventIds.includes(id)));
});

test("a bounded read suppresses only shown messages and preserves an earlier unanswered Human request", (t) => {
  const f = fixture(t);
  const first = f.post();
  const last = f.post();
  const page = f.kernel.workerReads.history(f.execution, {
    channel: "#a",
    after: first.event.aggregateId,
    limit: 1,
  });
  assert.equal(page.messages.length, 1);
  assert.equal(page.messages[0]!.messageId, last.event.aggregateId);
  const notice = f.kernel.readPendingRuntimeNotice(f.host, f.input);
  assert.ok(notice);
  assert.ok(notice.eventIds.includes(first.event.eventId));
  assert.ok(!notice.eventIds.includes(last.event.eventId));
});

test("a bounded hold does not suppress the older messages omitted from its context", (t) => {
  const f = fixture(t);
  const first = f.post();
  for (let i = 0; i < 24; i++) f.post();
  const held = f.kernel.postWorkerMessage(f.execution, {
    body: "reply from the original request",
  });
  assert.ok("state" in held);
  assert.equal(held.state, "held");
  if (held.state !== "held") throw new Error("expected a held draft");
  assert.equal(held.newerMessages.length, 20);
  const notice = f.kernel.readPendingRuntimeNotice(f.host, f.input);
  assert.ok(notice);
  assert.ok(notice.eventIds.includes(first.event.eventId));
  assert.equal(notice.eventIds.length, 5);
});
