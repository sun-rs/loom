import { createHash } from "node:crypto";
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
import { nullableText, text, type Row } from "./sqlite-row.ts";

/**
 * S2-0 leftover-process cleanup records (schema 64; per-runtime state and
 * notice reservation schema 66, S2 spec §6a).
 *
 * `runtime_process_cleanups` keeps one row per Host sweep of one runtime: how
 * many tagged leftover processes were found, killed, left or could not be
 * verified, and which listening ports were released. Diagnostics next to the
 * ledger (no Room event, Inbox, Task or trajectory effect).
 *
 * `runtime_cleanup_states` is the admission fence, one row per runtime:
 * `pending` (the Host marked a cleanup due and has not recorded its result),
 * `blocked` (the newest observation left processes, unknown processes, a
 * sweep error or a resource-cap alert) or `resolved`. A participant is
 * admitted only when none of its runtimes is pending or blocked; a clean
 * sweep of one runtime never clears another. Observations apply in
 * `observedAt` order, so a sweep observed before a later pending mark (or
 * before a newer result) is kept as history and never changes the state. It
 * never cancels work that is already running.
 *
 * Notices: a row that killed processes or released ports is pending notice;
 * `reserveNotice` reserves pending rows for one RunAttempt (a same-run retry
 * returns the same content), `acceptNotice` consumes them once the runtime
 * accepted the input, `releaseNotice` returns them after an early failure, and
 * a reservation of a RunAttempt that finished without acceptance is released
 * automatically. Delivery is at-least-once; the line carries a stable dedup id.
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
  recorded_at TEXT NOT NULL,
  unknown_count INTEGER NOT NULL DEFAULT 0 CHECK (unknown_count >= 0),
  ports_observed INTEGER NOT NULL DEFAULT 1 CHECK (ports_observed IN (0, 1)),
  notice_accepted_at TEXT
) STRICT;

CREATE INDEX IF NOT EXISTS idx_runtime_process_cleanups_participant
  ON runtime_process_cleanups(participant_id, recorded_at);
CREATE INDEX IF NOT EXISTS idx_runtime_process_cleanups_run_attempt
  ON runtime_process_cleanups(run_attempt_id);

CREATE TABLE IF NOT EXISTS runtime_cleanup_states (
  runtime_run_id TEXT PRIMARY KEY CHECK (length(runtime_run_id) BETWEEN 1 AND 200),
  host_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  run_attempt_id TEXT,
  state TEXT NOT NULL CHECK (state IN ('pending', 'blocked', 'resolved')),
  last_cleanup_id TEXT,
  observed_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_runtime_cleanup_states_participant
  ON runtime_cleanup_states(participant_id, state);
`;

/** Columns added to `runtime_process_cleanups` by schema 66. */
const CLEANUP_COLUMNS_V66: readonly [string, string][] = [
  ["unknown_count", "INTEGER NOT NULL DEFAULT 0 CHECK (unknown_count >= 0)"],
  [
    "ports_observed",
    "INTEGER NOT NULL DEFAULT 1 CHECK (ports_observed IN (0, 1))",
  ],
  ["notice_accepted_at", "TEXT"],
];

/**
 * Schema 66: add the columns, backfill one state per runtime from its newest
 * row (this re-exposes leftovers a later anonymous janitor row used to hide),
 * and treat notices claimed before the upgrade as delivered.
 */
export function migrateRuntimeCleanupV66(database: DatabaseSync): void {
  const existing = new Set(
    database
      .prepare("PRAGMA table_info(runtime_process_cleanups)")
      .all()
      .map((row) => String(row.name)),
  );
  const added = CLEANUP_COLUMNS_V66.filter(([name]) => !existing.has(name));
  for (const [name, definition] of added)
    database.exec(
      `ALTER TABLE runtime_process_cleanups ADD COLUMN ${name} ${definition}`,
    );
  if (!added.some(([name]) => name === "notice_accepted_at")) return;
  database.exec(`
    UPDATE runtime_process_cleanups SET notice_accepted_at = recorded_at
    WHERE notice_run_attempt_id IS NOT NULL;
    INSERT OR IGNORE INTO runtime_cleanup_states(
      runtime_run_id, host_id, participant_id, run_attempt_id, state,
      last_cleanup_id, observed_at, updated_at)
    SELECT c.runtime_run_id, c.host_id, c.participant_id, c.run_attempt_id,
      CASE WHEN c.blocking = 1 THEN 'blocked' ELSE 'resolved' END,
      c.cleanup_id, c.observed_at, c.recorded_at
    FROM runtime_process_cleanups c
    WHERE c.runtime_run_id IS NOT NULL
      AND c.rowid = (SELECT latest.rowid FROM runtime_process_cleanups latest
                     WHERE latest.runtime_run_id = c.runtime_run_id
                     ORDER BY latest.recorded_at DESC, latest.rowid DESC LIMIT 1);
  `);
}

