import assert from "node:assert/strict";
import test from "node:test";

import { decideMemoryAccess } from "../src/channel-memory-access.ts";
import {
  roleInstanceFixture,
  startInstanceRun,
  type RoleInstanceFixture,
} from "./role-instance-fixture.ts";

// evo S6 batch A: channel-scoped platform memory in the Kernel. Fake Host,
// temporary database; every assertion reads the durable Kernel state or the
// authenticated facade result, never model prose.

const entry = (name: string, body = `body of ${name}`) => ({
  name,
  type: "project" as const,
  description: `what ${name} is about`,
  body,
  idempotencyKey: `write-${name}`,
});

function startTurn(
  f: RoleInstanceFixture,
  roomId: string,
  participantId = f.instance.instanceId,
) {
  f.kernel.postMessage(f.actor, {
    roomId,
    body: "turn",
    idempotencyKey: `turn-${String(Math.random())}`,
    recipients: [{ participantId, reason: "mention" }],
  });
  const activation = f.kernel.leaseNextActivation(f.host, {
    leaseMs: 600_000,
  });
  assert.ok(activation);
  assert.equal(activation.participantId, participantId);
  const run = f.kernel.createRunAttempt(f.host, {
    activationId: activation.activationId,
  });
  const runtime = {
    runAttemptId: run.runAttemptId,
    runtimeRunId: `fake-${run.runAttemptId}`,
    recoveryDescriptor: {
      driver: "fake",
      recoveryKey: run.runAttemptId,
      metadata: {},
    },
  };
  f.kernel.prepareRunAttemptRuntime(f.host, runtime);
  f.kernel.markRunAttemptRunning(f.host, runtime);
  const scope = {
    activationId: activation.activationId,
    consumerId: "worker",
    hostId: f.host.hostId,
    participantId,
    roomId,
    runAttemptId: run.runAttemptId,
    toSeq: activation.toSeq,
  };
  return {
    activation,
    runAttemptId: run.runAttemptId,
    execution: f.kernel.authorizeWorkerExecution(f.host, scope),
  };
}

function secondInstance(f: RoleInstanceFixture, channelId: string) {
  return f.kernel.roles.instantiate(f.actor, {
    roleId: f.role.roleId,
    channelId,
    basedOnRoomSeq: f.head(channelId),
    idempotencyKey: `instance-${channelId}-${String(Math.random())}`,
  }).instance;
}

const count = (f: RoleInstanceFixture, sql: string, ...values: string[]) =>
  Number(f.db.prepare(sql).get(...values)!.n);

/** A Worker change returns a receipt only; content is read separately. */
const stored = (f: RoleInstanceFixture, entryId: string) =>
  f.kernel.memory.humanRead(f.actor, { entryId }).entry;

function entryEvent(f: RoleInstanceFixture, entryId: string, revision: number) {
  const row = f.db
    .prepare(
      `SELECT event_id, type, room_id, actor_id, payload_json FROM room_events
       WHERE aggregate_type='memory_entry' AND aggregate_id=?
         AND json_extract(payload_json,'$.revision')=?`,
    )
    .get(entryId, revision)!;
  return {
    eventId: String(row.event_id),
    type: String(row.type),
    roomId: String(row.room_id),
    actorId: String(row.actor_id),
    payload: JSON.parse(String(row.payload_json)) as Record<string, unknown>,
  };
}

test("provenance comes from the Worker credential and the request cannot carry it", () => {
  const f = roleInstanceFixture();
  try {
    const work = startInstanceRun(f);
    assert.throws(
      () =>
        f.kernel.memory.write(work.execution, {
          ...entry("forged"),
          actorPrincipalId: f.owner.principal.principalId,
        } as never),
      /Unrecognized key/u,
    );
    assert.throws(
      () =>
        f.kernel.memory.write(work.execution, {
          ...entry("forged"),
          channelId: f.channel("elsewhere").roomId,
        } as never),
      /Unrecognized key/u,
    );
    const written = f.kernel.memory.write(work.execution, entry("deploy"));
    assert.deepEqual(
      { ...written, entryId: "x" },
      {
        entryId: "x",
        name: "deploy",
        revision: 1,
        op: "create",
        state: "active",
        deduplicated: false,
      },
      "the Worker receipt carries no body, description or provenance",
    );
    const saved = stored(f, written.entryId);
    assert.equal(saved.channelId, f.home.roomId);
    assert.equal(saved.body, "body of deploy");
    assert.deepEqual(
      { ...saved.provenance, recordedAt: "t" },
      {
        actorPrincipalId: f.instance.instanceId,
        actorKind: "instance",
        roleId: f.role.roleId,
        roleRevisionId: f.role.roleRevisionId,
        instanceId: f.instance.instanceId,
        modelBindingId: null,
        modelReasoning: null,
        sessionGeneration: 0,
        runAttemptId: work.run.runAttemptId,
        viaRoomId: f.home.roomId,
        basedOnRoomSeq: work.activation.toSeq,
        recordedAt: "t",
      },
    );
  } finally {
    f.close();
  }
});

