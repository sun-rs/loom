export function finalOutputInstructions(prompt, enabled) {
  return enabled
    ? `${prompt}\nWhen the current wake selects final-output, the ordinary final reply to its single delivered target must be exactly one complete JSON command {"kind":"room.reply","version":1,"body":"...","final":true,"basedOnRoomSeq":123}. Replace 123 with the exact --based-on-room-seq value from the current Reply context; this explicitly confirms the context used for this reply. This explicit command is the exception to the message-post/MCP reply requirement; do not also post the same reply through a tool. General provider prose remains diagnostic. Other operations retain the Worker tools; wakes without this selection retain their existing reply path.`
    : prompt;
}

export function nativeFinalTextInstructions(prompt, enabled) {
  return enabled
    ? `${prompt}\nWhen the current wake selects native-final-text, your ordinary final assistant text is published by the Host to that delivery's single target. Do not wrap it in JSON or also post that final reply through a tool. Other operations retain the Worker tools; wakes without this selection retain their existing reply path.`
    : prompt;
}
