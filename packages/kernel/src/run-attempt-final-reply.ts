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
  interrupt_sent INTEGER CHECK (interrupt_sent IS NULL OR interrupt_sent IN (0, 1)),
  preempted_follow_up TEXT CHECK (preempted_follow_up IS NULL OR preempted_follow_up IN ('true', 'false', 'unknown')),
  reported_at TEXT
) STRICT;
`;

export type FinalReplyMarker = {
  activationId: string;
  committedAt: string;
  eventId: string;
  /** `null` until the Host reports the native interrupt outcome. */
  interrupt: Pick<
    RunAttemptFinalInterrupt,
    "preemptedFollowUp" | "sent"
  > | null;
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
         SET interrupt_sent = ?, preempted_follow_up = ?, reported_at = ?
         WHERE run_attempt_id = ? AND reported_at IS NULL`,
      )
      .run(
        input.sent ? 1 : 0,
        String(input.preemptedFollowUp),
        this.#now().toISOString(),
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
            sent: sent === 1,
            preemptedFollowUp:
              preempted === "unknown" ? "unknown" : preempted === "true",
          },
    roomId: text(row, "room_id"),
    roomSeq: integer(row, "room_seq"),
    runAttemptId: text(row, "run_attempt_id"),
  };
}
