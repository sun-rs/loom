import type { DatabaseSync } from "node:sqlite";

import type { AuthenticatedHostContext } from "./auth.ts";
import {
  ConflictError,
  ExecutionFencedError,
  ForbiddenError,
  NotFoundError,
} from "./errors.ts";
import type { RoomEventWriter } from "./room-event-writer.ts";
import {
  integer,
  nullableInteger,
  nullableText,
  text,
  type Row,
} from "./sqlite-row.ts";

/**
 * S2-a warm instance runtimes (S2 spec §1/§2, contract §6a).
 *
 * One `instance_runtimes` row is one warm Provider process lifetime for one
 * participant. It exclusively owns Host generation, crash, physical exit,
 * resource snapshot and janitor facts; the partial unique index allows at
 * most one live (non-terminated) row per participant, so a second process can
 * never be admitted before the first is proven gone.
 *
 * Each Activation stays one RunAttempt. Its `runtime_processes` row becomes
 * the per-turn execution record and closes with one of two proofs:
 * - `process_exit`: the process really ended, with its real exit data;
 * - `turn_quiesced`: this turn can no longer act (admission closed, evidence
 *   drained, handle revoked) while the process lives on. Exit columns stay
 *   NULL; nothing is invented. Quiescence never ACKs delivery, completes a
 *   Task or proves a reply.
 *
 * The lane is held (`busy`, `current_run_attempt_id`) from turn begin until
 * the Activation left `leased` — only then may the next turn begin.
 * Diagnostics adjacent to the ledger; only the quiescence proof, which closes
 * a RunAttempt's execution record, appends a Room event.
 */
export const INSTANCE_RUNTIME_SCHEMA = `
CREATE TABLE IF NOT EXISTS instance_runtimes (
  instance_runtime_id TEXT PRIMARY KEY CHECK (length(instance_runtime_id) BETWEEN 1 AND 200),
  participant_id TEXT NOT NULL,
  host_id TEXT NOT NULL,
  host_instance_id TEXT NOT NULL,
  driver TEXT NOT NULL CHECK (length(driver) BETWEEN 1 AND 200),
  cli_fingerprint TEXT,
  pid INTEGER CHECK (pid IS NULL OR pid > 1),
  pgid INTEGER CHECK (pgid IS NULL OR pgid > 1),
  process_started_at TEXT,
  native_session_id TEXT,
  session_resume_ms INTEGER CHECK (session_resume_ms IS NULL OR session_resume_ms >= 0),
  state TEXT NOT NULL CHECK (state IN ('starting', 'idle', 'busy', 'suspect', 'terminated')),
  current_run_attempt_id TEXT,
  turn_count INTEGER NOT NULL DEFAULT 0 CHECK (turn_count >= 0),
  rss_kb INTEGER CHECK (rss_kb IS NULL OR rss_kb >= 0),
  terminated_reason TEXT CHECK (terminated_reason IS NULL OR terminated_reason IN ('idle_ttl', 'lru', 'recycle_rss', 'recycle_age', 'cli_changed', 'config_restart', 'crash', 'stall', 'resource_failure', 'removed', 'host_shutdown', 'start_failed')),
  exit_code INTEGER,
  exit_signal TEXT,
  started_at TEXT NOT NULL,
  last_activity_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  terminated_at TEXT
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_instance_runtimes_live
  ON instance_runtimes(participant_id) WHERE state <> 'terminated';
CREATE INDEX IF NOT EXISTS idx_instance_runtimes_host
  ON instance_runtimes(host_id, state);
`;

/**
 * A busy warm turn whose execution record is orphaned (lease expiry, unowned
 * runtime reconciliation, quarantine) makes its runtime `suspect`: no new
 * execution for that participant until the Host proves the process gone.
 * It reads only `instance_runtimes`, so rebuilding `run_attempts` in a
 * migration never invalidates it.
 */
const INSTANCE_RUNTIME_TRIGGER_SQL = `CREATE TRIGGER IF NOT EXISTS instance_runtime_turn_orphaned
AFTER UPDATE OF state ON runtime_processes
WHEN NEW.state = 'orphaned'
BEGIN
  UPDATE instance_runtimes SET state = 'suspect', updated_at = NEW.updated_at
  WHERE state = 'busy' AND current_run_attempt_id = NEW.run_attempt_id;
END;
`;

/** Columns added to existing tables by schema 65. */
const RUN_ATTEMPT_COLUMNS: readonly [string, string][] = [
  ["instance_runtime_id", "TEXT"],
  ["native_turn_id", "TEXT"],
  [
    "execution_mode",
    "TEXT CHECK (execution_mode IS NULL OR execution_mode IN ('warm', 'cold'))",
  ],
  [
    "session_resume_ms",
    "INTEGER CHECK (session_resume_ms IS NULL OR session_resume_ms >= 0)",
  ],
];
const RUNTIME_PROCESS_COLUMNS: readonly [string, string][] = [
  [
    "proof_kind",
    "TEXT CHECK (proof_kind IS NULL OR proof_kind IN ('process_exit', 'turn_quiesced'))",
  ],
  [
    "quiesce_result",
    "TEXT CHECK (quiesce_result IS NULL OR quiesce_result IN ('success', 'error', 'cancelled'))",
  ],
  ["close_seq", "INTEGER CHECK (close_seq IS NULL OR close_seq >= 0)"],
  ["closed_at", "TEXT"],
  [
    "late_frame_count",
    "INTEGER NOT NULL DEFAULT 0 CHECK (late_frame_count >= 0)",
  ],
];