export type RuntimeCleanupAdmission =
  { blocked: false } | { blocked: true; reason: string };

export type RuntimeCleanupTarget = {
  participantId: string;
  runAttemptId: string;
  runtimeRunId: string;
  terminated: boolean;
};

/** An unresolved runtime whose processes can be re-swept (not live). */
export type RuntimeCleanupResweepTarget = {
  participantId: string;
  runAttemptId?: string;
  runtimeRunId: string;
  state: "pending" | "blocked";
};

export const RUNTIME_CLEANUP_BLOCKED = "RAH_RUNTIME_CLEANUP_BLOCKED";

const RESOLVE_PAGE_SIZE = 500;
const LIVE_RUN_STATES = "('starting', 'running', 'orphaned')";

/** A runtime that is still alive is excluded from re-sweeps (cap alerts). */
const RUNTIME_IS_LIVE_SQL = `(EXISTS (
    SELECT 1 FROM runtime_processes live
    WHERE live.runtime_run_id = s.runtime_run_id
      AND live.state <> 'terminated') OR EXISTS (
    SELECT 1 FROM instance_runtimes warm
    WHERE warm.instance_runtime_id = s.runtime_run_id
      AND warm.state <> 'terminated'))`;

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
        input.unknownCount > 0 ||
        input.error !== undefined ||
        input.trigger === "resource_cap";
      const values = [
        authenticatedHost.hostId,
        input.participantId,
        input.runAttemptId ?? null,
        input.runtimeRunId,
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
        input.unknownCount,
        input.portsObserved ? 1 : 0,
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
          Number(existing.unknown_count),
          Number(existing.ports_observed),
        ];
        if (stored.some((value, index) => value !== values[index]))
          throw new ConflictError(
            `runtime process cleanup ${input.cleanupId} conflicts with an existing record`,
          );
        return cleanupFromRow(existing);
      }
      const recordedAt = this.#now().toISOString();
      this.#database
        .prepare(
          `INSERT INTO runtime_process_cleanups(
             cleanup_id, host_id, participant_id, run_attempt_id,
             runtime_run_id, trigger, found_count, killed_count,
             remaining_count, released_ports_json, remaining_ports_json,
             cap_exceeded_json, error, blocking, observed_at, unknown_count,
             ports_observed, recorded_at
           ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(input.cleanupId, ...values, recordedAt);
      this.#applyObservation({
        hostId: authenticatedHost.hostId,
        observedAt: input.observedAt,
        participantId: input.participantId,
        recordedAt,
        runAttemptId: input.runAttemptId,
        runtimeRunId: input.runtimeRunId,
        state: blocking ? "blocked" : "resolved",
        cleanupId: input.cleanupId,
      });
      return cleanupFromRow(
        this.#database
          .prepare(
            "SELECT * FROM runtime_process_cleanups WHERE cleanup_id = ?",
          )
          .get(input.cleanupId)!,
      );
    });
  }

  /**
   * The Host is about to sweep a runtime whose process ended: until a newer
   * result is recorded, that runtime blocks its participant's admission (a
   * Host crash or a failed record write leaves it pending, not clear).
   */
  markPending(
    host: AuthenticatedHostContext,
    input: {
      observedAt: string;
      participantId: string;
      runAttemptId?: string;
      runtimeRunId: string;
    },
  ): void {
    const authenticatedHost = this.#options.requireHost(host);
    this.#options.requireHostParticipant(
      authenticatedHost,
      input.participantId,
    );
    if (
      input.runtimeRunId.length === 0 ||
      input.runtimeRunId.length > 200 ||
      !Number.isFinite(Date.parse(input.observedAt))
    )
      throw new ConflictError("invalid pending runtime cleanup");
    this.#transaction(() => {
      const current = this.#stateRow(input.runtimeRunId);
      this.#applyObservation({
        hostId: authenticatedHost.hostId,
        observedAt: input.observedAt,
        participantId: input.participantId,
        recordedAt: this.#now().toISOString(),
        runAttemptId: input.runAttemptId,
        runtimeRunId: input.runtimeRunId,
        // A blocked runtime stays blocked (its reason is more specific).
        state: current?.state === "blocked" ? "blocked" : "pending",
        cleanupId:
          current === undefined
            ? null
            : nullableText(current, "last_cleanup_id"),
      });
    });
  }

  /** Execution admission for one participant: all of its runtimes. */
  admission(
    host: AuthenticatedHostContext,
    input: { participantId: string },
  ): RuntimeCleanupAdmission {
    const authenticatedHost = this.#options.requireHost(host);
    this.#options.requireHostParticipant(
      authenticatedHost,
      input.participantId,
    );
    const reason = unresolvedReason(this.#database, input.participantId);
    return reason === undefined
      ? { blocked: false }
      : { blocked: true, reason };
  }

  /**
   * Unresolved runtimes of this Host that the janitor may re-sweep. A
   * runtime that is still live (a resource-cap alert of a busy run or warm
   * process) is excluded: only its end, and the sweep after it, resolves it.
   */
  resweepTargets(
    host: AuthenticatedHostContext,
    input: { participantId?: string },
  ): RuntimeCleanupResweepTarget[] {
    const authenticatedHost = this.#options.requireHost(host);
    if (input.participantId !== undefined)
      this.#options.requireHostParticipant(
        authenticatedHost,
        input.participantId,
      );
    return this.#database
      .prepare(
        `SELECT s.runtime_run_id, s.participant_id, s.run_attempt_id, s.state
         FROM runtime_cleanup_states s
         WHERE s.host_id = ? AND s.state <> 'resolved'
           AND (? IS NULL OR s.participant_id = ?)
           AND NOT ${RUNTIME_IS_LIVE_SQL}
         ORDER BY s.participant_id, s.runtime_run_id`,
      )
      .all(
        authenticatedHost.hostId,
        input.participantId ?? null,
        input.participantId ?? null,
      )
      .map((row) => ({
        participantId: text(row, "participant_id"),
        ...(row.run_attempt_id === null
          ? {}
          : { runAttemptId: text(row, "run_attempt_id") }),
        runtimeRunId: text(row, "runtime_run_id"),
        state: text(row, "state") as "pending" | "blocked",
      }));
  }

  /** Participants of this Host with a re-sweepable unresolved runtime. */
  blockedParticipants(host: AuthenticatedHostContext): string[] {
    return [
      ...new Set(
        this.resweepTargets(host, {}).map((target) => target.participantId),
      ),
    ];
  }

  /**
   * Janitor lookup: which tagged runtime ids this Host ran, and whether
   * dead. Pages through every id (no silent truncation).
   */
  resolveRuntimes(
    host: AuthenticatedHostContext,
    input: { runtimeRunIds: readonly string[] },
  ): RuntimeCleanupTarget[] {
    const authenticatedHost = this.#options.requireHost(host);
    const ids = [...new Set(input.runtimeRunIds)];
    const targets: RuntimeCleanupTarget[] = [];
    for (let offset = 0; offset < ids.length; offset += RESOLVE_PAGE_SIZE) {
      const page = ids.slice(offset, offset + RESOLVE_PAGE_SIZE);
      targets.push(
        ...this.#database
          .prepare(
            `SELECT runtime_run_id, participant_id, run_attempt_id, state
             FROM runtime_processes
             WHERE launch_host_id = ? AND runtime_run_id IN (${page.map(() => "?").join(",")})`,
          )
          .all(authenticatedHost.hostId, ...page)
          .map((row) => ({
            participantId: text(row, "participant_id"),
            runAttemptId: text(row, "run_attempt_id"),
            runtimeRunId: text(row, "runtime_run_id"),
            // A quiesced warm turn record is terminated while its process
            // lives; only the physical runtime lifecycle decides.
            terminated:
              text(row, "state") === "terminated" &&
              this.#database
                .prepare(
                  `SELECT 1 FROM run_attempts run JOIN instance_runtimes warm
                     ON warm.instance_runtime_id = run.instance_runtime_id
                   WHERE run.run_attempt_id = ? AND warm.state <> 'terminated'`,
                )
                .get(text(row, "run_attempt_id")) === undefined,
          })),
      );
    }
    return targets;
  }

  /**
   * One short wake line for this RunAttempt. Rows already reserved or
   * accepted by it are returned again unchanged (same-run retry); otherwise
   * every pending row is reserved for it. Reservations of RunAttempts that
   * are no longer live and never accepted return to pending first.
   */
  reserveNotice(
    host: AuthenticatedHostContext,
    input: { participantId: string; runAttemptId: string },
  ): string | null {
    const authenticatedHost = this.#options.requireHost(host);
    this.#options.requireHostParticipant(
      authenticatedHost,
      input.participantId,
    );
    return this.#transaction(() => {
      this.#database
        .prepare(
          `UPDATE runtime_process_cleanups SET notice_run_attempt_id = NULL
           WHERE participant_id = ? AND notice_accepted_at IS NULL
             AND notice_run_attempt_id IS NOT NULL
             AND notice_run_attempt_id <> ?
             AND NOT EXISTS (
               SELECT 1 FROM run_attempts run
               WHERE run.run_attempt_id = runtime_process_cleanups.notice_run_attempt_id
                 AND run.state IN ${LIVE_RUN_STATES})`,
        )
        .run(input.participantId, input.runAttemptId);
      const reserved = () =>
        this.#database
          .prepare(
            `SELECT * FROM runtime_process_cleanups
             WHERE participant_id = ? AND notice_run_attempt_id = ?
             ORDER BY recorded_at, rowid`,
          )
          .all(input.participantId, input.runAttemptId);
      let rows = reserved();
      if (rows.length === 0) {
        this.#database
          .prepare(
            `UPDATE runtime_process_cleanups SET notice_run_attempt_id = ?
             WHERE participant_id = ? AND notice_run_attempt_id IS NULL
               AND notice_accepted_at IS NULL
               AND (killed_count > 0 OR released_ports_json <> '[]')`,
          )
          .run(input.runAttemptId, input.participantId);
        rows = reserved();
      }
      if (rows.length === 0) return null;
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
      const dedupId = createHash("sha256")
        .update(
          rows
            .map((row) => text(row, "cleanup_id"))
            .sort()
            .join("\n"),
        )
        .digest("hex")
        .slice(0, 8);
      return formatNotice(killed, ports, dedupId);
    });
  }

  /** The runtime accepted the input that carried this run's notice. */
  acceptNotice(
    host: AuthenticatedHostContext,
    input: { participantId: string; runAttemptId: string },
  ): void {
    const authenticatedHost = this.#options.requireHost(host);
    this.#options.requireHostParticipant(
      authenticatedHost,
      input.participantId,
    );
    this.#database
      .prepare(
        `UPDATE runtime_process_cleanups SET notice_accepted_at = ?
         WHERE participant_id = ? AND notice_run_attempt_id = ?
           AND notice_accepted_at IS NULL`,
      )
      .run(this.#now().toISOString(), input.participantId, input.runAttemptId);
  }

  /** Early failure before acceptance: the next run receives the notice. */
  releaseNotice(
    host: AuthenticatedHostContext,
    input: { participantId: string; runAttemptId: string },
  ): void {
    const authenticatedHost = this.#options.requireHost(host);
    this.#options.requireHostParticipant(
      authenticatedHost,
      input.participantId,
    );
    this.#database
      .prepare(
        `UPDATE runtime_process_cleanups SET notice_run_attempt_id = NULL
         WHERE participant_id = ? AND notice_run_attempt_id = ?
           AND notice_accepted_at IS NULL`,
      )
      .run(input.participantId, input.runAttemptId);
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

  #stateRow(runtimeRunId: string): Row | undefined {
    return this.#database
      .prepare("SELECT * FROM runtime_cleanup_states WHERE runtime_run_id = ?")
      .get(runtimeRunId);
  }

  /** Applies one observation to a runtime's state unless a newer one exists. */
  #applyObservation(input: {
    cleanupId: string | null;
    hostId: string;
    observedAt: string;
    participantId: string;
    recordedAt: string;
    runAttemptId: string | undefined;
    runtimeRunId: string;
    state: "pending" | "blocked" | "resolved";
  }): void {
    const current = this.#stateRow(input.runtimeRunId);
    if (current !== undefined) {
      if (text(current, "participant_id") !== input.participantId)
        throw new ConflictError(
          `runtime ${input.runtimeRunId} belongs to another participant`,
        );
      if (
        Date.parse(input.observedAt) < Date.parse(text(current, "observed_at"))
      )
        return;
      this.#database
        .prepare(
          `UPDATE runtime_cleanup_states
           SET state = ?, last_cleanup_id = ?, observed_at = ?, updated_at = ?,
               host_id = ?, run_attempt_id = COALESCE(?, run_attempt_id)
           WHERE runtime_run_id = ?`,
        )
        .run(
          input.state,
          input.cleanupId,
          input.observedAt,
          input.recordedAt,
          input.hostId,
          input.runAttemptId ?? null,
          input.runtimeRunId,
        );
      return;
    }
    this.#database
      .prepare(
        `INSERT INTO runtime_cleanup_states(
           runtime_run_id, host_id, participant_id, run_attempt_id, state,
           last_cleanup_id, observed_at, updated_at)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.runtimeRunId,
        input.hostId,
        input.participantId,
        input.runAttemptId ?? null,
        input.state,
        input.cleanupId,
        input.observedAt,
        input.recordedAt,
      );
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

