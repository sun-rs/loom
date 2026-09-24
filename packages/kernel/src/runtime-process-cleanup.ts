import type { DatabaseSync } from "node:sqlite";

import {
  RUNTIME_PROCESS_CLEANUP_READ_LIMIT,
  RuntimeProcessCleanupRecordInputSchema,
  RuntimeProcessCleanupSchema,
  type RuntimeProcessCleanup,
  type RuntimeProcessCleanupRecordInput,
} from "@rah-os/protocol";

import type { AuthenticatedHostContext } from "./auth.ts";
import { ConflictError, ForbiddenError, NotFoundError } from "./errors.ts";
import type { RuntimeTrajectoryServiceOptions } from "./runtime-trajectory.ts";
import { text, type Row } from "./sqlite-row.ts";

/**
 * S2-0 leftover-process cleanup records (schema 64, S2 spec §6a).
 *
 * One row per Host sweep for one participant: how many tagged leftover
 * processes were found, killed and left, and which listening ports were
 * released. Diagnostics next to the ledger (no Room event, Inbox, Task or
 * trajectory effect). The participant's latest row is its cleanup state: an
 * unresolved row (processes remaining, a sweep error, or a resource-cap alert)
 * refuses new execution admission until a later clean sweep; it never cancels
 * work that is already running. A row that killed processes or released ports
 * is announced once, to the next RunAttempt that claims it.
 */
export const RUNTIME_PROCESS_CLEANUP_SCHEMA = `
CREATE TABLE IF NOT EXISTS runtime_process_cleanups (
  cleanup_id TEXT PRIMARY KEY CHECK (length(cleanup_id) BETWEEN 1 AND 200),
  host_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  run_attempt_id TEXT REFERENCES run_attempts(run_attempt_id),
  runtime_run_id TEXT,
  trigger TEXT NOT NULL CHECK (trigger IN ('run_end', 'runtime_crash', 'run_cancelled', 'host_start', 'janitor', 'resource_cap')),
  found_count INTEGER NOT NULL CHECK (found_count >= 0),
  killed_count INTEGER NOT NULL CHECK (killed_count >= 0),
  remaining_count INTEGER NOT NULL CHECK (remaining_count >= 0),
  released_ports_json TEXT NOT NULL,
  remaining_ports_json TEXT NOT NULL,
  cap_exceeded_json TEXT NOT NULL,
  error TEXT,
  blocking INTEGER NOT NULL CHECK (blocking IN (0, 1)),
  notice_run_attempt_id TEXT,
  observed_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_runtime_process_cleanups_participant
  ON runtime_process_cleanups(participant_id, recorded_at);
CREATE INDEX IF NOT EXISTS idx_runtime_process_cleanups_run_attempt
  ON runtime_process_cleanups(run_attempt_id);
`;

export type RuntimeCleanupAdmission =
  { blocked: false } | { blocked: true; reason: string };

export type RuntimeCleanupTarget = {
  participantId: string;
  runAttemptId: string;
  runtimeRunId: string;
  terminated: boolean;
};

export const RUNTIME_CLEANUP_BLOCKED = "RAH_RUNTIME_CLEANUP_BLOCKED";

export class RuntimeProcessCleanupService {
  readonly #database: DatabaseSync;
  readonly #now: () => Date;
  readonly #options: RuntimeTrajectoryServiceOptions;

  constructor(options: RuntimeTrajectoryServiceOptions) {
    this.#database = options.database;
    this.#now = options.now;
    this.#options = options;
  }

