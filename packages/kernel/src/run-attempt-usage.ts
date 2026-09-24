import type { DatabaseSync } from "node:sqlite";

import {
  ClientRunAttemptUsageGetRequestSchema,
  ClientRunAttemptUsageGetResponseSchema,
  RUN_ATTEMPT_USAGE_GENERATION_LIMIT,
  RunAttemptUsageRecordInputSchema,
  RunAttemptUsageRecordSchema,
  type ClientRunAttemptUsageGetRequest,
  type ClientRunAttemptUsageGetResponse,
  type RunAttemptUsageRecord,
  type RunAttemptUsageRecordInput,
} from "@rah-os/protocol";

import type {
  AuthenticatedActorContext,
  AuthenticatedHostContext,
} from "./auth.ts";
import { ConflictError, ForbiddenError, NotFoundError } from "./errors.ts";
import type { RuntimeTrajectoryServiceOptions } from "./runtime-trajectory.ts";
import { text, type Row } from "./sqlite-row.ts";

/**
 * Native per-generation Provider token usage for one RunAttempt. Diagnostics
 * adjacent to the ledger: no Room event, Inbox, Task or trajectory effect.
 * The owning Host writes it under its own credential; a response id is
 * recorded once and replays must repeat the same immutable fact.
 */
export const RUN_ATTEMPT_USAGE_SCHEMA = `
CREATE TABLE IF NOT EXISTS run_attempt_usage (
  run_attempt_id TEXT NOT NULL REFERENCES run_attempts(run_attempt_id),
  response_id TEXT NOT NULL CHECK (length(response_id) BETWEEN 1 AND 512),
  provider TEXT NOT NULL,
  input_tokens INTEGER NOT NULL CHECK (input_tokens >= 0),
  cached_input_tokens INTEGER NOT NULL CHECK (cached_input_tokens BETWEEN 0 AND input_tokens),
  output_tokens INTEGER NOT NULL CHECK (output_tokens >= 0),
  reasoning_output_tokens INTEGER CHECK (reasoning_output_tokens IS NULL OR reasoning_output_tokens BETWEEN 0 AND output_tokens),
  context_window INTEGER CHECK (context_window IS NULL OR context_window > 0),
  context_used_tokens INTEGER CHECK (context_used_tokens IS NULL OR context_used_tokens >= 0),
  observed_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  PRIMARY KEY (run_attempt_id, response_id)
) STRICT;
`;

const FACT_COLUMNS = [
  ["provider", "provider"],
  ["inputTokens", "input_tokens"],
  ["cachedInputTokens", "cached_input_tokens"],
  ["outputTokens", "output_tokens"],
  ["reasoningOutputTokens", "reasoning_output_tokens"],
  ["contextWindow", "context_window"],
  ["contextUsedTokens", "context_used_tokens"],
  ["observedAt", "observed_at"],
] as const;

