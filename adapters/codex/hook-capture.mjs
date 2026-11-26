import { closeSync, constants, fstatSync, mkdirSync, openSync, readFileSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';
import { normalize } from './hooks.mjs';
import { deliveryId } from '../../inbox/message.mjs';

const [sink] = process.argv.slice(2);
const payload = JSON.parse(readFileSync(0, 'utf8'));
if (!payload.isSidechain && normalize(payload)) {
  // Keep native identifiers for the caller to correlate events and deduplicate replays.
  // Follow relay/hooks.mjs and omit prompt text, tool arguments, and outputs.
  const fields = ['hook_event_name', 'session_id', 'turn_id', 'transcript_path', 'cwd',
    'tool_name', 'tool_use_id', 'last_assistant_message'];
  const row = { receivedAt: Date.now(), deliveryId: deliveryId(payload.prompt), is_interrupt: payload.is_interrupt };
  for (const field of fields) {
    if (typeof payload[field] === 'string' || payload[field] === null) row[field] = payload[field];
  }
  const line = Buffer.from(`${JSON.stringify(row)}\n`);
  mkdirSync(dirname(sink), { recursive: true, mode: 0o700 });
  const fd = openSync(sink, constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND |
    constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
  try {
    if (!fstatSync(fd).isFile()) throw new Error('Codex hook sink must be a regular file');
    if (writeSync(fd, line) !== line.length) throw new Error('Incomplete Codex hook append');
  } finally {
    closeSync(fd);
  }
}