test("each accepted change appends one metadata-only Room event in the channel", () => {
  const f = roleInstanceFixture();
  try {
    const work = startInstanceRun(f);
    const secret = "SECRET-BODY-TEXT";
    const before = f.head(f.home.roomId);
    const written = f.kernel.memory.write(work.execution, {
      ...entry("secret-note", secret),
      description: "SECRET-DESCRIPTION",
    });
    assert.equal(f.head(f.home.roomId), before + 1);
    const event = entryEvent(f, written.entryId, 1);
    assert.equal(event.type, "memory.entry_changed");
    assert.equal(event.roomId, f.home.roomId);
    assert.equal(event.actorId, f.instance.instanceId);
    assert.deepEqual(Object.keys(event.payload).sort(), [
      "entryId",
      "name",
      "op",
      "pinned",
      "requestDigest",
      "revision",
      "state",
      "type",
    ]);
    const stored = String(
      f.db
        .prepare("SELECT payload_json FROM room_events WHERE event_id=?")
        .get(event.eventId)!.payload_json,
    );
    assert.doesNotMatch(stored, /SECRET-BODY-TEXT|SECRET-DESCRIPTION/u);
    // No Activation is derived from a memory change.
    assert.equal(
      count(
        f,
        "SELECT count(*) AS n FROM inbox_items WHERE event_id=?",
        event.eventId,
      ),
      0,
    );
    assert.equal(
      count(
        f,
        "SELECT count(*) AS n FROM memory_revisions WHERE entry_id=?",
        written.entryId,
      ),
      1,
    );
  } finally {
    f.close();
  }
});

test("a name is unique among the non-deleted entries of a channel", () => {
  const f = roleInstanceFixture();
  try {
    const work = startInstanceRun(f);
    const first = f.kernel.memory.write(work.execution, entry("deploy"));
    assert.throws(
      () =>
        f.kernel.memory.write(work.execution, {
          ...entry("deploy"),
          idempotencyKey: "write-deploy-again",
        }),
      (error: Error & { code?: string }) =>
        error.code === "conflict" &&
        /already exists.*revision 1/u.test(error.message),
    );
    f.kernel.memory.invalidate(work.execution, {
      name: "deploy",
      expectedRevision: 1,
      reason: "superseded",
      idempotencyKey: "invalidate-deploy",
    });
    assert.throws(
      () =>
        f.kernel.memory.write(work.execution, {
          ...entry("deploy"),
          idempotencyKey: "write-deploy-invalidated",
        }),
      /already exists/u,
    );
    f.kernel.memory.humanDelete(f.actor, {
      entryId: first.entryId,
      expectedRevision: 2,
      reason: "privacy",
      idempotencyKey: "delete-deploy",
    });
    const reused = f.kernel.memory.write(work.execution, {
      ...entry("deploy"),
      idempotencyKey: "write-deploy-after-delete",
    });
    assert.notEqual(reused.entryId, first.entryId);
  } finally {
    f.close();
  }
});