/** Schema 65 column migration; the base CREATE TABLEs carry the same text. */
export function migrateInstanceRuntimeColumnsV65(database: DatabaseSync) {
  for (const [table, columns] of [
    ["run_attempts", RUN_ATTEMPT_COLUMNS],
    ["runtime_processes", RUNTIME_PROCESS_COLUMNS],
  ] as const) {
    const existing = new Set(
      database
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .map((row) => String(row.name)),
    );
    for (const [name, definition] of columns)
      if (!existing.has(name))
        database.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  }
  database.exec(INSTANCE_RUNTIME_TRIGGER_SQL);
}

export type InstanceRuntimeState =
  "starting" | "idle" | "busy" | "suspect" | "terminated";
export type InstanceRuntimeTerminationReason =
  | "idle_ttl"
  | "lru"
  | "recycle_rss"
  | "recycle_age"
  | "cli_changed"
  | "config_restart"
  | "crash"
  | "stall"
  | "resource_failure"
  | "removed"
  | "host_shutdown"
  | "start_failed";
export type TurnQuiesceResult = "success" | "error" | "cancelled";

export type InstanceRuntimeRecord = {
  instanceRuntimeId: string;
  participantId: string;
  hostId: string;
  hostInstanceId: string;
  /** Whether the row belongs to the reading Host's current generation. */
  hostGenerationCurrent: boolean;
  driver: string;
  state: InstanceRuntimeState;
  turnCount: number;
  startedAt: string;
  lastActivityAt: string;
  cliFingerprint?: string;
  pid?: number;
  pgid?: number;
  processStartedAt?: string;
  nativeSessionId?: string;
  sessionResumeMs?: number;
  currentRunAttemptId?: string;
  terminatedReason?: InstanceRuntimeTerminationReason;
  exitCode?: number;
  exitSignal?: string;
  terminatedAt?: string;
};

export type TurnExecutionRecord = {
  instanceRuntimeId: string;
  mode: "warm" | "cold";
  sessionResumeMs: number | null;
  lateFrameCount: number;
};

export type InstanceRuntimeServiceOptions = {
  database: DatabaseSync;
  events: RoomEventWriter;
  now: () => Date;
  requireHost: (host: AuthenticatedHostContext) => AuthenticatedHostContext;
  requireHostParticipant: (
    host: AuthenticatedHostContext,
    participantId: string,
  ) => void;
  requireRunAttemptHostGeneration: (
    runAttempt: Row,
    host: AuthenticatedHostContext,
  ) => void;
  /** RoomKernel's single owner of `process_exit` proofs. */
  persistProcessExit: (
    runtimeProcess: Row,
    exit: { code: number | null; signal?: string },
    authority: { hostId: string } | { recoveryHostId: string },
  ) => void;
  transaction: <T>(operation: () => T) => T;
};

const REASONS: ReadonlySet<string> = new Set([
  "idle_ttl",
  "lru",
  "recycle_rss",
  "recycle_age",
  "cli_changed",
  "config_restart",
  "crash",
  "stall",
  "resource_failure",
  "removed",
  "host_shutdown",
  "start_failed",
]);

export class InstanceRuntimeService {
  readonly #options: InstanceRuntimeServiceOptions;

  constructor(options: InstanceRuntimeServiceOptions) {
    this.#options = options;
  }

