import type { DatabaseSync } from "node:sqlite";

export const ROOM_LEDGER_SCHEMA_VERSION = 7;

const ROOM_CATALOG_SCHEMA = `
CREATE TABLE IF NOT EXISTS room_catalog_memberships (
  catalog_seq INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  UNIQUE (room_id, principal_id),
  FOREIGN KEY (room_id, principal_id)
    REFERENCES room_memberships(room_id, principal_id)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_room_catalog_principal_window
  ON room_catalog_memberships(principal_id, catalog_seq);

CREATE TABLE IF NOT EXISTS room_direct_pairs (
  workspace_key TEXT NOT NULL,
  principal_low TEXT NOT NULL REFERENCES room_principals(principal_id),
  principal_high TEXT NOT NULL REFERENCES room_principals(principal_id),
  room_id TEXT NOT NULL UNIQUE REFERENCES rooms(room_id),
  PRIMARY KEY (workspace_key, principal_low, principal_high),
  CHECK (principal_low < principal_high)
) STRICT;
`;

const ROOM_ACTIVATION_SCHEMA = `
CREATE TABLE IF NOT EXISTS room_activations (
  activation_seq INTEGER PRIMARY KEY AUTOINCREMENT,
  activation_id TEXT NOT NULL UNIQUE,
  room_id TEXT NOT NULL REFERENCES rooms(room_id),
  participant_id TEXT NOT NULL REFERENCES room_principals(principal_id),
  from_seq INTEGER NOT NULL CHECK (from_seq > 0),
  to_seq INTEGER NOT NULL CHECK (to_seq >= from_seq),
  reason TEXT NOT NULL CHECK (reason IN (
    'mention', 'direct_message', 'room_policy', 'task_assignment',
    'dependency_resolved', 'input_resolved'
  )),
  state TEXT NOT NULL CHECK (state IN (
    'queued', 'leased', 'completed', 'quarantined', 'cancelled'
  )),
  pulled_through_seq INTEGER NOT NULL DEFAULT 0 CHECK (pulled_through_seq >= 0),
  available_at TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  lease_owner TEXT,
  lease_token TEXT,
  lease_expires_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_room_activations_claim
  ON room_activations(state, available_at, participant_id, activation_seq);

CREATE INDEX IF NOT EXISTS idx_room_activation_queued_lane
  ON room_activations(room_id, participant_id, activation_seq)
  WHERE state = 'queued';

CREATE TABLE IF NOT EXISTS room_activation_receipts (
  hint_id TEXT PRIMARY KEY,
  receipt_id TEXT NOT NULL UNIQUE,
  activation_id TEXT REFERENCES room_activations(activation_id),
  participant_id TEXT NOT NULL REFERENCES room_principals(principal_id),
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS room_run_attempts (
  run_attempt_id TEXT PRIMARY KEY,
  activation_id TEXT NOT NULL REFERENCES room_activations(activation_id),
  attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
  room_id TEXT NOT NULL REFERENCES rooms(room_id),
  participant_id TEXT NOT NULL REFERENCES room_principals(principal_id),
  worker_id TEXT,
  lease_token TEXT,
  runtime_profile_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  workspace TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('prepared', 'running', 'exited', 'failed')),
  provider_session_id TEXT,
  started_at TEXT,
  ended_at TEXT,
  exit_code INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (activation_id, attempt_number)
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_room_run_one_active_activation
  ON room_run_attempts(activation_id)
  WHERE state IN ('prepared', 'running');

CREATE TABLE IF NOT EXISTS room_activation_outcomes (
  activation_id TEXT NOT NULL REFERENCES room_activations(activation_id),
  event_id TEXT NOT NULL UNIQUE REFERENCES room_events(event_id),
  run_attempt_id TEXT NOT NULL REFERENCES room_run_attempts(run_attempt_id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (activation_id, event_id)
) STRICT;
`;