export class RunAttemptUsageService {
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
    untrustedInput: RunAttemptUsageRecordInput,
  ): RunAttemptUsageRecord {
    const authenticatedHost = this.#options.requireHost(host);
    const input = RunAttemptUsageRecordInputSchema.parse(untrustedInput);
    return this.#transaction(() => {
      const runAttempt = this.#database
        .prepare("SELECT * FROM run_attempts WHERE run_attempt_id = ?")
        .get(input.runAttemptId);
      if (runAttempt === undefined) {
        throw new NotFoundError(
          `run attempt ${input.runAttemptId} was not found`,
        );
      }
      this.#options.requireHostParticipant(
        authenticatedHost,
        text(runAttempt, "participant_id"),
      );
      if (text(runAttempt, "host_id") !== authenticatedHost.hostId) {
        throw new ForbiddenError(
          `host ${authenticatedHost.hostId} does not own run attempt ${input.runAttemptId}`,
        );
      }
      this.#options.requireRunAttemptHostGeneration(
        runAttempt,
        authenticatedHost,
      );
      const existing = this.#database
        .prepare(
          "SELECT * FROM run_attempt_usage WHERE run_attempt_id = ? AND response_id = ?",
        )
        .get(input.runAttemptId, input.responseId);
      if (existing !== undefined) {
        const same = FACT_COLUMNS.every(
          ([field, column]) => (existing[column] ?? null) === input[field],
        );
        if (!same) {
          throw new ConflictError(
            "Provider usage response id conflicts with an existing fact",
          );
        }
        return usageFromRow(existing);
      }
      this.#requireLiveRuntime(runAttempt, input);
      this.#database
        .prepare(
          `INSERT INTO run_attempt_usage(
             run_attempt_id, response_id, provider, input_tokens,
             cached_input_tokens, output_tokens, reasoning_output_tokens,
             context_window, context_used_tokens, observed_at, recorded_at
           ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.runAttemptId,
          input.responseId,
          ...FACT_COLUMNS.map(([field]) => input[field]),
          this.#now().toISOString(),
        );
      return usageFromRow(
        this.#database
          .prepare(
            "SELECT * FROM run_attempt_usage WHERE run_attempt_id = ? AND response_id = ?",
          )
          .get(input.runAttemptId, input.responseId)!,
      );
    });
  }

  /** Same visibility as Agent trajectory: control-Room Human and work-Room member. */
  get(
    actor: AuthenticatedActorContext,
    untrustedInput: ClientRunAttemptUsageGetRequest,
  ): ClientRunAttemptUsageGetResponse {
    const actorId = this.#options.requireActor(actor);
    const input = ClientRunAttemptUsageGetRequestSchema.parse(untrustedInput);
    const visible = this.#database
      .prepare(
        `SELECT run_attempts.run_attempt_id
         FROM agent_definitions
         JOIN rooms AS control_room
           ON control_room.room_id = agent_definitions.control_room_id
         JOIN memberships AS control_membership
           ON control_membership.room_id = agent_definitions.control_room_id
          AND control_membership.principal_id = ?
         JOIN principals AS actor
           ON actor.principal_id = control_membership.principal_id
          AND actor.kind = 'human'
         JOIN run_attempts
           ON run_attempts.participant_id = agent_definitions.participant_id
          AND run_attempts.run_attempt_id = ?
         JOIN rooms AS work_room
           ON work_room.room_id = run_attempts.room_id
          AND work_room.workspace_id = control_room.workspace_id
         JOIN memberships AS work_membership
           ON work_membership.room_id = run_attempts.room_id
          AND work_membership.principal_id = control_membership.principal_id
         WHERE agent_definitions.agent_definition_id = ?`,
      )
      .get(actorId, input.runAttemptId, input.agentId);
    if (visible === undefined) {
      throw new NotFoundError(
        `run attempt ${input.runAttemptId} was not found`,
      );
    }
    const totals = this.#database
      .prepare(
        `SELECT COUNT(*) AS generations,
                COALESCE(SUM(input_tokens), 0) AS input_tokens,
                COALESCE(SUM(cached_input_tokens), 0) AS cached_input_tokens,
                COALESCE(SUM(output_tokens), 0) AS output_tokens,
                SUM(reasoning_output_tokens) AS reasoning_output_tokens,
                COUNT(reasoning_output_tokens) AS reasoning_known
         FROM run_attempt_usage WHERE run_attempt_id = ?`,
      )
      .get(input.runAttemptId)!;
    const rows = this.#database
      .prepare(
        `SELECT * FROM run_attempt_usage WHERE run_attempt_id = ?
         ORDER BY observed_at, recorded_at, response_id LIMIT ?`,
      )
      .all(input.runAttemptId, RUN_ATTEMPT_USAGE_GENERATION_LIMIT);
    const generations = Number(totals.generations);
    return ClientRunAttemptUsageGetResponseSchema.parse({
      runAttemptId: input.runAttemptId,
      generations: rows.map((row) => {
        const { runAttemptId: _runAttemptId, ...generation } =
          usageFromRow(row);
        return generation;
      }),
      totals: {
        generations,
        inputTokens: Number(totals.input_tokens),
        cachedInputTokens: Number(totals.cached_input_tokens),
        outputTokens: Number(totals.output_tokens),
        reasoningOutputTokens:
          generations > 0 && Number(totals.reasoning_known) === generations
            ? Number(totals.reasoning_output_tokens)
            : null,
      },
      truncated: generations > rows.length,
    });
  }

  #requireLiveRuntime(runAttempt: Row, input: RunAttemptUsageRecordInput) {
    const runState = text(runAttempt, "state");
    const runtimeProcess = this.#database
      .prepare("SELECT * FROM runtime_processes WHERE run_attempt_id = ?")
      .get(input.runAttemptId);
    if (
      (runState !== "starting" && runState !== "running") ||
      runtimeProcess === undefined ||
      text(runtimeProcess, "runtime_run_id") !== input.runtimeRunId ||
      !["active", "prepared"].includes(text(runtimeProcess, "state"))
    ) {
      throw new ConflictError(
        `run attempt ${input.runAttemptId} cannot accept Provider usage`,
      );
    }
  }

  #transaction<T>(operation: () => T): T {
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

function nullableCount(row: Row, column: string): number | null {
  return row[column] === null ? null : Number(row[column]);
}

function usageFromRow(row: Row): RunAttemptUsageRecord {
  return RunAttemptUsageRecordSchema.parse({
    runAttemptId: text(row, "run_attempt_id"),
    responseId: text(row, "response_id"),
    provider: text(row, "provider"),
    inputTokens: Number(row.input_tokens),
    cachedInputTokens: Number(row.cached_input_tokens),
    outputTokens: Number(row.output_tokens),
    reasoningOutputTokens: nullableCount(row, "reasoning_output_tokens"),
    contextWindow: nullableCount(row, "context_window"),
    contextUsedTokens: nullableCount(row, "context_used_tokens"),
    observedAt: text(row, "observed_at"),
    recordedAt: text(row, "recorded_at"),
  });
}
