// Tool-call classification shared by the efficiency and drift gates (owner
// 2026-09-25, decision A). A Worker CLI call (message-post/check, help, Task
// commands, other `worker <command>`), internal Worker MCP replies and a read
// of the platform memory index
// are protocol; every other identifiable tool call is business work. A call
// whose arguments are absent cannot be classified and is `unknown`: the RAH
// arm counts it as protocol (conservative), and it is always reported.
// `worker help message-post` asks about a command; it neither posts nor
// checks (and must not count as an unhandled post for `--turn`).
// Cost evidence only, never delivery/authorization proof. A cell containing the
// reserved internal tool symbol is conservatively all protocol, even if mixed
// with business work or the symbol is only referenced/quoted. No token split
// or --turn/final proof is inferred from model-written arguments.
const WORKER_MCP_REPLY = "mcp__loom_worker__loom_reply";
const WORKER_MCP_SYMBOL = /\bmcp__loom_worker__loom_reply\b/;
const HELP = /\bworker\s+help\b/;
const POST = /message-post/;
const CHECK = /message-check/;
const TASK = /task-(create|claim|update)|tasks?\s+create/;
const WORKER = /RAH_WORKER_CLI|\bworker\s+[a-z][\w-]*/;
const MEMORY = /\bMEMORY\.md\b/;

export const PROTOCOL_KINDS = new Set([
  "worker-mcp-reply",
  "box-post",
  "box-check",
  "task-command",
  "worker-command",
  "memory-read",
]);

export function workerCallKind(args, toolName) {
  if (
    toolName === WORKER_MCP_REPLY ||
    (typeof args === "string" && WORKER_MCP_SYMBOL.test(args))
  )
    return "worker-mcp-reply";
  return cliCallKind(args);
}

function cliCallKind(args) {
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

// Independent diagnostic evidence: cost classification cannot hide a CLI
// no-handle failure. Direct MCP arguments never prove CLI execution. Outer
// cells containing CLI-like text are ambiguous, even if it is only prose;
// do not parse JavaScript or accept model-written --turn text as proof.
export function mcpCliTurnHandle(args, toolName) {
  if (toolName === WORKER_MCP_REPLY) return undefined;
  if (["exec_command", "shell_command", "shell"].includes(toolName)) {
    try {
      const parsed = JSON.parse(args);
      const command = parsed?.cmd ?? parsed?.command;
      if (typeof command === "string" && cliCallKind(command) === "box-post")
        return /--turn\b/.test(command);
    } catch {
      /* Unreadable command evidence stays conservative below. */
    }
  }
  return typeof args === "string" && POST.test(args) ? "ambiguous" : undefined;
}
