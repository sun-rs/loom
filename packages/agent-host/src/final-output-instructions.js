export function finalOutputInstructions(prompt, enabled) {
  return enabled
    ? `${prompt}\nWhen the current wake selects final-output, the ordinary final reply to its single delivered target must be exactly one complete JSON command {"kind":"room.reply","version":1,"body":"...","final":true,"basedOnRoomSeq":123}. Replace 123 with the exact --based-on-room-seq value from the current Reply context; this explicitly confirms the context used for this reply. This explicit command is the exception to the message-post/MCP reply requirement; do not also post the same reply through a tool. General provider prose remains diagnostic. Other operations retain the Worker tools; wakes without this selection retain their existing reply path.`
    : prompt;
}

export function nativeFinalTextInstructions(prompt, enabled) {
  return enabled
    ? `${prompt}\nWhen the current wake selects native-final-text, your ordinary final assistant text is published by the Host to that delivery's single target. When initiating a new request to a teammate, include their actual @<handle> in plain text in that final reply; role labels or names without @ do not select recipients. Use plain names, without @, for acknowledgements and status-only references; live mentions select delivery recipients. After sending a request, end your turn to await the peer. Automatic peer return is limited to one delivered plain-text top-level request that mentions only you. If a request addresses multiple members or this wake combines multiple request origins, explicitly @ the intended requester in your final reply. An automatic return is a reply and does not start another automatic return; a further request needs explicit addressing. Do not wrap it in JSON or also post that final reply through a tool. Other operations retain the Worker tools; wakes without this selection retain their existing reply path.`
    : prompt;
}
