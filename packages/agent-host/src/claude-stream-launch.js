// Shared by the per-turn and warm Claude stream-json drivers: the RAH launch
// policy for `claude -p --input-format stream-json --output-format
// stream-json` (the built-in transport arguments stay in
// provider-launch-arguments.js).
export const CLAUDE_DISALLOWED_TOOLS = [
  "EnterPlanMode",
  "ExitPlanMode",
  "ScheduleWakeup",
  "CronCreate",
  "CronList",
  "CronDelete",
].join(",");

/** Process-only: a nested Claude Code marker must not reach the child CLI. */
export function withoutNestedClaudeCode(environment) {
  const next = { ...environment };
  delete next.CLAUDECODE;
  return next;
}

export function isMissingClaudeSessionError(message) {
  return /(?:no (?:conversation|session) found|(?:session|conversation).*(?:not found|does not exist|missing)|(?:not found|missing).*(?:session|conversation))/iu.test(
    message ?? "",
  );
}

/**
 * A result's error text. A real 2.1.282 error result carries it only in
 * `errors[]` (for example "No conversation found with session ID: …" or an
 * interrupt diagnostic), never in `result`/`error`.
 */
export function claudeResultError(frame) {
  const errors = Array.isArray(frame?.errors)
    ? frame.errors.filter((entry) => typeof entry === "string").join("; ")
    : "";
  const text =
    (typeof frame?.result === "string" && frame.result !== ""
      ? frame.result
      : typeof frame?.error === "string" && frame.error !== ""
        ? frame.error
        : errors) ||
    `Claude turn ended with ${String(frame?.subtype ?? "unknown")}`;
  return String(text).slice(0, 2048);
}

/**
 * Every input a `result` ran (real 2.1.282): `user_message_uuid` names the
 * turn's first input and `user_message_uuids` every input folded into that
 * turn (a busy input written while it ran joins it at the next tool
 * boundary). A result with neither ran no input written on stdin — for
 * example the turn a finished background task starts.
 */
export function claudeResultInputUuids(frame) {
  const uuids = [];
  if (typeof frame?.user_message_uuid === "string")
    uuids.push(frame.user_message_uuid);
  if (Array.isArray(frame?.user_message_uuids))
    for (const uuid of frame.user_message_uuids)
      if (typeof uuid === "string" && !uuids.includes(uuid)) uuids.push(uuid);
  return uuids;
}

/** Settles the pending `control_request` a `control_response` answers. */
export function settleClaudeControlResponse(frame, requests) {
  const response =
    typeof frame?.response === "object" && frame.response !== null
      ? frame.response
      : {};
  const requestId = response.request_id;
  const pending =
    typeof requestId === "string" ? requests.get(requestId) : undefined;
  if (pending === undefined) return;
  requests.delete(requestId);
  clearTimeout(pending.timer);
  if (response.subtype === "success") pending.resolve(response.response ?? {});
  else
    pending.reject(
      Object.assign(
        new Error(
          typeof response.error === "string" && response.error !== ""
            ? response.error
            : "Claude control_request failed",
        ),
        { providerRejected: true },
      ),
    );
}