test("update and invalidate require the current revision", () => {
  const f = roleInstanceFixture();
  try {
    const work = startInstanceRun(f);
    f.kernel.memory.write(work.execution, entry("deploy"));
    const updated = f.kernel.memory.update(work.execution, {
      name: "deploy",
      expectedRevision: 1,
      body: "second body",
      idempotencyKey: "update-1",
    });
    assert.equal(updated.revision, 2);
    assert.equal(stored(f, updated.entryId).body, "second body");
    assert.equal(
      stored(f, updated.entryId).description,
      "what deploy is about",
    );
    for (const change of [
      () =>
        f.kernel.memory.update(work.execution, {
          name: "deploy",
          expectedRevision: 1,
          body: "lost update",
          idempotencyKey: "update-stale",
        }),
      () =>
        f.kernel.memory.invalidate(work.execution, {
          name: "deploy",
          expectedRevision: 1,
          reason: "stale",
          idempotencyKey: "invalidate-stale",
        }),
    ])
      assert.throws(
        change,
        (error: Error & { code?: string }) =>
          error.code === "conflict" && /revision 2/u.test(error.message),
      );
    assert.equal(
      f.kernel.memory.read(work.execution, { name: "deploy" }).entry.body,
      "second body",
    );
  } finally {
    f.close();
  }
});

test("an idempotency key replays one change and refuses a different request", () => {
  const f = roleInstanceFixture();
  try {
    const work = startInstanceRun(f);
    const first = f.kernel.memory.write(work.execution, entry("deploy"));
    const head = f.head(f.home.roomId);
    const replay = f.kernel.memory.write(work.execution, entry("deploy"));
    assert.equal(replay.deduplicated, true);
    assert.deepEqual({ ...replay, deduplicated: false }, first);
    assert.equal(f.head(f.home.roomId), head);
    assert.equal(
      count(f, "SELECT count(*) AS n FROM memory_revisions"),
      1,
      "no second revision",
    );
    assert.throws(
      () =>
        f.kernel.memory.write(work.execution, {
          ...entry("deploy", "different body"),
        }),
      (error: Error) => error.name === "IdempotencyConflictError",
    );
  } finally {
    f.close();
  }
});

test("instances and Humans invalidate and restore; only a Human deletes, redacting every body", () => {
  const f = roleInstanceFixture();
  try {
    const work = startInstanceRun(f);
    const written = f.kernel.memory.write(work.execution, entry("deploy"));
    const entryId = written.entryId;
    f.kernel.memory.update(work.execution, {
      name: "deploy",
      expectedRevision: 1,
      body: "revised body",
      idempotencyKey: "update",
    });
    const invalidated = f.kernel.memory.invalidate(work.execution, {
      name: "deploy",
      expectedRevision: 2,
      reason: "no longer true",
      idempotencyKey: "invalidate",
    });
    assert.equal(invalidated.state, "invalidated");
    assert.equal(stored(f, entryId).body, "revised body", "history kept");
    assert.deepEqual(
      f.kernel.memory.list(work.execution, {}).entries.map((e) => e.name),
      [],
      "an invalidated entry leaves the index",
    );
    assert.deepEqual(
      f.kernel.memory
        .list(work.execution, { includeInvalidated: true })
        .entries.map((e) => e.name),
      ["deploy"],
    );
    const restored = f.kernel.memory.restore(work.execution, {
      name: "deploy",
      expectedRevision: 3,
      idempotencyKey: "restore",
    });
    assert.equal(restored.state, "active");
    const human = f.kernel.memory.humanInvalidate(f.actor, {
      entryId,
      expectedRevision: 4,
      reason: "Human says stale",
      idempotencyKey: "human-invalidate",
    });
    assert.equal(human.entry.provenance.actorKind, "human");
    assert.equal(
      human.entry.provenance.actorPrincipalId,
      f.owner.principal.principalId,
    );
    f.kernel.memory.humanRestore(f.actor, {
      entryId,
      expectedRevision: 5,
      idempotencyKey: "human-restore",
    });
    // A Human who does not manage the channel cannot delete.
    const member = f.kernel.provisionPrincipal({
      handle: "member-human",
      kind: "human",
    });
    const memberActor = f.kernel.authenticateAccessToken(member.accessToken);
    for (const roomId of [f.controlRoomId, f.home.roomId])
      f.kernel.addRoomMember(f.actor, {
        roomId,
        basedOnRoomSeq: f.head(roomId),
        idempotencyKey: `enroll-member-${roomId}`,
        principalId: member.principal.principalId,
        role: "member",
      });
    assert.throws(
      () =>
        f.kernel.memory.humanDelete(memberActor, {
          entryId,
          expectedRevision: 6,
          reason: "not mine",
          idempotencyKey: "member-delete",
        }),
      (error: Error & { code?: string }) => error.code === "forbidden",
    );
    const deleted = f.kernel.memory.humanDelete(f.actor, {
      entryId,
      expectedRevision: 6,
      reason: "contains a customer name",
      idempotencyKey: "human-delete",
    });
    assert.equal(deleted.entry.state, "deleted");
    assert.equal(deleted.entry.body, null);
    assert.equal(
      count(
        f,
        "SELECT count(*) AS n FROM memory_revisions WHERE entry_id=? AND body IS NOT NULL",
        entryId,
      ),
      0,
      "every revision body is redacted",
    );
    const history = f.kernel.memory.humanHistory(f.actor, { entryId });
    assert.equal(history.entry.state, "deleted", "tombstone kept");
    assert.deepEqual(
      history.revisions.map((r) => [r.revision, r.op, r.body]),
      [
        [7, "delete", null],
        [6, "restore", null],
        [5, "invalidate", null],
        [4, "restore", null],
        [3, "invalidate", null],
        [2, "update", null],
        [1, "create", null],
      ],
    );
    assert.equal(history.revisions[0]!.reason, "contains a customer name");
    // Owner ruling 2026-09-27 (full review 2 P2-3): only the delete's own
    // reason survives; earlier invalidation reasons are free text that often
    // restates the body.
    assert.deepEqual(
      history.revisions.slice(1).map((r) => r.reason ?? null),
      [null, null, null, null, null, null],
    );
    assert.equal(
      count(
        f,
        "SELECT count(*) AS n FROM memory_revisions WHERE entry_id=? AND op<>'delete' AND reason IS NOT NULL",
        entryId,
      ),
      0,
      "no earlier revision keeps a reason",
    );
    assert.equal(
      f.kernel.memory.humanRead(f.actor, { entryId }).entry.body,
      null,
    );
    assert.throws(
      () => f.kernel.memory.read(work.execution, { name: "deploy" }),
      (error: Error & { code?: string }) => error.code === "not_found",
    );
    assert.equal(
      f.kernel.memory.search(work.execution, { query: "revised" }).entries
        .length,
      0,
    );
    assert.equal(
      count(
        f,
        "SELECT count(*) AS n FROM memory_entries_fts WHERE entry_id=?",
        entryId,
      ),
      0,
    );
  } finally {
    f.close();
  }
});

