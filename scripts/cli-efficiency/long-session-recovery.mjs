// Failure-only, read-only evidence recovery for the isolated long-session gate.
// Known reported charges are retained; an interrupted window never becomes a
// complete cost measurement or successful delivery merely because SQLite exists.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
const count = (n) => Number.isSafeInteger(n) && n >= 0;

export function recoverFailedProductRound({
  stateDirectory,
  roomId,
  participantId,
  round,
}) {
  if (round?.metrics)
    return { usageRecoveryEvidence: { source: "existing-metrics-preserved" } };
  let db;
  try {
    assert.ok(
      typeof roomId === "string" &&
        roomId &&
        typeof participantId === "string" &&
        participantId,
      "Missing exact Room/participant scope",
    );
    assert.ok(
      Number.isFinite(Date.parse(round?.startedAt)),
      "Missing round start window",
    );
    const capturedAt = new Date().toISOString();
    const to = round.finishedAt ?? capturedAt;
    assert.ok(
      Number.isFinite(Date.parse(to)) &&
        Date.parse(to) >= Date.parse(round.startedAt),
      "Invalid round end window",
    );
    db = new DatabaseSync(join(stateDirectory, "room.db"), { readOnly: true });
    const runs = db
      .prepare(
        `SELECT r.run_attempt_id, r.instance_runtime_id, i.native_session_id
      FROM run_attempts r LEFT JOIN instance_runtimes i ON i.instance_runtime_id=r.instance_runtime_id
      WHERE r.room_id=? AND r.participant_id=? AND r.started_at>=? AND r.started_at<=?
      ORDER BY r.started_at,r.run_attempt_id`,
      )
      .all(roomId, participantId, round.startedAt, to);
    const rows = [],
      gaps = [
        {
          kind: "failed-stage-recovery",
          detail: "Known usage only; completeness and delivery not established",
        },
      ];
    const unreportedRunAttemptIds = [];
    for (const r of runs) {
      // All usage belonging to an admitted attempt, including records observed
      // after the round cutoff. Never truncate a known late charge by timestamp.
      const usage = db
        .prepare("SELECT * FROM run_attempt_usage WHERE run_attempt_id=?")
        .all(r.run_attempt_id);
      rows.push(...usage);
      if (!usage.length) unreportedRunAttemptIds.push(r.run_attempt_id);
      gaps.push(
        ...db
          .prepare(
            "SELECT * FROM run_attempt_usage_gaps WHERE run_attempt_id=?",
          )
          .all(r.run_attempt_id),
      );
    }
    if (!runs.length) gaps.push({ kind: "no-run-evidence" });
    if (unreportedRunAttemptIds.length)
      gaps.push({
        kind: "unreported-attempts",
        runAttemptIds: unreportedRunAttemptIds,
      });
    const totals = {};
    const fields = {
      input: "input_tokens",
      cached: "cached_input_tokens",
      output: "output_tokens",
      reasoning: "reasoning_output_tokens",
    };
    for (const [name, column] of Object.entries(fields)) {
      const known = rows.filter((r) => count(r[column]));
      if (known.length) totals[name] = known.reduce((n, r) => n + r[column], 0);
      if (known.length !== rows.length)
        gaps.push({ kind: "usage-field-missing", field: column });
    }
    const uncached = rows.filter(
      (r) =>
        count(r.input_tokens) &&
        count(r.cached_input_tokens) &&
        r.input_tokens >= r.cached_input_tokens,
    );
    if (uncached.length)
      totals.uncached = uncached.reduce(
        (n, r) => n + r.input_tokens - r.cached_input_tokens,
        0,
      );
    if (uncached.length !== rows.length)
      gaps.push({ kind: "uncached-evidence-missing" });
    if (rows.length) totals.generations = rows.length;
    const nativeSessionIds = [
      ...new Set(
        runs
          .map((r) => r.native_session_id)
          .filter((id) => typeof id === "string" && id),
      ),
    ];
    const completeSessionEvidence =
      runs.length > 0 &&
      runs.every((r) => r.native_session_id) &&
      nativeSessionIds.length === 1;
    return {
      ...(!round.sessionId && completeSessionEvidence
        ? { sessionId: nativeSessionIds[0] }
        : {}),
      metrics: {
        ...totals,
        productUsage: {
          completeness: "incomplete",
          gaps,
          totals: {
            inputTokens: totals.input,
            cachedInputTokens: totals.cached,
            outputTokens: totals.output,
            generations: totals.generations,
          },
        },
      },
      usageRecoveryEvidence: {
        source: "isolated-product-sqlite-known-usage",
        capturedAt,
        from: round.startedAt,
        to,
        endBasis: round.finishedAt
          ? "round-finishedAt"
          : "recovery-observation-time",
        runAttemptIds: runs.map((r) => r.run_attempt_id),
        unreportedRunAttemptIds,
        nativeSessionIds,
        reportedUsageRows: rows.length,
      },
    };
  } catch (error) {
    return { usageRecoveryError: String(error) };
  } finally {
    db?.close();
  }
}
