import type { DatabaseSync } from "node:sqlite";

export const LEGACY_WORKSPACE_ID = "workspace_legacy";

export const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS principals (
  principal_id TEXT PRIMARY KEY,
  handle TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('human', 'agent', 'service')),
  display_name TEXT,
  avatar_key TEXT,
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

CREATE TABLE IF NOT EXISTS agent_memory_homes (
  participant_id TEXT PRIMARY KEY REFERENCES principals(principal_id),
  owner_host_id TEXT,
  state TEXT NOT NULL CHECK (state IN ('bound', 'conflicted')),
  bound_at TEXT NOT NULL,
  CHECK ((state = 'bound' AND owner_host_id IS NOT NULL) OR (state = 'conflicted' AND owner_host_id IS NULL))
) STRICT;

CREATE TABLE IF NOT EXISTS agent_exclusive_operation_leases (
  lease_id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL UNIQUE,
  participant_id TEXT NOT NULL REFERENCES principals(principal_id),
  kind TEXT NOT NULL CHECK (kind IN ('memory_maintenance', 'memory_reset', 'execution_restart', 'task_reassignment')),
  owner_host_id TEXT NOT NULL,
  owner_host_instance_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('active', 'released')),
  acquired_at TEXT NOT NULL,
  renewed_at TEXT NOT NULL,
  lease_until TEXT NOT NULL,
  lease_until_ms INTEGER NOT NULL,
  released_at TEXT,
  CHECK ((state = 'active' AND released_at IS NULL) OR (state = 'released' AND released_at IS NOT NULL))
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_agent_exclusive_operation
  ON agent_exclusive_operation_leases(participant_id)
  WHERE state = 'active';

CREATE INDEX IF NOT EXISTS idx_agent_exclusive_operation_owner
  ON agent_exclusive_operation_leases(owner_host_id, owner_host_instance_id, state, lease_until_ms);

CREATE TABLE IF NOT EXISTS task_reassignment_operations (
  operation_id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(room_id),
  task_id TEXT NOT NULL REFERENCES tasks(task_id),
  requested_by TEXT NOT NULL REFERENCES principals(principal_id),
  previous_assignee_id TEXT NOT NULL REFERENCES principals(principal_id),
  next_assignee_id TEXT NOT NULL REFERENCES principals(principal_id),
  idempotency_key TEXT NOT NULL,
  reason TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('requested', 'cancellation_requested', 'runtime_terminal_proven', 'task_reopened_unassigned', 'assigned', 'failed_closed')),
  cancellation_request_id TEXT REFERENCES activation_cancellation_requests(request_id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE (room_id, idempotency_key),
  CHECK ((state IN ('assigned', 'failed_closed') AND completed_at IS NOT NULL) OR (state NOT IN ('assigned', 'failed_closed') AND completed_at IS NULL))
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_task_reassignment
  ON task_reassignment_operations(task_id)
  WHERE state NOT IN ('assigned', 'failed_closed');

CREATE INDEX IF NOT EXISTS idx_task_reassignment_participant_state
  ON task_reassignment_operations(previous_assignee_id, state, updated_at);

CREATE TABLE IF NOT EXISTS computer_operations (
  operation_id TEXT PRIMARY KEY,
  host_id TEXT NOT NULL REFERENCES agent_hosts(host_id),
  idempotency_key TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('restart', 'upgrade')),
  target_build_version TEXT,
  state TEXT NOT NULL CHECK (state IN ('pending', 'claimed', 'in_progress', 'awaiting_reconnect', 'succeeded', 'failed')),
  phase TEXT CHECK (phase IN ('draining', 'downloading', 'verifying', 'staging', 'replacing', 'restarting')),
  claimed_credential_id TEXT,
  claimed_host_instance_id TEXT,
  ready_host_instance_id TEXT,
  observed_build_version TEXT,
  failure_code TEXT CHECK (failure_code IN ('control_unavailable', 'download_failed', 'identity_attestation_failed', 'replacement_failed', 'staging_failed', 'unsupported_operation', 'verification_failed', 'version_attestation_failed')),
  requested_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE (host_id, idempotency_key),
  CHECK ((action = 'restart' AND target_build_version IS NULL) OR (action = 'upgrade' AND target_build_version IS NOT NULL)),
  CHECK ((state IN ('succeeded', 'failed') AND completed_at IS NOT NULL) OR (state NOT IN ('succeeded', 'failed') AND completed_at IS NULL))
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_computer_operation_per_host
  ON computer_operations(host_id)
  WHERE state NOT IN ('succeeded', 'failed');

CREATE INDEX IF NOT EXISTS idx_computer_operations_host_state
  ON computer_operations(host_id, state, requested_at, operation_id);

CREATE TABLE IF NOT EXISTS workspaces (
  workspace_id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  avatar_key TEXT,
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
  description TEXT,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('public', 'private')),
  next_seq INTEGER NOT NULL DEFAULT 1 CHECK (next_seq > 0),
  created_at TEXT NOT NULL,
  archived_at TEXT,
  UNIQUE (workspace_id, slug)
) STRICT;

