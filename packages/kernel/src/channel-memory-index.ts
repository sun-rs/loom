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
 * evo S6 batch B (schema 75, delivery contract reworked at 76 after review).
 * The index a Host injects at session start and the per-wake delta.
 *
 * `memory_index_marks` holds, per instance session generation, what the
 * session was proven to hold — Host transport knowledge, never a read
 * receipt (it proves the text reached the runtime, not that a model used it):
 *
 * - `served_seq` / `served_read_enabled`: the last index the Host read under
 *   its own credential for this generation. A launch claim
 *   (`memoryIndexSeq`) counts only when it equals this, and it is consumed by
 *   the first accepted wake that carried it;
 * - `index_state`: `index` (a real index snapshot, launch prompt or refresh,
 *   was delivered), `notice` (only the reading-off notice was), or NULL
 *   (nothing proven);
 * - `index_seq`: the channel memory seq of the delivered index snapshot;
 * - `delta_seq`: the head of the last delivered wake delta;
 * - `through_seq`: the seq through which the session holds entry knowledge
 *   (index or delta); the next delta starts after it.
 *
 * Nothing here advances on a presentation. The snapshot a wake carries is
 * frozen on its presented window (`activation_presented_windows.memory_json`)
 * and applied only when the Host registers that window as sent.
 * `pending_run_attempt_id` / `pending_through_seq` (schema 75) are retired.
 */
