import { DatabaseSync } from "node:sqlite";
import { openCodeDatabasePath } from "./drift-opencode-guard.mjs";

// Diagnostic bounds only: the assistant message is created before its request,
// the same message's step-start is emitted after streaming starts. Neither is
// an exact provider request timestamp. A retry/multiple start stays unknown.
export function readOpenCodeTiming(
  sessionId,
  fromMs,
  toMs,
  dbPath = openCodeDatabasePath(),
) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const rows = db
      .prepare(
        `WITH RECURSIVE tree(id) AS (
      SELECT ? UNION SELECT s.id FROM session s JOIN tree t ON s.parent_id=t.id)
      SELECT p.id,p.message_id,p.time_created,p.data,m.data AS message
      FROM part p JOIN message m ON m.id=p.message_id AND m.session_id=p.session_id
      WHERE p.session_id IN (SELECT id FROM tree) AND p.time_created BETWEEN ? AND ?`,
      )
      .all(sessionId, fromMs, toMs);
    const groups = new Map();
    for (const row of rows) {
      const group = groups.get(row.message_id) ?? [];
      group.push({ ...row, part: JSON.parse(row.data) });
      groups.set(row.message_id, group);
    }
    const result = new Map();
    for (const group of groups.values()) {
      const starts = group.filter((r) => r.part.type === "step-start");
      const ends = group.filter((r) => r.part.type === "step-finish");
      if (starts.length !== 1 || ends.length !== 1) continue;
      const start = starts[0],
        end = ends[0],
        message = JSON.parse(end.message);
      const created = message.time?.created;
      if (
        message.role !== "assistant" ||
        !Number.isFinite(created) ||
        created < fromMs ||
        created > start.time_created ||
        start.time_created > end.time_created
      )
        continue;
      result.set(end.id, {
        startedAfter: new Date(created).toISOString(),
        startedBy: new Date(start.time_created).toISOString(),
      });
    }
    return result;
  } finally {
    db.close();
  }
}