/** Why a participant is not admitted, or undefined when every runtime is clear. */
function unresolvedReason(
  database: DatabaseSync,
  participantId: string,
): string | undefined {
  const rows = database
    .prepare(
      `SELECT c.*, s.runtime_run_id AS state_runtime_run_id,
         s.state AS cleanup_state FROM runtime_cleanup_states s
       LEFT JOIN runtime_process_cleanups c ON c.cleanup_id = s.last_cleanup_id
       WHERE s.participant_id = ? AND s.state <> 'resolved'
       ORDER BY s.runtime_run_id LIMIT 8`,
    )
    .all(participantId);
  if (rows.length === 0) return undefined;
  const parts = rows.map((row) => {
    const runtime = text(row, "state_runtime_run_id");
    if (text(row, "cleanup_state") === "pending" || row.cleanup_id === null)
      return `runtime ${runtime}: cleanup not confirmed (pending sweep)`;
    return `runtime ${runtime}: ${blockingReasons(row).join("; ")}`;
  });
  return `${RUNTIME_CLEANUP_BLOCKED}: ${parts.join(" | ")}`;
}

/**
 * Room removal and instance session reset refuse while any runtime of the
 * participant has an unresolved leftover cleanup: its old processes must be
 * gone before membership or session generation moves on (S2 spec §6a item 7).
 */