test("read and write switches are enforced with per-member overrides", () => {
  const f = roleInstanceFixture();
  try {
    const work = startInstanceRun(f);
    f.kernel.memory.write(work.execution, entry("deploy"));
    const initial = f.kernel.memory.readPolicy(f.actor, {
      channelId: f.home.roomId,
    });
    assert.deepEqual(
      {
        revision: initial.revision,
        readDefault: initial.readDefault,
        writeDefault: initial.writeDefault,
        members: initial.members,
      },
      {
        revision: 0,
        readDefault: true,
        writeDefault: true,
        members: [
          { instanceId: f.instance.instanceId, read: true, write: true },
        ],
      },
    );
    const writeOff = f.kernel.memory.updatePolicy(f.actor, {
      channelId: f.home.roomId,
      expectedRevision: 0,
      writeDefault: false,
      idempotencyKey: "policy-write-off",
    });
    assert.equal(writeOff.event.type, "memory.policy_changed");
    assert.equal(writeOff.event.roomId, f.home.roomId);
    assert.throws(
      () =>
        f.kernel.memory.write(work.execution, {
          ...entry("blocked"),
        }),
      (error: Error & { code?: string }) =>
        error.code === "forbidden" && /write/u.test(error.message),
    );
    assert.equal(
      f.kernel.memory.read(work.execution, { name: "deploy" }).entry.name,
      "deploy",
    );
    assert.throws(
      () =>
        f.kernel.memory.updatePolicy(f.actor, {
          channelId: f.home.roomId,
          expectedRevision: 0,
          readDefault: false,
          idempotencyKey: "policy-stale",
        }),
      (error: Error & { code?: string }) => error.code === "conflict",
    );
    f.kernel.memory.updatePolicy(f.actor, {
      channelId: f.home.roomId,
      expectedRevision: 1,
      overrides: [
        { instanceId: f.instance.instanceId, read: false, write: true },
      ],
      idempotencyKey: "policy-override",
    });
    const written = f.kernel.memory.write(work.execution, entry("allowed"));
    assert.equal(written.name, "allowed");
    for (const readCall of [
      () => f.kernel.memory.list(work.execution, {}),
      () => f.kernel.memory.read(work.execution, { name: "deploy" }),
      () => f.kernel.memory.search(work.execution, { query: "deploy" }),
      () => f.kernel.memory.history(work.execution, { name: "deploy" }),
    ])
      assert.throws(
        readCall,
        (error: Error & { code?: string }) =>
          error.code === "forbidden" && /read/u.test(error.message),
      );
    const policy = f.kernel.memory.readPolicy(f.actor, {
      channelId: f.home.roomId,
    });
    assert.deepEqual(policy.members, [
      { instanceId: f.instance.instanceId, read: false, write: true },
    ]);
    // The Human facade keeps administering the channel's memory.
    assert.equal(
      f.kernel.memory.humanList(f.actor, { channelId: f.home.roomId }).entries
        .length,
      2,
    );
    // An agent principal cannot change the switches.
    assert.throws(() =>
      f.kernel.memory.updatePolicy(
        f.kernel.authenticateAccessToken(
          f.kernel.provisionPrincipal({ handle: "sneaky", kind: "agent" })
            .accessToken,
        ),
        {
          channelId: f.home.roomId,
          expectedRevision: 2,
          readDefault: true,
          idempotencyKey: "agent-policy",
        },
      ),
    );
  } finally {
    f.close();
  }
});