CREATE TABLE IF NOT EXISTS room_deletion_receipts (
  deletion_id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL REFERENCES principals(principal_id),
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
  room_id TEXT NOT NULL,
  room_name TEXT NOT NULL,
  room_slug TEXT NOT NULL,
  based_on_room_seq INTEGER NOT NULL CHECK (based_on_room_seq >= 0),
  idempotency_key TEXT NOT NULL,
  file_count INTEGER NOT NULL CHECK (file_count >= 0),
  deleted_at TEXT NOT NULL,
  UNIQUE (actor_id, idempotency_key)
) STRICT;

CREATE TABLE IF NOT EXISTS room_file_gc_receipts (
  deletion_id TEXT NOT NULL REFERENCES room_deletion_receipts(deletion_id),
  attachment_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'reclaimed', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (deletion_id, attachment_id),
  UNIQUE (attachment_id)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_room_file_gc_pending
  ON room_file_gc_receipts(state, updated_at, deletion_id, attachment_id);

CREATE TABLE IF NOT EXISTS memberships (
  room_id TEXT NOT NULL REFERENCES rooms(room_id),
  principal_id TEXT NOT NULL REFERENCES principals(principal_id),
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  joined_at TEXT NOT NULL,
  PRIMARY KEY (room_id, principal_id)
) STRICT;

CREATE TABLE IF NOT EXISTS direct_room_pairs (
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
  left_principal_id TEXT NOT NULL REFERENCES principals(principal_id),
  right_principal_id TEXT NOT NULL REFERENCES principals(principal_id),
  room_id TEXT NOT NULL UNIQUE REFERENCES rooms(room_id),
  PRIMARY KEY (workspace_id, left_principal_id, right_principal_id),
  CHECK (left_principal_id < right_principal_id)
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

CREATE TABLE IF NOT EXISTS agent_thread_follows (
  participant_id TEXT NOT NULL REFERENCES principals(principal_id),
  thread_id TEXT NOT NULL REFERENCES threads(thread_id),
  following INTEGER NOT NULL CHECK (following IN (0, 1)),
  source TEXT NOT NULL CHECK (source IN ('mention', 'participation', 'explicit_unfollow')),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (participant_id, thread_id),
  CHECK (
    (following = 0 AND source = 'explicit_unfollow') OR
    (following = 1 AND source IN ('mention', 'participation'))
  )
) STRICT;

CREATE INDEX IF NOT EXISTS idx_agent_thread_follows_delivery
  ON agent_thread_follows(thread_id, following, participant_id);

CREATE TABLE IF NOT EXISTS agent_thread_follower_undo (
  undo_token TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL REFERENCES principals(principal_id),
  participant_id TEXT NOT NULL REFERENCES principals(principal_id),
  thread_id TEXT NOT NULL REFERENCES threads(thread_id),
  previous_source TEXT NOT NULL CHECK (previous_source IN ('mention', 'participation')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_agent_thread_follower_undo_expiry
  ON agent_thread_follower_undo(expires_at);

CREATE TABLE IF NOT EXISTS tasks (
  task_id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(room_id),
  creator_id TEXT NOT NULL REFERENCES principals(principal_id),
  assignee_id TEXT REFERENCES principals(principal_id),
  task_number INTEGER NOT NULL CHECK (task_number > 0),
  source_message_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
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
  cancelled_at TEXT,
  UNIQUE (room_id, task_number),
  UNIQUE (source_message_id),
  UNIQUE (thread_id),
  FOREIGN KEY (room_id, source_message_id)
    REFERENCES messages(room_id, message_id),
  FOREIGN KEY (room_id, thread_id)
    REFERENCES threads(room_id, thread_id)
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

CREATE TABLE IF NOT EXISTS task_participants (
  task_id TEXT NOT NULL REFERENCES tasks(task_id),
  participant_id TEXT NOT NULL REFERENCES principals(principal_id),
  role TEXT NOT NULL CHECK (role IN ('collaborator', 'reviewer')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (task_id, participant_id, role)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_task_participants_participant
  ON task_participants(participant_id, role, task_id);

CREATE TABLE IF NOT EXISTS task_submissions (
  submission_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(task_id),
  room_id TEXT NOT NULL REFERENCES rooms(room_id),
  submission_number INTEGER NOT NULL CHECK (submission_number > 0),
  producer_id TEXT NOT NULL REFERENCES principals(principal_id),
  summary TEXT NOT NULL,
  message_id TEXT NOT NULL,
  submission_digest TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (task_id, submission_number),
  UNIQUE (message_id),
  FOREIGN KEY (room_id, message_id)
    REFERENCES messages(room_id, message_id)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_task_submissions_task
  ON task_submissions(task_id, submission_number DESC);

CREATE TABLE IF NOT EXISTS task_submission_artifacts (
  submission_id TEXT NOT NULL REFERENCES task_submissions(submission_id),
  ordinal INTEGER NOT NULL CHECK (ordinal > 0),
  attachment_id TEXT NOT NULL,
  task_id TEXT NOT NULL REFERENCES tasks(task_id),
  producer_id TEXT NOT NULL REFERENCES principals(principal_id),
  run_attempt_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size INTEGER NOT NULL CHECK (size > 0),
  sha256 TEXT NOT NULL,
  PRIMARY KEY (submission_id, ordinal),
  UNIQUE (submission_id, attachment_id)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_task_submission_artifacts_attachment
  ON task_submission_artifacts(attachment_id);

CREATE TABLE IF NOT EXISTS task_reviews (
  review_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(task_id),
  room_id TEXT NOT NULL REFERENCES rooms(room_id),
  submission_id TEXT NOT NULL REFERENCES task_submissions(submission_id),
  submission_digest TEXT NOT NULL,
  reviewer_id TEXT NOT NULL REFERENCES principals(principal_id),
  disposition TEXT NOT NULL CHECK (disposition IN ('approved', 'changes_requested')),
  summary TEXT NOT NULL,
  message_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (submission_id, reviewer_id),
  UNIQUE (message_id),
  FOREIGN KEY (room_id, message_id)
    REFERENCES messages(room_id, message_id)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_task_reviews_task
  ON task_reviews(task_id, created_at, review_id);

CREATE TABLE IF NOT EXISTS input_requests (
  input_request_id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(room_id),
  task_id TEXT NOT NULL REFERENCES tasks(task_id),
  requester_id TEXT NOT NULL REFERENCES principals(principal_id),
  responder_id TEXT NOT NULL REFERENCES principals(principal_id),
  question TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'resolved', 'cancelled')),
  answer TEXT,
  resolved_by TEXT REFERENCES principals(principal_id),
  cancelled_at TEXT,
  cancelled_by TEXT REFERENCES principals(principal_id),
  cancellation_reason TEXT,
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

CREATE TABLE IF NOT EXISTS held_message_drafts (
  held_draft_id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(room_id),
  participant_id TEXT NOT NULL REFERENCES principals(principal_id),
  activation_id TEXT NOT NULL REFERENCES activations(activation_id),
  thread_id TEXT REFERENCES threads(thread_id),
  body TEXT NOT NULL,
  based_on_room_seq INTEGER NOT NULL CHECK (based_on_room_seq >= 0),
  seen_up_to_seq INTEGER NOT NULL CHECK (seen_up_to_seq > based_on_room_seq),
  idempotency_key TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('held', 'replaced')),
  source_held_draft_id TEXT REFERENCES held_message_drafts(held_draft_id),
  rehold_count INTEGER NOT NULL DEFAULT 1 CHECK (rehold_count > 0),
  expires_at_ms INTEGER NOT NULL DEFAULT 0 CHECK (expires_at_ms >= 0),
  resolution_kind TEXT CHECK (resolution_kind IN ('expired', 'reheld', 'revised', 'sent_anyway', 'sent_unchanged')),
  resolved_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (room_id, idempotency_key)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_held_message_drafts_target
  ON held_message_drafts(room_id, participant_id, thread_id, state, created_at);

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

CREATE TABLE IF NOT EXISTS activation_retry_fences (
  activation_id TEXT PRIMARY KEY REFERENCES activations(activation_id),
  room_id TEXT NOT NULL REFERENCES rooms(room_id),
  participant_id TEXT NOT NULL REFERENCES principals(principal_id),
  state TEXT NOT NULL CHECK (state IN ('observing', 'blocked', 'resolved')),
  retry_disposition TEXT NOT NULL DEFAULT 'recoverable' CHECK (retry_disposition IN ('recoverable', 'action_required', 'sticky_terminal')),
  error_fingerprint TEXT NOT NULL,
  same_error_count INTEGER NOT NULL CHECK (same_error_count >= 0),
  last_error TEXT NOT NULL,
  first_observed_at TEXT NOT NULL,
  last_observed_at TEXT NOT NULL,
  blocked_at TEXT,
  resolved_at TEXT,
  resolution_kind TEXT CHECK (resolution_kind IN ('progress', 'restart'))
) STRICT;

CREATE INDEX IF NOT EXISTS idx_activation_retry_fences_participant
  ON activation_retry_fences(participant_id, state, last_observed_at);

CREATE TABLE IF NOT EXISTS reminders (
  reminder_id TEXT PRIMARY KEY,
  owner_agent_id TEXT NOT NULL REFERENCES agent_definitions(agent_definition_id),
  owner_participant_id TEXT NOT NULL REFERENCES principals(principal_id),
  room_id TEXT NOT NULL REFERENCES rooms(room_id),
  target_room_id TEXT NOT NULL REFERENCES rooms(room_id),
  thread_id TEXT REFERENCES threads(thread_id),
  root_message_id TEXT REFERENCES messages(message_id),
  title TEXT NOT NULL,
  fire_at TEXT NOT NULL,
  fire_at_ms INTEGER NOT NULL,
  fired_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('scheduled', 'fired', 'canceled')),
  message_id TEXT NOT NULL REFERENCES messages(message_id),
  payload_json TEXT,
  repeat_rule TEXT,
  timezone TEXT,
  version INTEGER NOT NULL CHECK (version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (room_id, message_id) REFERENCES messages(room_id, message_id)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_reminders_due
  ON reminders(status, fire_at_ms, reminder_id);

CREATE INDEX IF NOT EXISTS idx_reminders_owner
  ON reminders(owner_agent_id, status, fire_at_ms, reminder_id);

CREATE TABLE IF NOT EXISTS reminder_events (
  event_id TEXT PRIMARY KEY,
  reminder_id TEXT NOT NULL REFERENCES reminders(reminder_id),
  event_type TEXT NOT NULL CHECK (event_type IN ('scheduled', 'fired', 'snoozed', 'updated', 'canceled')),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('agent', 'human', 'system')),
  actor_id TEXT REFERENCES principals(principal_id),
  occurred_at TEXT NOT NULL,
  next_fire_at TEXT,
  metadata_json TEXT
) STRICT;

CREATE INDEX IF NOT EXISTS idx_reminder_events_log
  ON reminder_events(reminder_id, occurred_at, event_id);

CREATE TABLE IF NOT EXISTS reminder_command_receipts (
  owner_participant_id TEXT NOT NULL REFERENCES principals(principal_id),
  idempotency_key TEXT NOT NULL,
  request_json TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (owner_participant_id, idempotency_key)
) STRICT;

CREATE TABLE IF NOT EXISTS reminder_fire_receipts (
  occurrence_id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE,
  reminder_id TEXT NOT NULL REFERENCES reminders(reminder_id),
  reminder_version INTEGER NOT NULL CHECK (reminder_version > 0),
  scheduled_fire_at TEXT NOT NULL,
  fired_at_client TEXT NOT NULL,
  catchup INTEGER NOT NULL CHECK (catchup IN (0, 1)),
  state TEXT NOT NULL CHECK (state IN ('pending', 'delivered', 'exhausted', 'obsolete')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at_ms INTEGER NOT NULL,
  deadline_at_ms INTEGER NOT NULL,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  delivered_at TEXT,
  UNIQUE (reminder_id, reminder_version)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_reminder_fire_receipts_pending
  ON reminder_fire_receipts(state, next_attempt_at_ms, deadline_at_ms, occurrence_id);

CREATE TABLE IF NOT EXISTS activation_obligations (
  obligation_id TEXT PRIMARY KEY,
  obligation_key TEXT NOT NULL UNIQUE,
  activation_id TEXT NOT NULL REFERENCES activations(activation_id),
  room_id TEXT NOT NULL REFERENCES rooms(room_id),
  participant_id TEXT NOT NULL REFERENCES principals(principal_id),
  source_event_id TEXT NOT NULL REFERENCES room_events(event_id),
  kind TEXT NOT NULL CHECK (kind IN ('task_owner_follow_up', 'task_review')),
  task_id TEXT NOT NULL REFERENCES tasks(task_id),
  submission_id TEXT REFERENCES task_submissions(submission_id),
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_activation_obligations_activation
  ON activation_obligations(activation_id, kind, created_at);

CREATE TABLE IF NOT EXISTS activation_cancellation_requests (
  request_id TEXT PRIMARY KEY,
  activation_id TEXT NOT NULL REFERENCES activations(activation_id),
  activation_attempt_number INTEGER NOT NULL CHECK (activation_attempt_number > 0),
  room_id TEXT NOT NULL REFERENCES rooms(room_id),
  task_id TEXT NOT NULL REFERENCES tasks(task_id),
  participant_id TEXT NOT NULL REFERENCES principals(principal_id),
  requested_by TEXT NOT NULL REFERENCES principals(principal_id),
  reason TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  resolved_at TEXT,
  UNIQUE (activation_id, activation_attempt_number)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_activation_cancellation_unresolved_task
  ON activation_cancellation_requests(task_id, activation_id)
  WHERE resolved_at IS NULL;

CREATE TABLE IF NOT EXISTS room_agent_sos_operations (
  operation_id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(room_id),
  requested_by TEXT NOT NULL REFERENCES principals(principal_id),
  idempotency_key TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('stopping', 'stopped', 'resumed')),
  request_event_id TEXT NOT NULL REFERENCES room_events(event_id),
  stopped_event_id TEXT REFERENCES room_events(event_id),
  resume_event_id TEXT REFERENCES room_events(event_id),
  guidance TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  stopped_at TEXT,
  resumed_at TEXT,
  UNIQUE (room_id, idempotency_key),
  CHECK (
    (state = 'stopping' AND stopped_at IS NULL AND resumed_at IS NULL AND guidance IS NULL AND stopped_event_id IS NULL AND resume_event_id IS NULL) OR
    (state = 'stopped' AND stopped_at IS NOT NULL AND resumed_at IS NULL AND guidance IS NULL AND stopped_event_id IS NOT NULL AND resume_event_id IS NULL) OR
    (state = 'resumed' AND stopped_at IS NOT NULL AND resumed_at IS NOT NULL AND guidance IS NOT NULL AND stopped_event_id IS NOT NULL AND resume_event_id IS NOT NULL)
  )
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_room_agent_sos
  ON room_agent_sos_operations(room_id)
  WHERE state <> 'resumed';

CREATE TABLE IF NOT EXISTS room_agent_sos_holds (
  room_id TEXT PRIMARY KEY REFERENCES rooms(room_id),
  operation_id TEXT NOT NULL UNIQUE REFERENCES room_agent_sos_operations(operation_id),
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS room_agent_sos_targets (
  target_id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL REFERENCES room_agent_sos_operations(operation_id),
  activation_id TEXT NOT NULL REFERENCES activations(activation_id),
  activation_attempt_number INTEGER NOT NULL CHECK (activation_attempt_number > 0),
  participant_id TEXT NOT NULL REFERENCES principals(principal_id),
  state TEXT NOT NULL CHECK (state IN ('requested', 'terminal_proven')),
  requested_at TEXT NOT NULL,
  resolved_at TEXT,
  UNIQUE (activation_id, activation_attempt_number),
  CHECK (
    (state = 'requested' AND resolved_at IS NULL) OR
    (state = 'terminal_proven' AND resolved_at IS NOT NULL)
  )
) STRICT;

CREATE INDEX IF NOT EXISTS idx_room_agent_sos_targets_operation
  ON room_agent_sos_targets(operation_id, state, target_id);

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

CREATE TABLE IF NOT EXISTS managed_mcp_servers (
  mcp_server_id TEXT PRIMARY KEY,
  control_room_id TEXT NOT NULL REFERENCES rooms(room_id),
  current_config_version INTEGER NOT NULL CHECK (current_config_version > 0),
  current_revision_id TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK (state IN ('enabled', 'disabled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS managed_mcp_server_revisions (
  managed_mcp_server_revision_id TEXT PRIMARY KEY,
  mcp_server_id TEXT NOT NULL REFERENCES managed_mcp_servers(mcp_server_id),
  config_version INTEGER NOT NULL CHECK (config_version > 0),
  content_digest TEXT NOT NULL,
  definition_json TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES principals(principal_id),
  created_at TEXT NOT NULL,
  UNIQUE (mcp_server_id, config_version)
) STRICT;

CREATE TABLE IF NOT EXISTS managed_mcp_assignments (
  managed_mcp_assignment_id TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL REFERENCES principals(principal_id),
  mcp_server_id TEXT NOT NULL REFERENCES managed_mcp_servers(mcp_server_id),
  current_assignment_version INTEGER NOT NULL CHECK (current_assignment_version > 0),
  current_revision_id TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (participant_id, mcp_server_id)
) STRICT;

CREATE TABLE IF NOT EXISTS managed_mcp_assignment_revisions (
  managed_mcp_assignment_revision_id TEXT PRIMARY KEY,
  managed_mcp_assignment_id TEXT NOT NULL REFERENCES managed_mcp_assignments(managed_mcp_assignment_id),
  assignment_version INTEGER NOT NULL CHECK (assignment_version > 0),
  allowed_tool_names_json TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES principals(principal_id),
  created_at TEXT NOT NULL,
  UNIQUE (managed_mcp_assignment_id, assignment_version)
) STRICT;

CREATE TABLE IF NOT EXISTS managed_mcp_calls (
  managed_mcp_call_id TEXT PRIMARY KEY,
  run_attempt_id TEXT NOT NULL REFERENCES run_attempts(run_attempt_id),
  participant_id TEXT NOT NULL REFERENCES principals(principal_id),
  room_id TEXT NOT NULL REFERENCES rooms(room_id),
  mcp_server_id TEXT NOT NULL REFERENCES managed_mcp_servers(mcp_server_id),
  tool_name TEXT NOT NULL,
  config_version INTEGER NOT NULL CHECK (config_version > 0),
  assignment_version INTEGER NOT NULL CHECK (assignment_version > 0),
  arguments_digest TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'completed', 'failed')),
  is_error INTEGER CHECK (is_error IN (0, 1)),
  result_digest TEXT,
  failure_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  CHECK ((state = 'pending' AND completed_at IS NULL) OR
         (state <> 'pending' AND completed_at IS NOT NULL))
) STRICT;

CREATE INDEX IF NOT EXISTS idx_managed_mcp_assignments_participant
  ON managed_mcp_assignments(participant_id, enabled, mcp_server_id);

CREATE INDEX IF NOT EXISTS idx_managed_mcp_calls_run
  ON managed_mcp_calls(run_attempt_id, created_at, managed_mcp_call_id);

CREATE INDEX IF NOT EXISTS idx_managed_mcp_calls_participant
  ON managed_mcp_calls(participant_id, created_at, managed_mcp_call_id);

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

CREATE INDEX IF NOT EXISTS idx_run_attempts_presence
  ON run_attempts(participant_id);
CREATE INDEX IF NOT EXISTS idx_run_attempts_presence_active
  ON run_attempts(participant_id) WHERE state IN ('starting', 'running', 'orphaned');

CREATE TABLE IF NOT EXISTS run_trajectory_entries (
  server_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  activity_id TEXT NOT NULL UNIQUE,
  run_attempt_id TEXT NOT NULL REFERENCES run_attempts(run_attempt_id),
  runtime_run_id TEXT NOT NULL,
  room_id TEXT NOT NULL REFERENCES rooms(room_id),
  participant_id TEXT NOT NULL REFERENCES principals(principal_id),
  producer_sequence INTEGER NOT NULL CHECK (producer_sequence > 0),
  observed_at TEXT NOT NULL,
  entry_json TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  UNIQUE (runtime_run_id, producer_sequence)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_run_trajectory_agent_page
  ON run_trajectory_entries(participant_id, server_sequence DESC);

CREATE INDEX IF NOT EXISTS idx_run_trajectory_room_page
  ON run_trajectory_entries(room_id, server_sequence DESC);

-- Current presence skips arbitrarily long text-only streams without rescanning
-- their payloads every second. Predicate matches the read projection exactly.
CREATE INDEX IF NOT EXISTS idx_run_trajectory_presence
  ON run_trajectory_entries(runtime_run_id, producer_sequence DESC)
  WHERE json_extract(entry_json, '$.subagent') IS NULL
    AND json_extract(entry_json, '$.kind') IN ('thinking','tool_start','compaction_started','compaction_finished','status');

CREATE TABLE IF NOT EXISTS context_manifests (
  context_manifest_id TEXT PRIMARY KEY,
  run_attempt_id TEXT NOT NULL UNIQUE REFERENCES run_attempts(run_attempt_id),
  content_digest TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

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

export function migrateRoomMetadataV14(database: DatabaseSync): void {
  const roomColumns = database.prepare("PRAGMA table_info(rooms)").all();
  if (
    !roomColumns.some((row) => requiredString(row, "name") === "description")
  ) {
    database.exec("ALTER TABLE rooms ADD COLUMN description TEXT");
  }
  if (
    !roomColumns.some((row) => requiredString(row, "name") === "visibility")
  ) {
    database.exec(
      "ALTER TABLE rooms ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('public', 'private'))",
    );
    database.exec(
      "UPDATE rooms SET visibility = 'public' WHERE kind = 'channel'",
    );
  }
}

export function migrateActivationRetryFencesV35(database: DatabaseSync): void {
  const definition = database
    .prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'activation_retry_fences'",
    )
    .get() as { sql?: unknown } | undefined;
  const sql = typeof definition?.sql === "string" ? definition.sql : "";
  if (
    sql.includes("retry_disposition") &&
    sql.includes("same_error_count >= 0")
  ) {
    return;
  }
  database.exec("PRAGMA foreign_keys = OFF");
  try {
    database.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE activation_retry_fences_v35 (
        activation_id TEXT PRIMARY KEY REFERENCES activations(activation_id),
        room_id TEXT NOT NULL REFERENCES rooms(room_id),
        participant_id TEXT NOT NULL REFERENCES principals(principal_id),
        state TEXT NOT NULL CHECK (state IN ('observing', 'blocked', 'resolved')),
        retry_disposition TEXT NOT NULL DEFAULT 'recoverable' CHECK (retry_disposition IN ('recoverable', 'action_required', 'sticky_terminal')),
        error_fingerprint TEXT NOT NULL,
        same_error_count INTEGER NOT NULL CHECK (same_error_count >= 0),
        last_error TEXT NOT NULL,
        first_observed_at TEXT NOT NULL,
        last_observed_at TEXT NOT NULL,
        blocked_at TEXT,
        resolved_at TEXT,
        resolution_kind TEXT CHECK (resolution_kind IN ('progress', 'restart'))
      ) STRICT;
      INSERT INTO activation_retry_fences_v35(
        activation_id, room_id, participant_id, state, retry_disposition,
        error_fingerprint, same_error_count, last_error, first_observed_at,
        last_observed_at, blocked_at, resolved_at, resolution_kind
      )
      SELECT activation_id, room_id, participant_id, state, 'recoverable',
             error_fingerprint, same_error_count, last_error, first_observed_at,
             last_observed_at, blocked_at, resolved_at, resolution_kind
      FROM activation_retry_fences;
      DROP TABLE activation_retry_fences;
      ALTER TABLE activation_retry_fences_v35 RENAME TO activation_retry_fences;
      CREATE INDEX idx_activation_retry_fences_participant
        ON activation_retry_fences(participant_id, state, last_observed_at);
      COMMIT;
    `);
  } catch (error) {
    if (database.isTransaction) database.exec("ROLLBACK");
    throw error;
  } finally {
    database.exec("PRAGMA foreign_keys = ON");
  }
}

export function migrateReminderTargetsV36(database: DatabaseSync): void {
  const columns = database.prepare("PRAGMA table_info(reminders)").all();
  const names = new Set(columns.map((row) => requiredString(row, "name")));
  if (!names.has("target_room_id")) {
    database.exec(
      "ALTER TABLE reminders ADD COLUMN target_room_id TEXT REFERENCES rooms(room_id)",
    );
  }
  if (!names.has("thread_id")) {
    database.exec(
      "ALTER TABLE reminders ADD COLUMN thread_id TEXT REFERENCES threads(thread_id)",
    );
  }
  if (!names.has("root_message_id")) {
    database.exec(
      "ALTER TABLE reminders ADD COLUMN root_message_id TEXT REFERENCES messages(message_id)",
    );
  }
  database.exec(
    "UPDATE reminders SET target_room_id = room_id WHERE target_room_id IS NULL",
  );
}

export function migrateInputRequestCancellationV38(
  database: DatabaseSync,
): void {
  const definition = database
    .prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'input_requests'",
    )
    .get() as { sql?: unknown } | undefined;
  const sql = typeof definition?.sql === "string" ? definition.sql : "";
  const columns = new Set(
    database
      .prepare("PRAGMA table_info(input_requests)")
      .all()
      .map((row) => requiredString(row, "name")),
  );
  if (
    sql.includes("'cancelled'") &&
    columns.has("cancelled_at") &&
    columns.has("cancelled_by") &&
    columns.has("cancellation_reason")
  ) {
    return;
  }
  database.exec("PRAGMA foreign_keys = OFF");
  try {
    database.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE input_requests_v38 (
        input_request_id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL REFERENCES rooms(room_id),
        task_id TEXT NOT NULL REFERENCES tasks(task_id),
        requester_id TEXT NOT NULL REFERENCES principals(principal_id),
        responder_id TEXT NOT NULL REFERENCES principals(principal_id),
        question TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('pending', 'resolved', 'cancelled')),
        answer TEXT,
        resolved_by TEXT REFERENCES principals(principal_id),
        cancelled_at TEXT,
        cancelled_by TEXT REFERENCES principals(principal_id),
        cancellation_reason TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        resolved_at TEXT
      ) STRICT;
      INSERT INTO input_requests_v38(
        input_request_id, room_id, task_id, requester_id, responder_id,
        question, state, answer, resolved_by, created_at, updated_at,
        resolved_at
      )
      SELECT input_request_id, room_id, task_id, requester_id, responder_id,
             question, state, answer, resolved_by, created_at, updated_at,
             resolved_at
      FROM input_requests;
      DROP TABLE input_requests;
      ALTER TABLE input_requests_v38 RENAME TO input_requests;
      CREATE INDEX idx_input_requests_room_state
        ON input_requests(room_id, state, created_at, input_request_id);
      CREATE UNIQUE INDEX idx_one_pending_input_per_task
        ON input_requests(task_id)
        WHERE state = 'pending';
      COMMIT;
    `);
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
