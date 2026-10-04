export function openCodeFinalOutputInstructions(prompt, enabled) {
  return enabled
    ? `${prompt}\nWhen the current wake selects final-output, the ordinary final reply to its single delivered target must be exactly one complete JSON command {"kind":"room.reply","version":1,"body":"...","final":true,"basedOnRoomSeq":123}. Replace 123 with the exact --based-on-room-seq value from the current Reply context; this explicitly confirms the context used for this reply. This explicit command is the exception to the message-post requirement; do not also post the same reply through a tool. General provider prose remains diagnostic. Other operations retain the Worker tools; wakes without this selection retain their existing reply path.`
    : prompt;
}

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
