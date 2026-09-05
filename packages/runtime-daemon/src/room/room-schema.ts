import type { DatabaseSync } from "node:sqlite";

export const ROOM_LEDGER_SCHEMA_VERSION = 2;

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

export const ROOM_LEDGER_SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 250;

CREATE TABLE IF NOT EXISTS room_principals (
  principal_id TEXT PRIMARY KEY,
  handle TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('human', 'agent', 'service')),
  display_name TEXT,
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
  created_at TEXT NOT NULL,
  UNIQUE (room_id, room_seq),
  FOREIGN KEY (room_id, room_seq) REFERENCES room_events(room_id, room_seq)
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

      PRAGMA user_version = ${ROOM_LEDGER_SCHEMA_VERSION};
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
