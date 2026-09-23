import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Diagnostic owner only. No credentials, message bodies, Provider transcripts,
// ACKs, migrations or runtime calls. A post is not proof of an answered question.
export function summarizeRun(run, entries, posts) {
  const start = Date.parse(run.startedAt);
  const end = run.finishedAt ? Date.parse(run.finishedAt) : Infinity;
  const inside = (at) => Date.parse(at) >= start && Date.parse(at) <= end;
  const ordered = entries
    .filter((e) => inside(e.at))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const post = posts
    .filter(inside)
    .sort((a, b) => Date.parse(a) - Date.parse(b))[0];
  const tool = ordered.find((e) => e.kind === "tool_start");
  return {
    ...run,
    activationAgeAtRunStartMs: start - Date.parse(run.createdAt),
    runDurationMs: Number.isFinite(end) ? end - start : null,
    firstToolAfterRunMs: tool ? Date.parse(tool.at) - start : null,
    firstAttributedPostAfterRunMs: post ? Date.parse(post) - start : null,
    postToFinishMs:
      post && Number.isFinite(end) ? end - Date.parse(post) : null,
    attributedPostCount: posts.filter(inside).length,
    startMarkerCount: ordered.filter(
      (e) => e.detailKind === "model_request_started",
    ).length,
    modelRequestsBeforeReply: null,
    firstRequestInputTokens: null,
    cacheReadTokens: null,
    rateLimited: null,
  };
}

export function auditDatabase(databasePath, limit = 100) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000)
    throw new Error("limit must be 1–1000");
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    db.exec("PRAGMA query_only=ON; BEGIN");
    const runs = db
      .prepare(
        `SELECT r.run_attempt_id AS runAttemptId,
      r.activation_id AS activationId, r.room_id AS roomId,
      r.participant_id AS participantId, r.attempt_number AS attemptNumber,
      r.state, r.started_at AS startedAt, r.finished_at AS finishedAt,
      a.created_at AS createdAt, a.from_seq AS fromSeq, a.to_seq AS toSeq
      FROM run_attempts r JOIN activations a USING(activation_id)
      ORDER BY r.started_at DESC LIMIT ?`,
      )
      .all(limit);
    const entries = db.prepare(`SELECT observed_at AS at,
      json_extract(entry_json, '$.kind') AS kind,
      json_extract(entry_json, '$.detailKind') AS detailKind
      FROM run_trajectory_entries WHERE run_attempt_id = ?`);
    const posts = db.prepare(`SELECT created_at AS at FROM room_events
      WHERE type='message.posted' AND actor_id=?
      AND json_extract(payload_json, '$.activationId')=?`);
    return {
      schemaVersion: 1,
      capturedAt: new Date().toISOString(),
      scope: "latest RunAttempts, not a randomized latency benchmark",
      caveats: [
        "Activation range is its current projection, not an immutable per-attempt delivery window.",
        "Post attribution uses activationId + actor + attempt time interval; excludes target posts without this provenance.",
        "First attributed post may be progress, not the requested final answer.",
        "Run start is a ledger boundary, not Provider readiness or first model token.",
        "Existing init/turn/prompt markers cannot count individual model requests; unknown metrics remain null.",
      ],
      runs: runs.map((run) =>
        summarizeRun(
          run,
          entries.all(run.runAttemptId),
          posts.all(run.participantId, run.activationId).map((p) => p.at),
        ),
      ),
    };
  } finally {
    db.close();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  if (!process.argv[2])
    throw new Error(
      "Usage: node scripts/scheduling-phase-audit.mjs DATABASE [LIMIT]",
    );
  process.stdout.write(
    JSON.stringify(
      auditDatabase(process.argv[2], Number(process.argv[3] ?? 100)),
      null,
      2,
    ) + "\n",
  );
}
