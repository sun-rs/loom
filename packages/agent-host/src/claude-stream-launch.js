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
