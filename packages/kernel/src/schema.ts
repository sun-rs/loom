import type { DatabaseSync } from "node:sqlite";

export const LEGACY_WORKSPACE_ID = "workspace_legacy";

export const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS principals (
  principal_id TEXT PRIMARY KEY,
  handle TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('human', 'agent', 'service')),
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS principal_credentials (
  credential_id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL REFERENCES principals(principal_id),
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  revoked_at TEXT
) STRICT;

CREATE INDEX IF NOT EXISTS idx_principal_credentials_active
  ON principal_credentials(principal_id, revoked_at);

CREATE TABLE IF NOT EXISTS agent_hosts (
  host_id TEXT PRIMARY KEY,
  credential_id TEXT,
  instance_id TEXT NOT NULL,
  build_version TEXT,
  protocol_version INTEGER,
  process_id INTEGER,
  participant_ids_json TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('online', 'draining', 'offline')),
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  last_seen_ms INTEGER NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_agent_hosts_state_seen
  ON agent_hosts(state, last_seen_ms);

CREATE TABLE IF NOT EXISTS agent_host_credentials (
  credential_id TEXT PRIMARY KEY,
  host_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  participant_ids_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT
) STRICT;

CREATE INDEX IF NOT EXISTS idx_agent_host_credentials_active
  ON agent_host_credentials(host_id, revoked_at);

CREATE TABLE IF NOT EXISTS workspaces (
  workspace_id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('active', 'archived')),
  created_at TEXT NOT NULL,
  archived_at TEXT,
  CHECK ((state = 'active' AND archived_at IS NULL) OR (state = 'archived' AND archived_at IS NOT NULL))
) STRICT;

CREATE TABLE IF NOT EXISTS rooms (
  room_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
  kind TEXT NOT NULL CHECK (kind IN ('channel', 'direct', 'control')),
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  next_seq INTEGER NOT NULL DEFAULT 1 CHECK (next_seq > 0),
  created_at TEXT NOT NULL,
  archived_at TEXT,
  UNIQUE (workspace_id, slug)
) STRICT;

CREATE TABLE IF NOT EXISTS memberships (
  room_id TEXT NOT NULL REFERENCES rooms(room_id),
  principal_id TEXT NOT NULL REFERENCES principals(principal_id),
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  joined_at TEXT NOT NULL,
  PRIMARY KEY (room_id, principal_id)
) STRICT;

CREATE TABLE IF NOT EXISTS messages (
  message_id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(room_id),
  actor_id TEXT NOT NULL REFERENCES principals(principal_id),
  thread_id TEXT,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (room_id, message_id),
  FOREIGN KEY (room_id, thread_id) REFERENCES threads(room_id, thread_id)
) STRICT;

CREATE TABLE IF NOT EXISTS threads (
  thread_id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(room_id),
  root_message_id TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES principals(principal_id),
  reply_count INTEGER NOT NULL DEFAULT 0 CHECK (reply_count >= 0),
  created_at TEXT NOT NULL,
  last_reply_at TEXT,
  UNIQUE (room_id, thread_id),
  UNIQUE (root_message_id),
  FOREIGN KEY (room_id, root_message_id) REFERENCES messages(room_id, message_id)
) STRICT;

CREATE TABLE IF NOT EXISTS tasks (
  task_id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(room_id),
  creator_id TEXT NOT NULL REFERENCES principals(principal_id),
  assignee_id TEXT REFERENCES principals(principal_id),
  title TEXT NOT NULL,
  description TEXT,
  state TEXT NOT NULL CHECK (state IN ('todo', 'claimed', 'in_progress', 'waiting_input', 'blocked', 'submitted', 'completed', 'cancelled')),
  claimed_by TEXT REFERENCES principals(principal_id),
  claim_until TEXT,
  claim_until_ms INTEGER,
  last_progress TEXT,
  submission_summary TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  submitted_at TEXT,
  completed_at TEXT,
  blocked_reason TEXT,
  blocked_at TEXT,
  cancellation_reason TEXT,
  cancelled_at TEXT
) STRICT;