  record(
    host: AuthenticatedHostContext,
    untrustedInput: RuntimeProcessCleanupRecordInput,
  ): RuntimeProcessCleanup {
    const input = RuntimeProcessCleanupRecordInputSchema.parse(untrustedInput);
    const authenticatedHost = this.#options.requireHost(host);
    this.#options.requireHostParticipant(
      authenticatedHost,
      input.participantId,
    );
    return this.#transaction(() => {
      if (input.runAttemptId !== undefined) {
        // Janitor rows name a RunAttempt of an earlier Host generation, so
        // only Host and participant ownership are required, not generation.
        const runAttempt = this.#database
          .prepare("SELECT * FROM run_attempts WHERE run_attempt_id = ?")
          .get(input.runAttemptId);
        if (runAttempt === undefined)
          throw new NotFoundError(
            `run attempt ${input.runAttemptId} was not found`,
          );
        if (
          text(runAttempt, "host_id") !== authenticatedHost.hostId ||
          text(runAttempt, "participant_id") !== input.participantId
        )
          throw new ForbiddenError(
            `host ${authenticatedHost.hostId} does not own run attempt ${input.runAttemptId}`,
          );
      }
      const blocking =
        input.remainingCount > 0 ||
        input.error !== undefined ||
        input.trigger === "resource_cap";
      const values = [
        authenticatedHost.hostId,
        input.participantId,
        input.runAttemptId ?? null,
        input.runtimeRunId ?? null,
        input.trigger,
        input.foundCount,
        input.killedCount,
        input.remainingCount,
        JSON.stringify(input.releasedPorts),
        JSON.stringify(input.remainingPorts),
        JSON.stringify(input.capExceeded),
        input.error ?? null,
        blocking ? 1 : 0,
        input.observedAt,
      ];
      const existing = this.#database
        .prepare("SELECT * FROM runtime_process_cleanups WHERE cleanup_id = ?")
        .get(input.cleanupId);
      if (existing !== undefined) {
        const stored = [
          existing.host_id,
          existing.participant_id,
          existing.run_attempt_id,
          existing.runtime_run_id,
          existing.trigger,
          Number(existing.found_count),
          Number(existing.killed_count),
          Number(existing.remaining_count),
          existing.released_ports_json,
          existing.remaining_ports_json,
          existing.cap_exceeded_json,
          existing.error,
          Number(existing.blocking),
          existing.observed_at,
        ];
        if (stored.some((value, index) => value !== values[index]))
          throw new ConflictError(
            `runtime process cleanup ${input.cleanupId} conflicts with an existing record`,
          );
        return cleanupFromRow(existing);
      }
      this.#database
        .prepare(
          `INSERT INTO runtime_process_cleanups(
             cleanup_id, host_id, participant_id, run_attempt_id,
             runtime_run_id, trigger, found_count, killed_count,
             remaining_count, released_ports_json, remaining_ports_json,
             cap_exceeded_json, error, blocking, observed_at, recorded_at
           ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(input.cleanupId, ...values, this.#now().toISOString());
      return cleanupFromRow(
        this.#database
          .prepare(
            "SELECT * FROM runtime_process_cleanups WHERE cleanup_id = ?",
          )
          .get(input.cleanupId)!,
      );
    });
  }

  /** Execution admission for one participant: its latest cleanup state. */
  admission(
    host: AuthenticatedHostContext,
    input: { participantId: string },
  ): RuntimeCleanupAdmission {
    const authenticatedHost = this.#options.requireHost(host);
    this.#options.requireHostParticipant(
      authenticatedHost,
      input.participantId,
    );
    const latest = this.#latest(input.participantId);
    if (latest === undefined || Number(latest.blocking) === 0)
      return { blocked: false };
    return { blocked: true, reason: blockingReason(latest) };
  }

  /**
   * Participants of this Host whose latest cleanup is unresolved and may be
   * re-evaluated by the janitor. A resource-cap alert of a runtime that is
   * still live is excluded: only its run end (or a later sweep) resolves it.
   */
  blockedParticipants(host: AuthenticatedHostContext): string[] {
    const authenticatedHost = this.#options.requireHost(host);
    return this.#database
      .prepare(
        `SELECT c.participant_id FROM runtime_process_cleanups c
         WHERE c.host_id = ? AND c.blocking = 1
           AND c.rowid = (SELECT latest.rowid FROM runtime_process_cleanups latest
                          WHERE latest.participant_id = c.participant_id
                          ORDER BY latest.recorded_at DESC, latest.rowid DESC LIMIT 1)
           AND NOT (c.trigger = 'resource_cap' AND (EXISTS (
             SELECT 1 FROM runtime_processes live
             WHERE live.runtime_run_id = c.runtime_run_id
               AND live.state <> 'terminated') OR EXISTS (
             SELECT 1 FROM instance_runtimes warm
             WHERE warm.instance_runtime_id = c.runtime_run_id
               AND warm.state <> 'terminated')))
         ORDER BY c.participant_id`,
      )
      .all(authenticatedHost.hostId)
      .map((row) => text(row, "participant_id"));
  }

  /** Janitor lookup: which tagged runtime ids this Host ran, and whether dead. */
  resolveRuntimes(
    host: AuthenticatedHostContext,
    input: { runtimeRunIds: readonly string[] },
  ): RuntimeCleanupTarget[] {
    const authenticatedHost = this.#options.requireHost(host);
    const ids = [...new Set(input.runtimeRunIds)].slice(0, 500);
    if (ids.length === 0) return [];
    return this.#database
      .prepare(
        `SELECT runtime_run_id, participant_id, run_attempt_id, state
         FROM runtime_processes
         WHERE launch_host_id = ? AND runtime_run_id IN (${ids.map(() => "?").join(",")})`,
      )
      .all(authenticatedHost.hostId, ...ids)
      .map((row) => ({
        participantId: text(row, "participant_id"),
        runAttemptId: text(row, "run_attempt_id"),
        runtimeRunId: text(row, "runtime_run_id"),
        // A quiesced warm turn record is terminated while its process lives;
        // only the physical runtime lifecycle decides (S2-0 review).
        terminated:
          text(row, "state") === "terminated" &&
          this.#database
            .prepare(
              `SELECT 1 FROM run_attempts run JOIN instance_runtimes warm
                 ON warm.instance_runtime_id = run.instance_runtime_id
               WHERE run.run_attempt_id = ? AND warm.state <> 'terminated'`,
            )
            .get(text(row, "run_attempt_id")) === undefined,
      }));
  }

  /**
   * One short wake line for the next run of this participant, claimed once:
   * every unannounced row that killed processes or released ports is marked
   * with the claiming RunAttempt in the same transaction.
   */
  claimNotice(
    host: AuthenticatedHostContext,
    input: { participantId: string; runAttemptId: string },
  ): string | null {
    const authenticatedHost = this.#options.requireHost(host);
    this.#options.requireHostParticipant(
      authenticatedHost,
      input.participantId,
    );
    return this.#transaction(() => {
      const rows = this.#database
        .prepare(
          `SELECT * FROM runtime_process_cleanups
           WHERE participant_id = ? AND notice_run_attempt_id IS NULL
             AND (killed_count > 0 OR released_ports_json <> '[]')
           ORDER BY recorded_at, rowid`,
        )
        .all(input.participantId);
      if (rows.length === 0) return null;
      this.#database
        .prepare(
          `UPDATE runtime_process_cleanups SET notice_run_attempt_id = ?
           WHERE participant_id = ? AND notice_run_attempt_id IS NULL
             AND (killed_count > 0 OR released_ports_json <> '[]')`,
        )
        .run(input.runAttemptId, input.participantId);
      const killed = rows.reduce(
        (total, row) => total + Number(row.killed_count),
        0,
      );
      const ports = [
        ...new Set(
          rows.flatMap(
            (row) => JSON.parse(text(row, "released_ports_json")) as number[],
          ),
        ),
      ].sort((left, right) => left - right);
      return formatNotice(killed, ports);
    });
  }

  /** Room removal / session reset: the old processes must be gone first. */
  assertNoUnresolved(participantId: string): void {
    assertNoUnresolvedRuntimeCleanup(this.#database, participantId);
  }

  listForRunAttempt(runAttemptId: string): RuntimeProcessCleanup[] {
    return this.#database
      .prepare(
        `SELECT * FROM runtime_process_cleanups WHERE run_attempt_id = ?
         ORDER BY recorded_at, rowid LIMIT ?`,
      )
      .all(runAttemptId, RUNTIME_PROCESS_CLEANUP_READ_LIMIT)
      .map(cleanupFromRow);
  }

  #latest(participantId: string): Row | undefined {
    return latestCleanup(this.#database, participantId);
  }

  #transaction<T>(operation: () => T): T {
    if (this.#database.isTransaction) return operation();
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.#database.exec("COMMIT");
      return result;
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }
}

function latestCleanup(
  database: DatabaseSync,
  participantId: string,
): Row | undefined {
  return database
    .prepare(
      `SELECT * FROM runtime_process_cleanups WHERE participant_id = ?
       ORDER BY recorded_at DESC, rowid DESC LIMIT 1`,
    )
    .get(participantId);
}

/**
 * Room removal and instance session reset refuse while the participant's
 * latest leftover cleanup is unresolved: its old processes must be gone
 * before membership or session generation moves on (S2 spec §6a item 7).
 */
export function assertNoUnresolvedRuntimeCleanup(
  database: DatabaseSync,
  participantId: string,
): void {
  const latest = latestCleanup(database, participantId);
  if (latest !== undefined && Number(latest.blocking) === 1)
    throw new ConflictError(
      `principal ${participantId} has unresolved leftover processes: ${blockingReason(latest)}`,
    );
}

const NOTICE_PORT_LIMIT = 8;

function formatNotice(killed: number, ports: number[]): string {
  const parts: string[] = [];
  if (killed > 0)
    parts.push(
      `${killed} leftover background process${killed === 1 ? " was" : "es were"} stopped`,
    );
  if (ports.length > 0) {
    const shown = ports.slice(0, NOTICE_PORT_LIMIT).join(", ");
    const more =
      ports.length > NOTICE_PORT_LIMIT
        ? ` and ${ports.length - NOTICE_PORT_LIMIT} more`
        : "";
    parts.push(
      `listening port${ports.length === 1 ? "" : "s"} ${shown}${more} released`,
    );
  }
  return `Host cleanup after your previous run: ${parts.join("; ")}. Restart anything you still need.`;
}

function blockingReason(row: Row): string {
  const caps = JSON.parse(text(row, "cap_exceeded_json")) as string[];
  const reasons: string[] = [];
  const remaining = Number(row.remaining_count);
  if (remaining > 0)
    reasons.push(
      `${remaining} leftover process${remaining === 1 ? "" : "es"} could not be stopped`,
    );
  if (caps.length > 0)
    reasons.push(`resource cap exceeded: ${caps.join(", ")}`);
  if (typeof row.error === "string") reasons.push(`sweep failed: ${row.error}`);
  return `${RUNTIME_CLEANUP_BLOCKED}: ${reasons.join("; ")}`;
}

function cleanupFromRow(row: Row): RuntimeProcessCleanup {
  return RuntimeProcessCleanupSchema.parse({
    cleanupId: text(row, "cleanup_id"),
    ...(row.run_attempt_id === null
      ? {}
      : { runAttemptId: text(row, "run_attempt_id") }),
    ...(row.runtime_run_id === null
      ? {}
      : { runtimeRunId: text(row, "runtime_run_id") }),
    trigger: text(row, "trigger"),
    foundCount: Number(row.found_count),
    killedCount: Number(row.killed_count),
    remainingCount: Number(row.remaining_count),
    releasedPorts: JSON.parse(text(row, "released_ports_json")),
    remainingPorts: JSON.parse(text(row, "remaining_ports_json")),
    capExceeded: JSON.parse(text(row, "cap_exceeded_json")),
    ...(row.error === null ? {} : { error: text(row, "error") }),
    observedAt: text(row, "observed_at"),
    blocking: Number(row.blocking) === 1,
    recordedAt: text(row, "recorded_at"),
  });
}
