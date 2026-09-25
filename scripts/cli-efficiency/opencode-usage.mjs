// OpenCode evidence for the paid efficiency gate. The parsers are pure; the
// paid runners supply the bytes (stdout of `opencode run --format json`) or
// read the CLI's own database (diagnostics only, never Room truth).
//
// `opencode run --format json` (1.18) prints one JSON event per line, each
// with `type`, `timestamp` and `sessionID`: `step_start`/`step_finish`
// (`part` is the step part; `step-finish` carries `tokens`), `text` (a
// finished text part), `tool_use` (a finished tool part) and `error`. Usage
// is counted exactly as the product does (openCodeStepFinishUsage: one
// record per step-finish part id).
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { openCodeStepFinishUsage } from "../../packages/agent-host/src/provider-usage.js";
import { workerCall } from "./claude-usage.mjs";
import { openCodeDatabasePath } from "./drift-opencode-guard.mjs";

const NATIVE_TITLE = "Loom efficiency gate native";

// Native arm: one process per round, the same session resumed after round 1.
// The explicit title avoids OpenCode's internal title-generation call.
export function openCodeNativeArgs({ model, effort, prompt, sessionId }) {
  if (!model || !effort || typeof prompt !== "string")
    throw new Error("Native OpenCode args need model, effort and prompt");
  return [
    "run",
    "--pure",
    "--format",
    "json",
    // Parity with the product's full-access Role (the gate workspace is a
    // temporary copy); the other native arms bypass approvals likewise.
    "--auto",
    "-m",
    model,
    "--variant",
    effort,
    ...(sessionId ? ["--session", sessionId] : ["--title", NATIVE_TITLE]),
    prompt,
  ];
}

// Pins OpenCode's default and small model to the approved one (the product's
// served config is pinned the same way, see assertOpenCodeServerConfig).
export function openCodeNativeEnv(approved, env) {
  return {
    ...env,
    OPENCODE_CONFIG_CONTENT: JSON.stringify({
      model: approved.model,
      small_model: approved.model,
    }),
  };
}

const FORBIDDEN = new Set([
  "--fork",
  "-c",
  "--continue",
  "--agent",
  "--command",
  "--attach",
  "--share",
  "-f",
  "--file",
  "--port",
  "--dir",
  "-i",
  "--interactive",
]);

// Fail-closed pre-launch fence for the native run arm.
export function checkOpenCodeNativeLaunch(args, env, approved) {
  if (args[0] !== "run")
    throw new Error("Unsupported gate CLI command (run only)");
  const models = [];
  const variants = [];
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (a === "-m" || a === "--model") models.push(args[++i]);
    else if (a === "--variant") variants.push(args[++i]);
    else if (
      a === "--session" ||
      a === "-s" ||
      a === "--title" ||
      a === "--format"
    )
      i++;
    else if (
      a.startsWith("-") &&
      (FORBIDDEN.has(a.split("=")[0]) || a.includes("="))
    )
      throw new Error(`Unsupported gate argument ${a}`);
  }
  if (models.length !== 1 || models[0] !== approved.model)
    throw new Error("Unapproved model (exactly one approved -m required)");
  if (variants.length !== 1 || variants[0] !== approved.effort)
    throw new Error(
      "Unapproved variant (exactly one approved --variant required)",
    );
  let config;
  try {
    config = JSON.parse(env.OPENCODE_CONFIG_CONTENT ?? "");
  } catch {
    throw new Error("Unapproved OpenCode config (not JSON)");
  }
  if (
    config?.model !== approved.model ||
    config?.small_model !== approved.model
  )
    throw new Error("Unapproved OpenCode default or small model");
}

// entries: [{ line, at }] in arrival order.
export function parseOpenCodeRunRound(entries) {
  const out = {
    sessionIds: [],
    answer: undefined,
    finalAt: undefined,
    generations: [],
    gaps: [],
    toolCalls: [],
    errors: [],
  };
  for (const { line, at } of entries) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event === null || typeof event !== "object") continue;
    if (
      typeof event.sessionID === "string" &&
      !out.sessionIds.includes(event.sessionID)
    )
      out.sessionIds.push(event.sessionID);
    const when = Number.isFinite(event.timestamp) ? event.timestamp : at;
    const part = event.part ?? {};
    if (event.type === "step_finish") {
      const usage = openCodeStepFinishUsage(part, () => when);
      if (usage?.reason !== undefined) out.gaps.push(usage);
      else if (usage !== undefined) out.generations.push(usage);
    }
    if (
      event.type === "text" &&
      typeof part.text === "string" &&
      part.text.trim()
    ) {
      out.answer = part.text.trim();
      out.finalAt = when;
    }
    if (event.type === "tool_use")
      out.toolCalls.push(
        workerCall(
          part.tool,
          JSON.stringify(part.state?.input ?? {}),
          new Date(when).toISOString(),
        ),
      );
    if (event.type === "error") out.errors.push(event.error ?? null);
  }
  return out;
}

// Tool parts of a session tree inside [fromMs, toMs] (the RAH arm's Worker
// call kinds; the product's usage records come from its own driver).
export function readOpenCodeToolCalls(
  sessionId,
  fromMs,
  toMs,
  dbPath = openCodeDatabasePath(),
) {
  if (!existsSync(dbPath)) throw new Error("OpenCode database not found");
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return db
      .prepare(
        `WITH RECURSIVE tree(id) AS (
           SELECT ? UNION SELECT s.id FROM session s JOIN tree t ON s.parent_id = t.id)
         SELECT time_created, data FROM part
          WHERE session_id IN (SELECT id FROM tree) AND time_created BETWEEN ? AND ?
          ORDER BY time_created, id`,
      )
      .all(sessionId, fromMs, toMs)
      .map((row) => ({ at: row.time_created, part: JSON.parse(row.data) }))
      .filter(({ part }) => part?.type === "tool")
      .map(({ at, part }) =>
        workerCall(
          part.tool,
          JSON.stringify(part.state?.input ?? {}),
          new Date(at).toISOString(),
        ),
      );
  } finally {
    db.close();
  }
}
