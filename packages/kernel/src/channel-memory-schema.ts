/**
 * evo S6 batch A (schema 74): channel-scoped platform memory. The Kernel is
 * the single owner: `memory_entries` is the projection, `memory_revisions`
 * the immutable history (a Human delete redacts bodies only), the switch
 * tables hold the channel defaults and per-instance overrides, and the FTS5
 * table indexes the active entries for retrieval. Provenance columns are
 * plain text on purpose: they record history and survive the deletion of a
 * private box or a RunAttempt. Nothing here is materialized as a file.
 */
export const CHANNEL_MEMORY_SCHEMA = `
CREATE TABLE IF NOT EXISTS memory_entries (
  entry_id TEXT PRIMARY KEY,
  scope_room_id TEXT NOT NULL REFERENCES rooms(room_id),
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('user', 'feedback', 'project', 'reference')),
  description TEXT NOT NULL,
  body TEXT,
  pinned INTEGER NOT NULL CHECK (pinned IN (0, 1)),
  state TEXT NOT NULL CHECK (state IN ('active', 'invalidated', 'deleted')),
  revision INTEGER NOT NULL CHECK (revision > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((state = 'deleted') = (body IS NULL))
) STRICT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_entries_scope_name
  ON memory_entries(scope_room_id, name) WHERE state <> 'deleted';
CREATE INDEX IF NOT EXISTS idx_memory_entries_scope_order
  ON memory_entries(scope_room_id, state, pinned, updated_at);
CREATE TABLE IF NOT EXISTS memory_revisions (
  entry_id TEXT NOT NULL REFERENCES memory_entries(entry_id),
  revision INTEGER NOT NULL CHECK (revision > 0),
  op TEXT NOT NULL CHECK (op IN ('create', 'update', 'invalidate', 'restore', 'pin', 'unpin', 'delete')),
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  description TEXT NOT NULL,
  body TEXT,
  body_sha256 TEXT,
  pinned INTEGER NOT NULL CHECK (pinned IN (0, 1)),
  state TEXT NOT NULL CHECK (state IN ('active', 'invalidated', 'deleted')),
  reason TEXT,
  actor_principal_id TEXT NOT NULL,
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('instance', 'human')),
  role_id TEXT,
  role_revision_id TEXT,
  instance_id TEXT,
  model_binding_id TEXT,
  model_reasoning TEXT,
  session_generation INTEGER,
  run_attempt_id TEXT,
  via_room_id TEXT,
  based_on_room_seq INTEGER,
  idempotency_key TEXT NOT NULL,
  event_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  import_instance_id TEXT,
  import_path TEXT,
  PRIMARY KEY (entry_id, revision)
) STRICT;
CREATE TABLE IF NOT EXISTS memory_access_policies (
  room_id TEXT PRIMARY KEY REFERENCES rooms(room_id),
  read_default INTEGER NOT NULL CHECK (read_default IN (0, 1)),
  write_default INTEGER NOT NULL CHECK (write_default IN (0, 1)),
  revision INTEGER NOT NULL CHECK (revision > 0),
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS memory_access_overrides (
  room_id TEXT NOT NULL REFERENCES rooms(room_id),
  instance_id TEXT NOT NULL,
  read_enabled INTEGER CHECK (read_enabled IS NULL OR read_enabled IN (0, 1)),
  write_enabled INTEGER CHECK (write_enabled IS NULL OR write_enabled IN (0, 1)),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (room_id, instance_id)
) STRICT;
CREATE VIRTUAL TABLE IF NOT EXISTS memory_entries_fts USING fts5(
  entry_id UNINDEXED,
  name,
  description,
  body,
  tokenize = 'trigram'
);
`;