  /** Before spawn: the id is the process-tree tag (`LOOM_RUNTIME_ID`). */
  register(
    host: AuthenticatedHostContext,
    input: {
      cliFingerprint?: string;
      driver: string;
      instanceRuntimeId: string;
      participantId: string;
    },
  ): InstanceRuntimeRecord {
    const authenticated = this.#options.requireHost(host);
    this.#options.requireHostParticipant(authenticated, input.participantId);
    requireId(input.instanceRuntimeId, "instanceRuntimeId");
    requireId(input.driver, "driver");
    return this.#options.transaction(() => {
      const existing = this.#row(input.instanceRuntimeId);
      if (existing !== undefined) {
        if (
          text(existing, "participant_id") === input.participantId &&
          text(existing, "host_id") === authenticated.hostId &&
          text(existing, "host_instance_id") === authenticated.instanceId &&
          text(existing, "driver") === input.driver
        )
          return this.#record(existing, authenticated);
        throw new ConflictError(
          `instance runtime ${input.instanceRuntimeId} already exists`,
        );
      }
      const live = this.#options.database
        .prepare(
          "SELECT * FROM instance_runtimes WHERE participant_id = ? AND state <> 'terminated'",
        )
        .get(input.participantId);
      if (live !== undefined)
        throw new ConflictError(
          `principal ${input.participantId} already has live instance runtime ${text(live, "instance_runtime_id")} (${text(live, "state")}${text(live, "host_instance_id") === authenticated.instanceId ? "" : ", older Host generation"}); it must be proven terminated first`,
        );
      const now = this.#timestamp();
      this.#options.database
        .prepare(
          `INSERT INTO instance_runtimes(
             instance_runtime_id, participant_id, host_id, host_instance_id,
             driver, cli_fingerprint, state, started_at, last_activity_at, updated_at
           ) VALUES(?, ?, ?, ?, ?, ?, 'starting', ?, ?, ?)`,
        )
        .run(
          input.instanceRuntimeId,
          input.participantId,
          authenticated.hostId,
          authenticated.instanceId,
          input.driver,
          input.cliFingerprint ?? null,
          now,
          now,
          now,
        );
      return this.#record(
        this.#require(input.instanceRuntimeId),
        authenticated,
      );
    });
  }

  /**
   * Right after spawn, before native ready (review P1-3): the physical
   * identity (pid, pgid, birth time) is durable while the row is still
   * `starting`, so a crash in the startup window leaves an identity a later
   * janitor can verify instead of a row that looks like "never started".
   */
  recordSpawned(
    host: AuthenticatedHostContext,
    input: {
      instanceRuntimeId: string;
      pgid: number;
      pid: number;
      processStartedAt: string;
    },
  ): InstanceRuntimeRecord {
    const authenticated = this.#options.requireHost(host);
    requireProcessIdentity(input);
    return this.#options.transaction(() => {
      const row = this.#requireCurrent(input.instanceRuntimeId, authenticated);
      const recorded = nullableInteger(row, "pid");
      if (recorded !== null) {
        if (
          recorded === input.pid &&
          nullableText(row, "process_started_at") === input.processStartedAt
        )
          return this.#record(row, authenticated);
        throw new ConflictError(
          `instance runtime ${input.instanceRuntimeId} already recorded another process`,
        );
      }
      if (text(row, "state") !== "starting")
        throw new ConflictError(
          `instance runtime ${input.instanceRuntimeId} is not starting`,
        );
      this.#options.database
        .prepare(
          `UPDATE instance_runtimes SET pid = ?, pgid = ?, process_started_at = ?,
             updated_at = ? WHERE instance_runtime_id = ?`,
        )
        .run(
          input.pid,
          input.pgid,
          input.processStartedAt,
          this.#timestamp(),
          input.instanceRuntimeId,
        );
      return this.#record(
        this.#require(input.instanceRuntimeId),
        authenticated,
      );
    });
  }

  /**
   * The Host could not prove this runtime's termination (review P1-1): it
   * stays live and `suspect`, blocking new execution for its participant,
   * until a real exit or identity-verified absence is recorded.
   */
  markSuspect(
    host: AuthenticatedHostContext,
    input: { instanceRuntimeId: string },
  ): InstanceRuntimeRecord {
    const authenticated = this.#options.requireHost(host);
    return this.#options.transaction(() => {
      const row = this.#requireCurrent(input.instanceRuntimeId, authenticated);
      if (text(row, "state") !== "suspect")
        this.#options.database
          .prepare(
            "UPDATE instance_runtimes SET state = 'suspect', updated_at = ? WHERE instance_runtime_id = ?",
          )
          .run(this.#timestamp(), input.instanceRuntimeId);
      return this.#record(
        this.#require(input.instanceRuntimeId),
        authenticated,
      );
    });
  }

  /** The process is up and the native session is loaded (resumed or new). */
  markReady(
    host: AuthenticatedHostContext,
    input: {
      instanceRuntimeId: string;
      nativeSessionId?: string;
      pgid: number;
      pid: number;
      processStartedAt: string;
      sessionResumeMs?: number;
    },
  ): InstanceRuntimeRecord {
    const authenticated = this.#options.requireHost(host);
    requireProcessIdentity(input);
    if (
      input.sessionResumeMs !== undefined &&
      (!Number.isInteger(input.sessionResumeMs) || input.sessionResumeMs < 0)
    )
      throw new Error("sessionResumeMs must be a non-negative integer");
    return this.#options.transaction(() => {
      const row = this.#requireCurrent(input.instanceRuntimeId, authenticated);
      if (text(row, "state") !== "starting") {
        if (
          text(row, "state") === "idle" &&
          nullableInteger(row, "pid") === input.pid
        )
          return this.#record(row, authenticated);
        throw new ConflictError(
          `instance runtime ${input.instanceRuntimeId} is not starting`,
        );
      }
      const spawned = nullableInteger(row, "pid");
      if (
        spawned !== null &&
        (spawned !== input.pid ||
          nullableText(row, "process_started_at") !== input.processStartedAt)
      )
        throw new ConflictError(
          `instance runtime ${input.instanceRuntimeId} is ready under another process than the one recorded at spawn`,
        );
      const now = this.#timestamp();
      this.#options.database
        .prepare(
          `UPDATE instance_runtimes SET state = 'idle', pid = ?, pgid = ?,
             process_started_at = ?, native_session_id = ?, session_resume_ms = ?,
             last_activity_at = ?, updated_at = ?
           WHERE instance_runtime_id = ?`,
        )
        .run(
          input.pid,
          input.pgid,
          input.processStartedAt,
          input.nativeSessionId ?? null,
          input.sessionResumeMs ?? null,
          now,
          now,
          input.instanceRuntimeId,
        );
      return this.#record(
        this.#require(input.instanceRuntimeId),
        authenticated,
      );
    });
  }

  /** Take the lane for one RunAttempt; before its credential or process record. */
  beginTurn(
    host: AuthenticatedHostContext,
    input: {
      executionMode: "warm" | "cold";
      instanceRuntimeId: string;
      runAttemptId: string;
    },
  ): InstanceRuntimeRecord {
    const authenticated = this.#options.requireHost(host);
    if (input.executionMode !== "warm" && input.executionMode !== "cold")
      throw new Error("executionMode must be warm or cold");
    return this.#options.transaction(() => {
      const row = this.#requireCurrent(input.instanceRuntimeId, authenticated);
      const runAttempt = this.#requireRunAttempt(
        input.runAttemptId,
        authenticated,
      );
      if (text(runAttempt, "participant_id") !== text(row, "participant_id"))
        throw new ForbiddenError(
          "RunAttempt belongs to another participant than the runtime",
        );
      const state = text(row, "state");
      if (
        state === "busy" &&
        nullableText(row, "current_run_attempt_id") === input.runAttemptId
      )
        return this.#record(row, authenticated);
      if (state !== "idle")
        throw new ConflictError(
          `instance runtime ${input.instanceRuntimeId} is ${state}, not idle`,
        );
      if (
        text(runAttempt, "state") !== "starting" ||
        nullableText(runAttempt, "instance_runtime_id") !== null
      )
        throw new ConflictError(
          `run attempt ${input.runAttemptId} cannot begin a warm turn`,
        );
      const now = this.#timestamp();
      this.#options.database
        .prepare(
          `UPDATE instance_runtimes SET state = 'busy', current_run_attempt_id = ?,
             turn_count = turn_count + 1, last_activity_at = ?, updated_at = ?
           WHERE instance_runtime_id = ?`,
        )
        .run(input.runAttemptId, now, now, input.instanceRuntimeId);
      this.#options.database
        .prepare(
          `UPDATE run_attempts SET instance_runtime_id = ?, execution_mode = ?,
             session_resume_ms = ? WHERE run_attempt_id = ?`,
        )
        .run(
          input.instanceRuntimeId,
          input.executionMode,
          input.executionMode === "cold"
            ? nullableInteger(row, "session_resume_ms")
            : null,
          input.runAttemptId,
        );
      return this.#record(
        this.#require(input.instanceRuntimeId),
        authenticated,
      );
    });
  }

  /** The native runtime accepted this turn's input under `nativeTurnId`. */
  recordTurnAccepted(
    host: AuthenticatedHostContext,
    input: {
      instanceRuntimeId: string;
      nativeTurnId: string;
      runAttemptId: string;
    },
  ): void {
    const authenticated = this.#options.requireHost(host);
    requireId(input.nativeTurnId, "nativeTurnId");
    this.#options.transaction(() => {
      const row = this.#requireCurrent(input.instanceRuntimeId, authenticated);
      const runAttempt = this.#requireTurn(row, input.runAttemptId);
      const recorded = nullableText(runAttempt, "native_turn_id");
      if (recorded === input.nativeTurnId) return;
      if (recorded !== null)
        throw new ConflictError(
          `run attempt ${input.runAttemptId} already accepted native turn ${recorded}`,
        );
      this.#options.database
        .prepare(
          "UPDATE run_attempts SET native_turn_id = ? WHERE run_attempt_id = ?",
        )
        .run(input.nativeTurnId, input.runAttemptId);
    });
  }

  /**
   * The `turn_quiesced` proof (S2 spec §2 step 6). The Host asserts, and the
   * Kernel refuses otherwise: the runtime is busy on exactly this run in the
   * current Host generation, the closing native turn is the accepted one, no
   * tool or approval is in flight and the verified process group is alive.
   */
  recordTurnQuiesced(
    host: AuthenticatedHostContext,
    input: {
      closeSeq: number;
      inFlightToolCount: number;
      instanceRuntimeId: string;
      /** `null`: the native runtime rejected the turn; nothing was admitted. */
      nativeTurnId: string | null;
      processGroupAlive: boolean;
      result: TurnQuiesceResult;
      runAttemptId: string;
      runtimeRunId: string;
    },
  ): TurnProofRecord {
    const authenticated = this.#options.requireHost(host);
    if (!["success", "error", "cancelled"].includes(input.result))
      throw new Error("result must be success, error or cancelled");
    if (!Number.isInteger(input.closeSeq) || input.closeSeq < 0)
      throw new Error("closeSeq must be a non-negative integer");
    return this.#options.transaction(() => {
      const process = this.#options.database
        .prepare("SELECT * FROM runtime_processes WHERE run_attempt_id = ?")
        .get(input.runAttemptId);
      if (process === undefined)
        throw new NotFoundError(
          `runtime process for run attempt ${input.runAttemptId} was not found`,
        );
      // Scope and full identity first (review P2-2): an idempotent replay is
      // returned only to the same Host generation for the same runtime, run
      // and native turn — never to an unrelated Host that knows the run id.
      const owner = this.#require(input.instanceRuntimeId);
      this.#options.requireHostParticipant(
        authenticated,
        text(owner, "participant_id"),
      );
      if (
        text(owner, "host_id") !== authenticated.hostId ||
        text(owner, "host_instance_id") !== authenticated.instanceId
      )
        throw new ExecutionFencedError(
          `instance runtime ${input.instanceRuntimeId} belongs to another Host generation`,
        );
      const turnRun = this.#options.database
        .prepare("SELECT * FROM run_attempts WHERE run_attempt_id = ?")
        .get(input.runAttemptId);
      if (
        turnRun === undefined ||
        nullableText(turnRun, "instance_runtime_id") !== input.instanceRuntimeId
      )
        throw new ExecutionFencedError(
          `run attempt ${input.runAttemptId} does not belong to this runtime`,
        );
      if (
        text(process, "launch_host_id") !== authenticated.hostId ||
        text(process, "runtime_run_id") !== input.runtimeRunId
      )
        throw new ExecutionFencedError(
          "turn quiescence does not match the launched execution",
        );
      if (nullableText(turnRun, "native_turn_id") !== input.nativeTurnId)
        throw new ConflictError(
          "turn quiescence names a different native turn than the accepted one",
        );
      if (
        text(process, "state") === "terminated" &&
        nullableText(process, "proof_kind") === "turn_quiesced" &&
        nullableText(process, "quiesce_result") === input.result &&
        nullableInteger(process, "close_seq") === input.closeSeq
      )
        return turnProofFromRow(process);
      const row = this.#requireCurrent(input.instanceRuntimeId, authenticated);
      this.#requireTurn(row, input.runAttemptId);
      if (!["prepared", "active"].includes(text(process, "state")))
        throw new ExecutionFencedError(
          "turn quiescence does not match the launched execution",
        );
      if (input.nativeTurnId === null && input.result === "success")
        throw new ConflictError(
          "a turn the native runtime never admitted cannot quiesce as success",
        );
      if (
        !Number.isInteger(input.inFlightToolCount) ||
        input.inFlightToolCount !== 0
      )
        throw new ConflictError(
          "turn cannot quiesce while a tool or approval is in flight",
        );
      if (input.processGroupAlive !== true)
        throw new ConflictError(
          "turn cannot quiesce without a verified live process group; record a process exit instead",
        );
      const now = this.#timestamp();
      this.#options.database
        .prepare(
          `UPDATE runtime_processes SET state = 'terminated', proof_kind = 'turn_quiesced',
             quiesce_result = ?, close_seq = ?, closed_at = ?, exit_code = NULL,
             exit_signal = NULL, terminated_at = ?, updated_at = ?
           WHERE runtime_process_id = ?`,
        )
        .run(
          input.result,
          input.closeSeq,
          now,
          now,
          now,
          text(process, "runtime_process_id"),
        );
      this.#options.events.append({
        actorId: "principal_system",
        aggregateId: input.runAttemptId,
        aggregateType: "run_attempt",
        idempotencyKey: `run.turn_quiesced:${input.runAttemptId}`,
        payload: {
          closeSeq: input.closeSeq,
          hostId: authenticated.hostId,
          instanceRuntimeId: input.instanceRuntimeId,
          nativeTurnId: input.nativeTurnId,
          result: input.result,
          runAttemptId: input.runAttemptId,
          runtimeRunId: input.runtimeRunId,
        },
        roomId: text(process, "room_id"),
        type: "run.turn_quiesced",
      });
      return turnProofFromRow(
        this.#options.database
          .prepare("SELECT * FROM runtime_processes WHERE run_attempt_id = ?")
          .get(input.runAttemptId)!,
      );
    });
  }

  /** A frame of an already-closed turn arrived: its usage is incomplete. */
  recordLateTurnFrame(
    host: AuthenticatedHostContext,
    input: { runAttemptId: string },
  ): void {
    const authenticated = this.#options.requireHost(host);
    this.#options.transaction(() => {
      const runAttempt = this.#requireRunAttempt(
        input.runAttemptId,
        authenticated,
        false,
      );
      if (nullableText(runAttempt, "instance_runtime_id") === null)
        throw new ConflictError("late frames apply only to warm turns");
      this.#options.database
        .prepare(
          `UPDATE runtime_processes SET late_frame_count = late_frame_count + 1
           WHERE run_attempt_id = ?`,
        )
        .run(input.runAttemptId);
    });
  }

  /** Release the lane after the Activation left `leased` (spec §2 step 8). */
  releaseTurn(
    host: AuthenticatedHostContext,
    input: { instanceRuntimeId: string; runAttemptId: string },
  ): InstanceRuntimeRecord {
    const authenticated = this.#options.requireHost(host);
    return this.#options.transaction(() => {
      const row = this.#requireCurrent(input.instanceRuntimeId, authenticated);
      if (
        text(row, "state") === "idle" &&
        nullableText(row, "current_run_attempt_id") === null
      )
        return this.#record(row, authenticated);
      const runAttempt = this.#requireTurn(row, input.runAttemptId);
      if (["starting", "running"].includes(text(runAttempt, "state")))
        throw new ConflictError(
          `run attempt ${input.runAttemptId} is not finished; the lane stays held`,
        );
      const process = this.#options.database
        .prepare("SELECT state FROM runtime_processes WHERE run_attempt_id = ?")
        .get(input.runAttemptId);
      if (process !== undefined && text(process, "state") !== "terminated")
        throw new ConflictError(
          `run attempt ${input.runAttemptId} has no terminal turn proof`,
        );
      const activation = this.#options.database
        .prepare(
          "SELECT state, attempt_count FROM activations WHERE activation_id = ?",
        )
        .get(text(runAttempt, "activation_id"));
      if (
        activation !== undefined &&
        text(activation, "state") === "leased" &&
        integer(activation, "attempt_count") ===
          integer(runAttempt, "attempt_number")
      )
        throw new ConflictError(
          `activation ${text(runAttempt, "activation_id")} is still leased; the lane stays held`,
        );
      const now = this.#timestamp();
      this.#options.database
        .prepare(
          `UPDATE instance_runtimes SET state = 'idle', current_run_attempt_id = NULL,
             last_activity_at = ?, updated_at = ?
           WHERE instance_runtime_id = ?`,
        )
        .run(now, now, input.instanceRuntimeId);
      return this.#record(
        this.#require(input.instanceRuntimeId),
        authenticated,
      );
    });
  }

  /**
   * The warm process is proven gone (normal eviction, crash, or a janitor of
   * a later Host generation that killed the verified group). A turn record
   * still open on it gets a real `process_exit` proof in the same transaction;
   * an already-quiesced turn is never rewritten.
   */
  recordExit(
    host: AuthenticatedHostContext,
    input: {
      exit: { code: number | null; signal?: string };
      instanceRuntimeId: string;
      reason: InstanceRuntimeTerminationReason;
      rssKb?: number;
    },
  ): InstanceRuntimeRecord {
    const authenticated = this.#options.requireHost(host);
    if (!REASONS.has(input.reason))
      throw new Error("unknown instance runtime termination reason");
    if (!(input.exit.code === null || Number.isInteger(input.exit.code)))
      throw new Error("exit code must be an integer or null");
    return this.#options.transaction(() => {
      const row = this.#require(input.instanceRuntimeId);
      this.#options.requireHostParticipant(
        authenticated,
        text(row, "participant_id"),
      );
      if (text(row, "host_id") !== authenticated.hostId)
        throw new ForbiddenError(
          `host ${authenticated.hostId} does not own instance runtime ${input.instanceRuntimeId}`,
        );
      if (text(row, "state") === "terminated")
        return this.#record(row, authenticated);
      const current = nullableText(row, "current_run_attempt_id");
      if (current !== null) {
        const process = this.#options.database
          .prepare("SELECT * FROM runtime_processes WHERE run_attempt_id = ?")
          .get(current);
        if (process !== undefined && text(process, "state") !== "terminated") {
          const sameGeneration =
            text(row, "host_instance_id") === authenticated.instanceId;
          this.#options.persistProcessExit(
            process,
            {
              code: input.exit.code,
              ...(input.exit.signal === undefined
                ? {}
                : { signal: input.exit.signal }),
            },
            sameGeneration
              ? { hostId: authenticated.hostId }
              : { recoveryHostId: authenticated.hostId },
          );
        }
      }
      const now = this.#timestamp();
      this.#options.database
        .prepare(
          `UPDATE instance_runtimes SET state = 'terminated', terminated_reason = ?,
             exit_code = ?, exit_signal = ?, rss_kb = COALESCE(?, rss_kb),
             terminated_at = ?, updated_at = ?
           WHERE instance_runtime_id = ?`,
        )
        .run(
          input.reason,
          input.exit.code,
          input.exit.signal ?? null,
          input.rssKb ?? null,
          now,
          now,
          input.instanceRuntimeId,
        );
      return this.#record(
        this.#require(input.instanceRuntimeId),
        authenticated,
      );
    });
  }

  get(host: AuthenticatedHostContext, instanceRuntimeId: string) {
    const authenticated = this.#options.requireHost(host);
    const row = this.#require(instanceRuntimeId);
    this.#options.requireHostParticipant(
      authenticated,
      text(row, "participant_id"),
    );
    return this.#record(row, authenticated);
  }

  /** Janitor input: every live row this Host id owns, any generation. */
  list(host: AuthenticatedHostContext): InstanceRuntimeRecord[] {
    const authenticated = this.#options.requireHost(host);
    return this.#options.database
      .prepare(
        `SELECT * FROM instance_runtimes WHERE host_id = ? AND state <> 'terminated'
         ORDER BY started_at, instance_runtime_id`,
      )
      .all(authenticated.hostId)
      .map((row) => this.#record(row, authenticated));
  }

  /** Terminated runtime ids among `ids` owned by this Host (leftover sweep). */
  terminatedAmong(
    host: AuthenticatedHostContext,
    ids: readonly string[],
  ): { instanceRuntimeId: string; participantId: string }[] {
    const authenticated = this.#options.requireHost(host);
    const unique = [...new Set(ids)].slice(0, 500);
    if (unique.length === 0) return [];
    return this.#options.database
      .prepare(
        `SELECT instance_runtime_id, participant_id FROM instance_runtimes
         WHERE host_id = ? AND state = 'terminated'
           AND instance_runtime_id IN (${unique.map(() => "?").join(",")})`,
      )
      .all(authenticated.hostId, ...unique)
      .map((row) => ({
        instanceRuntimeId: text(row, "instance_runtime_id"),
        participantId: text(row, "participant_id"),
      }));
  }

  executionForRunAttempt(runAttemptId: string): TurnExecutionRecord | null {
    return turnExecutionForRunAttempt(this.#options.database, runAttemptId);
  }

  #requireCurrent(
    instanceRuntimeId: string,
    host: AuthenticatedHostContext,
  ): Row {
    const row = this.#require(instanceRuntimeId);
    this.#options.requireHostParticipant(host, text(row, "participant_id"));
    if (
      text(row, "host_id") !== host.hostId ||
      text(row, "host_instance_id") !== host.instanceId
    )
      throw new ExecutionFencedError(
        `instance runtime ${instanceRuntimeId} belongs to another Host generation`,
      );
    if (text(row, "state") === "terminated")
      throw new ConflictError(
        `instance runtime ${instanceRuntimeId} is terminated`,
      );
    return row;
  }

  #requireTurn(row: Row, runAttemptId: string): Row {
    if (
      text(row, "state") !== "busy" ||
      nullableText(row, "current_run_attempt_id") !== runAttemptId
    )
      throw new ExecutionFencedError(
        `instance runtime ${text(row, "instance_runtime_id")} is not running run attempt ${runAttemptId}`,
      );
    const runAttempt = this.#options.database
      .prepare("SELECT * FROM run_attempts WHERE run_attempt_id = ?")
      .get(runAttemptId);
    if (
      runAttempt === undefined ||
      nullableText(runAttempt, "instance_runtime_id") !==
        text(row, "instance_runtime_id")
    )
      throw new ExecutionFencedError(
        `run attempt ${runAttemptId} does not belong to this runtime`,
      );
    return runAttempt;
  }

  #requireRunAttempt(
    runAttemptId: string,
    host: AuthenticatedHostContext,
    requireGeneration = true,
  ): Row {
    const runAttempt = this.#options.database
      .prepare("SELECT * FROM run_attempts WHERE run_attempt_id = ?")
      .get(runAttemptId);
    if (runAttempt === undefined)
      throw new NotFoundError(`run attempt ${runAttemptId} was not found`);
    this.#options.requireHostParticipant(
      host,
      text(runAttempt, "participant_id"),
    );
    if (text(runAttempt, "host_id") !== host.hostId)
      throw new ForbiddenError(
        `host ${host.hostId} does not own run attempt ${runAttemptId}`,
      );
    if (requireGeneration)
      this.#options.requireRunAttemptHostGeneration(runAttempt, host);
    return runAttempt;
  }

  #row(instanceRuntimeId: string): Row | undefined {
    return this.#options.database
      .prepare("SELECT * FROM instance_runtimes WHERE instance_runtime_id = ?")
      .get(instanceRuntimeId);
  }

  #require(instanceRuntimeId: string): Row {
    const row = this.#row(instanceRuntimeId);
    if (row === undefined)
      throw new NotFoundError(
        `instance runtime ${instanceRuntimeId} was not found`,
      );
    return row;
  }

  #timestamp(): string {
    return this.#options.now().toISOString();
  }

  #record(row: Row, host: AuthenticatedHostContext): InstanceRuntimeRecord {
    return instanceRuntimeFromRow(row, host.instanceId);
  }
}

