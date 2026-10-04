import type { DatabaseSync } from "node:sqlite";

import {
  RunAttemptFinalInterruptRecordInputSchema,
  RunAttemptFinalInterruptSchema,
  type ActivationCredentialScope,
  type RoomEvent,
  type RunAttemptFinalInterrupt,
  type RunAttemptFinalInterruptRecordInput,
} from "@rah-os/protocol";

import type { AuthenticatedHostContext } from "./auth.ts";
import { ConflictError, ForbiddenError, NotFoundError } from "./errors.ts";
import type { RuntimeTrajectoryServiceOptions } from "./runtime-trajectory.ts";
import {
  integer,
  nullableInteger,
  nullableText,
  text,
  type Row,
} from "./sqlite-row.ts";

/**
 * Final-reply marker (schema 67). A Worker post flagged `final` that commits
 * from the live RunAttempt records here, in that post's own transaction, that
 * the reply to the delivered messages is committed. The first final post of
 * a RunAttempt wins. The Host (the only party that may end a native turn)
 * reads it and reports whether its native interrupt landed.
 *
 * Not an ACK, not a Task transition, not a Room event: completing the
 * Activation still requires delivery acknowledged through `toSeq`.
 */
export const RUN_ATTEMPT_FINAL_REPLY_SCHEMA = `
CREATE TABLE IF NOT EXISTS run_attempt_final_replies (
  run_attempt_id TEXT PRIMARY KEY REFERENCES run_attempts(run_attempt_id),
  activation_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  room_seq INTEGER NOT NULL CHECK (room_seq > 0),
  committed_at TEXT NOT NULL,
  submission_kind TEXT CHECK (submission_kind IS NULL OR submission_kind = 'final-output'),
  interrupt_sent INTEGER CHECK (interrupt_sent IS NULL OR interrupt_sent IN (0, 1)),
  preempted_follow_up TEXT CHECK (preempted_follow_up IS NULL OR preempted_follow_up IN ('true', 'false', 'unknown')),
  reported_at TEXT,
  interrupt_requested INTEGER CHECK (interrupt_requested IS NULL OR interrupt_requested IN (0, 1)),
  interrupt_accepted TEXT CHECK (interrupt_accepted IS NULL OR interrupt_accepted IN ('true', 'false', 'unknown')),
  interrupt_terminal TEXT CHECK (interrupt_terminal IS NULL OR interrupt_terminal IN ('true', 'false', 'unknown'))
) STRICT;
`;

/**
 * P2-1: the separate interrupt facts (requested / accepted / terminal). Added
 * in place, idempotently: rows reported before carry NULL, read as `unknown`
 * (requested follows the recorded `sent`).
 */
export function migrateRunAttemptFinalReplyFacts(database: DatabaseSync): void {
  const columns = new Set(
    database
      .prepare("PRAGMA table_info(run_attempt_final_replies)")
      .all()
      .map((row) => String(row.name)),
  );
  if (columns.size === 0) return;
  if (!columns.has("submission_kind"))
    database.exec(
      "ALTER TABLE run_attempt_final_replies ADD COLUMN submission_kind TEXT CHECK (submission_kind IS NULL OR submission_kind = 'final-output')",
    );
  if (!columns.has("interrupt_requested"))
    database.exec(
      "ALTER TABLE run_attempt_final_replies ADD COLUMN interrupt_requested INTEGER CHECK (interrupt_requested IS NULL OR interrupt_requested IN (0, 1))",
    );
  for (const column of ["interrupt_accepted", "interrupt_terminal"])
    if (!columns.has(column))
      database.exec(
        `ALTER TABLE run_attempt_final_replies ADD COLUMN ${column} TEXT CHECK (${column} IS NULL OR ${column} IN ('true', 'false', 'unknown'))`,
      );
}

const fact = (value: boolean | "unknown" | undefined): string | null =>
  value === undefined ? null : String(value);
const readFact = (value: string | null): boolean | "unknown" =>
  value === null || value === "unknown" ? "unknown" : value === "true";

export type FinalReplyMarker = {
  activationId: string;
  committedAt: string;
  eventId: string;
  /** `null` until the Host reports the native interrupt outcome. */
  interrupt: Omit<RunAttemptFinalInterrupt, "committedRoomSeq"> | null;
  roomId: string;
  roomSeq: number;
  runAttemptId: string;
};

export class RunAttemptFinalReplyService {
  readonly #database: DatabaseSync;
  readonly #now: () => Date;
  readonly #options: RuntimeTrajectoryServiceOptions;
  readonly #listeners = new Set<(runAttemptId: string) => void>();
  /** Recorded inside a still-open transaction; hinted only after commit. */
  #pendingHints: string[] = [];

  constructor(options: RuntimeTrajectoryServiceOptions) {
    this.#database = options.database;
    this.#now = options.now;
    this.#options = options;
  }

  /** Called inside the committing post's transaction (both post routes). */
  recordInTransaction(
    scope: ActivationCredentialScope,
    event: RoomEvent,
  ): void {
    const previous = this.#row(scope.runAttemptId);
    if (
      previous?.submission_kind === "final-output" &&
      previous.event_id !== event.eventId
    )
      throw new ConflictError(
        "This Run already committed its explicit final output",
      );
    const inserted = this.#database
      .prepare(
        `INSERT OR IGNORE INTO run_attempt_final_replies(
           run_attempt_id, activation_id, room_id, event_id, room_seq, committed_at
         ) VALUES(?, ?, ?, ?, ?, ?)`,
      )
      .run(
        scope.runAttemptId,
        scope.activationId,
        event.roomId,
        event.eventId,
        event.roomSeq,
        this.#now().toISOString(),
      );
    if (Number(inserted.changes) > 0)
      this.#pendingHints.push(scope.runAttemptId);
  }

