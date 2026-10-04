/** Extract native final text only; this is not a Room command validator. */
export function openCodeFinalOutputCandidate(
  response,
  { sessionId, parentId },
) {
  const info = response?.info;
  if (
    typeof sessionId !== "string" ||
    sessionId.trim() === "" ||
    typeof parentId !== "string" ||
    parentId.trim() === "" ||
    !info ||
    info.role !== "assistant" ||
    typeof info.id !== "string" ||
    info.id.length === 0 ||
    info.sessionID !== sessionId ||
    info.parentID !== parentId ||
    !Number.isFinite(info.time?.completed) ||
    info.finish !== "stop" ||
    info.error !== undefined ||
    !Array.isArray(response.parts)
  )
    return undefined;
  const texts = response.parts.filter((part) => part?.type === "text");
  if (texts.length !== 1) return undefined;
  const part = texts[0];
  if (
    typeof part.id !== "string" ||
    part.id.length === 0 ||
    part.sessionID !== sessionId ||
    part.messageID !== info.id ||
    typeof part.text !== "string" ||
    part.text.length === 0 ||
    Buffer.byteLength(part.text, "utf8") > 64 * 1024
  )
    return undefined;
  return { text: part.text, nativeMessageId: info.id };
}
