import { writeSync } from "node:fs";

// Native per-generation token usage for the Host-private
// `rah-provider-usage/v1` fd3 frame. Every value is copied from Provider data;
// nothing here estimates, and a shape that cannot be proven yields no record.
// A lost or unprovable generation instead yields a `rah-provider-usage-gap/v1`
// frame, so the Kernel can report the RunAttempt's usage as partial rather
// than silently undercounting it; a gap never becomes a generation.
// Normalized semantics (see @rah-os/protocol runtime-usage.ts): inputTokens
// includes cached reads and cache writes, outputTokens includes reasoning.

const MAX_OPEN_CLAUDE_MESSAGES = 64;

/**
 * Codex app-server `thread/tokenUsage/updated` (codex-cli 0.156 schema:
 * v2/ThreadTokenUsageUpdatedNotification). `tokenUsage.last` is the usage of
 * the latest model response, `tokenUsage.total` the thread cumulative. The
 * notification carries no response id and may repeat unchanged, so the
 * cumulative total is the generation fingerprint: a record is emitted only when
 * the total advances by exactly `last`. An exact repeat is silent. A jump that
 * does not match `last` (missed or recomputed usage) is an `inconsistent_total`
 * gap, and a same-or-lower total that differs from the last one seen (a
 * Provider revision of reported usage) is a `correction_frame` gap; in both
 * cases the observed total becomes the next baseline and nothing is guessed. A
 * resumed thread has no known baseline, so its first consistent `last` is
 * accepted as is.
 */
export class CodexTokenUsageTracker {
  #now;
  #previousTotal;
  #previousLast;

  constructor({ freshThread, now = Date.now }) {
    this.#now = now;
    this.#previousTotal = freshThread
      ? {
          cachedInputTokens: 0,
          inputTokens: 0,
          outputTokens: 0,
          reasoningOutputTokens: 0,
          totalTokens: 0,
        }
      : undefined;
  }

  observe(frame) {
    if (!isRecord(frame) || frame.method !== "thread/tokenUsage/updated") {
      return undefined;
    }
    const params = record(frame.params);
    const turnId = string(params.turnId);
    const tokenUsage = record(params.tokenUsage);
    const last = codexBreakdown(tokenUsage.last);
    const total = codexBreakdown(tokenUsage.total);
    if (turnId === undefined || last === undefined || total === undefined) {
      return this.#gap("parse_error");
    }
    const previous = this.#previousTotal;
    const previousLast = this.#previousLast;
    this.#previousTotal = total;
    this.#previousLast = last;
    if (previous !== undefined && total.totalTokens <= previous.totalTokens) {
      const repeat =
        sameBreakdown(total, previous) &&
        (previousLast === undefined || sameBreakdown(last, previousLast));
      return repeat ? undefined : this.#gap("correction_frame");
    }
    const consistent =
      last.totalTokens > 0 &&
      CODEX_FIELDS.every((field) =>
        previous === undefined
          ? total[field] >= last[field]
          : total[field] - previous[field] === last[field],
      );
    if (!consistent) return this.#gap("inconsistent_total");
    const contextWindow = positiveInteger(tokenUsage.modelContextWindow);
    return (
      usageRecord({
        provider: CODEX_PROVIDER,
        responseId: `${turnId}:${total.totalTokens}`,
        inputTokens: last.inputTokens,
        cachedInputTokens: last.cachedInputTokens,
        outputTokens: last.outputTokens,
        reasoningOutputTokens: last.reasoningOutputTokens,
        contextWindow: contextWindow ?? null,
        contextUsedTokens:
          contextWindow === undefined ? null : last.totalTokens,
        observedAt: new Date(this.#now()).toISOString(),
      }) ?? this.#gap("parse_error")
    );
  }

  #gap(reason) {
    return providerUsageGap(CODEX_PROVIDER, reason, this.#now);
  }
}

const CODEX_PROVIDER = "codex-app-server/v1";

function sameBreakdown(left, right) {
  return CODEX_FIELDS.every((field) => left[field] === right[field]);
}

/** A capture gap for one RunAttempt; see ProviderUsageGapReasonSchema. */
export function providerUsageGap(provider, reason, now = Date.now) {
  return { provider, reason, observedAt: new Date(now()).toISOString() };
}

const CODEX_FIELDS = [
  "cachedInputTokens",
  "inputTokens",
  "outputTokens",
  "reasoningOutputTokens",
  "totalTokens",
];

function codexBreakdown(value) {
  if (!isRecord(value)) return undefined;
  const parsed = {};
  for (const field of CODEX_FIELDS) {
    const count = tokenCount(value[field]);
    if (count === undefined) return undefined;
    parsed[field] = count;
  }
  return parsed;
}

/**
 * Claude Code stream-json with `--include-partial-messages`: each generation is
 * one Anthropic `message_start` (message id plus input/cache usage) followed by
 * `message_delta` (cumulative output usage) and `message_stop`. The whole
 * `assistant` frames repeat message_start usage with stale output counts, and
 * `result.usage` is a whole-query cumulative, so neither is used. A message
 * that never reaches `message_stop` (interrupted) yields no record. Claude does
 * not split thinking tokens out of output, so reasoning stays null.
 */
export class ClaudeStreamUsageTracker {
  #now;
  #open = new Map();

  constructor({ now = Date.now } = {}) {
    this.#now = now;
  }

