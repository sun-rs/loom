// Claude Code evidence for the paid gates. Pure: parses recorded stream-json
// output and session transcripts; the paid runners supply the bytes.
//
// Usage is counted exactly as the product does (ClaudeStreamUsageTracker over
// `stream_event` message_start/delta/stop, one record per response id, input =
// uncached + cache writes + cache reads), so the native arm and the product's
// recorded RAH usage share one accounting. The session transcript is an
// independent cross-check (one line per content block, usage repeated per
// line of a message id, so it is deduplicated by message id).
import { ClaudeStreamUsageTracker } from "../../packages/agent-host/src/provider-usage.js";

const WORKER_POST = /message-post/;
const WORKER_CHECK = /message-check/;
// Same patterns as drift-checks.mjs `codexToolCalls`.
const WORKER_TASK = /task-(create|claim|update)|tasks?\s+create/;

// One tool call → Worker call kind (boolean handle flag only; the handle
// itself is never recorded). Mirrors common.mjs `measure` for Codex.
export function workerCall(name, args, at) {
  const kind = WORKER_POST.test(args)
    ? "box-post"
    : WORKER_CHECK.test(args)
      ? "box-check"
      : WORKER_TASK.test(args)
        ? "task-command"
        : "other";
  return {
    at,
    name,
    kind,
    ...(kind === "box-post" || kind === "box-check"
      ? { turnHandle: /--turn\b/.test(args) }
      : {}),
    ...(kind === "box-post" ? { final: /--final\b/.test(args) } : {}),
  };
}

// tool_use content blocks → Worker call kinds.
export function claudeToolCalls(content, at) {
  return (Array.isArray(content) ? content : [])
    .filter((block) => block?.type === "tool_use")
    .map((block) =>
      workerCall(block.name, JSON.stringify(block.input ?? {}), at),
    );
}

const textOf = (content) =>
  (Array.isArray(content) ? content : [])
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("");

// entries: [{ line: string, at: epoch ms }] in arrival order.
export function parseClaudeStreamRound(entries) {
  let now = 0;
  const tracker = new ClaudeStreamUsageTracker({ now: () => now });
  const out = {
    sessionId: undefined,
    sessionIds: [],
    initModel: undefined,
    models: [],
    answer: undefined,
    lastText: undefined,
    finalAt: undefined,
    result: undefined,
    generations: [],
    gaps: [],
    toolCalls: [],
    compactBoundaries: [],
  };
  const addUnique = (list, value) => {
    if (typeof value === "string" && !list.includes(value)) list.push(value);
  };
  for (const { line, at } of entries) {
    let frame;
    try {
      frame = JSON.parse(line);
    } catch {
      continue;
    }
    if (frame === null || typeof frame !== "object") continue;
    now = at;
    addUnique(out.sessionIds, frame.session_id);
    out.sessionId ??= frame.session_id;
    const observed = tracker.observe(frame);
    if (observed?.reason !== undefined) out.gaps.push(observed);
    else if (observed !== undefined) out.generations.push(observed);
    if (frame.type === "system" && frame.subtype === "init")
      out.initModel ??= frame.model;
    if (frame.type === "system" && frame.subtype === "compact_boundary")
      out.compactBoundaries.push({
        trigger: frame.compact_metadata?.trigger ?? null,
        preTokens: frame.compact_metadata?.pre_tokens ?? null,
      });
    if (frame.type === "assistant" && frame.parent_tool_use_id == null) {
      const message = frame.message ?? {};
      addUnique(out.models, message.model);
      out.toolCalls.push(
        ...claudeToolCalls(message.content, new Date(at).toISOString()),
      );
      const text = textOf(message.content);
      if (text) {
        out.lastText = text;
        out.finalAt = at;
      }
    }
    if (frame.type === "result")
      out.result = {
        subtype: frame.subtype,
        isError: frame.is_error === true,
        numTurns: frame.num_turns ?? null,
        at,
      };
    if (frame.type === "result" && typeof frame.result === "string")
      out.answer = frame.result;
  }
  out.answer ??= out.lastText;
  delete out.lastText;
  return out;
}

