import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const [project, addr, session] = process.argv.slice(2);
const path = join(project, '.project/relay/events', addr + '.jsonl');
const log = join(project, 'native-deliveries.jsonl');
const idle = readFileSync(new URL('../../TUI-REL-0/fixtures/codex-idle.txt', import.meta.url), 'utf8');
const draw = () => process.stdout.write('\x1b[2J\x1b[H' + idle);
let turn = 0;
let pending = '';
let buffer = '';
process.stdin.setRawMode(true);
process.stdin.setEncoding('utf8');
function receive(body) {
  const match = /\[loom:([0-9a-f-]{36})\]\r?\n([\s\S]+)/.exec(body);
  if (!match) return;
  const [, deliveryId, text] = match;
  const common = { receivedAt: Date.now(), cwd: project, session_id: session, turn_id: String(++turn) };
  const rows = [{ ...common, hook_event_name: 'UserPromptSubmit', deliveryId },
    { ...common, hook_event_name: 'Stop', last_assistant_message: 'ACK ' + text.trim() }];
  appendFileSync(log, JSON.stringify({ backend: 'hc', session, text: '[loom:' + deliveryId + ']\n' + text.trim() }) + '\n', { flush: true });
  appendFileSync(path, rows.map(row => JSON.stringify(row) + '\n').join(''), { flush: true });
  draw();
}
process.stdin.on('data', chunk => {
  buffer += chunk.replace(/\x1b\[20[01]~/g, '');
  const lines = buffer.split('\r');
  buffer = lines.pop();
  for (const line of lines) {
    pending = pending ? pending + '\n' + line : line;
    if (/\[loom:[0-9a-f-]{36}\]\n[\s\S]+/.test(pending)) {
      receive(pending);
      pending = '';
    }
  }
});
appendFileSync(path, JSON.stringify({ receivedAt: Date.now(), cwd: project, session_id: session,
  hook_event_name: 'SessionStart' }) + '\n', { flush: true });
process.stdout.write('\x1b[?2004h');
draw();
