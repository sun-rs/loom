import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { RoomKernel } from "../src/index.ts";

// The two hot statements, copied verbatim from room-kernel.ts:
// `reconcileAgentDeletions()` runs every 1000ms from the daemon reconciler and
// `#assertWorkerGrantScope` runs on every Worker authorization.
const RECONCILE_SQL = `SELECT e.* FROM room_events e JOIN agent_definitions a ON a.agent_definition_id=e.aggregate_id WHERE e.type='agent.deletion_requested' AND a.state='disabled' ORDER BY e.created_at LIMIT 50`;
const GRANT_SCOPE_SQL = `SELECT 1 FROM agent_definitions a JOIN room_events e ON e.aggregate_id=a.agent_definition_id WHERE a.participant_id=? AND e.type='agent.deletion_requested' LIMIT 1`;

const DELETION_ORDER_INDEX = "idx_room_events_agent_deletion_requested_created";
const DELETION_AGGREGATE_INDEX =
  "idx_room_events_agent_deletion_requested_aggregate";

const UNRELATED_EVENT_TYPES = [
  "message.posted",
  "task.created",
  "activation.leased",
  "inbox.acknowledged",
  "run_attempt.started",
];

/**
 * Builds a temp Kernel database holding a representative volume of unrelated
 * room_events plus a handful of `agent.deletion_requested` events, so that
 * EXPLAIN QUERY PLAN reflects the production shape rather than a toy table.
 * No ANALYZE is run, matching production: the Kernel never collects
 * sqlite_stat1, so the planner must be able to pick the index on structure
 * alone.
 */
