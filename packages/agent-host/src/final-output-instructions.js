export function finalOutputInstructions(prompt, enabled) {
  return enabled
    ? `${prompt}\nWhen the wake selects final-output, complete all current work, then reply to its single delivered target with exactly one JSON command {"kind":"room.reply","version":1,"body":"...","final":true,"basedOnRoomSeq":123}. Replace 123 with the exact --based-on-room-seq value from the current Reply context. This replaces message-post/MCP for this reply; do not also post it through a tool. Other operations retain the Worker tools (progress, attachments, other targets, or wakes without this selection).`
    : prompt;
}