  /** After the post's transaction committed: in-process hints, lossy by design. */
  flushHints(): void {
    const hints = this.#pendingHints;
    this.#pendingHints = [];
    for (const runAttemptId of hints)
      for (const listener of this.#listeners) {
        try {
          listener(runAttemptId);
        } catch {
          // A hint listener never fails the committed post.
        }
      }
  }

  /** Runs one post; hints its markers only if it returned (committed). */
  hinting<T>(post: () => T): T {
    try {
      const result = post();
      this.flushHints();
      return result;
    } catch (error) {
      this.discardHints();
      throw error;
    }
  }

  /** The post failed and rolled back: its recorded hints are void. */
  discardHints(): void {
    this.#pendingHints = [];
  }

  /**
   * In-process wake hint for a co-located Host. Hints may be lost; the Host
   * always re-reads the durable marker before acting.
   */
  subscribe(listener: (runAttemptId: string) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  read(
    host: AuthenticatedHostContext,
    input: { runAttemptId: string },
  ): FinalReplyMarker | null {
    this.#requireOwnedRunAttempt(host, input.runAttemptId);
    const row = this.#row(input.runAttemptId);
    return row === undefined ? null : markerFromRow(row);
  }

  /** The runtime's native interrupt outcome; the first report is kept. */
  recordInterrupt(
    host: AuthenticatedHostContext,
    untrustedInput: RunAttemptFinalInterruptRecordInput,
  ): void {
    const input =
      RunAttemptFinalInterruptRecordInputSchema.parse(untrustedInput);
    this.#requireOwnedRunAttempt(host, input.runAttemptId);
    if (this.#row(input.runAttemptId) === undefined)
      throw new ConflictError(
        `run attempt ${input.runAttemptId} has no committed final reply`,
      );
    this.#database
      .prepare(
        `UPDATE run_attempt_final_replies
         SET interrupt_sent = ?, preempted_follow_up = ?, reported_at = ?,
           interrupt_requested = ?, interrupt_accepted = ?, interrupt_terminal = ?
         WHERE run_attempt_id = ? AND reported_at IS NULL`,
      )
      .run(
        input.sent ? 1 : 0,
        String(input.preemptedFollowUp),
        this.#now().toISOString(),
        input.requested === undefined ? null : input.requested ? 1 : 0,
        fact(input.accepted),
        fact(input.terminal),
        input.runAttemptId,
      );
  }

  #row(runAttemptId: string): Row | undefined {
    return this.#database
      .prepare(
        "SELECT * FROM run_attempt_final_replies WHERE run_attempt_id = ?",
      )
      .get(runAttemptId);
  }

  #requireOwnedRunAttempt(
    host: AuthenticatedHostContext,
    runAttemptId: string,
  ) {
    const authenticatedHost = this.#options.requireHost(host);
    const runAttempt = this.#database
      .prepare("SELECT * FROM run_attempts WHERE run_attempt_id = ?")
      .get(runAttemptId);
    if (runAttempt === undefined)
      throw new NotFoundError(`run attempt ${runAttemptId} was not found`);
    this.#options.requireHostParticipant(
      authenticatedHost,
      text(runAttempt, "participant_id"),
    );
    if (text(runAttempt, "host_id") !== authenticatedHost.hostId)
      throw new ForbiddenError(
        `host ${authenticatedHost.hostId} does not own run attempt ${runAttemptId}`,
      );
    this.#options.requireRunAttemptHostGeneration(
      runAttempt,
      authenticatedHost,
    );
  }
}

/** The usage read's view; `null` when no final post committed. */
export function finalInterruptForRunAttempt(
  database: DatabaseSync,
  runAttemptId: string,
): RunAttemptFinalInterrupt | null {
  const row = database
    .prepare("SELECT * FROM run_attempt_final_replies WHERE run_attempt_id = ?")
    .get(runAttemptId);
  if (row === undefined) return null;
  const marker = markerFromRow(row);
  return RunAttemptFinalInterruptSchema.parse({
    committedRoomSeq: marker.roomSeq,
    requested: marker.interrupt?.requested ?? false,
    accepted: marker.interrupt?.accepted ?? "unknown",
    terminal: marker.interrupt?.terminal ?? "unknown",
    sent: marker.interrupt?.sent ?? false,
    preemptedFollowUp: marker.interrupt?.preemptedFollowUp ?? "unknown",
  });
}

function markerFromRow(row: Row): FinalReplyMarker {
  const sent = nullableInteger(row, "interrupt_sent");
  const preempted = nullableText(row, "preempted_follow_up");
  return {
    activationId: text(row, "activation_id"),
    committedAt: text(row, "committed_at"),
    eventId: text(row, "event_id"),
    interrupt:
      sent === null || preempted === null
        ? null
        : {
            requested:
              (nullableInteger(row, "interrupt_requested") ?? sent) === 1,
            accepted: readFact(nullableText(row, "interrupt_accepted")),
            terminal: readFact(nullableText(row, "interrupt_terminal")),
            sent: sent === 1,
            preemptedFollowUp:
              preempted === "unknown" ? "unknown" : preempted === "true",
          },
    roomId: text(row, "room_id"),
    roomSeq: integer(row, "room_seq"),
    runAttemptId: text(row, "run_attempt_id"),
  };
}