test("side credentials may read but never write (decision point)", () => {
  const enabled = { readEnabled: true, writeEnabled: true };
  assert.deepEqual(
    decideMemoryAccess({ ...enabled, credential: "main" }, "write"),
    { allowed: true },
  );
  assert.deepEqual(
    decideMemoryAccess({ ...enabled, credential: "side" }, "read"),
    { allowed: true },
  );
  const refused = decideMemoryAccess(
    { ...enabled, credential: "side" },
    "write",
  );
  assert.equal(refused.allowed, false);
  assert.match(refused.allowed ? "" : refused.reason, /side/u);
  assert.equal(
    decideMemoryAccess(
      { readEnabled: false, writeEnabled: true, credential: "main" },
      "read",
    ).allowed,
    false,
  );
});

test("another channel's instance and a removed instance cannot see the channel's memory", () => {
  const f = roleInstanceFixture();
  try {
    const home = startInstanceRun(f);
    f.kernel.memory.write(home.execution, entry("home-fact", "marker home"));
    home.finish(0);
    const other = f.channel("other");
    const outsider = secondInstance(f, other.roomId);
    const outside = startTurn(f, other.roomId, outsider.instanceId);
    f.kernel.memory.write(
      outside.execution,
      entry("other-fact", "marker other"),
    );
    const list = f.kernel.memory.list(outside.execution, {});
    assert.equal(list.channelId, other.roomId);
    assert.deepEqual(
      list.entries.map((e) => e.name),
      ["other-fact"],
    );
    assert.deepEqual(
      f.kernel.memory
        .search(outside.execution, { query: "marker" })
        .entries.map((e) => e.name),
      ["other-fact"],
      "search is filtered to the permitted scope first",
    );
    assert.throws(
      () => f.kernel.memory.read(outside.execution, { name: "home-fact" }),
      (error: Error & { code?: string }) => error.code === "not_found",
    );
    // A Human who is not in the channel cannot read it either.
    const stranger = f.kernel.provisionPrincipal({
      handle: "stranger",
      kind: "human",
    });
    assert.throws(
      () =>
        f.kernel.memory.humanList(
          f.kernel.authenticateAccessToken(stranger.accessToken),
          { channelId: f.home.roomId },
        ),
      (error: Error & { code?: string }) => error.code === "forbidden",
    );
    const again = startTurn(f, f.home.roomId);
    f.detachFromChannel();
    assert.throws(
      () => f.kernel.memory.list(again.execution, {}),
      (error: Error & { code?: string }) => error.code === "forbidden",
    );
  } finally {
    f.close();
  }
});

