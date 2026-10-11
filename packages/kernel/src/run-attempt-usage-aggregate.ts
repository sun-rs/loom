import type { DatabaseSync } from "node:sqlite";
import {
  RUN_ATTEMPT_USAGE_AGGREGATE_LIMIT,
  RunAttemptUsageAggregateRecordInputSchema,
  RunAttemptUsageAggregateSchema,
  RunAttemptUsageAggregateSummarySchema,
  type RunAttemptUsageAggregate,
  type RunAttemptUsageAggregateRecordInput,
  type RunAttemptUsageAggregateSummary,
} from "@rah-os/protocol";
import type { AuthenticatedHostContext } from "./auth.ts";
import { ConflictError, ForbiddenError, NotFoundError } from "./errors.ts";
import { instanceSessionState } from "./instance-session.ts";
import type { RuntimeTrajectoryServiceOptions } from "./runtime-trajectory.ts";
import { text, type Row } from "./sqlite-row.ts";

export const RUN_ATTEMPT_USAGE_AGGREGATE_SCHEMA = `
CREATE TABLE IF NOT EXISTS run_attempt_usage_aggregates (
  participant_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  native_session_id TEXT NOT NULL,
  entry_id TEXT NOT NULL,
  session_generation INTEGER NOT NULL CHECK(session_generation >= 0),
  run_attempt_id TEXT NOT NULL REFERENCES run_attempts(run_attempt_id),
  runtime_run_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind = 'compaction'),
  input_tokens INTEGER NOT NULL CHECK(input_tokens >= 0),
  output_tokens INTEGER NOT NULL CHECK(output_tokens >= 0),
  cached_input_tokens INTEGER CHECK(cached_input_tokens BETWEEN 0 AND input_tokens),
  reasoning_output_tokens INTEGER CHECK(reasoning_output_tokens BETWEEN 0 AND output_tokens),
  observed_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  PRIMARY KEY(participant_id, provider, native_session_id, entry_id)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_run_usage_aggregates_run ON run_attempt_usage_aggregates(run_attempt_id);
`;
const fields = [
  ["provider", "provider"],
  ["kind", "kind"],
  ["nativeSessionId", "native_session_id"],
  ["entryId", "entry_id"],
  ["inputTokens", "input_tokens"],
  ["outputTokens", "output_tokens"],
  ["cachedInputTokens", "cached_input_tokens"],
  ["reasoningOutputTokens", "reasoning_output_tokens"],
  ["observedAt", "observed_at"],
] as const;
function fromRow(row: Row): RunAttemptUsageAggregate {
  return RunAttemptUsageAggregateSchema.parse({
    ...Object.fromEntries(
      fields.map(([field, column]) => [field, row[column]]),
    ),
    recordedAt: row.recorded_at,
  });
}
/** Kernel owns immutable aggregate attribution. Host must attest that native
 * session/entry came from the current runtime's newly appended native data. */
