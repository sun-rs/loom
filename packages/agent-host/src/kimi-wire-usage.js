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
// An issued llm.request without its own step usage leaves the sums partial,
// including final-interrupted requests. A step.begin alone is not a request.
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
 * The wire's baseline right before `session/prompt`: its size (the offset
 * this prompt's records start at) and its file identity, so a replaced or
 * restored file is never read as this prompt's. `undefined` when the file
 * does not exist.
 */
export function kimiWireBaseline(path) {
  let stats;
  try {
    stats = statSync(path);
  } catch {
    return undefined;
  }
  return {
    offset: stats.size,
    identity: { dev: stats.dev, ino: stats.ino },
  };
}

/**
 * Usage of one prompt from the wire bytes appended since it was sent.
 *
 * Review 2026-09-26 P2-2: the region is attributed only between boundaries
 * kimi-code 0.39.1 writes itself. The turn starts at the `turn.prompt` record
 * (`TurnManager.prompt` logs it before launching the turn; its `input` is the
 * prompt's parts, ACP text blocks passed through unchanged) whose text is
 * `promptText` — records before it (a late tail of an earlier turn, an
 * earlier prompt) are never this prompt's. The turn's number is the `turnId`
 * of its step events; every later step event and the `turn.ended` must carry
 * the same number, and the turn stops at that `turn.ended`. A record of
 * another turn inside it breaks the boundary: a gap, never attributed.
 *
 * A prompt that only compacted (a manual compaction writes no turn records)
 * is accepted only with independent proof that the prompt settled
 * (`promptSettled`, the ACP prompt result) and a complete compaction with no
 * turn record in the region; a compaction inside a turn never ends it.
 * `ended` is false while the region may still grow into proof.
 */
export function kimiTurnUsage(
  text,
  { now = Date.now, promptText, promptSettled = false } = {},
) {
  const rawLines = String(text).split("\n");
  const usages = [];
  const gaps = [];
  const gap = (reason) => {
    if (!gaps.some((entry) => entry.reason === reason))
      gaps.push(providerUsageGap(KIMI_USAGE_PROVIDER, reason, now));
  };
  const records = [];
  for (let index = 0; index < rawLines.length; index += 1) {
    const raw = rawLines[index];
    if (raw.trim() === "") continue;
    try {
      const record = JSON.parse(raw);
      if (isRecord(record)) records.push(record);
    } catch {
      // The first line may be the torn tail of a pre-prompt record and the
      // last one a record still being written; neither is this prompt's.
      if (index !== 0 && index !== rawLines.length - 1) gap("parse_error");
    }
  }
  const observedAt = (record) =>
    typeof record.time === "number" && Number.isFinite(record.time)
      ? new Date(record.time).toISOString()
      : new Date(now()).toISOString();
  const seen = new Set();
  const collect = (usage) => {
    if (usage === undefined) return gap("parse_error");
    if (seen.has(usage.responseId)) return;
    seen.add(usage.responseId);
    usages.push(usage);
  };

  const start = records.findIndex(
    (record) =>
      record.type === "turn.prompt" &&
      (promptText === undefined || turnPromptText(record) === promptText),
  );
  if (start < 0) {
    return compactionOnlyPrompt(records, {
      collect,
      gap,
      gaps,
      observedAt,
      promptSettled,
      usages,
    });
  }
  // Without this prompt's text the first prompt record is only assumed to
  // be ours: usage before it makes the start unproven.
  if (
    promptText === undefined &&
    records.slice(0, start).some(carriesTurnUsage)
  )
    gap("parse_error");

  let ended = false;
  let turnId;
  let inCompaction = false;
  let turnRecords = 0;
  let stepUsages = 0;
  const requestsByStep = new Map();
  const usagesByStep = new Map();
  const sameTurn = (value) => {
    if (value === undefined || value === null) return false;
    const id = String(value);
    if (turnId === undefined) turnId = id;
    return id === turnId;
  };
  for (const record of records.slice(start + 1)) {
    const at = observedAt(record);
    if (record.type === "turn.prompt") {
      // Another prompt began before this turn ended: boundary broken.
      gap("parse_error");
      ended = true;
      break;
    }
    if (record.type === "turn.ended") {
      if (!sameTurn(record.turnId)) gap("parse_error");
      ended = true;
      break;
    }
    if (record.type === "llm.request" && record.kind === "loop") {
      if (
        record.agentId !== "main" ||
        typeof record.turnStep !== "string" ||
        record.turnStep === ""
      )
        gap("parse_error");
      else
        requestsByStep.set(
          record.turnStep,
          (requestsByStep.get(record.turnStep) ?? 0) + 1,
        );
    }
    if (record.type === "full_compaction.begin") inCompaction = true;
    else if (record.type === "full_compaction.complete") inCompaction = false;
    else if (record.type === "usage.record") {
      if (record.usageScope === "turn") turnRecords += 1;
      else if (inCompaction)
        collect(kimiUsage(record.usage, `compaction:${at}`, at));
      else gap("parse_error");
    } else if (record.type === "context.append_loop_event") {
      const event = isRecord(record.event) ? record.event : {};
      if (event.type === "step.begin" || event.type === "step.end") {
        if (!sameTurn(event.turnId)) {
          gap("parse_error");
          ended = true;
          break;
        }
      }
      if (event.type === "tool.call" && SUB_AGENT_TOOLS.has(event.name))
        gap("unsupported_provider");
      if (event.type !== "step.end" || event.usage === undefined) continue;
      stepUsages += 1;
      const usage =
        typeof event.messageId === "string" && event.messageId !== ""
          ? kimiUsage(event.usage, event.messageId, at)
          : undefined;
      // Duplicate response IDs remain one observation; another step cannot
      // borrow that receipt to cover a separately issued model request.
      if (
        usage !== undefined &&
        record.agentId === "main" &&
        !seen.has(usage.responseId)
      ) {
        const key = `${event.turnId}.${event.step}`;
        usagesByStep.set(key, (usagesByStep.get(key) ?? 0) + 1);
      }
      collect(usage);
    }
  }
  if (
    [...requestsByStep].some(
      ([key, count]) => count > (usagesByStep.get(key) ?? 0),
    )
  )
    gap("parse_error");
  if (turnRecords !== stepUsages) gap("inconsistent_total");
  return { ended, usages, gaps };
}

