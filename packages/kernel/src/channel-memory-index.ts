import type { DatabaseSync } from "node:sqlite";

import * as P from "@rah-os/protocol";

import {
  effectiveMemorySwitches,
  hasMemoryAccess,
} from "./channel-memory-access.ts";
import { ForbiddenError } from "./errors.ts";
import { instanceSessionState } from "./instance-session.ts";
import { integer, nullableInteger, text, type Row } from "./sqlite-row.ts";

/**
 * evo S6 batch B (schema 75). The index a Host injects at session start and
 * the per-wake delta. `memory_index_marks` records, per instance session
 * generation, the channel memory sequence through which a wake carrying the
 * delta was registered as sent (the driver accepted exactly that input), and
 * the one delta currently presented but not yet sent (an instance has one
 * lane). A new session generation starts without a row. Host transport
 * knowledge, never a read receipt: it proves the text reached the runtime,
 * not that a model used it.
 */
export const MEMORY_INDEX_MARKS_SCHEMA = `
CREATE TABLE IF NOT EXISTS memory_index_marks (
  instance_id TEXT NOT NULL,
  session_generation INTEGER NOT NULL CHECK (session_generation >= 0),
  room_id TEXT NOT NULL,
  through_seq INTEGER CHECK (through_seq IS NULL OR through_seq >= 0),
  pending_run_attempt_id TEXT,
  pending_through_seq INTEGER,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (instance_id, session_generation)
) STRICT;
`;

/** Index rows the Host needs at most; the renderer bounds bytes itself. */
const INDEX_FETCH_LIMIT = 200;
/** Changed entries listed in one wake; the rest are counted. */
export const MEMORY_DELTA_MAX_CHANGES = 30;
const ENTRY_EVENT = "memory.entry_changed";

/** Schema 75 columns on tables that already existed at 74. */
export function migrateChannelMemoryV75(database: DatabaseSync): void {
  const columns = (table: string) =>
    new Set(
      database
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .map((row) => text(row, "name")),
    );
  const revisions = columns("memory_revisions");
  if (!revisions.has("import_instance_id"))
    database.exec(
      "ALTER TABLE memory_revisions ADD COLUMN import_instance_id TEXT",
    );
  if (!revisions.has("import_path"))
    database.exec("ALTER TABLE memory_revisions ADD COLUMN import_path TEXT");
}

/** The channel sequence of the latest accepted memory change, or 0. */
export function channelMemoryHeadSeq(
  database: DatabaseSync,
  channelId: string,
): number {
  const row = database
    .prepare(
      `SELECT MAX(ev.room_seq) AS seq FROM memory_entries e
         JOIN memory_revisions r ON r.entry_id=e.entry_id
         JOIN room_events ev ON ev.event_id=r.event_id
        WHERE e.scope_room_id=?`,
    )
    .get(channelId);
  return row === undefined ? 0 : (nullableInteger(row, "seq") ?? 0);
}

function instanceChannel(database: DatabaseSync, instanceId: string): string {
  const instance = database
    .prepare("SELECT channel_id FROM role_instances WHERE instance_id=?")
    .get(instanceId);
  if (instance === undefined)
    throw new ForbiddenError(
      "channel memory is available to Role instances only",
    );
  return text(instance, "channel_id");
}

/**
 * Session-start index for the Host (already authenticated and authorized for
 * this participant by the caller). A member whose effective read switch is
 * off, or who is no longer a member, gets no entries.
 */
export function instanceMemoryIndex(
  database: DatabaseSync,
  instanceId: string,
): P.InstanceMemoryIndex {
  const channelId = instanceChannel(database, instanceId);
  const member =
    database
      .prepare("SELECT 1 FROM memberships WHERE room_id=? AND principal_id=?")
      .get(channelId, instanceId) !== undefined;
  const readEnabled =
    member && effectiveMemorySwitches(database, channelId, instanceId).read;
  const throughSeq = channelMemoryHeadSeq(database, channelId);
  if (!readEnabled)
    return { channelId, readEnabled: false, entries: [], total: 0, throughSeq };
  const rows = database
    .prepare(
      `SELECT * FROM memory_entries WHERE scope_room_id=? AND state='active'
        ORDER BY pinned DESC, updated_at DESC, entry_id LIMIT ?`,
    )
    .all(channelId, INDEX_FETCH_LIMIT);
  const total = integer(
    database
      .prepare(
        "SELECT count(*) AS n FROM memory_entries WHERE scope_room_id=? AND state='active'",
      )
      .get(channelId)!,
    "n",
  );
  return P.InstanceMemoryIndexSchema.parse({
    channelId,
    readEnabled: true,
    entries: rows.map((row) => ({
      entryId: text(row, "entry_id"),
      channelId,
      name: text(row, "name"),
      type: text(row, "type"),
      description: text(row, "description"),
      pinned: integer(row, "pinned") === 1,
      state: text(row, "state"),
      revision: integer(row, "revision"),
      createdAt: text(row, "created_at"),
      updatedAt: text(row, "updated_at"),
    })),
    total,
    throughSeq,
  });
}

/**
 * The delta a presented window carries: entries changed after the later of
 * the launch's index (`memoryIndexSeq`, Host-supplied only when the session
 * holds that prompt) and the session's mark. With neither — a session that
 * predates the index, or a first wake that never registered — every entry
 * ever changed is listed (bounded), erring toward repetition, never loss.
 * Undefined for non-instances, a read switch that is off, or no change.
 */
