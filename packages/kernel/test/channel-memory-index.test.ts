import assert from "node:assert/strict";
import test from "node:test";

import { ForbiddenError, NotFoundError } from "../src/index.ts";
import {
  roleInstanceFixture,
  startInstanceRun,
  type RoleInstanceFixture,
} from "./role-instance-fixture.ts";

// evo S6 batch B: the session index a Host injects, the per-wake delta the
// Kernel attaches to a presented window, and the Human import of legacy
// per-instance memory. Fake Host, temporary database; assertions read the
// Kernel facade results and durable rows, never model prose.

const entry = (name: string, description = `what ${name} is about`) => ({
  name,
  type: "project" as const,
  description,
  body: `body of ${name}`,
  idempotencyKey: `write-${name}-${String(Math.random())}`,
});

function write(f: RoleInstanceFixture, name: string) {
  const work = startInstanceRun(f);
  const receipt = f.kernel.memory.write(work.execution, entry(name));
  work.finish(0);
  return receipt;
}

const humanPolicy = (
  f: RoleInstanceFixture,
  change: { readDefault?: boolean; writeDefault?: boolean },
) =>
  f.kernel.memory.updatePolicy(f.actor, {
    channelId: f.home.roomId,
    expectedRevision: f.kernel.memory.readPolicy(f.actor, {
      channelId: f.home.roomId,
    }).revision,
    ...change,
    idempotencyKey: `policy-${String(Math.random())}`,
  });

test("the Host reads the instance index: active only, pinned first, then most recently updated", () => {
  let clock = Date.parse("2026-09-27T00:00:00.000Z");
  const f = roleInstanceFixture({ now: () => new Date((clock += 1000)) });
  try {
    const a = write(f, "alpha");
    write(f, "beta");
    const gamma = write(f, "gamma");
    write(f, "delta");
    f.kernel.memory.humanPin(f.actor, {
      entryId: a.entryId,
      expectedRevision: 1,
      pinned: true,
      idempotencyKey: "pin-alpha",
    });
    f.kernel.memory.humanInvalidate(f.actor, {
      entryId: gamma.entryId,
      expectedRevision: 1,
      reason: "stale",
      idempotencyKey: "invalidate-gamma",
    });
    const index = f.kernel.readInstanceMemoryIndex(f.host, {
      participantId: f.instance.instanceId,
    });
    assert.equal(index.channelId, f.home.roomId);
    assert.equal(index.readEnabled, true);
    assert.deepEqual(
      index.entries.map((item) => [item.name, item.pinned]),
      [
        ["alpha", true],
        ["delta", false],
        ["beta", false],
      ],
    );
    assert.equal(index.total, 3);
    const head = Number(
      f.db
        .prepare(
          "SELECT MAX(room_seq) AS n FROM room_events WHERE room_id=? AND type='memory.entry_changed'",
        )
        .get(f.home.roomId)!.n,
    );
    assert.equal(index.throughSeq, head);
  } finally {
    f.close();
  }
});

test("a read switch that is off yields no index entries for the Host", () => {
  const f = roleInstanceFixture();
  try {
    write(f, "secret-plan");
    humanPolicy(f, { readDefault: false });
    const index = f.kernel.readInstanceMemoryIndex(f.host, {
      participantId: f.instance.instanceId,
    });
    assert.equal(index.readEnabled, false);
    assert.deepEqual(index.entries, []);
    assert.equal(index.total, 0);
  } finally {
    f.close();
  }
});

test("only a Role instance the Host serves has an index", () => {
  const f = roleInstanceFixture();
  try {
    assert.throws(
      () =>
        f.kernel.readInstanceMemoryIndex(f.host, {
          participantId: f.owner.principal.principalId,
        }),
      (error) => error instanceof ForbiddenError,
    );
  } finally {
    f.close();
  }
});