  observe(frame) {
    if (!isRecord(frame) || frame.type !== "stream_event") return undefined;
    const key =
      typeof frame.parent_tool_use_id === "string"
        ? frame.parent_tool_use_id
        : "";
    const event = record(frame.event);
    if (event.type === "message_start") {
      const message = record(event.message);
      const id = string(message.id);
      this.#open.delete(key);
      if (this.#open.size >= MAX_OPEN_CLAUDE_MESSAGES) {
        this.#open.delete(this.#open.keys().next().value);
      }
      this.#open.set(key, { id, usage: claudeCounts(message.usage) });
      return undefined;
    }
    if (event.type === "message_delta") {
      const open = this.#open.get(key);
      if (open !== undefined) {
        Object.assign(open.usage, claudeCounts(event.usage));
      }
      return undefined;
    }
    if (event.type !== "message_stop") return undefined;
    const open = this.#open.get(key);
    this.#open.delete(key);
    if (open === undefined) return undefined;
    const usage = open.usage;
    if (
      open.id === undefined ||
      usage.input_tokens === undefined ||
      usage.output_tokens === undefined
    ) {
      return providerUsageGap(CLAUDE_PROVIDER, "parse_error", this.#now);
    }
    const cachedRead = usage.cache_read_input_tokens ?? 0;
    const counted = usageRecord({
      provider: CLAUDE_PROVIDER,
      responseId: open.id,
      inputTokens:
        usage.input_tokens +
        (usage.cache_creation_input_tokens ?? 0) +
        cachedRead,
      cachedInputTokens: cachedRead,
      outputTokens: usage.output_tokens,
      reasoningOutputTokens: null,
      contextWindow: null,
      contextUsedTokens: null,
      observedAt: new Date(this.#now()).toISOString(),
    });
    return (
      counted ?? providerUsageGap(CLAUDE_PROVIDER, "parse_error", this.#now)
    );
  }
}

const CLAUDE_PROVIDER = "claude-stream-json/v1";

const CLAUDE_FIELDS = [
  "cache_creation_input_tokens",
  "cache_read_input_tokens",
  "input_tokens",
  "output_tokens",
];

function claudeCounts(value) {
  const counts = {};
  if (!isRecord(value)) return counts;
  for (const field of CLAUDE_FIELDS) {
    const count = tokenCount(value[field]);
    if (count !== undefined) counts[field] = count;
  }
  return counts;
}

/**
 * OpenCode 1.18 `step-finish` part (one per model step). Its `tokens` come from
 * OpenCode's usage normalization: `input` excludes cache reads and writes and
 * `output` excludes reasoning, so both are added back here.
 */
export function openCodeStepFinishUsage(part, now = Date.now) {
  if (!isRecord(part) || part.type !== "step-finish") return undefined;
  const id = string(part.id);
  const tokens = record(part.tokens);
  const cache = record(tokens.cache);
  const input = tokenCount(tokens.input);
  const output = tokenCount(tokens.output);
  const reasoning = tokenCount(tokens.reasoning);
  const cacheRead = tokenCount(cache.read);
  const cacheWrite = tokenCount(cache.write);
  if (
    id === undefined ||
    input === undefined ||
    output === undefined ||
    cacheRead === undefined ||
    cacheWrite === undefined
  ) {
    return providerUsageGap(OPENCODE_PROVIDER, "parse_error", now);
  }
  const usage = usageRecord({
    provider: OPENCODE_PROVIDER,
    responseId: id,
    inputTokens: input + cacheRead + cacheWrite,
    cachedInputTokens: cacheRead,
    outputTokens: output + (reasoning ?? 0),
    reasoningOutputTokens: reasoning ?? null,
    contextWindow: null,
    contextUsedTokens: null,
    observedAt: new Date(now()).toISOString(),
  });
  return usage ?? providerUsageGap(OPENCODE_PROVIDER, "parse_error", now);
}

const OPENCODE_PROVIDER = "opencode-server/v1";

/**
 * One usage frame per response id per driver process; every gap is written
 * (the Kernel aggregates them per reason). fd3 failures stay silent.
 */
export class ProviderUsageWriter {
  #emitted = new Set();
  #write;

  constructor(write = defaultWrite) {
    this.#write = write;
  }

  emit(usage) {
    if (usage === undefined) return;
    let frame;
    if (usage.reason !== undefined) {
      frame = { protocol: "rah-provider-usage-gap/v1", ...usage };
    } else {
      if (this.#emitted.has(usage.responseId)) return;
      this.#emitted.add(usage.responseId);
      frame = { protocol: "rah-provider-usage/v1", ...usage };
    }
    try {
      this.#write(`${JSON.stringify(frame)}\n`);
    } catch {
      // Usage is diagnostics; a missing Host listener cannot fail the turn.
    }
  }
}

function usageRecord(usage) {
  if (
    usage.cachedInputTokens > usage.inputTokens ||
    (usage.reasoningOutputTokens !== null &&
      usage.reasoningOutputTokens > usage.outputTokens) ||
    !Number.isSafeInteger(usage.inputTokens) ||
    !Number.isSafeInteger(usage.outputTokens)
  ) {
    return undefined;
  }
  return usage;
}

function defaultWrite(value) {
  writeSync(3, value);
}

function tokenCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function string(value) {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function record(value) {
  return isRecord(value) ? value : {};
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