const ROOM_TASK_SCHEMA = `
CREATE TABLE IF NOT EXISTS room_tasks (
  task_id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(room_id),
  task_number INTEGER NOT NULL CHECK (task_number > 0),
  source_message_id TEXT NOT NULL UNIQUE REFERENCES room_messages(message_id),
  thread_id TEXT NOT NULL UNIQUE REFERENCES room_threads(thread_id),
  creator_id TEXT NOT NULL REFERENCES room_principals(principal_id),
  assignee_id TEXT REFERENCES room_principals(principal_id),
  title TEXT NOT NULL,
  description TEXT,
  state TEXT NOT NULL CHECK (state IN (
    'todo', 'claimed', 'in_progress', 'waiting_input', 'blocked',
    'submitted', 'completed', 'cancelled'
  )),
  claimed_by TEXT REFERENCES room_principals(principal_id),
  claim_until TEXT,
  submission_summary TEXT,
  submitted_at TEXT,
  completed_at TEXT,
  cancelled_at TEXT,
  cancellation_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (room_id, task_number)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_room_tasks_state
  ON room_tasks(room_id, state, task_number);

CREATE TABLE IF NOT EXISTS room_task_reviewers (
  task_id TEXT NOT NULL REFERENCES room_tasks(task_id),
  participant_id TEXT NOT NULL REFERENCES room_principals(principal_id),
  PRIMARY KEY (task_id, participant_id)
) STRICT;

CREATE TABLE IF NOT EXISTS room_task_dependencies (
  task_id TEXT NOT NULL REFERENCES room_tasks(task_id),
  dependency_task_id TEXT NOT NULL REFERENCES room_tasks(task_id),
  PRIMARY KEY (task_id, dependency_task_id),
  CHECK (task_id <> dependency_task_id)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_room_task_dependencies_reverse
  ON room_task_dependencies(dependency_task_id, task_id);

CREATE TABLE IF NOT EXISTS room_task_submissions (
  submission_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES room_tasks(task_id),
  room_id TEXT NOT NULL REFERENCES rooms(room_id),
  submission_number INTEGER NOT NULL CHECK (submission_number > 0),
  submission_digest TEXT NOT NULL,
      producer_id TEXT NOT NULL REFERENCES room_principals(principal_id),
      message_id TEXT NOT NULL REFERENCES room_messages(message_id),
      summary TEXT NOT NULL,
      evidence_json TEXT NOT NULL CHECK(json_valid(evidence_json)),
      evidence_digest TEXT NOT NULL,
      created_at TEXT NOT NULL,
  UNIQUE (task_id, submission_number),
  UNIQUE (task_id, submission_digest)
) STRICT;

CREATE TABLE IF NOT EXISTS room_task_reviews (
  review_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES room_tasks(task_id),
  room_id TEXT NOT NULL REFERENCES rooms(room_id),
  submission_id TEXT NOT NULL REFERENCES room_task_submissions(submission_id),
  submission_digest TEXT NOT NULL,
  reviewer_id TEXT NOT NULL REFERENCES room_principals(principal_id),
  disposition TEXT NOT NULL CHECK (disposition IN ('approved', 'changes_requested')),
  summary TEXT NOT NULL,
  message_id TEXT NOT NULL REFERENCES room_messages(message_id),
  created_at TEXT NOT NULL,
  UNIQUE (submission_id, reviewer_id)
) STRICT;
`;

export const ROOM_LEDGER_SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 250;

CREATE TABLE IF NOT EXISTS room_principals (
  principal_id TEXT PRIMARY KEY,
  handle TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('human', 'agent', 'service')),
  display_name TEXT,
  avatar_key TEXT,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS room_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS rooms (
  room_id TEXT PRIMARY KEY,
  workspace_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('channel', 'direct', 'control')),
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  visibility TEXT NOT NULL CHECK (visibility IN ('public', 'private')),
  next_seq INTEGER NOT NULL DEFAULT 1 CHECK (next_seq > 0),
  created_at TEXT NOT NULL,
  archived_at TEXT,
  UNIQUE (workspace_key, slug)
) STRICT;

CREATE TABLE IF NOT EXISTS room_memberships (
  room_id TEXT NOT NULL REFERENCES rooms(room_id),
  principal_id TEXT NOT NULL REFERENCES room_principals(principal_id),
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  joined_at TEXT NOT NULL,
  PRIMARY KEY (room_id, principal_id)
) STRICT;

${ROOM_CATALOG_SCHEMA}