test("a wake carries only entries changed since the session's index, and a sent window advances it", () => {
  const f = roleInstanceFixture();
  try {
    write(f, "first");
    const start = f.kernel.readInstanceMemoryIndex(f.host, {
      participantId: f.instance.instanceId,
    });
    const second = write(f, "second");

    // New session: the launch's index is `start`; only `second` is new.
    const turn1 = startInstanceRun(f);
    const presented1 = f.kernel.presentWorkerMessages(turn1.execution, {
      memoryIndexSeq: start.throughSeq,
    });
    assert.deepEqual(
      presented1.memoryDelta?.changes.map((item) => [item.name, item.state]),
      [["second", "active"]],
    );
    assert.equal(presented1.memoryDelta?.omitted, 0);
    // Rendered but never sent: the next wake still owes the same change.
    turn1.finish(0);

    const turn2 = startInstanceRun(f);
    const presented2 = f.kernel.presentWorkerMessages(turn2.execution, {
      memoryIndexSeq: start.throughSeq,
    });
    assert.deepEqual(
      presented2.memoryDelta?.changes.map((item) => item.name),
      ["second"],
    );
    f.kernel.markPresentedDeliverySent(f.host, {
      activationId: turn2.activation.activationId,
      consumerId: "worker",
      runAttemptId: turn2.run.runAttemptId,
    });
    turn2.finish(0);

    // Resumed session (no seq from the Host): nothing changed since.
    const turn3 = startInstanceRun(f);
    assert.equal(
      f.kernel.presentWorkerMessages(turn3.execution, {}).memoryDelta,
      undefined,
    );
    f.kernel.markPresentedDeliverySent(f.host, {
      activationId: turn3.activation.activationId,
      consumerId: "worker",
      runAttemptId: turn3.run.runAttemptId,
    });
    turn3.finish(0);

    f.kernel.memory.humanPin(f.actor, {
      entryId: second.entryId,
      expectedRevision: 1,
      pinned: true,
      idempotencyKey: "pin-second",
    });
    f.kernel.memory.humanDelete(f.actor, {
      entryId: f.kernel.memory
        .humanList(f.actor, { channelId: f.home.roomId })
        .entries.find((item) => item.name === "first")!.entryId,
      expectedRevision: 1,
      reason: "private",
      idempotencyKey: "delete-first",
    });
    const turn4 = startInstanceRun(f);
    const delta = f.kernel.presentWorkerMessages(
      turn4.execution,
      {},
    ).memoryDelta!;
    assert.deepEqual(delta.changes, [
      {
        name: "second",
        type: "project",
        description: "what second is about",
        pinned: true,
        state: "active",
      },
      {
        name: "first",
        type: "project",
        description: null,
        pinned: false,
        state: "deleted",
      },
    ]);
    turn4.finish(0);
  } finally {
    f.close();
  }
});

test("a read switch that is off carries no delta", () => {
  const f = roleInstanceFixture();
  try {
    write(f, "kept");
    const turn = startInstanceRun(f);
    assert.ok(f.kernel.presentWorkerMessages(turn.execution, {}).memoryDelta);
    turn.finish(0);
    humanPolicy(f, { readDefault: false });
    write(f, "hidden");
    const off = startInstanceRun(f);
    assert.equal(
      f.kernel.presentWorkerMessages(off.execution, {}).memoryDelta,
      undefined,
      "read off: no names or descriptions reach the wake",
    );
    off.finish(0);
  } finally {
    f.close();
  }
});

test("memory change events are omitted from wake windows and message-check", () => {
  const f = roleInstanceFixture();
  try {
    write(f, "noted");
    const turn = startInstanceRun(f);
    const presented = f.kernel.presentWorkerMessages(turn.execution, {});
    assert.ok(
      presented.events.every((event) => !event.type.startsWith("memory.")),
      "the delta, not the raw event, carries memory changes",
    );
    turn.finish(0);
  } finally {
    f.close();
  }
});

