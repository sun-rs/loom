import type { DatabaseSync } from "node:sqlite";

import {
  InstanceSessionBindingRecordInputSchema,
  type InstanceSessionBindingRecordInput,
} from "@rah-os/protocol";

import type { AuthenticatedHostContext } from "./auth.ts";
import { ConflictError, ForbiddenError, NotFoundError } from "./errors.ts";
import type { RuntimeTrajectoryServiceOptions } from "./runtime-trajectory.ts";
import { integer, text } from "./sqlite-row.ts";

/**
 * Durable Kernel evidence that a Role instance's native session binding was
 * actually persisted by its Host, per session generation. Launch history alone
 * (a spawned process, a runtime id) does not prove a binding: a first launch
 * can fail before the provider ever reports a session. Only this evidence makes
 * a later launch require the existing session, so a lost Host binding file
 * fails closed while a pre-bind failure starts fresh. A Human reset advances
 * the generation and clears the evidence; it never deletes history.
 */
export const INSTANCE_SESSION_SCHEMA = `
CREATE TABLE IF NOT EXISTS role_instance_sessions (
  instance_id TEXT PRIMARY KEY REFERENCES role_instances(instance_id),
  generation INTEGER NOT NULL CHECK (generation >= 0),
  bound INTEGER NOT NULL CHECK (bound IN (0, 1)),
  bound_run_attempt_id TEXT,
  bound_at TEXT,
  updated_at TEXT NOT NULL
) STRICT;
`;

export function instanceSessionState(
  database: DatabaseSync,
  instanceId: string,
): { generation: number; required: boolean } {
  const row = database
    .prepare(
      "SELECT generation, bound FROM role_instance_sessions WHERE instance_id=?",
    )
    .get(instanceId);
  return row === undefined
    ? { generation: 0, required: false }
    : {
        generation: integer(row, "generation"),
        required: integer(row, "bound") === 1,
      };
}

/** Inside the caller's transaction. Returns the new generation. */
export function advanceInstanceSessionGeneration(
  database: DatabaseSync,
  instanceId: string,
  now: string,
): number {
  const next = instanceSessionState(database, instanceId).generation + 1;
  database
    .prepare(
      `INSERT INTO role_instance_sessions(instance_id, generation, bound, updated_at)
       VALUES(?, ?, 0, ?)
       ON CONFLICT(instance_id) DO UPDATE SET generation=excluded.generation,
         bound=0, bound_run_attempt_id=NULL, bound_at=NULL, updated_at=excluded.updated_at`,
    )
    .run(instanceId, next, now);
  return next;
}

/**
 * Schema 62 upgrade: an instance launched under the old rule keeps its fail
 * closed requirement, because a pre-upgrade Host never reported binding
 * evidence. A Human session reset is the explicit exit for a pre-bind failure.
 */
export function backfillInstanceSessionEvidence(
  database: DatabaseSync,
  now: string,
): void {
  database
    .prepare(
      `INSERT OR IGNORE INTO role_instance_sessions(instance_id, generation, bound, updated_at)
       SELECT ri.instance_id, 0, 1, ? FROM role_instances ri
       WHERE EXISTS (SELECT 1 FROM run_attempts r WHERE r.participant_id=ri.instance_id
         AND (r.runtime_run_id IS NOT NULL OR EXISTS
           (SELECT 1 FROM runtime_processes p WHERE p.run_attempt_id=r.run_attempt_id)))`,
    )
    .run(now);
}

export class InstanceSessionService {
  readonly #database: DatabaseSync;
  readonly #options: RuntimeTrajectoryServiceOptions;

  constructor(options: RuntimeTrajectoryServiceOptions) {
    this.#database = options.database;
    this.#options = options;
  }

  /** Schema 62 upgrade unit; later starts never re-run it. */
  backfill(fromSchemaVersion: number): void {
    if (fromSchemaVersion < 62)
      backfillInstanceSessionEvidence(
        this.#database,
        this.#options.now().toISOString(),
      );
  }

  /** Idempotent per generation: every resumed run may report it again. */
  record(
    host: AuthenticatedHostContext,
    untrustedInput: InstanceSessionBindingRecordInput,
  ): { generation: number } {
    const authenticatedHost = this.#options.requireHost(host);
    const input = InstanceSessionBindingRecordInputSchema.parse(untrustedInput);
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const runAttempt = this.#database
        .prepare("SELECT * FROM run_attempts WHERE run_attempt_id = ?")
        .get(input.runAttemptId);
      if (runAttempt === undefined)
        throw new NotFoundError(
          `run attempt ${input.runAttemptId} was not found`,
        );
      const participantId = text(runAttempt, "participant_id");
      this.#options.requireHostParticipant(authenticatedHost, participantId);
      if (text(runAttempt, "host_id") !== authenticatedHost.hostId)
        throw new ForbiddenError(
          `host ${authenticatedHost.hostId} does not own run attempt ${input.runAttemptId}`,
        );
      this.#options.requireRunAttemptHostGeneration(
        runAttempt,
        authenticatedHost,
      );
      if (
        !this.#database
          .prepare("SELECT 1 FROM role_instances WHERE instance_id=?")
          .get(participantId)
      )
        throw new ConflictError(
          `participant ${participantId} is not a Role instance`,
        );
      const runtimeProcess = this.#database
        .prepare("SELECT * FROM runtime_processes WHERE run_attempt_id = ?")
        .get(input.runAttemptId);
      if (
        !["starting", "running"].includes(text(runAttempt, "state")) ||
        runtimeProcess === undefined ||
        text(runtimeProcess, "runtime_run_id") !== input.runtimeRunId ||
        !["active", "prepared"].includes(text(runtimeProcess, "state"))
      )
        throw new ConflictError(
          `run attempt ${input.runAttemptId} cannot record a session binding`,
        );
      const now = this.#options.now().toISOString();
      const { generation } = instanceSessionState(
        this.#database,
        participantId,
      );
      this.#database
        .prepare(
          `INSERT INTO role_instance_sessions(instance_id, generation, bound,
             bound_run_attempt_id, bound_at, updated_at)
           VALUES(?, ?, 1, ?, ?, ?)
           ON CONFLICT(instance_id) DO UPDATE SET bound=1,
             bound_run_attempt_id=COALESCE(role_instance_sessions.bound_run_attempt_id, excluded.bound_run_attempt_id),
             bound_at=COALESCE(role_instance_sessions.bound_at, excluded.bound_at),
             updated_at=excluded.updated_at`,
        )
        .run(participantId, generation, input.runAttemptId, now, now);
      this.#database.exec("COMMIT");
      return { generation };
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }
}
