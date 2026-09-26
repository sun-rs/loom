// evo §40: Kimi per-generation usage from the session wire. kimi-code 0.39.1
// ACP reports no usage frames, but it appends every durable agent event to
// `<sessionDir>/agents/main/wire.jsonl` (session found through
// `<KIMI_CODE_HOME>/session_index.jsonl`, the same lookup the goal fence
// uses). Each LLM step of the main agent ends with a
// `context.append_loop_event` whose `step.end` event carries the provider
// `messageId` and `usage {inputOther, output, inputCacheRead,
// inputCacheCreation}`, next to a `usage.record` with `usageScope: "turn"`;
// a compaction's own model call is a `usage.record` with another scope
// between `full_compaction.begin` and `full_compaction.complete`; a prompt
// ends with `turn.ended` (a compaction-only prompt with
// `full_compaction.complete`). Shapes read from the real wire kept as
// `scripts/cli-efficiency/fixtures/kimi-acp-0.39-session/wire.jsonl`.
//
// The driver records the wire size right before `session/prompt` and, after
// the prompt settles, reads only the bytes appended since: that region is
// this prompt's (one lane, one prompt in flight). Values are copied, never
// estimated; anything that cannot be proven is a capture gap:
// - no readable wire, or no turn end in the region: `parse_error`;
// - turn-scoped `usage.record` count differs from the `step.end` usages:
//   `inconsistent_total`;
// - the main agent called a sub-agent (`Agent`/`AgentSwarm`), whose steps
//   live in wires this reader does not attribute: `unsupported_provider`.
// A step cancelled before it produced usage (the Host's final interrupt)
// has no usage record in the wire and is not a generation, as for Claude.
import {
  closeSync,
  existsSync,
  fstatSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
} from "node:fs";
import { isAbsolute, join } from "node:path";

import { kimiHome } from "./kimi-native-autonomy.js";
import { providerUsageGap } from "./provider-usage.js";

export const KIMI_USAGE_PROVIDER = "kimi-acp/v1";
const MAX_TURN_WIRE_BYTES = 16 * 1024 * 1024;
const SUB_AGENT_TOOLS = new Set(["Agent", "AgentSwarm"]);