test("a private-box turn reads and writes the memory of the instance's channel", () => {
  const f = roleInstanceFixture();
  try {
    const priv = startTurn(f, f.privateBox.roomId);
    const channelHead = f.head(f.home.roomId);
    const privateHead = f.head(f.privateBox.roomId);
    const written = f.kernel.memory.write(priv.execution, entry("from-dm"));
    assert.equal(stored(f, written.entryId).channelId, f.home.roomId);
    assert.equal(
      stored(f, written.entryId).provenance.viaRoomId,
      f.privateBox.roomId,
    );
    assert.equal(entryEvent(f, written.entryId, 1).roomId, f.home.roomId);
    assert.equal(f.head(f.home.roomId), channelHead + 1);
    assert.equal(
      f.head(f.privateBox.roomId),
      privateHead,
      "nothing is appended to the private box",
    );
    assert.deepEqual(
      f.kernel.memory.list(priv.execution, {}).entries.map((e) => e.name),
      ["from-dm"],
    );
  } finally {
    f.close();
  }
});

test("search uses full text inside the permitted scope; the list puts pinned entries first", () => {
  let nowMs = Date.parse("2026-09-26T00:00:00Z");
  const f = roleInstanceFixture({ now: () => new Date(nowMs) });
  try {
    const work = startInstanceRun(f);
    const tick = () => (nowMs += 1_000);
    const a = f.kernel.memory.write(
      work.execution,
      entry("alpha", "the staging cluster is ams-2"),
    );
    tick();
    f.kernel.memory.write(work.execution, entry("beta", "unrelated"));
    tick();
    f.kernel.memory.write(work.execution, {
      ...entry("gamma", "部署前先跑冒烟测试"),
      description: "发布流程",
    });
    assert.deepEqual(
      f.kernel.memory
        .search(work.execution, { query: "staging cluster" })
        .entries.map((e) => e.name),
      ["alpha"],
    );
    assert.deepEqual(
      f.kernel.memory
        .search(work.execution, { query: "冒烟测试" })
        .entries.map((e) => e.name),
      ["gamma"],
    );
    assert.deepEqual(
      f.kernel.memory
        .search(work.execution, { query: "发布" })
        .entries.map((e) => e.name),
      ["gamma"],
      "a query shorter than a trigram still matches",
    );
    assert.deepEqual(
      f.kernel.memory.list(work.execution, {}).entries.map((e) => e.name),
      ["gamma", "beta", "alpha"],
    );
    tick();
    f.kernel.memory.humanPin(f.actor, {
      entryId: a.entryId,
      expectedRevision: 1,
      pinned: true,
      idempotencyKey: "pin-alpha",
    });
    assert.deepEqual(
      f.kernel.memory.list(work.execution, {}).entries.map((e) => e.name),
      ["alpha", "gamma", "beta"],
    );
    f.kernel.memory.invalidate(work.execution, {
      name: "gamma",
      expectedRevision: 1,
      reason: "old",
      idempotencyKey: "invalidate-gamma",
    });
    assert.equal(
      f.kernel.memory.search(work.execution, { query: "冒烟测试" }).entries
        .length,
      0,
      "invalidated entries are not retrieved",
    );
  } finally {
    f.close();
  }
});

test("size, type, name and description are validated", () => {
  const f = roleInstanceFixture();
  try {
    const work = startInstanceRun(f);
    for (const invalid of [
      { ...entry("big"), body: "x".repeat(16 * 1024 + 1) },
      { ...entry("big-cjk"), body: "记".repeat(5_462) },
      { ...entry("typed"), type: "secret" },
      { ...entry("Upper") },
      { ...entry("multi"), description: "line one\nline two" },
      { ...entry("long"), description: "d".repeat(151) },
      { ...entry("empty"), body: "   " },
    ])
      assert.throws(
        () => f.kernel.memory.write(work.execution, invalid as never),
        (error: Error) => error.name === "ZodError",
        JSON.stringify(invalid).slice(0, 60),
      );
    const exact = f.kernel.memory.write(work.execution, {
      ...entry("exact"),
      body: "x".repeat(16 * 1024),
    });
    assert.equal(stored(f, exact.entryId).body!.length, 16 * 1024);
    assert.equal(count(f, "SELECT count(*) AS n FROM memory_entries"), 1);
  } finally {
    f.close();
  }
});