export const MEMORY_INDEX_MARKS_SCHEMA = `
CREATE TABLE IF NOT EXISTS memory_index_marks (
  instance_id TEXT NOT NULL,
  session_generation INTEGER NOT NULL CHECK (session_generation >= 0),
  room_id TEXT NOT NULL,
  through_seq INTEGER CHECK (through_seq IS NULL OR through_seq >= 0),
  updated_at TEXT NOT NULL,
  served_seq INTEGER,
  served_read_enabled INTEGER,
  index_state TEXT CHECK (index_state IS NULL OR index_state IN ('index', 'notice')),
  index_seq INTEGER,
  delta_seq INTEGER,
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

/**
 * Owner ruling 2026-09-27: a Human delete leaves only the tombstone (name,
 * time, the delete's own reason, metadata), so the description and every
 * earlier revision's reason go with the body (full review 2 P2-3). This
 * idempotent pass clears what a delete before the ruling left behind; it
 * runs on every open and touches only deleted entries.
 */
export function clearDeletedMemoryDescriptions(database: DatabaseSync): void {
  database.exec(`
    UPDATE memory_entries SET description='' WHERE state='deleted' AND description<>'';
    UPDATE memory_revisions SET description='' WHERE description<>''
      AND entry_id IN (SELECT entry_id FROM memory_entries WHERE state='deleted');
    UPDATE memory_revisions SET reason=NULL WHERE reason IS NOT NULL AND op<>'delete'
      AND entry_id IN (SELECT entry_id FROM memory_entries WHERE state='deleted');
  `);
}

/**
 * Owner ruling 2026-09-27: a snapshot already frozen on a presented window of
 * the channel's instances keeps its sequence numbers (the send still
 * registers the same version) but loses the deleted entry's description, so a
 * re-present never returns it. Text a Host already sent is outside the delete
 * boundary (target contract §4).
 */
export function clearPresentedMemoryDescription(
  database: DatabaseSync,
  channelId: string,
  entry: { entryId: string; name: string },
): void {
  const rows = database
    .prepare(
      `SELECT w.activation_id, w.consumer_id, w.run_attempt_id, w.memory_json
         FROM activation_presented_windows w
         JOIN run_attempts r ON r.run_attempt_id=w.run_attempt_id
         JOIN role_instances i ON i.instance_id=r.participant_id
        WHERE i.channel_id=? AND w.memory_json IS NOT NULL`,
    )
    .all(channelId);
  const update = database.prepare(
    `UPDATE activation_presented_windows SET memory_json=?
      WHERE activation_id=? AND consumer_id=? AND run_attempt_id=?`,
  );
  for (const row of rows) {
    const presentation = JSON.parse(
      text(row, "memory_json"),
    ) as MemoryPresentation | null;
    if (presentation === null) continue;
    let changed = false;
    for (const change of presentation.delta?.changes ?? [])
      if (change.name === entry.name && change.description !== null) {
        change.description = null;
        changed = true;
      }
    for (const item of presentation.index?.entries ?? [])
      if (item.entryId === entry.entryId && item.description !== "") {
        item.description = "";
        changed = true;
      }
    if (changed)
      update.run(
        JSON.stringify(presentation),
        text(row, "activation_id"),
        text(row, "consumer_id"),
        text(row, "run_attempt_id"),
      );
  }
}

/**
 * Schema 76: the frozen memory snapshot on each presented window and the
 * per-generation delivery state (see MEMORY_INDEX_MARKS_SCHEMA).
 */
export function migrateChannelMemoryV76(database: DatabaseSync): void {
  const columns = (table: string) =>
    new Set(
      database
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .map((row) => text(row, "name")),
    );
  const windows = columns("activation_presented_windows");
  if (!windows.has("memory_json"))
    database.exec(
      "ALTER TABLE activation_presented_windows ADD COLUMN memory_json TEXT",
    );
  const marks = columns("memory_index_marks");
  if (marks.has("pending_run_attempt_id")) {
    database.exec(`
      ALTER TABLE memory_index_marks DROP COLUMN pending_run_attempt_id;
      ALTER TABLE memory_index_marks DROP COLUMN pending_through_seq;
    `);
  }
  if (!marks.has("served_seq"))
    database.exec(`
      ALTER TABLE memory_index_marks ADD COLUMN served_seq INTEGER;
      ALTER TABLE memory_index_marks ADD COLUMN served_read_enabled INTEGER;
      ALTER TABLE memory_index_marks ADD COLUMN index_state TEXT CHECK (index_state IS NULL OR index_state IN ('index', 'notice'));
      ALTER TABLE memory_index_marks ADD COLUMN index_seq INTEGER;
      ALTER TABLE memory_index_marks ADD COLUMN delta_seq INTEGER;
    `);
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
 * The Host's session-start read (the caller authenticated and authorized
 * it). It also records what was served: review P1-1, the only source a
 * launch claim may be verified against.
 */
export function serveInstanceMemoryIndex(
  database: DatabaseSync,
  instanceId: string,
  now: string,
): P.InstanceMemoryIndex {
  const index = instanceMemoryIndex(database, instanceId);
  database
    .prepare(
      `INSERT INTO memory_index_marks(instance_id, session_generation, room_id, through_seq, updated_at,
         served_seq, served_read_enabled)
       VALUES(?, ?, ?, NULL, ?, ?, ?)
       ON CONFLICT(instance_id, session_generation) DO UPDATE SET
         served_seq=excluded.served_seq,
         served_read_enabled=excluded.served_read_enabled,
         updated_at=excluded.updated_at`,
    )
    .run(
      instanceId,
      instanceSessionState(database, instanceId).generation,
      index.channelId,
      now,
      index.throughSeq,
      index.readEnabled ? 1 : 0,
    );
  return index;
}

/**
 * The memory part of one RunAttempt's wake, frozen with its presented window.
 * `launch`: the Host-served index the launch prompt carried (a verified
 * claim), applied at the send; `delta` / `index` (a refresh): what the wake
 * text carries.
 */
type MemoryPresentation = {
  generation: number;
  launch?: { seq: number; kind: "index" | "notice" };
  delta?: P.MemoryIndexDelta;
  index?: P.InstanceMemoryIndex;
  /**
   * The latest presentation of this RunAttempt withheld the refresh/delta
   * because reading was no longer allowed; a send then delivers neither.
   */
  withheld?: true;
};

type MarkRow = {
  servedSeq: number | undefined;
  servedReadEnabled: boolean;
  indexState: "index" | "notice" | undefined;
  throughSeq: number | undefined;
};

function readMark(
  database: DatabaseSync,
  instanceId: string,
  generation: number,
): MarkRow | undefined {
  const row = database
    .prepare(
      "SELECT * FROM memory_index_marks WHERE instance_id=? AND session_generation=?",
    )
    .get(instanceId, generation);
  if (row === undefined) return undefined;
  const state = row["index_state"];
  return {
    servedSeq: nullableInteger(row, "served_seq") ?? undefined,
    servedReadEnabled: nullableInteger(row, "served_read_enabled") === 1,
    indexState: state === "index" || state === "notice" ? state : undefined,
    throughSeq: nullableInteger(row, "through_seq") ?? undefined,
  };
}

function changedSince(
  database: DatabaseSync,
  channelId: string,
  base: number,
  head: number,
): P.MemoryIndexDelta {
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

/**
 * What a new presentation carries. The session's knowledge is the delivered
 * state plus, when the launch prompt carried a Host-served index, that index.
 * - read off: nothing (the launch claim is still kept for the send);
 * - the session holds only the reading-off notice: a refresh with the current
 *   index (bounded by the Host renderer), never a delta from a head the
 *   session was never given;
 * - otherwise: entries changed after the known baseline; with no baseline at
 *   all (a session that predates the index, or a launch without one) every
 *   entry ever changed, bounded — erring toward repetition, never loss.
 */
function computeMemoryPresentation(
  database: DatabaseSync,
  scope: Readonly<P.ActivationCredentialScope>,
  claimedIndexSeq: number | undefined,
): MemoryPresentation | undefined {
  const instanceId = scope.participantId;
  const isInstance =
    database
      .prepare("SELECT 1 FROM role_instances WHERE instance_id=?")
      .get(instanceId) !== undefined;
  if (!isInstance) return undefined;
  const generation = instanceSessionState(database, instanceId).generation;
  const mark = readMark(database, instanceId, generation);
  // Only an index the Host itself read for this generation, never a bare
  // request-body number, can describe what the launch prompt carried.
  const launch =
    claimedIndexSeq !== undefined && mark?.servedSeq === claimedIndexSeq
      ? {
          seq: claimedIndexSeq,
          kind: mark.servedReadEnabled
            ? ("index" as const)
            : ("notice" as const),
        }
      : undefined;
  const presentation: MemoryPresentation = {
    generation,
    ...(launch === undefined ? {} : { launch }),
  };
  if (!readableNow(database, scope)) return presentation;
  const holdsOnlyNotice =
    launch !== undefined
      ? launch.kind === "notice"
      : mark?.indexState === "notice";
  if (holdsOnlyNotice)
    return {
      ...presentation,
      index: instanceMemoryIndex(database, instanceId),
    };
  const base = Math.max(
    launch?.kind === "index" ? launch.seq : 0,
    mark?.throughSeq ?? 0,
  );
  const channelId = instanceChannel(database, instanceId);
  const head = channelMemoryHeadSeq(database, channelId);
  if (head <= base) return presentation;
  return {
    ...presentation,
    delta: changedSince(database, channelId, base, head),
  };
}

/** Current membership, execution scope and read switch, never cached. */
function readableNow(
  database: DatabaseSync,
  scope: Readonly<P.ActivationCredentialScope>,
): boolean {
  try {
    return hasMemoryAccess(database, scope, "read");
  } catch {
    return false;
  }
}

/**
 * Attaches the memory part to a presented window. The first presentation of
 * a RunAttempt freezes it on the window record; every later presentation of
 * the same RunAttempt returns exactly that snapshot, so the text the Host
 * sends and the state its registration applies are the same version.
 * Freezing fixes the version, never the access: each presentation re-checks
 * reading, and while it is revoked the refresh/delta is withheld and marked
 * so that a send does not count it as delivered (full review 2 P1-3).
 */
export function withPresentedMemory<Window extends object>(
  database: DatabaseSync,
  scope: Readonly<P.ActivationCredentialScope>,
  claimedIndexSeq: number | undefined,
  window: Window,
): Window & {
  memoryDelta?: P.MemoryIndexDelta;
  memoryIndex?: P.InstanceMemoryIndex;
} {
  const key = [scope.activationId, scope.consumerId, scope.runAttemptId];
  const stored = database
    .prepare(
      `SELECT memory_json FROM activation_presented_windows
        WHERE activation_id=? AND consumer_id=? AND run_attempt_id=?`,
    )
    .get(...key);
  let presentation: MemoryPresentation | undefined;
  const frozen = stored === undefined ? null : stored["memory_json"];
  if (typeof frozen === "string") {
    presentation = JSON.parse(frozen) as MemoryPresentation | undefined;
    if (
      presentation !== undefined &&
      presentation !== null &&
      (presentation.delta !== undefined || presentation.index !== undefined)
    ) {
      const withheld = !readableNow(database, scope);
      if (withheld !== (presentation.withheld === true)) {
        presentation = { ...presentation };
        if (withheld) presentation.withheld = true;
        else delete presentation.withheld;
        database
          .prepare(
            `UPDATE activation_presented_windows SET memory_json=?
              WHERE activation_id=? AND consumer_id=? AND run_attempt_id=?`,
          )
          .run(JSON.stringify(presentation), ...key);
      }
      if (withheld)
        presentation = {
          generation: presentation.generation,
          ...(presentation.launch === undefined
            ? {}
            : { launch: presentation.launch }),
        };
    }
  } else {
    presentation = computeMemoryPresentation(database, scope, claimedIndexSeq);
    database
      .prepare(
        `UPDATE activation_presented_windows SET memory_json=?
          WHERE activation_id=? AND consumer_id=? AND run_attempt_id=?`,
      )
      .run(JSON.stringify(presentation ?? null), ...key);
  }
  return {
    ...window,
    ...(presentation?.delta === undefined
      ? {}
      : { memoryDelta: presentation.delta }),
    ...(presentation?.index === undefined
      ? {}
      : { memoryIndex: presentation.index }),
  };
}

/**
 * The Host registered this RunAttempt's window as sent (a transition, never a
 * duplicate or a late receipt): the session now holds exactly the frozen
 * snapshot. The launch index first (a notice clears the entry baseline: that
 * prompt replaced whatever index the session had), then the refresh or delta.
 * A snapshot from an older session generation changes nothing.
 */
export function applySentMemoryPresentation(
  database: DatabaseSync,
  key: { activationId: string; consumerId: string; runAttemptId: string },
  now: string,
): void {
  const row = database
    .prepare(
      `SELECT w.memory_json, r.participant_id FROM activation_presented_windows w
         JOIN run_attempts r ON r.run_attempt_id=w.run_attempt_id
        WHERE w.activation_id=? AND w.consumer_id=? AND w.run_attempt_id=?`,
    )
    .get(key.activationId, key.consumerId, key.runAttemptId);
  const frozen = row === undefined ? null : row["memory_json"];
  if (typeof frozen !== "string") return;
  const presentation = JSON.parse(frozen) as MemoryPresentation | null;
  if (presentation === null) return;
  const instanceId = text(row!, "participant_id");
  if (
    instanceSessionState(database, instanceId).generation !==
    presentation.generation
  )
    return;
  const where = "WHERE instance_id=? AND session_generation=?";
  const args = [instanceId, presentation.generation] as const;
  database
    .prepare(
      `INSERT INTO memory_index_marks(instance_id, session_generation, room_id, through_seq, updated_at)
       VALUES(?, ?, ?, NULL, ?) ON CONFLICT(instance_id, session_generation) DO NOTHING`,
    )
    .run(...args, instanceChannel(database, instanceId), now);
  const { launch } = presentation;
  const { index, delta } = presentation.withheld === true ? {} : presentation;
  if (launch?.kind === "index")
    database
      .prepare(
        `UPDATE memory_index_marks SET index_state='index', index_seq=?,
           through_seq=MAX(COALESCE(through_seq, 0), ?),
           served_seq=CASE WHEN served_seq=? THEN NULL ELSE served_seq END,
           updated_at=? ${where}`,
      )
      .run(launch.seq, launch.seq, launch.seq, now, ...args);
  if (launch?.kind === "notice")
    database
      .prepare(
        `UPDATE memory_index_marks SET index_state='notice', index_seq=NULL,
           through_seq=NULL, delta_seq=NULL,
           served_seq=CASE WHEN served_seq=? THEN NULL ELSE served_seq END,
           updated_at=? ${where}`,
      )
      .run(launch.seq, now, ...args);
  if (index !== undefined)
    database
      .prepare(
        `UPDATE memory_index_marks SET index_state='index', index_seq=?,
           through_seq=MAX(COALESCE(through_seq, 0), ?), updated_at=? ${where}`,
      )
      .run(index.throughSeq, index.throughSeq, now, ...args);
  if (delta !== undefined)
    database
      .prepare(
        `UPDATE memory_index_marks SET
           delta_seq=MAX(COALESCE(delta_seq, 0), ?),
           through_seq=MAX(COALESCE(through_seq, 0), ?), updated_at=? ${where}`,
      )
      .run(delta.throughSeq, delta.throughSeq, now, ...args);
}