const iso = (value) => {
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
};

// text: the transcript file; window: { from, to } ISO bounds (inclusive).
export function claudeTranscriptRound(text, { from, to } = {}) {
  const lo = from === undefined ? -Infinity : iso(from);
  const hi = to === undefined ? Infinity : iso(to);
  const byId = new Map();
  const models = [];
  const efforts = [];
  const sidechain = new Set();
  const toolCalls = [];
  let compactBoundaries = 0;
  let targetRejections = 0;
  let cwd;
  for (const raw of String(text).split("\n")) {
    if (!raw.trim()) continue;
    let e;
    try {
      e = JSON.parse(raw);
    } catch {
      continue;
    }
    cwd ??= typeof e.cwd === "string" ? e.cwd : undefined;
    const at = iso(e.timestamp);
    if (at === null || at < lo || at > hi) continue;
    if (e.type === "system" && e.subtype === "compact_boundary")
      compactBoundaries += 1;
    // Kernel's definite reply-target refusal in a Worker call result.
    if (e.type === "user" && Array.isArray(e.message?.content))
      targetRejections += e.message.content.filter(
        (block) =>
          block?.type === "tool_result" &&
          /\breply_target_mismatch\b/.test(
            typeof block.content === "string"
              ? block.content
              : JSON.stringify(block.content ?? ""),
          ),
      ).length;
    if (e.type !== "assistant") continue;
    const m = e.message ?? {};
    if (m.model === "<synthetic>" || typeof m.id !== "string") continue;
    if (e.isSidechain === true) {
      sidechain.add(m.id);
      continue;
    }
    if (!models.includes(m.model)) models.push(m.model);
    if (typeof e.effort === "string" && !efforts.includes(e.effort))
      efforts.push(e.effort);
    toolCalls.push(...claudeToolCalls(m.content, e.timestamp));
    if (byId.has(m.id)) continue;
    const u = m.usage ?? {};
    const cachedRead = u.cache_read_input_tokens ?? 0;
    byId.set(m.id, {
      responseId: m.id,
      inputTokens:
        (u.input_tokens ?? 0) +
        (u.cache_creation_input_tokens ?? 0) +
        cachedRead,
      cachedInputTokens: cachedRead,
      outputTokens: u.output_tokens ?? 0,
      reasoningOutputTokens: null,
      observedAt: e.timestamp,
    });
  }
  const generations = [...byId.values()];
  const sum = (key) => generations.reduce((a, g) => a + g[key], 0);
  return {
    cwd,
    generations,
    totals: {
      generations: generations.length,
      inputTokens: sum("inputTokens"),
      cachedInputTokens: sum("cachedInputTokens"),
      outputTokens: sum("outputTokens"),
    },
    models,
    efforts,
    sidechainGenerations: sidechain.size,
    compactBoundaries,
    targetRejections,
    toolCalls,
  };
}

// Claude Code publishes family aliases (`sonnet`) that resolve to a concrete
// release; an alias binding matches only that family's model ids.
export function claudeModelMatches(approved, actual) {
  if (typeof actual !== "string" || !approved) return false;
  if (actual === approved) return true;
  if (!/^[a-z]+$/u.test(approved)) return false;
  return new RegExp(`^claude-${approved}(-|$)`, "u").test(actual);
}

// Native arm: the installed CLI directly, one process per round, the same
// session resumed (never forked) after round 1.
export function claudeNativeArgs({ model, effort, prompt, sessionId }) {
  if (!model || !effort || typeof prompt !== "string")
    throw new Error("Native Claude args need model, effort and prompt");
  return [
    "-p",
    prompt,
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--dangerously-skip-permissions",
    "--model",
    model,
    "--effort",
    effort,
    ...(sessionId ? ["--resume", sessionId] : []),
  ];
}
