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
// product's Kimi ACP driver records no usage), so both are counted alike.
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
  return {
    generations: [...byId.values()],
    requests,
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
