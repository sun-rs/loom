import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
const parse = (text) => {
  assert.ok(
    typeof text === "string" && text.endsWith("\n"),
    "complete Pi JSONL required",
  );
  return text.trim().split("\n").map(JSON.parse);
};
const body = (message) =>
  (message.content ?? [])
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("");
/** Shared stdout terminal shape; session binding remains in inspectPiTurn. */
export function piTerminalCompactions(frames) {
  if (
    frames.filter((x) => x.type === "agent_start").length !== 1 ||
    frames.filter((x) => x.type === "agent_end").length !== 1 ||
    frames.filter((x) => x.type === "agent_settled").length !== 1 ||
    frames.at(-1)?.type !== "agent_settled" ||
    frames.at(-1).aborted !== false ||
    frames.find((x) => x.type === "agent_end").willRetry !== false
  )
    return undefined;
  // Pi 1.1.0 may persist threshold compaction after agent_end, before settled.
  // Only that closed native tail is allowed; it is never a new final or usage record.
  const tail = frames.slice(
    frames.findIndex((x) => x.type === "agent_end") + 1,
    -1,
  );
  if (tail.length !== 0 && tail.length !== 2) return undefined;
  const compactions = [];
  for (let i = 0; i < tail.length; i += 2) {
    const start = tail[i],
      end = tail[i + 1];
    if (
      start.type !== "compaction_start" ||
      start.reason !== "threshold" ||
      end.type !== "compaction_end" ||
      end.reason !== start.reason ||
      end.aborted !== false ||
      end.willRetry !== false ||
      !end.result ||
      typeof end.result.summary !== "string" ||
      typeof end.result.firstKeptEntryId !== "string" ||
      !Number.isSafeInteger(end.result.tokensBefore) ||
      end.result.tokensBefore < 0
    )
      return undefined;
    compactions.push(end.result);
  }
  return compactions;
}
/** Native evidence only. Kernel remains the sole owner of publication and ACK. */
export function inspectPiTurn(e) {
  const frames = parse(e.stdout),
    tree = parse(e.sessionAfter),
    before = e.sessionBefore ? parse(e.sessionBefore) : [];
  assert.ok(
    e.sessionAfter.startsWith(e.sessionBefore),
    "Pi session must be append-only",
  );
  assert.equal(tree[0].type, "session");
  assert.ok(typeof tree[0].id === "string" && tree[0].id.trim());
  const sessionId = tree[0].id;
  assert.equal(frames[0].type, "session");
  assert.equal(frames[0].id, sessionId);
  assert.equal(frames.filter((f) => f.type === "session").length, 1);
  if (e.expectedSessionId) assert.equal(sessionId, e.expectedSessionId);
  const appended = tree
    .slice(before.length)
    .filter((x) => x.type !== "session");
  let previous = before.filter((x) => x.type !== "session").at(-1)?.id ?? null;
  for (const x of appended) {
    assert.ok(typeof x.id === "string" && x.id);
    assert.equal(x.parentId, previous, "Pi current branch required");
    previous = x.id;
  }
  const users = appended.filter((x) => x.message?.role === "user");
  assert.equal(users.length, 1);
  assert.equal(body(users[0].message), e.prompt);
  const model = tree.filter((x) => x.type === "model_change").at(-1),
    thinking = tree.filter((x) => x.type === "thinking_level_change").at(-1);
  assert.equal(model?.provider, e.provider);
  assert.equal(model?.modelId, e.model);
  assert.equal(thinking?.thinkingLevel, e.reasoning);
  const messages = frames
    .filter((x) => x.type === "message_end" && x.message?.role === "assistant")
    .map((x) => x.message);
  const persisted = appended
    .filter((x) => x.message?.role === "assistant")
    .map((x) => x.message);
  assert.deepEqual(
    messages,
    persisted,
    "Pi stdout/session response evidence differs",
  );
  for (const m of messages) {
    assert.equal(m.provider, e.provider);
    assert.equal(m.model, e.model);
    assert.equal(m.thinkingLevel, e.reasoning);
    assert.ok(typeof m.responseId === "string" && m.responseId.trim());
  }
  const input = { sessionId, turnId: users[0].id };
  const result = { input, messages };
  if (e.exit.code !== 0 || e.exit.signal != null) return result;
  const compactions = piTerminalCompactions(frames);
  if (!compactions) return result;
  let openAssistant = false;
  for (const frame of frames) {
    if (frame.type === "message_start" && frame.message?.role === "assistant") {
      if (openAssistant) return result;
      openAssistant = true;
    }
    if (frame.type === "message_end" && frame.message?.role === "assistant")
      openAssistant = false;
  }
  if (openAssistant) return result;
  const pending = new Set();
  for (const x of frames.filter((x) => x.type === "message_end")) {
    for (const c of x.message?.content ?? [])
      if (c.type === "toolCall") {
        if (pending.has(c.id)) return result;
        pending.add(c.id);
      }
    if (x.message?.role === "toolResult") {
      if (
        !pending.delete(x.message.toolCallId) ||
        typeof x.message.isError !== "boolean"
      )
        return result;
    }
  }
  const final = messages.at(-1);
  if (
    pending.size ||
    !final ||
    final.stopReason !== "stop" ||
    final.rawStopReason !== "stop" ||
    messages.some((x) => !["stop", "toolUse"].includes(x.stopReason))
  )
    return result;
  const entryIndex = appended.length - compactions.length - 1;
  const entry = appended[entryIndex];
  for (let i = 0; i < compactions.length; i++) {
    const saved = appended[entryIndex + i + 1],
      emitted = compactions[i];
    if (
      saved?.type !== "compaction" ||
      ![
        "summary",
        "firstKeptEntryId",
        "tokensBefore",
        "details",
        "usage",
      ].every((key) => isDeepStrictEqual(saved[key], emitted[key]))
    )
      return result;
  }
  if (
    entry?.message?.responseId !== final.responseId ||
    !final.content.every((x) => ["text", "thinking"].includes(x.type))
  )
    return result;
  const text = body(final);
  if (!text.trim() || Buffer.byteLength(text) > 65536) return result;
  return {
    ...result,
    final: { text, sessionId, turnId: input.turnId, nativeMessageId: entry.id },
  };
}
