// Orca b7fd7caa3 src/main/codex/hooks/definitions/codex-hook-identity.ts, CODEX_HOOK_EVENT_LABEL.
// Keep the events consumed by this adapter. Interrupt is the native cancellation hook.
export const hookLabels = {
  UserPromptSubmit: 'user_prompt_submit',
  PreToolUse: 'pre_tool_use',
  PostToolUse: 'post_tool_use',
  Stop: 'stop',
  Interrupt: 'interrupt',
};

const eventTypes = new Map([
  ['UserPromptSubmit', 'turn-start'],
  ['PreToolUse', 'tool'],
  ['PostToolUse', 'tool'],
  ['Stop', 'turn-end'],
  ['Interrupt', 'stop-failure'],
  ['StopFailure', 'stop-failure'],
]);

export function normalize(payload) {
  const type = eventTypes.get(payload?.hook_event_name);
  if (!type || typeof payload.session_id !== 'string' || !payload.session_id.trim() || payload.agent_id) {
    return null;
  }
  const event = {
    type,
    sessionId: payload.session_id,
    transcriptPath: typeof payload.transcript_path === 'string' ? payload.transcript_path : null,
  };
  const reply = payload.last_assistant_message;
  if (type === 'turn-end' && typeof reply === 'string' && reply.trim()) event.finalReply = reply;
  return event;
}