CREATE TABLE IF NOT EXISTS room_events (
  event_id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(room_id),
  room_seq INTEGER NOT NULL CHECK (room_seq > 0),
  type TEXT NOT NULL,
  actor_id TEXT NOT NULL REFERENCES room_principals(principal_id),
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  created_at TEXT NOT NULL,
  UNIQUE (room_id, room_seq)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_room_events_window
  ON room_events(room_id, room_seq);

CREATE TABLE IF NOT EXISTS room_messages (
  message_id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(room_id),
  room_seq INTEGER NOT NULL,
  actor_id TEXT NOT NULL REFERENCES room_principals(principal_id),
  body TEXT NOT NULL,
  thread_id TEXT,
  root_message_id TEXT,
  reply_to_message_id TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (room_id, room_seq),
  FOREIGN KEY (room_id, room_seq) REFERENCES room_events(room_id, room_seq)
) STRICT;

CREATE TABLE IF NOT EXISTS room_threads (
  thread_id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(room_id),
  root_message_id TEXT NOT NULL UNIQUE REFERENCES room_messages(message_id),
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS room_inbox_items (
  inbox_seq INTEGER PRIMARY KEY AUTOINCREMENT,
  inbox_item_id TEXT NOT NULL UNIQUE,
  room_id TEXT NOT NULL REFERENCES rooms(room_id),
  participant_id TEXT NOT NULL REFERENCES room_principals(principal_id),
  event_id TEXT NOT NULL REFERENCES room_events(event_id),
  event_seq INTEGER NOT NULL CHECK (event_seq > 0),
  reason TEXT NOT NULL CHECK (reason IN (
    'mention', 'direct_message', 'room_policy', 'task_assignment',
    'dependency_resolved', 'input_resolved'
  )),
  disposition TEXT NOT NULL CHECK (disposition IN ('activation', 'notification')),
  state TEXT NOT NULL CHECK (state IN ('pending', 'acknowledged')),
  created_at TEXT NOT NULL,
  acknowledged_at TEXT,
  UNIQUE (participant_id, event_id),
  FOREIGN KEY (room_id, event_seq) REFERENCES room_events(room_id, room_seq)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_room_inbox_pending
  ON room_inbox_items(participant_id, state, inbox_seq);

CREATE INDEX IF NOT EXISTS idx_room_inbox_window
  ON room_inbox_items(participant_id, inbox_seq);

CREATE INDEX IF NOT EXISTS idx_room_inbox_room_pending
  ON room_inbox_items(participant_id, state, room_id);

CREATE TABLE IF NOT EXISTS room_outbox (
  outbox_seq INTEGER PRIMARY KEY AUTOINCREMENT,
  outbox_id TEXT NOT NULL UNIQUE,
  room_id TEXT NOT NULL REFERENCES rooms(room_id),
  room_seq INTEGER NOT NULL,
  topic TEXT NOT NULL CHECK (topic IN ('room.event', 'inbox.available')),
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  available_at TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  lease_owner TEXT,
  lease_token TEXT,
  lease_expires_at TEXT,
  last_error TEXT,
  quarantined_at TEXT,
  blocked_at TEXT,
  failure_class TEXT,
  action_required TEXT,
  sticky INTEGER NOT NULL DEFAULT 0 CHECK (sticky IN (0, 1)),
  last_attempt_id TEXT,
  delivery_receipt TEXT,
  published_by TEXT,
  published_lease_token TEXT,
  published_at TEXT,
  FOREIGN KEY (room_id, room_seq) REFERENCES room_events(room_id, room_seq)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_room_outbox_pending
  ON room_outbox(published_at, available_at, lease_expires_at, outbox_seq);

CREATE TABLE IF NOT EXISTS room_commands (
  actor_id TEXT NOT NULL REFERENCES room_principals(principal_id),
  idempotency_key TEXT NOT NULL,
  command_kind TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  event_id TEXT NOT NULL REFERENCES room_events(event_id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (actor_id, idempotency_key)
) STRICT;

${ROOM_ACTIVATION_SCHEMA}
${ROOM_TASK_SCHEMA}

PRAGMA user_version = ${ROOM_LEDGER_SCHEMA_VERSION};
`;

/** Transactional, fail-closed migration from the deployed v1 Room ledger. */
export function migrateRoomLedgerV1ToV2(database: DatabaseSync): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(ROOM_CATALOG_SCHEMA);
    database.exec(`
      INSERT INTO room_catalog_memberships(room_id, principal_id)
      SELECT room_id, principal_id
      FROM room_memberships
      ORDER BY joined_at, room_id, principal_id;

      INSERT INTO room_direct_pairs(workspace_key, principal_low, principal_high, room_id)
      SELECT
        room.workspace_key,
        MIN(membership.principal_id),
        MAX(membership.principal_id),
        room.room_id
      FROM rooms AS room
      JOIN room_memberships AS membership ON membership.room_id = room.room_id
      WHERE room.kind = 'direct'
      GROUP BY room.room_id, room.workspace_key
      HAVING COUNT(*) = 2;

      PRAGMA user_version = 2;
    `);
    database.exec("COMMIT");
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch {
      // Keep the migration failure as the primary error.
    }
    throw error;
  }
}

/** Adds fail-closed poison-row isolation without rewriting durable outbox identity. */
export function migrateRoomLedgerV2ToV3(database: DatabaseSync): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    const table = database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'room_outbox'",
      )
      .get() as { name?: string } | undefined;
    if (table?.name) {
      const columns = database
        .prepare("PRAGMA table_info(room_outbox)")
        .all() as Array<{
        name?: string;
      }>;
      const additions = [
        ["quarantined_at", "TEXT"],
        ["blocked_at", "TEXT"],
        ["failure_class", "TEXT"],
        ["action_required", "TEXT"],
        ["sticky", "INTEGER NOT NULL DEFAULT 0 CHECK (sticky IN (0, 1))"],
        ["last_attempt_id", "TEXT"],
        ["delivery_receipt", "TEXT"],
      ] as const;
      const existing = new Set(columns.map((column) => column.name));
      for (const [name, definition] of additions) {
        if (!existing.has(name)) {
          database.exec(
            `ALTER TABLE room_outbox ADD COLUMN ${name} ${definition}`,
          );
        }
      }
    }
    database.exec(ROOM_ACTIVATION_SCHEMA);
    database.exec("PRAGMA user_version = 3");
    database.exec("COMMIT");
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch {
      // Keep the migration failure as the primary error.
    }
    throw error;
  }
}

/** Adds stable thread references used by replies and Task anchors. */
export function migrateRoomLedgerV3ToV4(database: DatabaseSync): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    const principalColumns = database
      .prepare("PRAGMA table_info(room_principals)")
      .all() as Array<{
      name?: string;
    }>;
    if (!principalColumns.some((column) => column.name === "avatar_key")) {
      database.exec("ALTER TABLE room_principals ADD COLUMN avatar_key TEXT");
    }
    const messageTable = database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'room_messages'",
      )
      .get() as { name?: string } | undefined;
    const columns = database
      .prepare("PRAGMA table_info(room_messages)")
      .all() as Array<{
      name?: string;
    }>;
    const existing = new Set(columns.map((column) => column.name));
    if (messageTable?.name) {
      for (const [name, definition] of [
        ["thread_id", "TEXT"],
        ["root_message_id", "TEXT"],
        ["reply_to_message_id", "TEXT"],
      ] as const) {
        if (!existing.has(name)) {
          database.exec(
            `ALTER TABLE room_messages ADD COLUMN ${name} ${definition}`,
          );
        }
      }
    }
    database.exec(`
      CREATE TABLE IF NOT EXISTS room_threads (
        thread_id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL REFERENCES rooms(room_id),
        root_message_id TEXT NOT NULL UNIQUE REFERENCES room_messages(message_id),
        created_at TEXT NOT NULL
      ) STRICT;
    `);
    database.exec(ROOM_TASK_SCHEMA);
    database.exec(ROOM_ACTIVATION_SCHEMA);
    database.exec("PRAGMA user_version = 4");
    database.exec("COMMIT");
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch {
      /* preserve primary error */
    }
    throw error;
  }
}

/** Persists the Worker fence used to authenticate safe terminal replays. */
export function migrateRoomLedgerV4ToV5(database: DatabaseSync): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    const columns = database
      .prepare("PRAGMA table_info(room_run_attempts)")
      .all() as Array<{
      name?: string;
    }>;
    const existing = new Set(columns.map((column) => column.name));
    if (!existing.has("worker_id")) {
      database.exec("ALTER TABLE room_run_attempts ADD COLUMN worker_id TEXT");
    }
    if (!existing.has("lease_token")) {
      database.exec(
        "ALTER TABLE room_run_attempts ADD COLUMN lease_token TEXT",
      );
    }
    database.exec(`
      UPDATE room_run_attempts
      SET state = 'failed', ended_at = COALESCE(ended_at, updated_at)
      WHERE state IN ('prepared', 'running')
        AND (worker_id IS NULL OR lease_token IS NULL);
      PRAGMA user_version = 5;
    `);
    database.exec("COMMIT");
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch {
      /* preserve primary error */
    }
    throw error;
  }
}

/** Separates durable notification delivery from actionable Agent activation. */
export function migrateRoomLedgerV5ToV6(database: DatabaseSync): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    const table = database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'room_inbox_items'",
      )
      .get() as { name?: string } | undefined;
    if (table?.name) {
      const columns = database
        .prepare("PRAGMA table_info(room_inbox_items)")
        .all() as Array<{
        name?: string;
      }>;
      if (!columns.some((column) => column.name === "disposition")) {
        database.exec(
          "ALTER TABLE room_inbox_items ADD COLUMN disposition TEXT NOT NULL DEFAULT 'activation' CHECK (disposition IN ('activation', 'notification'))",
        );
      }
    }
    database.exec("PRAGMA user_version = 6");
    database.exec("COMMIT");
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch {
      /* preserve primary error */
    }
    throw error;
  }
}

/** Replaces the unbounded singleton queue with bounded ordered Activation lanes. */
export function migrateRoomLedgerV6ToV7(database: DatabaseSync): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(`
      DROP INDEX IF EXISTS idx_room_activation_one_queued_lane;
      CREATE INDEX IF NOT EXISTS idx_room_activation_queued_lane
        ON room_activations(room_id, participant_id, activation_seq)
        WHERE state = 'queued';
      PRAGMA user_version = 7;
    `);
    database.exec("COMMIT");
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch {
      /* preserve primary error */
    }
    throw error;
  }
}