export class RunAttemptUsageAggregateService {
  private readonly options: RuntimeTrajectoryServiceOptions;
  constructor(options: RuntimeTrajectoryServiceOptions) {
    this.options = options;
  }
  record(
    host: AuthenticatedHostContext,
    untrusted: RunAttemptUsageAggregateRecordInput,
  ): RunAttemptUsageAggregate {
    const input = RunAttemptUsageAggregateRecordInputSchema.parse(untrusted);
    const db = this.options.database;
    db.exec("BEGIN IMMEDIATE");
    try {
      const authenticated = this.options.requireHost(host);
      const run = db
        .prepare("SELECT * FROM run_attempts WHERE run_attempt_id=?")
        .get(input.runAttemptId);
      if (!run)
        throw new NotFoundError(
          `run attempt ${input.runAttemptId} was not found`,
        );
      const participantId = text(run, "participant_id");
      this.options.requireHostParticipant(authenticated, participantId);
      if (text(run, "host_id") !== authenticated.hostId)
        throw new ForbiddenError("Host does not own aggregate RunAttempt");
      this.options.requireRunAttemptHostGeneration(run, authenticated);
      const identity = [
        participantId,
        input.provider,
        input.nativeSessionId,
        input.entryId,
      ];
      const existing = db
        .prepare(
          "SELECT * FROM run_attempt_usage_aggregates WHERE participant_id=? AND provider=? AND native_session_id=? AND entry_id=?",
        )
        .get(...identity);
      if (existing) {
        if (
          existing.run_attempt_id !== input.runAttemptId ||
          existing.runtime_run_id !== input.runtimeRunId ||
          !fields.every(([field, column]) => existing[column] === input[field])
        )
          throw new ConflictError(
            "Native aggregate entry conflicts with an existing attribution or fact",
          );
        db.exec("COMMIT");
        return fromRow(existing);
      }
      const runtime = db
        .prepare("SELECT * FROM runtime_processes WHERE run_attempt_id=?")
        .get(input.runAttemptId);
      if (
        !["starting", "running"].includes(text(run, "state")) ||
        !runtime ||
        text(runtime, "runtime_run_id") !== input.runtimeRunId ||
        !["active", "prepared"].includes(text(runtime, "state"))
      )
        throw new ConflictError(
          "RunAttempt cannot accept native aggregate usage",
        );
      const generation = instanceSessionState(db, participantId).generation;
      const recordedAt = this.options.now().toISOString();
      db.prepare(
        `INSERT INTO run_attempt_usage_aggregates(participant_id,session_generation,run_attempt_id,runtime_run_id,${fields.map(([, column]) => column).join(",")},recorded_at) VALUES(${Array(14).fill("?").join(",")})`,
      ).run(
        participantId,
        generation,
        input.runAttemptId,
        input.runtimeRunId,
        ...fields.map(([field]) => input[field]),
        recordedAt,
      );
      // An aggregate proves only known successful usage, not full request coverage.
      // Do not duplicate an existing gap or erase its provider/occurrence evidence.
      db.prepare(
        `INSERT OR IGNORE INTO run_attempt_usage_gaps(run_attempt_id,reason,provider,occurrences,first_observed_at,last_observed_at,recorded_at) VALUES(?,'parse_error',?,1,?,?,?)`,
      ).run(
        input.runAttemptId,
        input.provider,
        input.observedAt,
        input.observedAt,
        recordedAt,
      );
      db.exec("COMMIT");
      return RunAttemptUsageAggregateSchema.parse({
        ...Object.fromEntries(fields.map(([field]) => [field, input[field]])),
        recordedAt,
      });
    } catch (error) {
      if (db.isTransaction) db.exec("ROLLBACK");
      throw error;
    }
  }
}
/** Called only after the existing RunAttempt visibility check. */
export function aggregateUsageForRun(
  db: DatabaseSync,
  runAttemptId: string,
): RunAttemptUsageAggregateSummary {
  const totals = db
    .prepare(
      `SELECT COUNT(*) AS entries,SUM(input_tokens) AS inputTokens,SUM(output_tokens) AS outputTokens,
    CASE WHEN COUNT(cached_input_tokens)=COUNT(*) THEN SUM(cached_input_tokens) END AS cachedInputTokens,
    CASE WHEN COUNT(reasoning_output_tokens)=COUNT(*) THEN SUM(reasoning_output_tokens) END AS reasoningOutputTokens
    FROM run_attempt_usage_aggregates WHERE run_attempt_id=?`,
    )
    .get(runAttemptId)!;
  const entries = db
    .prepare(
      "SELECT * FROM run_attempt_usage_aggregates WHERE run_attempt_id=? ORDER BY observed_at,recorded_at,entry_id LIMIT ?",
    )
    .all(runAttemptId, RUN_ATTEMPT_USAGE_AGGREGATE_LIMIT)
    .map(fromRow);
  return RunAttemptUsageAggregateSummarySchema.parse({
    entries,
    totals: {
      ...totals,
      entries: totals.entries === 0 ? null : totals.entries,
    },
    truncated: Number(totals.entries) > entries.length,
  });
}
