import { appendFileSync, constants, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { normalizeHook } from './hooks.mjs';

const capturedFields = [
  'hook_event_name', 'session_id', 'transcript_path', 'cwd', 'prompt_id', 'tool_name', 'tool_use_id',
  'last_assistant_message', 'is_interrupt', 'stop_hook_active', 'error',
];

// Reuse relay/hooks.mjs's append-only per-worker capture. A failed observer must leave the turn running.
try {
  const receivedAt = Date.now();
  const payload = JSON.parse(readFileSync(0, 'utf8'));
  const sink = process.argv[2];
  if (sink && normalizeHook(payload)) {
    const row = { receivedAt };
    for (const key of capturedFields) {
      const value = payload[key];
      if (typeof value === 'string' || typeof value === 'boolean' || value === null) row[key] = value;
    }
    mkdirSync(dirname(sink), { recursive: true, mode: 0o700 });
    appendFileSync(sink, JSON.stringify(row) + '\n', {
      flag: constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      mode: 0o600,
    });
  }
} catch {
  // A missing sink or unreadable hook payload cannot block Claude.
}