export type TurnProofRecord = {
  runAttemptId: string;
  runtimeRunId: string;
  state: string;
  proofKind: "process_exit" | "turn_quiesced";
  quiesceResult?: TurnQuiesceResult;
  closeSeq?: number;
  exitCode?: number;
  exitSignal?: string;
};

function turnProofFromRow(row: Row): TurnProofRecord {
  const result = nullableText(row, "quiesce_result");
  const closeSeq = nullableInteger(row, "close_seq");
  const exitCode = nullableInteger(row, "exit_code");
  const exitSignal = nullableText(row, "exit_signal");
  return {
    runAttemptId: text(row, "run_attempt_id"),
    runtimeRunId: text(row, "runtime_run_id"),
    state: text(row, "state"),
    proofKind:
      nullableText(row, "proof_kind") === "turn_quiesced"
        ? "turn_quiesced"
        : "process_exit",
    ...(result === null ? {} : { quiesceResult: result as TurnQuiesceResult }),
    ...(closeSeq === null ? {} : { closeSeq }),
    ...(exitCode === null ? {} : { exitCode }),
    ...(exitSignal === null ? {} : { exitSignal }),
  };
}

export function instanceRuntimeFromRow(
  row: Row,
  currentHostInstanceId: string,
): InstanceRuntimeRecord {
  const optionalText = (column: string) =>
    nullableText(row, column) ?? undefined;
  const optionalInteger = (column: string) =>
    nullableInteger(row, column) ?? undefined;
  const record: InstanceRuntimeRecord = {
    driver: text(row, "driver"),
    hostGenerationCurrent:
      text(row, "host_instance_id") === currentHostInstanceId,
    hostId: text(row, "host_id"),
    hostInstanceId: text(row, "host_instance_id"),
    instanceRuntimeId: text(row, "instance_runtime_id"),
    lastActivityAt: text(row, "last_activity_at"),
    participantId: text(row, "participant_id"),
    startedAt: text(row, "started_at"),
    state: text(row, "state") as InstanceRuntimeState,
    turnCount: integer(row, "turn_count"),
  };
  const optional: Record<string, unknown> = {
    cliFingerprint: optionalText("cli_fingerprint"),
    currentRunAttemptId: optionalText("current_run_attempt_id"),
    exitCode: optionalInteger("exit_code"),
    exitSignal: optionalText("exit_signal"),
    nativeSessionId: optionalText("native_session_id"),
    pgid: optionalInteger("pgid"),
    pid: optionalInteger("pid"),
    processStartedAt: optionalText("process_started_at"),
    sessionResumeMs: optionalInteger("session_resume_ms"),
    terminatedAt: optionalText("terminated_at"),
    terminatedReason: optionalText("terminated_reason") as
      InstanceRuntimeTerminationReason | undefined,
  };
  for (const [key, value] of Object.entries(optional))
    if (value !== undefined) Object.assign(record, { [key]: value });
  return record;
}

