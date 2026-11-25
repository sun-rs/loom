import { appendFileSync, constants, readFileSync } from 'node:fs';
import claude from '../../adapters/claude/index.mjs';
import { deliveryId } from '../../inbox/message.mjs';

// Keep the adapter's hook vocabulary and also capture the fields needed for
// the native session handshake, input correlation and StopFailure details.
const fields = [
  'hook_event_name', 'session_id', 'transcript_path', 'cwd', 'source', 'model',
  'prompt_id', 'prompt', 'turn_id', 'tool_name', 'tool_use_id', 'last_assistant_message',
  'is_interrupt', 'stop_hook_active', 'error', 'error_details',
];

try {
  const payload = JSON.parse(readFileSync(0, 'utf8'));
  const [sink, sessionId, cwd] = process.argv.slice(2);
  if (payload.cwd === cwd && !payload.agent_id &&
      (payload.session_id === sessionId || payload.hook_event_name === 'SessionStart') &&
      (['SessionStart', 'SessionEnd', 'PreCompact', 'PostCompact'].includes(payload.hook_event_name) || claude.hooks.normalize(payload))) {
    const row = { receivedAt: Date.now(), deliveryId: deliveryId(payload.prompt) };
    if (payload.tool_name === 'Bash' && payload.tool_input?.run_in_background === true) row.backgroundBash = true;
    for (const field of fields) {
      const value = payload[field];
      if (typeof value === 'string' || typeof value === 'boolean') row[field] = value;
    }
    appendFileSync(sink, JSON.stringify(row) + '\n', {
      flag: constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      mode: 0o600, flush: true,
    });
  }
} catch {
  // Observation must never block a Claude turn.
}