/** The main-agent wire of a Kimi session, or `undefined` when not indexed. */
export function kimiMainWirePath(sessionId, environment = process.env) {
  let index;
  try {
    index = readFileSync(
      join(kimiHome(environment), "session_index.jsonl"),
      "utf8",
    );
  } catch {
    return undefined;
  }
  let sessionDir;
  for (const line of index.split("\n")) {
    if (line.trim() === "") continue;
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
  return sessionDir === undefined
    ? undefined
    : join(sessionDir, "agents", "main", "wire.jsonl");
}

/** Current wire size in bytes; 0 when the file does not exist yet. */
export function kimiWireSize(path) {
  return existsSync(path) ? statSync(path).size : 0;
}

/**
 * Usage of one prompt from the wire bytes appended since it was sent.
 * `ended` is false when the region has no turn end yet.
 */
export function kimiTurnUsage(text, { now = Date.now } = {}) {
  const lines = String(text).split("\n");
  const usages = [];
  const gaps = [];
  const gap = (reason) => {
    if (!gaps.some((entry) => entry.reason === reason))
      gaps.push(providerUsageGap(KIMI_USAGE_PROVIDER, reason, now));
  };
  let ended = false;
  let inCompaction = false;
  let compactionDone = false;
  let stepAfterCompaction = false;
  let turnRecords = 0;
  let stepUsages = 0;
  const seen = new Set();
  for (let index = 0; index < lines.length && !ended; index += 1) {
    const raw = lines[index];
    if (raw.trim() === "") continue;
    let record;
    try {
      record = JSON.parse(raw);
    } catch {
      // The first line may be the torn tail of a pre-prompt record and the
      // last one a record still being written; neither is this prompt's.
      if (index !== 0 && index !== lines.length - 1) gap("parse_error");
      continue;
    }
    if (!isRecord(record)) continue;
    const at =
      typeof record.time === "number" && Number.isFinite(record.time)
        ? new Date(record.time).toISOString()
        : new Date(now()).toISOString();
    if (record.type === "turn.ended") {
      ended = true;
    } else if (record.type === "full_compaction.begin") {
      inCompaction = true;
    } else if (record.type === "full_compaction.complete") {
      inCompaction = false;
      compactionDone = true;
      stepAfterCompaction = false;
    } else if (record.type === "usage.record") {
      if (record.usageScope === "turn") turnRecords += 1;
      else if (inCompaction) {
        const usage = kimiUsage(record.usage, `compaction:${at}`, at);
        if (usage === undefined) gap("parse_error");
        else if (!seen.has(usage.responseId)) {
          seen.add(usage.responseId);
          usages.push(usage);
        }
      } else gap("parse_error");
    } else if (record.type === "context.append_loop_event") {
      const event = isRecord(record.event) ? record.event : {};
      if (event.type === "step.begin") stepAfterCompaction = true;
      if (event.type === "tool.call" && SUB_AGENT_TOOLS.has(event.name))
        gap("unsupported_provider");
      if (event.type !== "step.end" || event.usage === undefined) continue;
      stepUsages += 1;
      const usage =
        typeof event.messageId === "string" && event.messageId !== ""
          ? kimiUsage(event.usage, event.messageId, at)
          : undefined;
      if (usage === undefined) gap("parse_error");
      else if (!seen.has(usage.responseId)) {
        seen.add(usage.responseId);
        usages.push(usage);
      }
    }
  }
  // A prompt that only compacted ends with the compaction (no turn record).
  if (!ended && compactionDone && !stepAfterCompaction && !inCompaction)
    ended = true;
  if (turnRecords !== stepUsages) gap("inconsistent_total");
  return { ended, usages, gaps };
}

/**
 * Reads the region from `offset`, waiting up to `timeoutMs` for its turn end
 * (the wire may be flushed just after the prompt response). An unreadable
 * wire or a region that never ends is a `parse_error` gap.
 */
export async function readKimiTurnUsage({
  path,
  offset,
  timeoutMs = 2_000,
  pollMs = 25,
  now = Date.now,
}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let text;
    try {
      text = readFrom(path, offset);
    } catch {
      return {
        usages: [],
        gaps: [providerUsageGap(KIMI_USAGE_PROVIDER, "parse_error", now)],
      };
    }
    const result = kimiTurnUsage(text, { now });
    if (result.ended || Date.now() >= deadline) {
      if (!result.ended)
        result.gaps.push(
          providerUsageGap(KIMI_USAGE_PROVIDER, "parse_error", now),
        );
      return {
        usages: result.usages,
        gaps: dedupeGaps(result.gaps),
      };
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

function dedupeGaps(gaps) {
  const seen = new Set();
  return gaps.filter((entry) =>
    seen.has(entry.reason) ? false : (seen.add(entry.reason), true),
  );
}

function readFrom(path, offset) {
  const fd = openSync(path, "r");
  try {
    const size = fstatSync(fd).size;
    const length = size - offset;
    if (length < 0) throw new Error("Kimi wire shrank");
    if (length > MAX_TURN_WIRE_BYTES) throw new Error("Kimi turn too large");
    const buffer = Buffer.alloc(length);
    let read = 0;
    while (read < length) {
      const count = readSync(fd, buffer, read, length - read, offset + read);
      if (count === 0) break;
      read += count;
    }
    return buffer.subarray(0, read).toString("utf8");
  } finally {
    closeSync(fd);
  }
}

function kimiUsage(value, responseId, observedAt) {
  if (!isRecord(value)) return undefined;
  const other = count(value.inputOther);
  const output = count(value.output);
  const cacheRead = count(value.inputCacheRead);
  const cacheCreation = count(value.inputCacheCreation) ?? 0;
  if (other === undefined || output === undefined || cacheRead === undefined)
    return undefined;
  return {
    provider: KIMI_USAGE_PROVIDER,
    responseId,
    inputTokens: other + cacheRead + cacheCreation,
    cachedInputTokens: cacheRead,
    outputTokens: output,
    reasoningOutputTokens: null,
    contextWindow: null,
    contextUsedTokens: null,
    observedAt,
  };
}

function count(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