/**
 * Worker grant/execution scope of a warm turn: the runtime must hold the lane
 * for exactly this RunAttempt. Legacy per-turn runs (no runtime) pass.
 */
export function instanceRuntimeGrantIsCurrent(
  database: DatabaseSync,
  runAttempt: Row,
): boolean {
  const instanceRuntimeId = nullableText(runAttempt, "instance_runtime_id");
  if (instanceRuntimeId === null) return true;
  const row = database
    .prepare(
      "SELECT state, current_run_attempt_id FROM instance_runtimes WHERE instance_runtime_id = ?",
    )
    .get(instanceRuntimeId);
  return (
    row !== undefined &&
    text(row, "state") === "busy" &&
    nullableText(row, "current_run_attempt_id") ===
      text(runAttempt, "run_attempt_id")
  );
}

/**
 * Credential issuance: the runtime must be of the issuing Host generation and
 * the turn must not be closed already.
 */
export function assertInstanceRuntimeHostGeneration(
  database: DatabaseSync,
  runAttempt: Row,
  host: AuthenticatedHostContext,
): void {
  const instanceRuntimeId = nullableText(runAttempt, "instance_runtime_id");
  if (instanceRuntimeId === null) return;
  const row = database
    .prepare(
      "SELECT host_id, host_instance_id FROM instance_runtimes WHERE instance_runtime_id = ?",
    )
    .get(instanceRuntimeId);
  if (
    row === undefined ||
    text(row, "host_id") !== host.hostId ||
    text(row, "host_instance_id") !== host.instanceId
  )
    throw new ExecutionFencedError(
      "warm turn credential requires the runtime's current Host generation",
    );
  const turn = database
    .prepare("SELECT state FROM runtime_processes WHERE run_attempt_id = ?")
    .get(text(runAttempt, "run_attempt_id"));
  if (turn !== undefined && text(turn, "state") === "terminated")
    throw new ExecutionFencedError(
      "a closed warm turn cannot be granted new Worker authority",
    );
}