function compactionOnlyPrompt(
  records,
  { collect, gap, gaps, observedAt, promptSettled, usages },
) {
  const turnRecord = records.some(
    (record) =>
      record.type === "turn.prompt" ||
      record.type === "prompt.accepted" ||
      record.type === "turn.ended" ||
      (record.type === "context.append_loop_event" &&
        isRecord(record.event) &&
        (record.event.type === "step.begin" ||
          record.event.type === "step.end")),
  );
  const begin = records.findIndex(
    (record) => record.type === "full_compaction.begin",
  );
  const complete = records.findIndex(
    (record, index) =>
      index > begin && record.type === "full_compaction.complete",
  );
  if (!promptSettled || turnRecord || begin < 0 || complete < 0)
    return { ended: false, usages, gaps };
  for (const record of records.slice(begin + 1, complete)) {
    if (record.type !== "usage.record") continue;
    if (record.usageScope === "turn") gap("inconsistent_total");
    else {
      const at = observedAt(record);
      collect(kimiUsage(record.usage, `compaction:${at}`, at));
    }
  }
  if (records.slice(complete + 1).some(carriesTurnUsage)) gap("parse_error");
  return { ended: true, usages, gaps };
}

/** The text of a `turn.prompt` record's input parts. */
function turnPromptText(record) {
  if (!Array.isArray(record.input)) return undefined;
  let text = "";
  for (const part of record.input) {
    if (
      !isRecord(part) ||
      part.type !== "text" ||
      typeof part.text !== "string"
    )
      return undefined;
    text += part.text;
  }
  return text;
}

function carriesTurnUsage(record) {
  if (record.type === "usage.record") return true;
  return (
    record.type === "context.append_loop_event" &&
    isRecord(record.event) &&
    record.event.type === "step.end" &&
    record.event.usage !== undefined
  );
}

/**
 * Reads the region from `offset`, waiting up to `timeoutMs` for its turn end
 * (the wire may be flushed just after the prompt response). An unreadable
 * wire, a file whose identity differs from the baseline, or a region that
 * never ends is a `parse_error` gap.
 */
export async function readKimiTurnUsage({
  path,
  offset,
  identity,
  promptText,
  promptSettled = false,
  timeoutMs = 2_000,
  pollMs = 25,
  now = Date.now,
}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let text;
    try {
      text = readFrom(path, offset, identity);
    } catch {
      return {
        usages: [],
        gaps: [providerUsageGap(KIMI_USAGE_PROVIDER, "parse_error", now)],
      };
    }
    const result = kimiTurnUsage(text, { now, promptText, promptSettled });
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

function readFrom(path, offset, identity) {
  const fd = openSync(path, "r");
  try {
    const stats = fstatSync(fd);
    if (
      identity !== undefined &&
      (stats.dev !== identity.dev || stats.ino !== identity.ino)
    )
      throw new Error("Kimi wire replaced since the prompt baseline");
    const size = stats.size;
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
