import { fileURLToPath } from 'node:url';

// Orca b7fd7caa3: src/main/claude/hooks/claude-managed-hook-events.ts (root turn and tool events).
const eventTypes = new Map([
  ['UserPromptSubmit', 'turn-start'],
  ['Stop', 'turn-end'],
  ['StopFailure', 'stop-failure'],
  ['PreToolUse', 'tool'],
  ['PostToolUse', 'tool'],
  ['PostToolUseFailure', 'tool'],
  ['PermissionRequest', 'tool'],
]);

export function hookSettings(sink) {
  const hook = {
    type: 'command',
    command: process.execPath,
    args: [fileURLToPath(new URL('./capture-hook.mjs', import.meta.url)), sink],
    timeout: 5,
  };
  return { hooks: Object.fromEntries([...eventTypes].map(([name, type]) => [
    name, [{ ...(type === 'tool' ? { matcher: '*' } : {}), hooks: [hook] }],
  ])) };
}

export function normalizeHook(payload) {
  const type = eventTypes.get(payload?.hook_event_name);
  const sessionId = payload?.session_id;
  if (!type || typeof sessionId !== 'string' || !sessionId.trim() || payload.agent_id) return null;

  const transcriptPath = typeof payload.transcript_path === 'string' && payload.transcript_path.trim()
    ? payload.transcript_path : null;
  const event = { type, sessionId, transcriptPath };
  // Orca b7fd7caa3: src/shared/agent-hook-listener/providers/claude/claude-tool-fields.ts (native Stop text first).
  const reply = payload.last_assistant_message;
  if (type === 'turn-end' && payload.is_interrupt !== true && typeof reply === 'string' && reply.trim()) {
    event.finalReply = reply;
  }
  return event;
}
