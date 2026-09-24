// S2-c2: what the installed Kimi Code ACP server (kimi-code 0.39.1,
// `packages/acp-server/src/session.ts` and `events-map.ts` in its published
// bundle) actually puts on the wire, read without a model call.
//
// Compaction has no structured ACP event. The session pushes exactly one
// local `agent_message_chunk` per compaction fact through `emitLocalChunk`,
// always as ONE whole chunk (never streamed):
//   - `compaction.started` (auto-triggered only): "Compacting conversation
//     context…" or "Compacting conversation context with instruction: …"
//   - `compaction.completed` (auto or manual): `formatCompactionCompleted`,
//     "Compaction completed.\n- Messages compacted: N\n- Tokens before: N\n-
//     Tokens after: N" (numbers `toLocaleString("en-US")`)
//   - `compaction.cancelled` / `compaction.blocked`: fixed sentences.
// These chunks are not turn-scoped (no turn id), carry no compaction id and
// are pushed whether or not a prompt is in flight.
//
// Model output of a prompt IS turn-scoped: the session dispatches
// `assistant.delta`, `thinking.delta` and tool events only for the in-flight
// prompt's turn (`driverFor(turnId)`), and a second prompt while one is in
// flight is rejected (`assertNoActiveTurn`, -32600). A live prompt is never
// echoed back (`user_message_chunk` appears only in `session/load` replay).
const COMPACTION_COMPLETED =
  /^Compaction completed\.\n- Messages compacted: ([\d,]+)\n- Tokens before: ([\d,]+)\n- Tokens after: ([\d,]+)$/u;
const LOCAL_CHUNKS = [
  /^Compacting conversation context(?:…| with instruction: )/u,
  /^Compaction cancelled\.$/u,
  /^Compaction is blocked by the current turn; retry when the turn is idle\.$/u,
];

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function chunkText(update) {
  if (!isRecord(update) || update.sessionUpdate !== "agent_message_chunk")
    return undefined;
  const content = update.content;
  return isRecord(content) &&
    content.type === "text" &&
    typeof content.text === "string"
    ? content.text
    : undefined;
}

function count(value) {
  return Number(value.replaceAll(",", ""));
}

/** The `compaction.completed` summary chunk, parsed; otherwise undefined. */
export function kimiCompactionCompleted(update) {
  const text = chunkText(update);
  const match = text === undefined ? null : COMPACTION_COMPLETED.exec(text);
  if (match === null) return undefined;
  return {
    compactedCount: count(match[1]),
    tokensBefore: count(match[2]),
    tokensAfter: count(match[3]),
  };
}

/** The auto-compaction start chunk. */
export function isKimiCompactionStarted(update) {
  const text = chunkText(update);
  return text !== undefined && LOCAL_CHUNKS[0].test(text);
}

/** A session-local notice chunk: compaction progress, never model output. */
export function isKimiLocalChunk(update) {
  const text = chunkText(update);
  return (
    text !== undefined &&
    (COMPACTION_COMPLETED.test(text) ||
      LOCAL_CHUNKS.some((pattern) => pattern.test(text)))
  );
}

/**
 * A turn-scoped update produced by the model working on the in-flight prompt:
 * text, thinking, a tool call or its update, or a plan from a tool display.
 * Session notices (compaction chunks, `usage_update` after a turn settles,
 * config/mode/commands/session-info updates) are not.
 */
export function isKimiTurnModelUpdate(update) {
  if (!isRecord(update)) return false;
  const kind = update.sessionUpdate;
  if (kind === "agent_message_chunk") return !isKimiLocalChunk(update);
  return (
    kind === "agent_thought_chunk" ||
    kind === "tool_call" ||
    kind === "tool_call_update" ||
    kind === "plan"
  );
}