CREATE INDEX IF NOT EXISTS idx_tasks_room_state
  ON tasks(room_id, state, created_at, task_id);

CREATE INDEX IF NOT EXISTS idx_tasks_assignee_claim
  ON tasks(assignee_id, state, claim_until_ms);

CREATE TABLE IF NOT EXISTS task_dependencies (
  task_id TEXT NOT NULL REFERENCES tasks(task_id),
  dependency_task_id TEXT NOT NULL REFERENCES tasks(task_id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (task_id, dependency_task_id),
  CHECK (task_id <> dependency_task_id)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_task_dependencies_dependency
  ON task_dependencies(dependency_task_id, task_id);

CREATE TABLE IF NOT EXISTS input_requests (
  input_request_id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(room_id),
  task_id TEXT NOT NULL REFERENCES tasks(task_id),
  requester_id TEXT NOT NULL REFERENCES principals(principal_id),
  responder_id TEXT NOT NULL REFERENCES principals(principal_id),
  question TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'resolved')),
  answer TEXT,
  resolved_by TEXT REFERENCES principals(principal_id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  resolved_at TEXT
) STRICT;

CREATE INDEX IF NOT EXISTS idx_input_requests_room_state
  ON input_requests(room_id, state, created_at, input_request_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_one_pending_input_per_task
  ON input_requests(task_id)
  WHERE state = 'pending';

CREATE TABLE IF NOT EXISTS room_events (
  event_id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(room_id),
  room_seq INTEGER NOT NULL CHECK (room_seq > 0),
  type TEXT NOT NULL,
  actor_id TEXT NOT NULL REFERENCES principals(principal_id),
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  schema_version INTEGER NOT NULL CHECK (schema_version > 0),
  created_at TEXT NOT NULL,
  UNIQUE (room_id, room_seq),
  UNIQUE (room_id, idempotency_key)
) STRICT;

CREATE TABLE IF NOT EXISTS inbox_items (
  inbox_item_id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(room_id),
  participant_id TEXT NOT NULL REFERENCES principals(principal_id),
  event_id TEXT NOT NULL REFERENCES room_events(event_id),
  event_seq INTEGER NOT NULL CHECK (event_seq > 0),
  reason TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'acknowledged')),
  created_at TEXT NOT NULL,
  acknowledged_at TEXT,
  UNIQUE (participant_id, event_id)
) STRICT;

CREATE TABLE IF NOT EXISTS activations (
  activation_id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(room_id),
  participant_id TEXT NOT NULL REFERENCES principals(principal_id),
  from_seq INTEGER NOT NULL CHECK (from_seq > 0),
  to_seq INTEGER NOT NULL CHECK (to_seq >= from_seq),
  reason TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('queued', 'leased', 'quarantined', 'completed', 'cancelled')),
  lease_owner TEXT,
  lease_until TEXT,
  lease_until_ms INTEGER,
  available_at TEXT NOT NULL,
  available_at_ms INTEGER NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_one_queued_activation_per_lane
  ON activations(room_id, participant_id)
  WHERE state = 'queued';

CREATE INDEX IF NOT EXISTS idx_activation_lease_queue
  ON activations(state, available_at_ms, lease_until_ms, created_at);