function hotspotFixture(options: { unrelatedEvents?: number } = {}) {
  const unrelatedEvents = options.unrelatedEvents ?? 50000;
  const directory = mkdtempSync(join(tmpdir(), "rah-event-hotspot-"));
  const databasePath = join(directory, "room.db");
  let kernel: RoomKernel | undefined = new RoomKernel({ databasePath });
  kernel.initialize();
  const owner = kernel.provisionPrincipal({ handle: "owner", kind: "human" });
  const actor = kernel.authenticateAccessToken(owner.accessToken);
  const workspace = kernel.createWorkspace(actor, {
    idempotencyKey: "workspace",
    name: "Hotspot",
    slug: "hotspot",
  });
  const roomId = workspace.controlRoom.roomId;
  kernel.close();
  kernel = undefined;

  const database = new DatabaseSync(databasePath);
  const actorId = database
    .prepare("SELECT principal_id FROM principals LIMIT 1")
    .get()!.principal_id as string;
  let seq =
    (database
      .prepare("SELECT max(room_seq) s FROM room_events WHERE room_id=?")
      .get(roomId)!.s as number) + 1;
  const insert = database.prepare(
    `INSERT INTO room_events(event_id, room_id, room_seq, type, actor_id, aggregate_type, aggregate_id, payload_json, idempotency_key, schema_version, created_at) VALUES(?,?,?,?,?,?,?,?,?,1,?)`,
  );
  database.exec("BEGIN");
  for (let index = 0; index < unrelatedEvents; index += 1) {
    insert.run(
      `evt-${index}`,
      roomId,
      seq++,
      UNRELATED_EVENT_TYPES[index % UNRELATED_EVENT_TYPES.length]!,
      actorId,
      "message",
      `agg-${index % 2000}`,
      "{}",
      `idem-${index}`,
      new Date(1700000000000 + index * 1000).toISOString(),
    );
  }
  // Real agents, so the join in the reconcile query actually matches. Direct
  // inserts keep the fixture affordable at this row count; every column follows
  // the Kernel schema including the principals/rooms foreign keys.
  const insertPrincipal = database.prepare(
    "INSERT INTO principals(principal_id, handle, kind, created_at) VALUES(?,?,'agent',?)",
  );
  const insertAgent = database.prepare(
    `INSERT INTO agent_definitions(agent_definition_id, participant_id, control_room_id, state, current_revision_id, created_at, updated_at) VALUES(?,?,?,?,?,?,?)`,
  );
  const timestamp = (offsetMs: number) =>
    new Date(1800000000000 + offsetMs).toISOString();
  const addAgent = (key: string, state: string) => {
    const participantId = `participant-${key}`;
    const agentId = `agent-def-${key}`;
    insertPrincipal.run(participantId, `handle-${key}`, timestamp(0));
    insertAgent.run(
      agentId,
      participantId,
      roomId,
      state,
      `revision-${key}`,
      timestamp(0),
      timestamp(0),
    );
    return { agentId, participantId };
  };
  const addDeletionEvent = (aggregateId: string, createdAtMs: number) => {
    const eventId = `del-evt-${aggregateId}`;
    insert.run(
      eventId,
      roomId,
      seq++,
      "agent.deletion_requested",
      actorId,
      "agent",
      aggregateId,
      "{}",
      `del-idem-${aggregateId}`,
      timestamp(createdAtMs),
    );
    return eventId;
  };

  // 55 disabled agents awaiting deletion: more than the query's LIMIT 50, so
  // the ordering decides which rows are returned at all.
  const pendingCount = 55;
  const pending: Array<{
    agentId: string;
    participantId: string;
    createdAtMs: number;
  }> = [];
  for (let index = 0; index < pendingCount; index += 1) {
    const agent = addAgent(`pending-${index}`, "disabled");
    pending.push({ ...agent, createdAtMs: index * 60000 });
  }
  // Insertion order is deliberately shuffled against created_at, so a plan that
  // returns rows in storage order cannot accidentally look sorted.
  const shuffled = [...pending];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swap = (index * 7 + 3) % (index + 1);
    [shuffled[index], shuffled[swap]] = [shuffled[swap]!, shuffled[index]!];
  }
  for (const entry of shuffled) {
    addDeletionEvent(entry.agentId, entry.createdAtMs);
  }

  // Exclusion cases, each with a created_at early enough to win on ordering if
  // the WHERE clause or the join ever stopped filtering them out.
  const enabledWithDeletion = addAgent("enabled-with-deletion", "enabled");
  addDeletionEvent(enabledWithDeletion.agentId, -600000);
  const tombstonedWithDeletion = addAgent(
    "tombstoned-with-deletion",
    "tombstoned",
  );
  addDeletionEvent(tombstonedWithDeletion.agentId, -600000);
  const disabledWithoutDeletion = addAgent(
    "disabled-without-deletion",
    "disabled",
  );
  addDeletionEvent("agent-def-does-not-exist-1", -600000);
  addDeletionEvent("agent-def-does-not-exist-2", -600000);
  database.exec("COMMIT");

  const expectedReconcileIds = pending
    .slice()
    .sort((left, right) => left.createdAtMs - right.createdAtMs)
    .slice(0, 50)
    .map((entry) => entry.agentId);

  const plan = (sql: string, parameters: unknown[] = []): string[] =>
    database
      .prepare(`EXPLAIN QUERY PLAN ${sql}`)
      .all(...(parameters as never[]))
      .map((row) => String((row as { detail: unknown }).detail));

  return {
    database,
    databasePath,
    directory,
    roomId,
    plan,
    reconcilePlan: () => plan(RECONCILE_SQL),
    grantScopePlan: () => plan(GRANT_SCOPE_SQL, [pending[0]!.participantId]),
    pending,
    expectedReconcileIds,
    excluded: {
      enabledWithDeletion,
      tombstonedWithDeletion,
      disabledWithoutDeletion,
      missingAggregateIds: [
        "agent-def-does-not-exist-1",
        "agent-def-does-not-exist-2",
      ],
    },
    cleanup() {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

function eventAccessLine(plan: string[]): string {
  const line = plan.find((detail) => / e\b/.test(detail));
  assert.ok(line, `no room_events access line in plan: ${plan.join(" | ")}`);
  return line;
}

test("the per-second deletion reconcile query reads an index instead of scanning every unrelated room event", () => {
  const fixture = hotspotFixture();
  try {
    const plan = fixture.reconcilePlan();
    const access = eventAccessLine(plan);
    assert.ok(
      access.includes(DELETION_ORDER_INDEX),
      `reconcile plan must read ${DELETION_ORDER_INDEX}, got: ${plan.join(" | ")}`,
    );
    assert.equal(
      access.trim(),
      `SCAN e USING INDEX ${DELETION_ORDER_INDEX}`,
      "reconcile must walk only the partial deletion index, never the room_events table",
    );
    assert.ok(
      !plan.some((detail) => detail.includes("TEMP B-TREE")),
      `reconcile must not sort in a temp b-tree, got: ${plan.join(" | ")}`,
    );
  } finally {
    fixture.cleanup();
  }
});

test("the Worker grant-scope fence looks the deletion event up by aggregate id", () => {
  const fixture = hotspotFixture();
  try {
    const plan = fixture.grantScopePlan();
    const access = eventAccessLine(plan);
    assert.ok(
      access.startsWith("SEARCH e"),
      `grant-scope must search, not scan, got: ${plan.join(" | ")}`,
    );
    assert.ok(
      access.includes(DELETION_AGGREGATE_INDEX) &&
        access.includes("aggregate_id=?"),
      `grant-scope must seek ${DELETION_AGGREGATE_INDEX} by aggregate_id, got: ${plan.join(" | ")}`,
    );
  } finally {
    fixture.cleanup();
  }
});

test("the reconcile query returns the 50 oldest disabled agents awaiting deletion, in created_at order, with or without the indexes", () => {
  const fixture = hotspotFixture({ unrelatedEvents: 2000 });
  try {
    const { database, expectedReconcileIds, excluded } = fixture;
    const aggregateIds = () =>
      database
        .prepare(RECONCILE_SQL)
        .all()
        .map((row) => (row as { aggregate_id: string }).aggregate_id);

    const withIndexes = aggregateIds();
    // The fixture holds 55 pending deletions, so LIMIT 50 is actually binding
    // and the ORDER BY decides which five are left for the next tick.
    assert.equal(withIndexes.length, 50);
    assert.deepEqual(withIndexes, expectedReconcileIds);
    assert.equal(fixture.pending.length, 55);

    const excludedIds = [
      excluded.enabledWithDeletion.agentId,
      excluded.tombstonedWithDeletion.agentId,
      excluded.disabledWithoutDeletion.agentId,
      ...excluded.missingAggregateIds,
    ];
    for (const id of excludedIds) {
      assert.ok(
        !withIndexes.includes(id),
        `${id} must not be reconciled for deletion`,
      );
    }

    // Both created_at values and their order must match, not just the id set.
    const withIndexCreatedAt = database
      .prepare(RECONCILE_SQL)
      .all()
      .map((row) => (row as { created_at: string }).created_at);
    assert.deepEqual(
      withIndexCreatedAt,
      [...withIndexCreatedAt].sort(),
      "reconcile rows must come back in ascending created_at order",
    );

    const fullRowsWithIndexes = database.prepare(RECONCILE_SQL).all();
    database.exec(`DROP INDEX ${DELETION_ORDER_INDEX}`);
    database.exec(`DROP INDEX ${DELETION_AGGREGATE_INDEX}`);
    const fullRowsWithoutIndexes = database.prepare(RECONCILE_SQL).all();
    assert.deepEqual(fullRowsWithoutIndexes, fullRowsWithIndexes);
    assert.deepEqual(aggregateIds(), expectedReconcileIds);
  } finally {
    fixture.cleanup();
  }
});

test("the Worker grant-scope fence matches a deleted Agent's participant and no one else", () => {
  const fixture = hotspotFixture({ unrelatedEvents: 2000 });
  try {
    const { database, excluded } = fixture;
    const fenced = (participantId: string) =>
      database.prepare(GRANT_SCOPE_SQL).get(participantId) !== undefined;

    assert.equal(
      fenced(fixture.pending[0]!.participantId),
      true,
      "a participant with a deletion request must be fenced",
    );
    assert.equal(
      fenced(fixture.pending[fixture.pending.length - 1]!.participantId),
      true,
      "the newest deletion request must fence its participant too",
    );
    // The fence deliberately ignores agent state: a deletion request that has
    // not reached 'disabled' yet still revokes execution.
    assert.equal(
      fenced(excluded.enabledWithDeletion.participantId),
      true,
      "a pending deletion fences before the definition reaches 'disabled'",
    );
    assert.equal(
      fenced(excluded.disabledWithoutDeletion.participantId),
      false,
      "an Agent with no deletion request must not be fenced",
    );
    assert.equal(fenced("participant-does-not-exist"), false);

    database.exec(`DROP INDEX ${DELETION_AGGREGATE_INDEX}`);
    assert.equal(fenced(fixture.pending[0]!.participantId), true);
    assert.equal(fenced(excluded.disabledWithoutDeletion.participantId), false);
  } finally {
    fixture.cleanup();
  }
});

function indexNames(databasePath: string): string[] {
  const database = new DatabaseSync(databasePath);
  try {
    return database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_room_events_agent_deletion_requested%' ORDER BY name",
      )
      .all()
      .map((row) => String((row as { name: unknown }).name));
  } finally {
    database.close();
  }
}

test("repeated initialize() keeps exactly one copy of each deletion index", () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-event-hotspot-repeat-"));
  const databasePath = join(directory, "room.db");
  try {
    for (let run = 0; run < 3; run += 1) {
      const kernel = new RoomKernel({ databasePath });
      kernel.initialize();
      kernel.close();
      assert.deepEqual(indexNames(databasePath), [
        DELETION_AGGREGATE_INDEX,
        DELETION_ORDER_INDEX,
      ]);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("initialize() adds the deletion indexes to a populated database that predates them, without touching its rows", () => {
  const fixture = hotspotFixture({ unrelatedEvents: 2000 });
  try {
    const { database, databasePath } = fixture;
    // Simulate the pre-index database shipped by the previous build.
    database.exec(`DROP INDEX ${DELETION_ORDER_INDEX}`);
    database.exec(`DROP INDEX ${DELETION_AGGREGATE_INDEX}`);
    assert.deepEqual(indexNames(databasePath), []);
    const eventsBefore = database
      .prepare("SELECT count(*) n FROM room_events")
      .get()!.n as number;
    const digestBefore = database
      .prepare(
        "SELECT group_concat(event_id) g FROM (SELECT event_id FROM room_events ORDER BY room_seq LIMIT 200)",
      )
      .get()!.g as string;
    database.close();

    const kernel = new RoomKernel({ databasePath });
    kernel.initialize();
    kernel.close();

    assert.deepEqual(indexNames(databasePath), [
      DELETION_AGGREGATE_INDEX,
      DELETION_ORDER_INDEX,
    ]);
    const reopened = new DatabaseSync(databasePath);
    try {
      assert.equal(
        reopened.prepare("SELECT count(*) n FROM room_events").get()!.n,
        eventsBefore,
      );
      assert.equal(
        reopened
          .prepare(
            "SELECT group_concat(event_id) g FROM (SELECT event_id FROM room_events ORDER BY room_seq LIMIT 200)",
          )
          .get()!.g,
        digestBefore,
      );
    } finally {
      reopened.close();
    }
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("a blocked deletion index makes initialize() fail with an actionable message and leaves the database startable once the blocker is gone", () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-event-hotspot-fail-"));
  const databasePath = join(directory, "room.db");
  try {
    const first = new RoomKernel({ databasePath });
    first.initialize();
    first.close();

    const database = new DatabaseSync(databasePath);
    database.exec(`DROP INDEX ${DELETION_ORDER_INDEX}`);
    database.exec(`DROP INDEX ${DELETION_AGGREGATE_INDEX}`);
    // A name collision is the realistic failure: some other object already owns
    // the index name, so CREATE INDEX IF NOT EXISTS still fails.
    database.exec(`CREATE TABLE ${DELETION_ORDER_INDEX}(blocker TEXT)`);
    database.close();

    const blocked = new RoomKernel({ databasePath });
    assert.throws(
      () => blocked.initialize(),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /room_events/);
        assert.match(error.message, new RegExp(DELETION_ORDER_INDEX));
        assert.match(error.message, /safe to retry/i);
        return true;
      },
    );
    blocked.close();

    const cleaner = new DatabaseSync(databasePath);
    cleaner.exec(`DROP TABLE ${DELETION_ORDER_INDEX}`);
    cleaner.close();

    const retried = new RoomKernel({ databasePath });
    retried.initialize();
    retried.close();
    assert.deepEqual(indexNames(databasePath), [
      DELETION_AGGREGATE_INDEX,
      DELETION_ORDER_INDEX,
    ]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