export function assertNoUnresolvedRuntimeCleanup(
  database: DatabaseSync,
  participantId: string,
): void {
  const reason = unresolvedReason(database, participantId);
  if (reason !== undefined)
    throw new ConflictError(
      `principal ${participantId} has unresolved leftover processes: ${reason}`,
    );
}

const NOTICE_PORT_LIMIT = 8;

function formatNotice(
  killed: number,
  ports: number[],
  dedupId: string,
): string {
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
  return `Host cleanup after your previous run: ${parts.join("; ")}. Restart anything you still need. (notice ${dedupId})`;
}

function blockingReasons(row: Row): string[] {
  const caps = JSON.parse(text(row, "cap_exceeded_json")) as string[];
  const reasons: string[] = [];
  const remaining = Number(row.remaining_count);
  if (remaining > 0)
    reasons.push(
      `${remaining} leftover process${remaining === 1 ? "" : "es"} could not be stopped`,
    );
  const unknown = Number(row.unknown_count ?? 0);
  if (unknown > 0)
    reasons.push(
      `${unknown} tagged process${unknown === 1 ? "" : "es"} could not be verified`,
    );
  if (caps.length > 0)
    reasons.push(`resource cap exceeded: ${caps.join(", ")}`);
  if (typeof row.error === "string") reasons.push(`sweep failed: ${row.error}`);
  return reasons;
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
    unknownCount: Number(row.unknown_count ?? 0),
    portsObserved: Number(row.ports_observed ?? 1) === 1,
    ...(row.error === null ? {} : { error: text(row, "error") }),
    observedAt: text(row, "observed_at"),
    blocking: Number(row.blocking) === 1,
    recordedAt: text(row, "recorded_at"),
  });
}