CREATE TABLE IF NOT EXISTS execution_policies (
  execution_policy_id TEXT PRIMARY KEY,
  control_room_id TEXT NOT NULL REFERENCES rooms(room_id),
  current_revision_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS execution_policy_revisions (
  execution_policy_revision_id TEXT PRIMARY KEY,
  execution_policy_id TEXT NOT NULL REFERENCES execution_policies(execution_policy_id),
  control_room_id TEXT NOT NULL REFERENCES rooms(room_id),
  revision INTEGER NOT NULL CHECK (revision > 0),
  content_digest TEXT NOT NULL,
  policy_json TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES principals(principal_id),
  created_at TEXT NOT NULL,
  UNIQUE (execution_policy_id, revision)
) STRICT;

CREATE TABLE IF NOT EXISTS agent_definitions (
  agent_definition_id TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL UNIQUE REFERENCES principals(principal_id),
  control_room_id TEXT NOT NULL REFERENCES rooms(room_id),
  state TEXT NOT NULL CHECK (state IN ('enabled', 'disabled', 'tombstoned')),
  current_revision_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS agent_definition_revisions (
  agent_definition_revision_id TEXT PRIMARY KEY,
  agent_definition_id TEXT NOT NULL REFERENCES agent_definitions(agent_definition_id),
  revision INTEGER NOT NULL CHECK (revision > 0),
  content_digest TEXT NOT NULL,
  definition_json TEXT NOT NULL,
  execution_policy_revision_id TEXT NOT NULL REFERENCES execution_policy_revisions(execution_policy_revision_id),
  created_by TEXT NOT NULL REFERENCES principals(principal_id),
  created_at TEXT NOT NULL,
  UNIQUE (agent_definition_id, revision)
) STRICT;

CREATE TABLE IF NOT EXISTS runtime_offers (
  runtime_offer_id TEXT PRIMARY KEY,
  current_observation_id TEXT NOT NULL UNIQUE,
  current_snapshot_digest TEXT NOT NULL,
  host_id TEXT NOT NULL,
  host_instance_id TEXT NOT NULL,
  runtime_profile_id TEXT NOT NULL,
  runtime_profile_revision_id TEXT NOT NULL,
  revision_digest TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('available', 'degraded', 'draining', 'unavailable')),
  observed_at TEXT NOT NULL,
  observed_at_ms INTEGER NOT NULL,
  lease_until TEXT NOT NULL,
  lease_until_ms INTEGER NOT NULL,
  accepted_at TEXT NOT NULL,
  offer_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_runtime_offers_fresh
  ON runtime_offers(state, lease_until_ms, host_id, runtime_offer_id);

CREATE TABLE IF NOT EXISTS runtime_offer_observations (
  runtime_offer_observation_id TEXT PRIMARY KEY,
  runtime_offer_id TEXT NOT NULL,
  observation_sequence INTEGER NOT NULL CHECK (observation_sequence > 0),
  runtime_offer_snapshot_digest TEXT NOT NULL UNIQUE,
  host_id TEXT NOT NULL,
  host_instance_id TEXT NOT NULL,
  runtime_profile_revision_id TEXT NOT NULL,
  revision_digest TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  observed_at_ms INTEGER NOT NULL,
  accepted_at TEXT NOT NULL,
  accepted_at_ms INTEGER NOT NULL,
  lease_until TEXT NOT NULL,
  lease_until_ms INTEGER NOT NULL,
  report_json TEXT NOT NULL,
  projection_json TEXT NOT NULL,
  UNIQUE (runtime_offer_id, observation_sequence),
  UNIQUE (runtime_offer_id, observed_at_ms)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_runtime_offer_observations_history
  ON runtime_offer_observations(runtime_offer_id, observation_sequence);

CREATE TABLE IF NOT EXISTS placements (
  placement_id TEXT PRIMARY KEY,
  activation_id TEXT NOT NULL REFERENCES activations(activation_id),
  activation_attempt_number INTEGER NOT NULL CHECK (activation_attempt_number > 0),
  room_id TEXT NOT NULL REFERENCES rooms(room_id),
  participant_id TEXT NOT NULL REFERENCES principals(principal_id),
  agent_definition_revision_id TEXT NOT NULL REFERENCES agent_definition_revisions(agent_definition_revision_id),
  execution_policy_revision_id TEXT NOT NULL REFERENCES execution_policy_revisions(execution_policy_revision_id),
  host_id TEXT NOT NULL,
  host_instance_id TEXT NOT NULL,
  runtime_offer_id TEXT NOT NULL,
  runtime_offer_observation_id TEXT NOT NULL REFERENCES runtime_offer_observations(runtime_offer_observation_id),
  runtime_offer_snapshot_digest TEXT NOT NULL,
  runtime_profile_id TEXT NOT NULL,
  runtime_profile_revision_id TEXT NOT NULL,
  workspace_mount_revision_id TEXT NOT NULL,
  workspace_mode TEXT NOT NULL CHECK (workspace_mode IN ('in_place', 'worktree', 'ephemeral')),
  state TEXT NOT NULL CHECK (state IN ('reserved', 'consumed', 'released')),
  lease_until TEXT NOT NULL,
  lease_until_ms INTEGER NOT NULL,
  decision_json TEXT NOT NULL,
  release_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_placement_per_activation
  ON placements(activation_id)
  WHERE state IN ('reserved', 'consumed');

CREATE INDEX IF NOT EXISTS idx_placements_host_pull
  ON placements(host_id, host_instance_id, state, lease_until_ms, created_at, placement_id);

CREATE TABLE IF NOT EXISTS placement_capacity_reservations (
  placement_id TEXT NOT NULL REFERENCES placements(placement_id),
  resource_type TEXT NOT NULL CHECK (resource_type IN ('offer', 'host', 'profile', 'pool')),
  resource_id TEXT NOT NULL,
  PRIMARY KEY (placement_id, resource_type, resource_id)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_placement_capacity_usage
  ON placement_capacity_reservations(resource_type, resource_id);

CREATE TABLE IF NOT EXISTS workspace_leases (
  placement_id TEXT PRIMARY KEY REFERENCES placements(placement_id),
  workspace_mount_revision_id TEXT NOT NULL,
  workspace_mode TEXT NOT NULL CHECK (workspace_mode IN ('in_place', 'worktree', 'ephemeral')),
  created_at TEXT NOT NULL
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_one_in_place_workspace_lease
  ON workspace_leases(workspace_mount_revision_id)
  WHERE workspace_mode = 'in_place';

CREATE TABLE IF NOT EXISTS run_attempts (
  run_attempt_id TEXT PRIMARY KEY,
  placement_id TEXT REFERENCES placements(placement_id),
  activation_id TEXT NOT NULL REFERENCES activations(activation_id),
  room_id TEXT NOT NULL REFERENCES rooms(room_id),
  participant_id TEXT NOT NULL REFERENCES principals(principal_id),
  host_id TEXT NOT NULL,
  attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
  state TEXT NOT NULL CHECK (state IN ('starting', 'running', 'orphaned', 'exited', 'failed', 'cancelled', 'timed_out')),
  runtime_run_id TEXT,
  exit_code INTEGER,
  exit_signal TEXT,
  error TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  UNIQUE (activation_id, attempt_number)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_run_attempts_room_started
  ON run_attempts(room_id, started_at, run_attempt_id);

CREATE TABLE IF NOT EXISTS runtime_processes (
  runtime_process_id TEXT PRIMARY KEY,
  run_attempt_id TEXT NOT NULL UNIQUE REFERENCES run_attempts(run_attempt_id),
  activation_id TEXT NOT NULL REFERENCES activations(activation_id),
  room_id TEXT NOT NULL REFERENCES rooms(room_id),
  participant_id TEXT NOT NULL REFERENCES principals(principal_id),
  launch_host_id TEXT NOT NULL,
  runtime_run_id TEXT NOT NULL,
  recovery_driver TEXT NOT NULL,
  recovery_descriptor_json TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('prepared', 'active', 'orphaned', 'terminated')),
  recovery_available_at_ms INTEGER NOT NULL DEFAULT 0,
  recovery_lease_owner TEXT,
  recovery_lease_owner_instance_id TEXT,
  recovery_lease_until TEXT,
  recovery_lease_until_ms INTEGER,
  recovery_attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (recovery_attempt_count >= 0),
  recovery_last_error TEXT,
  exit_code INTEGER,
  exit_signal TEXT,
  registered_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  terminated_at TEXT
) STRICT;

CREATE INDEX IF NOT EXISTS idx_runtime_processes_recovery
  ON runtime_processes(state, recovery_driver, recovery_available_at_ms, recovery_lease_until_ms, registered_at);

CREATE TABLE IF NOT EXISTS subscription_cursors (
  room_id TEXT NOT NULL REFERENCES rooms(room_id),
  participant_id TEXT NOT NULL REFERENCES principals(principal_id),
  consumer_id TEXT NOT NULL,
  last_seq INTEGER NOT NULL CHECK (last_seq >= 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (room_id, participant_id, consumer_id)
) STRICT;

CREATE TABLE IF NOT EXISTS outbox (
  outbox_seq INTEGER PRIMARY KEY AUTOINCREMENT,
  outbox_id TEXT NOT NULL UNIQUE,
  room_id TEXT NOT NULL REFERENCES rooms(room_id),
  room_seq INTEGER NOT NULL CHECK (room_seq > 0),
  topic TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  published_at TEXT,
  available_at_ms INTEGER NOT NULL DEFAULT 0,
  lease_owner TEXT,
  lease_until TEXT,
  lease_until_ms INTEGER,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error TEXT
) STRICT;

CREATE INDEX IF NOT EXISTS idx_room_events_sequence
  ON room_events(room_id, room_seq);

CREATE INDEX IF NOT EXISTS idx_inbox_participant_state
  ON inbox_items(room_id, participant_id, state, event_seq);

CREATE INDEX IF NOT EXISTS idx_outbox_unpublished
  ON outbox(published_at, available_at_ms, lease_until_ms, outbox_seq);
`;

export function migrateCollaborationSchemaV7(
  database: DatabaseSync,
  timestamp: string,
): void {
  const roomColumns = database.prepare("PRAGMA table_info(rooms)").all();
  const hasWorkspaceColumn = roomColumns.some(
    (row) => (row as { name: unknown }).name === "workspace_id",
  );
  if (hasWorkspaceColumn) {
    database
      .prepare(
        `INSERT OR IGNORE INTO workspaces(
           workspace_id, slug, name, state, created_at
         ) VALUES(?, 'legacy', 'Legacy Workspace', 'active', ?)`,
      )
      .run(LEGACY_WORKSPACE_ID, timestamp);
    return;
  }

  const legacyRooms = database
    .prepare(
      `SELECT rooms.room_id, room_events.actor_id, principals.kind
       FROM rooms
       LEFT JOIN room_events
         ON room_events.event_id = (
           SELECT candidate.event_id
           FROM room_events AS candidate
           WHERE candidate.room_id = rooms.room_id
             AND candidate.type = 'room.created'
           ORDER BY candidate.room_seq, candidate.event_id
           LIMIT 1
         )
       LEFT JOIN principals ON principals.principal_id = room_events.actor_id
       ORDER BY rooms.room_id`,
    )
    .all();
  const owners = legacyRooms.map((row) => {
    const roomId = requiredString(row, "room_id");
    const actorId = optionalString(row, "actor_id");
    const kind = optionalString(row, "kind");
    const isMember =
      actorId !== undefined &&
      database
        .prepare(
          "SELECT 1 AS present FROM memberships WHERE room_id = ? AND principal_id = ?",
        )
        .get(roomId, actorId) !== undefined;
    if (actorId === undefined || kind !== "human" || !isMember) {
      throw new Error(
        `legacy Room ${roomId} has no provable Human owner; migration fails closed`,
      );
    }
    return { actorId, roomId };
  });

  database.exec("PRAGMA foreign_keys = OFF");
  try {
    database.exec(`
      BEGIN IMMEDIATE;
      CREATE TEMP TABLE collaboration_v7_owners (
        room_id TEXT PRIMARY KEY,
        principal_id TEXT NOT NULL
      ) STRICT;
    `);
    const insertOwner = database.prepare(
      "INSERT INTO collaboration_v7_owners(room_id, principal_id) VALUES(?, ?)",
    );
    for (const owner of owners) insertOwner.run(owner.roomId, owner.actorId);
    database
      .prepare(
        `INSERT OR IGNORE INTO workspaces(
           workspace_id, slug, name, state, created_at
         ) VALUES(?, 'legacy', 'Legacy Workspace', 'active', ?)`,
      )
      .run(LEGACY_WORKSPACE_ID, timestamp);
    database.exec(`
      CREATE TABLE rooms_collaboration_v7 (
        room_id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
        kind TEXT NOT NULL CHECK (kind IN ('channel', 'direct', 'control')),
        slug TEXT NOT NULL,
        name TEXT NOT NULL,
        next_seq INTEGER NOT NULL DEFAULT 1 CHECK (next_seq > 0),
        created_at TEXT NOT NULL,
        archived_at TEXT,
        UNIQUE (workspace_id, slug)
      ) STRICT;
      INSERT INTO rooms_collaboration_v7(
        room_id, workspace_id, kind, slug, name, next_seq, created_at
      )
      SELECT
        room_id, '${LEGACY_WORKSPACE_ID}', 'channel', slug, name, next_seq,
        created_at
      FROM rooms;

      CREATE TABLE memberships_collaboration_v7 (
        room_id TEXT NOT NULL REFERENCES rooms(room_id),
        principal_id TEXT NOT NULL REFERENCES principals(principal_id),
        role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
        joined_at TEXT NOT NULL,
        PRIMARY KEY (room_id, principal_id)
      ) STRICT;
      INSERT INTO memberships_collaboration_v7(
        room_id, principal_id, role, joined_at
      )
      SELECT
        memberships.room_id,
        memberships.principal_id,
        CASE WHEN collaboration_v7_owners.principal_id IS NULL
          THEN 'member' ELSE 'owner' END,
        memberships.joined_at
      FROM memberships
      LEFT JOIN collaboration_v7_owners
        ON collaboration_v7_owners.room_id = memberships.room_id
       AND collaboration_v7_owners.principal_id = memberships.principal_id;

      CREATE TABLE messages_collaboration_v7 (
        message_id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL REFERENCES rooms(room_id),
        actor_id TEXT NOT NULL REFERENCES principals(principal_id),
        thread_id TEXT,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (room_id, message_id),
        FOREIGN KEY (room_id, thread_id) REFERENCES threads(room_id, thread_id)
      ) STRICT;
      INSERT INTO messages_collaboration_v7(
        message_id, room_id, actor_id, body, created_at
      )
      SELECT message_id, room_id, actor_id, body, created_at FROM messages;

      DROP TABLE threads;
      DROP TABLE messages;
      DROP TABLE memberships;
      DROP TABLE rooms;
      ALTER TABLE rooms_collaboration_v7 RENAME TO rooms;
      ALTER TABLE memberships_collaboration_v7 RENAME TO memberships;
      ALTER TABLE messages_collaboration_v7 RENAME TO messages;
      CREATE TABLE threads (
        thread_id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL REFERENCES rooms(room_id),
        root_message_id TEXT NOT NULL,
        created_by TEXT NOT NULL REFERENCES principals(principal_id),
        reply_count INTEGER NOT NULL DEFAULT 0 CHECK (reply_count >= 0),
        created_at TEXT NOT NULL,
        last_reply_at TEXT,
        UNIQUE (room_id, thread_id),
        UNIQUE (root_message_id),
        FOREIGN KEY (room_id, root_message_id)
          REFERENCES messages(room_id, message_id)
      ) STRICT;
      DROP TABLE collaboration_v7_owners;
    `);
    const foreignKeyFailures = database
      .prepare("PRAGMA foreign_key_check")
      .all();
    if (foreignKeyFailures.length > 0) {
      throw new Error(
        `schema v7 migration violated ${String(foreignKeyFailures.length)} foreign key constraint(s)`,
      );
    }
    database.exec("COMMIT");
  } catch (error) {
    if (database.isTransaction) database.exec("ROLLBACK");
    throw error;
  } finally {
    database.exec("PRAGMA foreign_keys = ON");
  }
}

function requiredString(row: object, field: string): string {
  const value = (row as Record<string, unknown>)[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`invalid ${field} in schema v7 migration`);
  }
  return value;
}

function optionalString(row: object, field: string): string | undefined {
  const value = (row as Record<string, unknown>)[field];
  if (value === null || value === undefined) return undefined;
  return requiredString(row, field);
}
