import type { DatabaseSync } from "node:sqlite";

import { ConflictError, NotFoundError } from "./errors.ts";
import { integer, text, type Row } from "./sqlite-row.ts";

export const HELD_MESSAGE_DRAFT_TTL_MS = 10 * 60_000;
export const CONTINUE_ANYWAY_REHOLD_THRESHOLD = 2;

export type HeldMessageDraftResolution =
  "expired" | "reheld" | "revised" | "sent_anyway" | "sent_unchanged";

export function migrateHeldMessageDraftLifecycle(database: DatabaseSync): void {
  const columns = database
    .prepare("PRAGMA table_info(held_message_drafts)")
    .all();
  if (!columns.some((row) => row.name === "source_held_draft_id")) {
    database.exec(
      "ALTER TABLE held_message_drafts ADD COLUMN source_held_draft_id TEXT REFERENCES held_message_drafts(held_draft_id)",
    );
  }
  if (!columns.some((row) => row.name === "rehold_count")) {
    database.exec(
      "ALTER TABLE held_message_drafts ADD COLUMN rehold_count INTEGER NOT NULL DEFAULT 1 CHECK (rehold_count > 0)",
    );
  }
  if (!columns.some((row) => row.name === "expires_at_ms")) {
    database.exec(
      "ALTER TABLE held_message_drafts ADD COLUMN expires_at_ms INTEGER NOT NULL DEFAULT 0 CHECK (expires_at_ms >= 0)",
    );
  }
  if (!columns.some((row) => row.name === "resolution_kind")) {
    database.exec(
      "ALTER TABLE held_message_drafts ADD COLUMN resolution_kind TEXT CHECK (resolution_kind IN ('expired', 'reheld', 'revised', 'sent_anyway', 'sent_unchanged'))",
    );
  }
  if (!columns.some((row) => row.name === "resolved_at")) {
    database.exec(
      "ALTER TABLE held_message_drafts ADD COLUMN resolved_at TEXT",
    );
  }
  database
    .prepare(
      `UPDATE held_message_drafts
       SET expires_at_ms = CAST(strftime('%s', created_at) AS INTEGER) * 1000 + ?
       WHERE expires_at_ms = 0`,
    )
    .run(HELD_MESSAGE_DRAFT_TTL_MS);
  database.exec(
    "CREATE INDEX IF NOT EXISTS idx_held_message_drafts_expiry ON held_message_drafts(state, expires_at_ms)",
  );
}

export function initializeHeldMessageDrafts(
  database: DatabaseSync,
  now: Date,
): void {
  migrateHeldMessageDraftLifecycle(database);
  expireHeldMessageDraftsAt(database, now);
}

export function expireHeldMessageDraftsAt(
  database: DatabaseSync,
  now: Date,
): number {
  return expireHeldMessageDrafts(database, {
    nowMs: now.getTime(),
    resolvedAt: now.toISOString(),
  });
}

export function expireHeldMessageDrafts(
  database: DatabaseSync,
  input: { nowMs: number; resolvedAt: string },
): number {
  return Number(
    database
      .prepare(
        `UPDATE held_message_drafts
         SET state = 'replaced', resolution_kind = 'expired',
             resolved_at = ?, updated_at = ?
         WHERE state = 'held' AND expires_at_ms <= ?`,
      )
      .run(input.resolvedAt, input.resolvedAt, input.nowMs).changes,
  );
}

export function requireActiveHeldMessageDraft(
  database: DatabaseSync,
  input: { heldDraftId: string; nowMs: number },
): Row {
  const row = database
    .prepare("SELECT * FROM held_message_drafts WHERE held_draft_id = ?")
    .get(input.heldDraftId);
  if (row === undefined) {
    throw new NotFoundError(`Held draft ${input.heldDraftId} was not found`);
  }
  if (text(row, "state") !== "held") {
    throw new ConflictError(
      `Held draft ${input.heldDraftId} is no longer active`,
    );
  }
  if (integer(row, "expires_at_ms") <= input.nowMs) {
    throw new ConflictError(`Held draft ${input.heldDraftId} has expired`);
  }
  return row;
}

export function resolveHeldMessageDrafts(
  database: DatabaseSync,
  input: {
    participantId: string;
    resolution: HeldMessageDraftResolution;
    roomId: string;
    threadId?: string;
    timestamp: string;
  },
): void {
  database
    .prepare(
      `UPDATE held_message_drafts
       SET state = 'replaced', resolution_kind = ?, resolved_at = ?, updated_at = ?
       WHERE room_id = ? AND participant_id = ? AND thread_id IS ? AND state = 'held'`,
    )
    .run(
      input.resolution,
      input.timestamp,
      input.timestamp,
      input.roomId,
      input.participantId,
      input.threadId ?? null,
    );
}

export function resolveOneHeldMessageDraft(
  database: DatabaseSync,
  input: {
    heldDraftId: string;
    resolution: HeldMessageDraftResolution;
    timestamp: string;
  },
): void {
  database
    .prepare(
      `UPDATE held_message_drafts
       SET state = 'replaced', resolution_kind = ?, resolved_at = ?, updated_at = ?
       WHERE held_draft_id = ? AND state = 'held'`,
    )
    .run(input.resolution, input.timestamp, input.timestamp, input.heldDraftId);
}
