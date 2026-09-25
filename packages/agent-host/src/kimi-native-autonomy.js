// Codex review of batches 3-4 P1-1: kimi-code native goals drive
// continuation turns outside the instance's single lane. Read (not run) from
// the installed kimi-code 0.39.1 bundle (`dist/main.mjs`, agent-core-v2 — the
// default `kimi acp` server unless KIMI_CODE_LEGACY_FLAG is set):
//
// - There is no process switch for goal tools (only KIMI_DISABLE_CRON for
//   cron); `goalToolsEnabled` is simply "main agent".
// - `CreateGoal` asks the client (`goal-start-review-ask`) in every
//   permission mode except `auto`, which auto-approves it; `UpdateGoal`
//   (status `active` resumes a paused goal) and `SetGoalBudget` carry an
//   approval rule, asked in `manual` and auto-approved in `auto`/`yolo`.
// - Inside `kimi acp` only the ACP mode (`session/set_mode` or
//   `session/set_config_option` {configId:"mode"}) and the goal-start answer
//   change the permission mode; ACP `default` maps to `manual`. The ACP
//   session reports `default` on new/resume whatever the persisted mode is,
//   so the reported mode proves nothing until the driver sets it.
// - Durable agent events live in `<sessionDir>/agents/main/wire.jsonl`, the
//   session found through `<KIMI_CODE_HOME>/session_index.jsonl`. On agent
//   resume kimi-code pauses an active goal ("Paused after agent resume").
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

export const KIMI_UNSAFE_PERMISSION_MODE = "KIMI_UNSAFE_PERMISSION_MODE";
export const KIMI_NATIVE_GOAL_ACTIVE = "KIMI_NATIVE_GOAL_ACTIVE";
/** The CLI rejected the mode option itself (method or configId unknown). */
export const KIMI_MODE_UNSUPPORTED = "KIMI_MODE_UNSUPPORTED";
/** The mode request failed or went unanswered; the mode is unknown. */
export const KIMI_MODE_UNCONFIRMED = "KIMI_MODE_UNCONFIRMED";
/** ACP mode id that maps to the `manual` permission mode. */
export const KIMI_SAFE_MODE_ID = "default";

const GOAL_MUTATION_TOOLS = new Set([
  "CreateGoal",
  "UpdateGoal",
  "SetGoalBudget",
]);
const MAX_WIRE_BYTES = 64 * 1024 * 1024;

/** A permission request whose tool can create, resume or reshape a goal. */
export function isKimiGoalMutationTool(title) {
  return typeof title === "string" && GOAL_MUTATION_TOOLS.has(title);
}

export function kimiHome(environment = process.env) {
  const configured = environment.KIMI_CODE_HOME;
  return typeof configured === "string" && configured !== ""
    ? configured
    : join(homedir(), ".kimi-code");
}

/** The native goal reducer and permission-mode state over one main wire. */
export function foldKimiMainWire(text) {
  let goal = null;
  let permissionMode = "manual";
  for (const line of String(text).split("\n")) {
    if (line.trim() === "") continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event === null || typeof event !== "object") continue;
    if (event.type === "goal.create") {
      goal = { goalId: String(event.goalId), status: "active" };
    } else if (event.type === "goal.update") {
      if (goal !== null && typeof event.status === "string")
        goal = { ...goal, status: event.status };
    } else if (event.type === "goal.clear" || event.type === "forked") {
      goal = null;
    } else if (
      event.type === "permission.set_mode" &&
      typeof event.mode === "string"
    ) {
      permissionMode = event.mode;
    }
  }
  return { goal, permissionMode };
}

/** What Kimi itself persisted for a session it is about to resume. */
export function inspectKimiSession(sessionId, environment = process.env) {
  const home = kimiHome(environment);
  let index;
  try {
    index = readFileSync(join(home, "session_index.jsonl"), "utf8");
  } catch {
    return { state: "unavailable", reason: "session index unreadable" };
  }
  let sessionDir;
  for (const line of index.split("\n")) {
    try {
      const entry = JSON.parse(line);
      if (
        entry?.sessionId === sessionId &&
        typeof entry.sessionDir === "string" &&
        isAbsolute(entry.sessionDir)
      )
        sessionDir = entry.sessionDir;
    } catch {
      // A torn line is skipped.
    }
  }
  if (sessionDir === undefined)
    return {
      state: "unavailable",
      reason: "session not in the Kimi session index",
    };
  let wire;
  try {
    const buffer = readFileSync(
      join(sessionDir, "agents", "main", "wire.jsonl"),
    );
    if (buffer.byteLength > MAX_WIRE_BYTES)
      return { state: "unavailable", reason: "main agent wire too large" };
    wire = buffer.toString("utf8");
  } catch {
    return { state: "unavailable", reason: "main agent wire unreadable" };
  }
  return { state: "read", ...foldKimiMainWire(wire) };
}

/** Refuse to resume a session whose persisted native goal is active. */
export function assertKimiResumeSafe(inspection) {
  if (inspection?.state !== "read" || inspection.goal?.status !== "active")
    return;
  throw new Error(
    `${KIMI_NATIVE_GOAL_ACTIVE}: the Kimi session has an active native goal (${inspection.goal.goalId}) that would drive turns outside this instance's lane; pause or clear it in Kimi before this instance runs again (Loom does not reset the session)`,
  );
}

/** Only a confirmed ACP `default` mode (manual permission) is safe. */
export function assertKimiSafeMode(effective) {
  if (effective === KIMI_SAFE_MODE_ID) return;
  throw new Error(
    `${KIMI_UNSAFE_PERMISSION_MODE}: Kimi did not confirm mode=${KIMI_SAFE_MODE_ID} (effective=${effective ?? "unknown"}); auto/yolo modes approve native goals without asking`,
  );
}

/**
 * Why pinning the mode failed, kept apart from an unsafe mode: JSON-RPC
 * method-not-found / invalid-params mean this CLI has no mode option; any
 * other failure (a timeout included) leaves the mode unknown. Both refuse
 * the run — without a confirmed `default` the goal fence is not in place.
 */
export function kimiModeFailure(error) {
  const code = error?.code;
  const unsupported = code === -32601 || code === -32602;
  const detail = error instanceof Error ? error.message : String(error);
  return new Error(
    unsupported
      ? `${KIMI_MODE_UNSUPPORTED}: this Kimi CLI rejected the ACP mode option (${detail}); the native-goal fence cannot be pinned`
      : `${KIMI_MODE_UNCONFIRMED}: Kimi did not confirm mode=${KIMI_SAFE_MODE_ID} (${detail})`,
  );
}
