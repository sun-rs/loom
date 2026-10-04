// Kimi Code evidence for the paid efficiency gate. Pure: parses recorded
// print-mode output and the session wire; the paid runner supplies the bytes.
//
// `kimi -p --output-format stream-json` (kimi-code 0.39) prints assistant /
// tool / meta messages and a `session.resume_hint` with the session id, but
// no usage. Per-generation usage exists only in the session wire
// (`agents/main/wire.jsonl`): each LLM step ends with a `step.end` loop event
// carrying `messageId` and `usage {inputOther, output, inputCacheRead,
// inputCacheCreation}`; each request is logged as `llm.request` with its
// `modelAlias` and `thinkingEffort`. The same wire serves both arms (the
// product's Kimi ACP driver also records these wire generations), so both
// are counted alike and the gate cross-checks the product ledger.
import { jsonArgs, workerCall } from "./claude-usage.mjs";

export const KIMI_THINKING_ENV = "KIMI_MODEL_THINKING_EFFORT";

// Native arm: one process per round, the same session resumed after round 1.
// Thinking has no print-mode flag; the approved level goes through
// KIMI_MODEL_THINKING_EFFORT and is verified afterwards in the wire.
export function kimiNativeArgs({ model, prompt, sessionId }) {
  if (!model || typeof prompt !== "string")
    throw new Error("Native Kimi args need model and prompt");
  return [
    "-p",
    prompt,
    "--output-format",
    "stream-json",
    "-m",
    model,
    ...(sessionId ? ["--session", sessionId] : []),
  ];
}

const FORBIDDEN = new Set([
  "-c",
  "--continue",
  "--agent",
  "--agent-file",
  "--plan",
  "-S",
  "--skills-dir",
]);

// Fail-closed pre-launch fence for the native print arm.
export function checkKimiPrintLaunch(args, env, approved) {
  if (args[0] !== "-p" && args[0] !== "--prompt")
    throw new Error("Unsupported gate CLI command (print mode only)");
  const models = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "-m" || a === "--model") models.push(args[++i]);
    else if (a.startsWith("--model=")) models.push(a.slice(8));
    else if (FORBIDDEN.has(a.split("=")[0]))
      throw new Error(`Unsupported gate argument ${a}`);
  }
  if (models.length !== 1 || models[0] !== approved.model)
    throw new Error("Unapproved model (exactly one approved -m required)");
  if (env[KIMI_THINKING_ENV] !== approved.effort)
    throw new Error("Unapproved thinking environment");
}

// entries: [{ line, at }] of print-mode stdout.
export function parseKimiPrintRound(entries) {
  const out = {
    sessionId: undefined,
    answer: undefined,
    finalAt: undefined,
    retries: 0,
    toolCalls: [],
  };
  for (const { line, at } of entries) {
    let m;
    try {
      m = JSON.parse(line);
    } catch {
      continue;
    }
    if (m?.role === "meta" && m.type === "session.resume_hint")
      out.sessionId = m.session_id;
    if (m?.role === "meta" && m.type === "turn.step.retrying") out.retries += 1;
    if (m?.role !== "assistant") continue;
    for (const call of Array.isArray(m.tool_calls) ? m.tool_calls : [])
      out.toolCalls.push(
        workerCall(
          call.function?.name,
          String(call.function?.arguments ?? ""),
          new Date(at).toISOString(),
        ),
      );
    if (typeof m.content === "string" && m.content.trim()) {
      out.answer = m.content;
      out.finalAt = at;
    }
  }
  return out;
}

const bound = (value, fallback) => {
  if (value === undefined) return fallback;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : fallback;
};

