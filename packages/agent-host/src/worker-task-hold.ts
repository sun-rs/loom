/**
 * Raft holds a Task claim, status update or amendment on stale context with the
 * same `formatFreshnessHoldOutput` it uses for a send, writes it to stdout with
 * `writeText`, and returns — exit 0. The mutation is not applied and, unlike a
 * send, no draft is saved, so there is no "send the draft unchanged" path: the
 * only path forward is to read the newer context and rerun the command if it is
 * still correct. `heldAction` and the closing instruction are upstream's own
 * wording (`dist-UT7IQEHX.js@2818799`, `@2828615`, `@2840513`).
 */

const MAX_RENDERED_BODY_CHARACTERS = 500;

type TaskHoldWording = { action: string; rerun: string };

const CLAIM: TaskHoldWording = {
  action: "Your task claim was not applied.",
  rerun:
    "After reviewing the newer context, rerun the task claim command if it is still correct.",
};
const STATUS: TaskHoldWording = {
  action: "Your task status update was not applied.",
  rerun:
    "After reviewing the newer context, rerun the task update command if it is still correct.",
};
const AMEND: TaskHoldWording = {
  action: "Your task amendment was not applied.",
  rerun:
    "After reviewing the newer context, rerun the task amend command if it is still correct.",
};

/**
 * Raft's third hold belongs to its single status setter, whose `--status` takes
 * one of todo/in_progress/in_review/done/closed. `blocked` is not among them,
 * so unblock is a different command, and assign/unassign/unclaim have no hold
 * branch upstream at all. RAH split that setter into a lifecycle family, and
 * which members correspond to those five statuses is not settled by the
 * evidence gathered here — so STATUS is defined and left unmapped rather than
 * applied through a mapping invented to cover more commands.
 */
export function workerTaskHoldWording(
  command: string,
): TaskHoldWording | undefined {
  if (command === "task-claim" || command === "task-claim-message")
    return CLAIM;
  if (command === "task-amend") return AMEND;
  return undefined;
}

/** Raft's status-update hold wording, kept for the mapping still to be made. */
export const TASK_STATUS_HOLD_WORDING = STATUS;

function renderNewerMessages(value: Record<string, unknown>): string {
  const events = Array.isArray(value.newerMessages) ? value.newerMessages : [];
  const lines: string[] = [];
  for (const event of events) {
    if (typeof event !== "object" || event === null) continue;
    const row = event as Record<string, unknown>;
    const payload =
      typeof row.payload === "object" && row.payload !== null
        ? (row.payload as Record<string, unknown>)
        : {};
    const body = typeof payload.body === "string" ? payload.body : "";
    const bounded =
      body.length > MAX_RENDERED_BODY_CHARACTERS
        ? `${body.slice(0, MAX_RENDERED_BODY_CHARACTERS)}…`
        : body;
    const sender = typeof row.actorId === "string" ? row.actorId : "unknown";
    const seq = typeof row.roomSeq === "number" ? String(row.roomSeq) : "?";
    lines.push(`[${seq}] ${sender}: ${bounded}`);
  }
  return lines.length === 0 ? "" : `\n${lines.join("\n")}\n`;
}

/** The rendered hold, or nothing when the response is an applied mutation. */
export function workerTaskHoldOutput(
  command: string,
  result: unknown,
): string | undefined {
  if (
    !result ||
    typeof result !== "object" ||
    !("state" in result) ||
    result.state !== "held"
  )
    return undefined;
  const wording = workerTaskHoldWording(command);
  if (wording === undefined) return undefined;
  const value = result as Record<string, unknown>;
  const newMessageCount =
    typeof value.newMessageCount === "number" ? value.newMessageCount : 0;
  const shownMessageCount =
    typeof value.shownMessageCount === "number" ? value.shownMessageCount : 0;
  const omittedMessageCount =
    typeof value.omittedMessageCount === "number"
      ? value.omittedMessageCount
      : Math.max(0, newMessageCount - shownMessageCount);
  const omittedNote =
    omittedMessageCount > 0
      ? ` ${String(omittedMessageCount)} earlier same-target message${
          omittedMessageCount === 1 ? "" : "s"
        } omitted from this notice and no longer block this action; use rah worker message-read explicitly if you need earlier context.`
      : "";
  return `Freshness hold: showing latest ${String(shownMessageCount)} of ${String(
    newMessageCount,
  )} newer message${newMessageCount === 1 ? "" : "s"}.${omittedNote}
${wording.action} Review the bounded context shown here, then choose one path.
${renderNewerMessages(value)}
${wording.rerun}
`;
}
