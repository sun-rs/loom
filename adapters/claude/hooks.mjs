import { fileURLToPath } from 'node:url';
import { approval, choice, promptDetails, questionDetails } from '../prompt-state.mjs';

// Orca b7fd7caa3: src/main/claude/hooks/claude-managed-hook-events.ts (root turn and tool events).
const eventTypes = new Map([
  ['UserPromptSubmit', 'turn-start'],
  ['Stop', 'turn-end'],
  ['StopFailure', 'stop-failure'],
  ['PreToolUse', 'tool'],
  ['PostToolUse', 'tool'],
  ['PostToolUseFailure', 'tool'],
  ['PermissionRequest', 'tool'],
  ['Notification', 'notification'],
]);

export function hookSettings(sink) {
  const hook = {
    type: 'command',
    command: process.execPath,
    args: [fileURLToPath(new URL('./capture-hook.mjs', import.meta.url)), sink],
    timeout: 5,
  };
  return { hooks: Object.fromEntries([...eventTypes].map(([name, type]) => [
    name, [{ ...(type === 'tool' ? { matcher: '*' } : type === 'notification' ?
      { matcher: promptNotifications } : {}), hooks: [hook] }],
  ])) };
}

const promptNotifications = 'permission_prompt|elicitation|elicitation_dialog|elicitation_url_dialog|elicitation_complete|elicitation_response';

export function normalizeHook(payload) {
  const type = eventTypes.get(payload?.hook_event_name);
  const sessionId = payload?.session_id;
  if (type === 'notification' && !promptNotifications.split('|').includes(payload.notification_type)) return null;
  if (!type || typeof sessionId !== 'string' || !sessionId.trim() || payload.agent_id) return null;

  const transcriptPath = typeof payload.transcript_path === 'string' && payload.transcript_path.trim()
    ? payload.transcript_path : null;
  const event = { type: type === 'turn-end' && payload.paused ? 'turn-paused' : type, sessionId, transcriptPath };
  // Orca b7fd7caa3: src/shared/agent-hook-listener/providers/claude/claude-tool-fields.ts (native Stop text first).
  const reply = payload.last_assistant_message;
  if (event.type === 'turn-end' && payload.is_interrupt !== true && typeof reply === 'string' && reply.trim()) {
    event.finalReply = reply;
  }
  return event;
}

export function claudePrompt(payload) {
  const { hook_event_name: event, tool_name: tool, notification_type: notification } = payload;
  if (event === 'PreToolUse' && tool === 'AskUserQuestion' || event === 'PermissionRequest' && tool) {
    return tool === 'AskUserQuestion' ? questionDetails(payload.tool_input?.questions) : promptDetails(approval, tool);
  }
  if (event !== 'Notification') return;
  if (notification === 'permission_prompt') return promptDetails(approval, payload.message);
  if (['elicitation', 'elicitation_dialog', 'elicitation_url_dialog'].includes(notification)) return promptDetails(choice, payload.message);
}