test("a later turn of the same instance keeps writing under its current session generation", () => {
  const f = roleInstanceFixture();
  try {
    const first = startInstanceRun(f);
    f.kernel.memory.write(first.execution, entry("deploy"));
    first.finish(0);
    f.kernel.roles.resetInstanceSession(f.actor, {
      instanceId: f.instance.instanceId,
      basedOnRoomSeq: f.head(f.home.roomId),
      idempotencyKey: "reset",
    });
    const second = startInstanceRun(f);
    const updated = f.kernel.memory.update(second.execution, {
      name: "deploy",
      expectedRevision: 1,
      description: "updated after reset",
      idempotencyKey: "update-after-reset",
    });
    const provenance = stored(f, updated.entryId).provenance;
    assert.equal(provenance.sessionGeneration, 1);
    assert.equal(provenance.runAttemptId, second.run.runAttemptId);
    const history = f.kernel.memory.history(second.execution, {
      name: "deploy",
    });
    assert.deepEqual(
      history.revisions.map((r) => r.provenance.sessionGeneration),
      [1, 0],
    );
  } finally {
    f.close();
  }
});

test("owner ruling 2026-09-27: a Human delete also clears the description from the projection, every revision and every view", () => {
  const f = roleInstanceFixture();
  try {
    const work = startInstanceRun(f);
    const secret = "the Acme customer contract";
    const { entryId } = f.kernel.memory.write(work.execution, {
      ...entry("customer"),
      description: `about ${secret}`,
    });
    f.kernel.memory.update(work.execution, {
      name: "customer",
      expectedRevision: 1,
      description: `still about ${secret}`,
      idempotencyKey: "update-customer",
    });
    const deleted = f.kernel.memory.humanDelete(f.actor, {
      entryId,
      expectedRevision: 2,
      reason: "privacy",
      idempotencyKey: "delete-customer",
    });
    assert.equal(deleted.entry.description, "");
    assert.equal(deleted.entry.name, "customer", "the name stays");
    assert.equal(
      count(
        f,
        "SELECT count(*) AS n FROM memory_entries WHERE entry_id=? AND description<>''",
        entryId,
      ),
      0,
      "the projection keeps no description",
    );
    assert.equal(
      count(
        f,
        "SELECT count(*) AS n FROM memory_revisions WHERE entry_id=? AND description<>''",
        entryId,
      ),
      0,
      "no revision keeps a description",
    );
    assert.equal(
      count(
        f,
        "SELECT count(*) AS n FROM memory_entries_fts WHERE entry_id=?",
        entryId,
      ),
      0,
    );
    // Human views: the tombstone keeps name, time and reason only.
    const history = f.kernel.memory.humanHistory(f.actor, { entryId });
    assert.equal(history.entry.description, "");
    assert.deepEqual(
      history.revisions.map((r) => [r.revision, r.op, r.description, r.body]),
      [
        [3, "delete", "", null],
        [2, "update", "", null],
        [1, "create", "", null],
      ],
    );
    assert.equal(history.revisions[0]!.reason, "privacy");
    assert.equal(
      f.kernel.memory.humanRead(f.actor, { entryId }).entry.description,
      "",
    );
    const listed = f.kernel.memory.humanList(f.actor, {
      channelId: f.home.roomId,
      includeInvalidated: true,
      includeDeleted: true,
    });
    assert.deepEqual(
      listed.entries.map((e) => [e.name, e.state, e.description]),
      [["customer", "deleted", ""]],
    );
    assert.equal(
      f.kernel.memory.humanSearch(f.actor, {
        channelId: f.home.roomId,
        query: "Acme",
      }).entries.length,
      0,
    );
    // An idempotent replay of the delete returns the cleared tombstone.
    assert.equal(
      f.kernel.memory.humanDelete(f.actor, {
        entryId,
        expectedRevision: 2,
        reason: "privacy",
        idempotencyKey: "delete-customer",
      }).entry.description,
      "",
    );
    // Worker views never return it either.
    const workerViews = JSON.stringify([
      f.kernel.memory.list(work.execution, { includeInvalidated: true }),
      f.kernel.memory.search(work.execution, { query: "Acme" }).entries,
    ]);
    assert.ok(!workerViews.includes("Acme"), workerViews);
    for (const read of [
      () => f.kernel.memory.read(work.execution, { name: "customer" }),
      () => f.kernel.memory.history(work.execution, { name: "customer" }),
    ])
      assert.throws(
        read,
        (error: Error & { code?: string }) => error.code === "not_found",
      );
    assert.equal(
      count(
        f,
        "SELECT count(*) AS n FROM room_events WHERE aggregate_id=? AND payload_json LIKE '%Acme%'",
        entryId,
      ),
      0,
      "Room events never carried a description",
    );
  } finally {
    f.close();
  }
});
