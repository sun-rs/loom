import assert from "node:assert/strict";
import test from "node:test";

import { ForbiddenError, NotFoundError } from "../src/index.ts";
import {
  roleInstanceFixture,
  startInstanceRun,
  startInstanceRunFromQueue,
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

const sent = (
  f: RoleInstanceFixture,
  run: ReturnType<typeof startInstanceRun>,
) =>
  f.kernel.markPresentedDeliverySent(f.host, {
    activationId: run.activation.activationId,
    consumerId: "worker",
    runAttemptId: run.run.runAttemptId,
  });

const markRow = (f: RoleInstanceFixture) =>
  f.db
    .prepare(
      "SELECT through_seq, index_state, index_seq, delta_seq FROM memory_index_marks WHERE instance_id=?",
    )
    .get(f.instance.instanceId);

test("review P1-1: a RunAttempt's memory delta is frozen with its presented window; a re-present never replaces the snapshot the send registers", () => {
  const f = roleInstanceFixture();
  try {
    const alpha = write(f, "alpha");
    const run = startInstanceRun(f);
    const first = f.kernel.presentWorkerMessages(
      run.execution,
      {},
    ).memoryDelta!;
    assert.deepEqual(
      first.changes.map((item) => [item.name, item.pinned]),
      [["alpha", false]],
    );
    f.kernel.memory.humanPin(f.actor, {
      entryId: alpha.entryId,
      expectedRevision: 1,
      pinned: true,
      idempotencyKey: "pin-alpha",
    });
    const second = f.kernel.presentWorkerMessages(run.execution, {});
    assert.deepEqual(
      second.memoryDelta,
      first,
      "the same RunAttempt re-presents the frozen snapshot",
    );
    // Only the first input was ever registered; a duplicate receipt changes
    // nothing.
    sent(f, run);
    sent(f, run);
    assert.equal(Number(markRow(f)!.through_seq), first.throughSeq);
    run.finish(0);
    const next = startInstanceRun(f);
    const owed = f.kernel.presentWorkerMessages(next.execution, {}).memoryDelta;
    assert.deepEqual(
      owed?.changes.map((item) => [item.name, item.pinned]),
      [["alpha", true]],
      "the undelivered pin is still owed to the session",
    );
    next.finish(0);
  } finally {
    f.close();
  }
});

test("review P1-1: an unsent window and a receipt arriving after the RunAttempt ended advance nothing", () => {
  const f = roleInstanceFixture();
  try {
    write(f, "alpha");
    const unsent = startInstanceRun(f);
    assert.ok(f.kernel.presentWorkerMessages(unsent.execution, {}).memoryDelta);
    unsent.finish(0);
    try {
      sent(f, unsent);
    } catch {
      // A refusal is as good as a no-op; neither may advance the mark.
    }
    assert.equal(markRow(f)?.through_seq ?? null, null);
    const next = startInstanceRun(f);
    assert.deepEqual(
      f.kernel
        .presentWorkerMessages(next.execution, {})
        .memoryDelta?.changes.map((item) => item.name),
      ["alpha"],
    );
    next.finish(0);
  } finally {
    f.close();
  }
});

test("review P1-1: a memoryIndexSeq the Host never served is not trusted as a baseline", () => {
  const f = roleInstanceFixture();
  try {
    write(f, "alpha");
    const forged = startInstanceRun(f);
    assert.deepEqual(
      f.kernel
        .presentWorkerMessages(forged.execution, { memoryIndexSeq: 9999 })
        .memoryDelta?.changes.map((item) => item.name),
      ["alpha"],
      "a request-body seq alone suppresses nothing",
    );
    sent(f, forged);
    assert.ok(Number(markRow(f)!.through_seq) < 9999);
    forged.finish(0);
  } finally {
    f.close();
  }
});

test("review P2-1: the launch index becomes the session baseline once its first wake is accepted, so a resumed session is not re-sent it", () => {
  const f = roleInstanceFixture();
  try {
    write(f, "first");
    const launch = f.kernel.readInstanceMemoryIndex(f.host, {
      participantId: f.instance.instanceId,
    });
    const turn1 = startInstanceRun(f);
    assert.equal(
      f.kernel.presentWorkerMessages(turn1.execution, {
        memoryIndexSeq: launch.throughSeq,
      }).memoryDelta,
      undefined,
    );
    sent(f, turn1);
    turn1.finish(0);
    assert.equal(markRow(f)!.index_state, "index");
    assert.equal(Number(markRow(f)!.index_seq), launch.throughSeq);
    // The process was reclaimed; the same native session resumes without a
    // launch seq.
    const turn2 = startInstanceRun(f);
    const resumed = f.kernel.presentWorkerMessages(turn2.execution, {});
    assert.equal(resumed.memoryDelta, undefined);
    assert.equal(resumed.memoryIndex, undefined);
    turn2.finish(0);
  } finally {
    f.close();
  }
});

test("review P2-1: a session launched with reading off holds only the notice; turning reading on refreshes the index once even with no entry change", () => {
  const f = roleInstanceFixture();
  try {
    write(f, "kept");
    humanPolicy(f, { readDefault: false });
    const launch = f.kernel.readInstanceMemoryIndex(f.host, {
      participantId: f.instance.instanceId,
    });
    assert.equal(launch.readEnabled, false);
    const off = startInstanceRun(f);
    const offPresented = f.kernel.presentWorkerMessages(off.execution, {
      memoryIndexSeq: launch.throughSeq,
    });
    assert.equal(offPresented.memoryDelta, undefined);
    assert.equal(offPresented.memoryIndex, undefined);
    sent(f, off);
    off.finish(0);
    assert.equal(markRow(f)!.index_state, "notice");
    assert.equal(markRow(f)!.through_seq, null);

    humanPolicy(f, { readDefault: true });
    const on = startInstanceRun(f);
    const refreshed = f.kernel.presentWorkerMessages(on.execution, {});
    assert.equal(refreshed.memoryDelta, undefined);
    assert.deepEqual(
      refreshed.memoryIndex?.entries.map((item) => item.name),
      ["kept"],
    );
    sent(f, on);
    on.finish(0);
    assert.equal(markRow(f)!.index_state, "index");

    const after = startInstanceRun(f);
    const quiet = f.kernel.presentWorkerMessages(after.execution, {});
    assert.equal(quiet.memoryIndex, undefined, "refreshed once, not per wake");
    assert.equal(quiet.memoryDelta, undefined);
    after.finish(0);
  } finally {
    f.close();
  }
});

test("more than 30 non-active changes: 30 are listed and the rest counted, never re-sent after delivery", () => {
  const f = roleInstanceFixture();
  try {
    const work = startInstanceRun(f);
    const names = Array.from(
      { length: 32 },
      (_, index) => `entry-${String(index).padStart(2, "0")}`,
    );
    const receipts = names.map((name) =>
      f.kernel.memory.write(work.execution, entry(name)),
    );
    work.finish(0);
    const baseline = startInstanceRun(f);
    assert.equal(
      f.kernel.presentWorkerMessages(baseline.execution, {}).memoryDelta
        ?.omitted,
      2,
    );
    sent(f, baseline);
    baseline.finish(0);
    for (const receipt of receipts)
      f.kernel.memory.humanInvalidate(f.actor, {
        entryId: receipt.entryId,
        expectedRevision: 1,
        reason: "stale",
        idempotencyKey: `invalidate-${receipt.entryId}`,
      });
    const turn = startInstanceRun(f);
    const delta = f.kernel.presentWorkerMessages(
      turn.execution,
      {},
    ).memoryDelta!;
    assert.equal(delta.changes.length, 30);
    assert.equal(delta.omitted, 2);
    assert.ok(delta.changes.every((item) => item.state === "invalidated"));
    sent(f, turn);
    turn.finish(0);
    const next = startInstanceRun(f);
    assert.equal(
      f.kernel.presentWorkerMessages(next.execution, {}).memoryDelta,
      undefined,
      "the omitted changes are a stated loss, not a queue",
    );
    // The Worker can still see what the delta only counted.
    const listed = f.kernel.memory.list(next.execution, {
      includeInvalidated: true,
    });
    assert.equal(
      listed.entries.filter((item) => item.state === "invalidated").length,
      32,
    );
    next.finish(0);
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

test("schema 76 upgrades a schema 75 database: the pending mark columns are retired and windows gain the frozen memory snapshot", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { DatabaseSync } = await import("node:sqlite");
  const { RoomKernel } = await import("../src/index.ts");
  const directory = mkdtempSync(join(tmpdir(), "rah-memory-v76-"));
  const path = join(directory, "room.db");
  try {
    let kernel = new RoomKernel({ databasePath: path });
    kernel.initialize();
    kernel.close();
    const db = new DatabaseSync(path);
    db.exec(`
      DROP TABLE memory_index_marks;
      CREATE TABLE memory_index_marks (
        instance_id TEXT NOT NULL,
        session_generation INTEGER NOT NULL CHECK (session_generation >= 0),
        room_id TEXT NOT NULL,
        through_seq INTEGER CHECK (through_seq IS NULL OR through_seq >= 0),
        pending_run_attempt_id TEXT,
        pending_through_seq INTEGER,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (instance_id, session_generation)
      ) STRICT;
      INSERT INTO memory_index_marks VALUES ('i', 0, 'r', 7, 'run', 9, '2026-09-27');
      ALTER TABLE activation_presented_windows DROP COLUMN memory_json;
      PRAGMA user_version = 75;
    `);
    db.close();
    kernel = new RoomKernel({ databasePath: path });
    kernel.initialize();
    kernel.close();
    const read = new DatabaseSync(path, { readOnly: true });
    try {
      assert.deepEqual(
        { ...read.prepare("SELECT * FROM memory_index_marks").get() },
        {
          instance_id: "i",
          session_generation: 0,
          room_id: "r",
          through_seq: 7,
          updated_at: "2026-09-27",
          served_seq: null,
          served_read_enabled: null,
          index_state: null,
          index_seq: null,
          delta_seq: null,
        },
      );
      assert.ok(
        read
          .prepare("PRAGMA table_info(activation_presented_windows)")
          .all()
          .some((column) => column.name === "memory_json"),
      );
      assert.equal(RoomKernel.inspectSchemaState(path).pending.length, 0);
    } finally {
      read.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("owner ruling 2026-09-27: a Human delete clears the deleted entry's description from snapshots already frozen on presented windows", () => {
  const f = roleInstanceFixture();
  try {
    const writer = startInstanceRun(f);
    const alpha = f.kernel.memory.write(
      writer.execution,
      entry("alpha", "about the Acme customer contract"),
    );
    writer.finish(0);
    write(f, "beta");
    const run = startInstanceRun(f);
    const frozen = f.kernel.presentWorkerMessages(
      run.execution,
      {},
    ).memoryDelta!;
    assert.deepEqual(
      frozen.changes.map((item) => [item.name, item.description]),
      [
        ["alpha", "about the Acme customer contract"],
        ["beta", "what beta is about"],
      ],
    );
    f.kernel.memory.humanDelete(f.actor, {
      entryId: alpha.entryId,
      expectedRevision: 1,
      reason: "privacy",
      idempotencyKey: "delete-alpha",
    });
    const again = f.kernel.presentWorkerMessages(
      run.execution,
      {},
    ).memoryDelta!;
    assert.equal(again.throughSeq, frozen.throughSeq, "still the snapshot");
    assert.deepEqual(
      again.changes.map((item) => [item.name, item.description]),
      [
        ["alpha", null],
        ["beta", "what beta is about"],
      ],
    );
    assert.equal(
      Number(
        f.db
          .prepare(
            "SELECT count(*) AS n FROM activation_presented_windows WHERE memory_json LIKE '%Acme%'",
          )
          .get()!.n,
      ),
      0,
    );
    run.finish(0);
  } finally {
    f.close();
  }
});

test("owner ruling 2026-09-27: opening the Kernel clears descriptions a pre-ruling delete left on tombstones", async () => {
  const { RoomKernel } = await import("../src/index.ts");
  const f = roleInstanceFixture();
  try {
    const alpha = write(f, "alpha");
    const beta = write(f, "beta");
    f.kernel.memory.humanDelete(f.actor, {
      entryId: alpha.entryId,
      expectedRevision: 1,
      reason: "privacy",
      idempotencyKey: "delete-alpha",
    });
    // What a delete before the ruling left behind.
    f.db
      .prepare("UPDATE memory_entries SET description='old' WHERE entry_id=?")
      .run(alpha.entryId);
    f.db
      .prepare("UPDATE memory_revisions SET description='old' WHERE entry_id=?")
      .run(alpha.entryId);
    // ...and what a delete before full review 2 P2-3 left: earlier reasons.
    f.db
      .prepare(
        "UPDATE memory_revisions SET reason='old reason' WHERE entry_id IN (?, ?) AND op<>'delete'",
      )
      .run(alpha.entryId, beta.entryId);
    const path = String(f.db.prepare("PRAGMA database_list").get()!.file);
    const reopened = new RoomKernel({ databasePath: path });
    reopened.initialize();
    reopened.close();
    const described = (table: string, entryId: string) =>
      f.db
        .prepare(`SELECT DISTINCT description FROM ${table} WHERE entry_id=?`)
        .all(entryId)
        .map((row) => row.description);
    assert.deepEqual(described("memory_entries", alpha.entryId), [""]);
    assert.deepEqual(described("memory_revisions", alpha.entryId), [""]);
    assert.deepEqual(described("memory_entries", beta.entryId), [
      "what beta is about",
    ]);
    const reasons = (entryId: string) =>
      f.db
        .prepare(
          "SELECT op, reason FROM memory_revisions WHERE entry_id=? ORDER BY revision",
        )
        .all(entryId)
        .map((row) => [row.op, row.reason]);
    assert.deepEqual(reasons(alpha.entryId), [
      ["create", null],
      ["delete", "privacy"],
    ]);
    assert.deepEqual(
      reasons(beta.entryId),
      [["create", "old reason"]],
      "an entry that is not deleted keeps its history",
    );
  } finally {
    f.close();
  }
});

/** Starts a fake run for a Human message to the instance in `roomId`. */
function startRunIn(f: RoleInstanceFixture, roomId: string) {
  f.kernel.postMessage(f.actor, {
    roomId,
    body: "please review",
    idempotencyKey: `wake-${String(Math.random())}`,
    recipients: [{ participantId: f.instance.instanceId, reason: "mention" }],
  });
  return startInstanceRunFromQueue(f);
}

for (const where of ["channel", "private box"] as const)
  test(`full review 2 P1-3 (${where}): a frozen memory snapshot is withheld once reading is revoked, its receipt advances nothing, and re-enabled reading still gets the change`, () => {
    const f = roleInstanceFixture();
    const roomId = () =>
      where === "channel" ? f.home.roomId : f.privateBox.roomId;
    try {
      const writer = startInstanceRun(f);
      f.kernel.memory.write(
        writer.execution,
        entry("secret-index", "secret-description"),
      );
      writer.finish(0);

      const run = startRunIn(f, roomId());
      assert.deepEqual(
        f.kernel
          .presentWorkerMessages(run.execution, {})
          .memoryDelta?.changes.map((item) => [item.name, item.description]),
        [["secret-index", "secret-description"]],
      );
      humanPolicy(f, { readDefault: false });
      const revoked = f.kernel.presentWorkerMessages(run.execution, {});
      assert.equal(revoked.memoryDelta, undefined, "no names after revocation");
      assert.equal(revoked.memoryIndex, undefined);
      assert.equal(JSON.stringify(revoked).includes("secret"), false);
      sent(f, run);
      assert.equal(
        markRow(f)?.through_seq ?? null,
        null,
        "a withheld snapshot is not delivered",
      );
      run.finish(0);

      humanPolicy(f, { readDefault: true });
      const next = startRunIn(f, roomId());
      assert.deepEqual(
        f.kernel
          .presentWorkerMessages(next.execution, {})
          .memoryDelta?.changes.map((item) => item.name),
        ["secret-index"],
        "the change is still owed once reading is back",
      );
      sent(f, next);
      assert.ok(Number(markRow(f)!.through_seq) > 0);
      next.finish(0);
    } finally {
      f.close();
    }
  });

/**
 * Review of the review-2 fixes P1-2: a receipt names a window, never the
 * version of it the Host actually sent. Once a window was withheld it stays
 * withheld for its whole life, so every version of it the Host may have sent
 * after that carries no memory and its receipt advances nothing; the change
 * is presented again in the next window (a duplicate, never an omission).
 */
for (const order of [
  "withheld sent, restored unsent",
  "delta sent, receipt after revocation",
] as const)
  test(`review-2 fixes P1-2 (${order}): a withheld window stays withheld once reading is restored and a late receipt never delivers its delta`, () => {
    const f = roleInstanceFixture();
    try {
      write(f, "alpha");
      const run = startInstanceRun(f);
      const first = f.kernel.presentWorkerMessages(
        run.execution,
        {},
      ).memoryDelta!;
      assert.deepEqual(
        first.changes.map((item) => item.name),
        ["alpha"],
      );
      humanPolicy(f, { readDefault: false });
      assert.equal(
        f.kernel.presentWorkerMessages(run.execution, {}).memoryDelta,
        undefined,
        "B0: no memory while revoked",
      );
      if (order === "withheld sent, restored unsent") {
        humanPolicy(f, { readDefault: true });
        const restored = f.kernel.presentWorkerMessages(run.execution, {});
        assert.equal(
          restored.memoryDelta,
          undefined,
          "the same window is not un-withheld",
        );
        assert.equal(restored.memoryIndex, undefined);
      }
      // The late receipt (of B0, or of the first version) arrives now.
      sent(f, run);
      assert.equal(
        markRow(f)?.through_seq ?? null,
        null,
        "a receipt of a withheld window delivers nothing",
      );
      run.finish(0);

      if (order === "delta sent, receipt after revocation")
        humanPolicy(f, { readDefault: true });
      const next = startInstanceRun(f);
      assert.deepEqual(
        f.kernel
          .presentWorkerMessages(next.execution, {})
          .memoryDelta?.changes.map((item) => item.name),
        ["alpha"],
        "the next window presents the change again",
      );
      sent(f, next);
      assert.equal(Number(markRow(f)!.through_seq), first.throughSeq);
      next.finish(0);
    } finally {
      f.close();
    }
  });