test("a Human imports legacy memory once, with import provenance and the source instance", () => {
  const f = roleInstanceFixture();
  try {
    const files = [
      {
        relativePath: "MEMORY.md",
        content: "# Memory\n- [deploy](notes/deploy.md)\n",
      },
      {
        relativePath: "notes/deploy.md",
        content: "# Deploy steps\nrun make\n",
      },
      { relativePath: "notes/huge.md", content: "x".repeat(17 * 1024) },
    ];
    const first = f.kernel.memory.humanImportLegacy(
      f.actor,
      {
        channelId: f.home.roomId,
        instanceId: f.instance.instanceId,
        mode: "files",
        idempotencyKey: "import-1",
      },
      files,
    );
    assert.deepEqual(
      first.results.map((item) => [item.path, item.status]),
      [
        ["MEMORY.md", "created"],
        ["notes/deploy.md", "created"],
        ["notes/huge.md", "skipped"],
      ],
    );
    const created = first.results.find(
      (item) => item.path === "notes/deploy.md",
    )!;
    const detail = f.kernel.memory.humanRead(f.actor, {
      entryId: created.entryId!,
    }).entry;
    assert.equal(detail.body, "# Deploy steps\nrun make\n");
    assert.equal(detail.type, "reference");
    assert.equal(detail.provenance.actorKind, "human");
    assert.equal(
      detail.provenance.actorPrincipalId,
      f.owner.principal.principalId,
    );
    assert.deepEqual(detail.provenance.importedFrom, {
      instanceId: f.instance.instanceId,
      path: "notes/deploy.md",
    });
    assert.match(detail.description, /Deploy steps/u);

    // Idempotent: a replay or a second request never duplicates an entry.
    for (const key of ["import-1", "import-2"]) {
      const again = f.kernel.memory.humanImportLegacy(
        f.actor,
        {
          channelId: f.home.roomId,
          instanceId: f.instance.instanceId,
          mode: "files",
          idempotencyKey: key,
        },
        files,
      );
      assert.deepEqual(
        again.results.map((item) => item.status),
        ["existing", "existing", "skipped"],
      );
    }
    assert.equal(
      Number(
        f.db
          .prepare(
            "SELECT count(*) AS n FROM memory_entries WHERE scope_room_id=?",
          )
          .get(f.home.roomId)!.n,
      ),
      2,
    );

    // Whole mode: one entry holding the index and every note.
    const whole = f.kernel.memory.humanImportLegacy(
      f.actor,
      {
        channelId: f.home.roomId,
        instanceId: f.instance.instanceId,
        mode: "whole",
        idempotencyKey: "import-whole",
      },
      files.slice(0, 2),
    );
    assert.equal(whole.results.length, 1);
    assert.equal(whole.results[0]!.status, "created");
    const body = f.kernel.memory.humanRead(f.actor, {
      entryId: whole.results[0]!.entryId!,
    }).entry.body!;
    assert.match(body, /# Memory/u);
    assert.match(body, /## notes\/deploy\.md/u);
  } finally {
    f.close();
  }
});

test("import requires a channel manager and an instance of that channel", () => {
  const f = roleInstanceFixture();
  try {
    const other = f.channel("other");
    assert.throws(
      () =>
        f.kernel.memory.humanImportLegacy(
          f.actor,
          {
            channelId: other.roomId,
            instanceId: f.instance.instanceId,
            mode: "files",
            idempotencyKey: "wrong-channel",
          },
          [{ relativePath: "MEMORY.md", content: "x" }],
        ),
      (error) => error instanceof NotFoundError,
    );
    const stranger = f.kernel.provisionPrincipal({
      handle: "stranger",
      kind: "human",
    });
    assert.throws(
      () =>
        f.kernel.memory.humanImportLegacy(
          f.kernel.authenticateAccessToken(stranger.accessToken),
          {
            channelId: f.home.roomId,
            instanceId: f.instance.instanceId,
            mode: "files",
            idempotencyKey: "stranger",
          },
          [{ relativePath: "MEMORY.md", content: "x" }],
        ),
      (error) =>
        error instanceof ForbiddenError || error instanceof NotFoundError,
    );
  } finally {
    f.close();
  }
});