export function presentedMemoryDelta(
  database: DatabaseSync,
  scope: Readonly<P.ActivationCredentialScope>,
  memoryIndexSeq: number | undefined,
): P.MemoryIndexDelta | undefined {
  const isInstance =
    database
      .prepare("SELECT 1 FROM role_instances WHERE instance_id=?")
      .get(scope.participantId) !== undefined;
  if (!isInstance) return undefined;
  let readable: boolean;
  try {
    readable = hasMemoryAccess(database, scope, "read");
  } catch {
    return undefined;
  }
  if (!readable) return undefined;
  const channelId = instanceChannel(database, scope.participantId);
  const head = channelMemoryHeadSeq(database, channelId);
  const mark = database
    .prepare(
      "SELECT through_seq FROM memory_index_marks WHERE instance_id=? AND session_generation=?",
    )
    .get(
      scope.participantId,
      instanceSessionState(database, scope.participantId).generation,
    );
  const base = Math.max(
    memoryIndexSeq ?? 0,
    mark === undefined ? 0 : (nullableInteger(mark, "through_seq") ?? 0),
  );
  if (head <= base) return undefined;
  const rows = database
    .prepare(
      `SELECT e.*, MAX(ev.room_seq) AS changed_seq FROM memory_entries e
         JOIN memory_revisions r ON r.entry_id=e.entry_id
         JOIN room_events ev ON ev.event_id=r.event_id
        WHERE e.scope_room_id=? AND ev.room_seq>? AND ev.type=?
        GROUP BY e.entry_id ORDER BY changed_seq`,
    )
    .all(channelId, base, ENTRY_EVENT) as Row[];
  const listed = rows.slice(0, MEMORY_DELTA_MAX_CHANGES);
  return P.MemoryIndexDeltaSchema.parse({
    throughSeq: head,
    changes: listed.map((row) => {
      const state = text(row, "state");
      return {
        name: text(row, "name"),
        type: text(row, "type"),
        description: state === "deleted" ? null : text(row, "description"),
        pinned: integer(row, "pinned") === 1,
        state,
      };
    }),
    omitted: rows.length - listed.length,
  });
}

/** Keeps the presented (not yet sent) delta head for this RunAttempt. */
export function recordPresentedMemoryDelta(
  database: DatabaseSync,
  scope: Readonly<P.ActivationCredentialScope>,
  throughSeq: number | undefined,
  now: string,
): void {
  const generation = instanceSessionState(
    database,
    scope.participantId,
  ).generation;
  if (throughSeq === undefined) {
    database
      .prepare(
        `UPDATE memory_index_marks SET pending_run_attempt_id=NULL, pending_through_seq=NULL
          WHERE instance_id=? AND session_generation=? AND pending_run_attempt_id=?`,
      )
      .run(scope.participantId, generation, scope.runAttemptId);
    return;
  }
  database
    .prepare(
      `INSERT INTO memory_index_marks(instance_id, session_generation, room_id, through_seq,
         pending_run_attempt_id, pending_through_seq, updated_at)
       VALUES(?, ?, ?, NULL, ?, ?, ?)
       ON CONFLICT(instance_id, session_generation) DO UPDATE SET
         pending_run_attempt_id=excluded.pending_run_attempt_id,
         pending_through_seq=excluded.pending_through_seq,
         updated_at=excluded.updated_at`,
    )
    .run(
      scope.participantId,
      generation,
      instanceChannel(database, scope.participantId),
      scope.runAttemptId,
      throughSeq,
      now,
    );
}

/**
 * After the Host registered a presented window as sent: when that RunAttempt
 * carried the pending delta, the session now holds it. Monotonic; a late or
 * foreign RunAttempt changes nothing.
 */
export function advanceMemoryIndexMark(
  database: DatabaseSync,
  key: { runAttemptId: string },
  now: string,
): void {
  const attempt = database
    .prepare("SELECT participant_id FROM run_attempts WHERE run_attempt_id=?")
    .get(key.runAttemptId);
  if (attempt === undefined) return;
  const participantId = text(attempt, "participant_id");
  const sent = database
    .prepare(
      "SELECT 1 FROM activation_presented_windows WHERE run_attempt_id=? AND sent_at IS NOT NULL",
    )
    .get(key.runAttemptId);
  if (sent === undefined) return;
  database
    .prepare(
      `UPDATE memory_index_marks SET
         through_seq=MAX(COALESCE(through_seq, 0), pending_through_seq),
         pending_run_attempt_id=NULL, pending_through_seq=NULL, updated_at=?
       WHERE instance_id=? AND session_generation=? AND pending_run_attempt_id=?`,
    )
    .run(
      now,
      participantId,
      instanceSessionState(database, participantId).generation,
      key.runAttemptId,
    );
}

/**
 * Attaches the memory delta to a freshly rendered presented window and keeps
 * its head pending for this RunAttempt until the Host registers the send.
 */
export function withPresentedMemoryDelta<Window extends object>(
  database: DatabaseSync,
  scope: Readonly<P.ActivationCredentialScope>,
  memoryIndexSeq: number | undefined,
  now: string,
  window: Window,
): Window & { memoryDelta?: P.MemoryIndexDelta } {
  const memoryDelta = presentedMemoryDelta(database, scope, memoryIndexSeq);
  recordPresentedMemoryDelta(database, scope, memoryDelta?.throughSeq, now);
  return memoryDelta === undefined ? window : { ...window, memoryDelta };
}
