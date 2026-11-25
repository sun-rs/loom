#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
if (args.includes('--version')) {
  console.log('2.1.331 (Claude Code)');
  process.exit(0);
}
const options = JSON.parse(args[args.indexOf('--settings') + 1]);
const sessionId = args[args.indexOf('--session-id') + 1];
function hook(name, fields) {
  const capture = options.hooks[name][0].hooks[0];
  const result = spawnSync(capture.command, capture.args, { encoding: 'utf8',
    input: JSON.stringify({ cwd: process.cwd(), hook_event_name: name, session_id: sessionId, ...fields }) });
  if (result.status !== 0) throw new Error('Hook failed');
}
function display(text = '') {
  process.stdout.write(`\x1b[2J\x1b[H──────────\r\n❯ ${text.replaceAll('\n', '\r\n')}\r\n──────────\r\n? for shortcuts`);
}
hook('SessionStart');
process.stdin.setRawMode(true);
process.stdin.setEncoding('utf8');
display();
let pending = '';
let draft = '';
process.stdin.on('data', bytes => {
  pending += bytes;
  const pasted = /\x1b\[200~([\s\S]*?)\x1b\[201~/.exec(pending);
  if (pasted) {
    pending = pending.slice(pasted.index + pasted[0].length);
    draft = pasted[1];
    if (draft.includes('HOLD PASTE')) {
      // Preserve the in-flight intent before the wrapper can verify a draft.
      writeFileSync(join(process.cwd(), 'pasted'), 'observed\n', { flush: true });
      return;
    }
    display(draft);
  }
  if (pending.includes('\r') && draft && !draft.includes('HOLD PASTE')) {
    const turn_id = crypto.randomUUID();
    hook('UserPromptSubmit', { prompt: draft, turn_id });
    hook('Stop', { last_assistant_message: 'OK', turn_id });
    draft = '';
    pending = '';
    display();
  }
});
process.stdin.resume();
