import { isDeepStrictEqual } from "node:util";

/**
 * Prove the native continuation from one contiguous latest-message page.
 * Both endpoints must be present: never guess across a truncated page. The
 * caller owns the accepted prompt's HTTP response boundary, not the live bus.
 */
export function openCodeCompactionParent(response, messages, expected) {
  if (!Array.isArray(messages) || !expected.sessionId || !expected.parentId)
    return undefined;
  const start = messages.findIndex((m) => m?.info?.id === expected.parentId);
  if (start < 0 || messages[start]?.info?.role !== "user") return undefined;
  const window = messages.slice(start);
  if (!isDeepStrictEqual(window.at(-1), response)) return undefined;
  const ids = new Set();
  let parent = expected.parentId;
  let accepted = false;
  let stage = "business";
  let compacted = false;
  for (let index = 0; index < window.length; index++) {
    const message = window[index];
    const info = message?.info;
    if (
      !info ||
      info.sessionID !== expected.sessionId ||
      typeof info.id !== "string" ||
      !info.id ||
      ids.has(info.id) ||
      !Array.isArray(message.parts)
    )
      return undefined;
    ids.add(info.id);
    if (
      message.parts.some(
        (p) => p?.sessionID !== expected.sessionId || p.messageID !== info.id,
      )
    )
      return undefined;
    if (index === 0) continue;
    if (info.role === "assistant") {
      if (info.parentID !== parent) return undefined;
      if (stage === "summary") {
        if (
          info.summary !== true ||
          info.finish !== "stop" ||
          info.error !== undefined ||
          !Number.isFinite(info.time?.completed)
        )
          return undefined;
        stage = "continue";
      } else if (stage === "business" && info.summary !== true) {
        accepted = true;
      } else return undefined;
      continue;
    }
    if (info.role !== "user" || message.parts.length !== 1) return undefined;
    const part = message.parts[0];
    if (
      stage === "business" &&
      accepted &&
      part.type === "compaction" &&
      part.auto === true &&
      typeof part.overflow === "boolean"
    ) {
      stage = "summary";
      parent = info.id;
      continue;
    }
    if (
      stage === "continue" &&
      part.type === "text" &&
      part.synthetic === true &&
      part.metadata?.compaction_continue === true &&
      part.ignored !== true &&
      typeof part.text === "string" &&
      part.text.length > 0
    ) {
      stage = "business";
      parent = info.id;
      compacted = true;
      accepted = false;
      continue;
    }
    return undefined;
  }
  return compacted &&
    accepted &&
    stage === "business" &&
    response?.info?.role === "assistant"
    ? parent
    : undefined;
}