/**
 * Reader branch for terminal proofs that must not treat quiescence as an
 * exit: a quiesced turn maps its result, a real exit keeps exit-code rules.
 */
export function runStateFromTerminalProof(
  runtimeProcess: Row,
): "exited" | "failed" | "cancelled" {
  if (nullableText(runtimeProcess, "proof_kind") === "turn_quiesced") {
    const result = nullableText(runtimeProcess, "quiesce_result");
    return result === "success"
      ? "exited"
      : result === "cancelled"
        ? "cancelled"
        : "failed";
  }
  return nullableInteger(runtimeProcess, "exit_code") === 0
    ? "exited"
    : "failed";
}

/** The per-turn execution evidence read by the usage API (null: per-turn run). */
export function turnExecutionForRunAttempt(
  database: DatabaseSync,
  runAttemptId: string,
): TurnExecutionRecord | null {
  const row = database
    .prepare(
      `SELECT run.instance_runtime_id, run.execution_mode, run.session_resume_ms,
                COALESCE(process.late_frame_count, 0) AS late_frame_count
         FROM run_attempts AS run
         LEFT JOIN runtime_processes AS process ON process.run_attempt_id = run.run_attempt_id
         WHERE run.run_attempt_id = ?`,
    )
    .get(runAttemptId);
  if (row === undefined || nullableText(row, "instance_runtime_id") === null)
    return null;
  const mode = text(row, "execution_mode");
  return {
    instanceRuntimeId: text(row, "instance_runtime_id"),
    lateFrameCount: integer(row, "late_frame_count"),
    mode: mode === "cold" ? "cold" : "warm",
    sessionResumeMs: nullableInteger(row, "session_resume_ms"),
  };
}

function requireProcessIdentity(input: {
  pgid: number;
  pid: number;
  processStartedAt: string;
}): void {
  for (const [name, value] of [
    ["pid", input.pid],
    ["pgid", input.pgid],
  ] as const)
    if (!Number.isInteger(value) || value <= 1)
      throw new Error(`${name} must be an integer greater than 1`);
  if (
    typeof input.processStartedAt !== "string" ||
    input.processStartedAt.trim() === "" ||
    input.processStartedAt.length > 200
  )
    throw new Error("processStartedAt must be a non-empty process birth time");
}

function requireId(value: string, name: string): void {
  if (typeof value !== "string" || value.trim() === "" || value.length > 200)
    throw new Error(
      `${name} must be a non-empty identifier of at most 200 characters`,
    );
}