// text: wire.jsonl; window: { from, to } ISO bounds (inclusive).
export function kimiWireRound(text, { from, to } = {}) {
  const lo = bound(from, -Infinity);
  const hi = bound(to, Infinity);
  const byId = new Map();
  const steps = new Map();
  const requests = [];
  const toolCalls = [];
  let usageRecords = 0;
  let compactions = 0;
  for (const raw of String(text).split("\n")) {
    if (!raw.trim()) continue;
    let r;
    try {
      r = JSON.parse(raw);
    } catch {
      continue;
    }
    if (typeof r?.time !== "number" || r.time < lo || r.time > hi) continue;
    const at = new Date(r.time).toISOString();
    const event = r.event ?? {};
    const turnStep =
      r.type === "llm.request"
        ? r.turnStep
        : typeof event.turnId === "string" && Number.isInteger(event.step)
          ? `${event.turnId}.${event.step}`
          : undefined;
    const key =
      typeof r.agentId === "string" && typeof turnStep === "string"
        ? JSON.stringify([r.agentId, turnStep])
        : undefined;
    if (key !== undefined) {
      const step = steps.get(key) ?? { begins: [], requests: [], ends: [] };
      if (r.type === "llm.request" && r.kind === "loop") step.requests.push(r);
      if (r.type === "context.append_loop_event" && event.type === "step.begin")
        step.begins.push(r);
      if (r.type === "context.append_loop_event" && event.type === "step.end")
        step.ends.push(r);
      steps.set(key, step);
    }
    if (r.type === "llm.request")
      requests.push({
        kind: r.kind ?? null,
        modelAlias: r.modelAlias ?? null,
        thinkingEffort: r.thinkingEffort ?? null,
      });
    if (r.type === "usage.record") usageRecords += 1;
    if (/compact/iu.test(String(r.type))) compactions += 1;
    if (r.type !== "context.append_loop_event") continue;
    const e = r.event ?? {};
    if (e.type === "tool.call")
      toolCalls.push(workerCall(e.name, jsonArgs(e.args), at));
    if (e.type !== "step.end" || !e.usage || typeof e.messageId !== "string")
      continue;
    if (byId.has(e.messageId)) continue;
    const u = e.usage;
    const n = (v) => (Number.isSafeInteger(v) && v >= 0 ? v : 0);
    byId.set(e.messageId, {
      responseId: e.messageId,
      inputTokens:
        n(u.inputOther) + n(u.inputCacheRead) + n(u.inputCacheCreation),
      cachedInputTokens: n(u.inputCacheRead),
      outputTokens: n(u.output),
      reasoningOutputTokens: null,
      observedAt: at,
    });
  }
  // Requests and reported generations are different evidence. A cancelled
  // request without usage is not a zero-token generation or a free request.
  const matchedIds = new Set();
  const endCounts = new Map();
  for (const step of steps.values())
    for (const end of step.ends) {
      const id = end.event.messageId;
      if (typeof id === "string")
        endCounts.set(id, (endCounts.get(id) ?? 0) + 1);
    }
  for (const step of steps.values()) {
    if (step.requests.length !== 1 || step.ends.length !== 1) continue;
    const request = step.requests[0],
      end = step.ends[0],
      id = end.event.messageId;
    if (request.time <= end.time && endCounts.get(id) === 1 && byId.has(id))
      matchedIds.add(id);
  }
  const requestCoverage = {
    status:
      matchedIds.size === requests.length && matchedIds.size === byId.size
        ? "complete"
        : "incomplete",
    requests: requests.length,
    matchedRequests: matchedIds.size,
    unreportedRequests: requests.length - matchedIds.size,
    unmatchedUsageRecords: byId.size - matchedIds.size,
  };
  // Exact native keys, not adjacency: retries/duplicate steps remain unknown.
  for (const { begins, requests, ends } of steps.values()) {
    if (begins.length !== 1 || requests.length !== 1 || ends.length !== 1)
      continue;
    const [begin] = begins,
      [request] = requests,
      [end] = ends;
    if (
      typeof begin.event.uuid !== "string" ||
      begin.event.uuid !== end.event.uuid ||
      begin.time > request.time ||
      request.time > end.time
    )
      continue;
    const generation = byId.get(end.event.messageId);
    if (generation) generation.startedAt = new Date(request.time).toISOString();
  }
  return {
    generations: [...byId.values()],
    requests,
    requestCoverage,
    usageRecords,
    compactions,
    toolCalls,
  };
}

// Native compactions in the wire window (`full_compaction.begin` →
// `context.apply_compaction` → `full_compaction.complete`). `completed` only
// when both the applied context and the completion record exist; the token
// counts are Kimi's own before/after of the compaction itself.
export function kimiWireCompactions(text, { from, to } = {}) {
  const lo = bound(from, -Infinity);
  const hi = bound(to, Infinity);
  const out = [];
  let current;
  for (const raw of String(text).split("\n")) {
    if (!raw.trim()) continue;
    let r;
    try {
      r = JSON.parse(raw);
    } catch {
      continue;
    }
    if (typeof r?.time !== "number" || r.time < lo || r.time > hi) continue;
    const at = new Date(r.time).toISOString();
    if (r.type === "full_compaction.begin") {
      current = {
        source: r.source ?? null,
        beganAt: at,
        applied: false,
        completed: false,
        tokensBefore: null,
        tokensAfter: null,
      };
      out.push(current);
    } else if (r.type === "context.apply_compaction" && current) {
      current.applied = true;
      const n = (v) => (Number.isSafeInteger(v) && v >= 0 ? v : null);
      current.tokensBefore = n(r.tokensBefore);
      current.tokensAfter = n(r.tokensAfter);
    } else if (r.type === "full_compaction.complete" && current) {
      current.completed = current.applied;
      current.completedAt = at;
      current = undefined;
    }
  }
  return out;
}

// Post-hoc fence: every model request in the window used exactly the
// approved alias and thinking level.
export function assertKimiRequests(requests, approved) {
  if (!requests.length) throw new Error("Kimi wire has no model request");
  for (const r of requests) {
    if (r.modelAlias !== approved.model)
      throw new Error(`Unapproved model in Kimi wire (${r.modelAlias})`);
    if (r.thinkingEffort !== approved.effort)
      throw new Error(`Unapproved thinking in Kimi wire (${r.thinkingEffort})`);
  }
}
