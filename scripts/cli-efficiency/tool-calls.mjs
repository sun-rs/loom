// Tool-call classification shared by the efficiency and drift gates (owner
// 2026-09-25, decision A). A Worker CLI call (message-post/check, help, Task
// commands, other `worker <command>`) and a read of the platform memory index
// are protocol; every other identifiable tool call is business work. A call
// whose arguments are absent cannot be classified and is `unknown`: the RAH
// arm counts it as protocol (conservative), and it is always reported.
// `worker help message-post` asks about a command; it neither posts nor
// checks (and must not count as an unhandled post for `--turn`).
const HELP = /\bworker\s+help\b/;
const POST = /message-post/;
const CHECK = /message-check/;
const TASK = /task-(create|claim|update)|tasks?\s+create/;
const WORKER = /RAH_WORKER_CLI|\bworker\s+[a-z][\w-]*/;
const MEMORY = /\bMEMORY\.md\b/;

export const PROTOCOL_KINDS = new Set([
  "box-post",
  "box-check",
  "task-command",
  "worker-command",
  "memory-read",
]);

export function workerCallKind(args) {
  if (typeof args !== "string" || args.trim() === "") return "unknown";
  if (HELP.test(args)) return "worker-command";
  if (POST.test(args)) return "box-post";
  if (CHECK.test(args)) return "box-check";
  if (TASK.test(args)) return "task-command";
  if (WORKER.test(args)) return "worker-command";
  if (MEMORY.test(args)) return "memory-read";
  return "other";
}

// "business" | "protocol" | "unknown".
export function toolCallCategory(call) {
  const kind = call?.kind;
  if (kind === "other") return "business";
  if (PROTOCOL_KINDS.has(kind)) return "protocol";
  return "unknown";
}

// null when the tool calls were not collected (never counted as zero).
export function countToolCalls(toolCalls) {
  if (!Array.isArray(toolCalls)) return null;
  const out = { total: 0, business: 0, protocol: 0, unknown: 0, byKind: {} };
  for (const c of toolCalls) {
    const kind = typeof c?.kind === "string" ? c.kind : "unknown";
    out.total += 1;
    out[toolCallCategory(c)] += 1;
    out.byKind[kind] = (out.byKind[kind] ?? 0) + 1;
  }
  return out;
}
