import { createHash } from 'node:crypto';
import { appendFileSync, constants, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(import.meta.url);
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const toml = value => JSON.stringify(value).replaceAll('\x7f', '\\u007f');

export function addCodexStartHook(argv, sink, cwd, runner = script) {
  const command = [process.execPath, runner, sink, cwd].map(quote).join(' ');
  const timeout = 3;
  // The adapter injects the other command hooks through this same per-launch trust table.
  const trust = 'sha256:' + createHash('sha256').update(JSON.stringify({
    event_name: 'session_start', hooks: [{ async: false, command, timeout, type: 'command' }],
  })).digest('hex');
  const index = argv.findIndex(value => value.startsWith('hooks.state={'));
  if (index < 0) throw new Error('Codex hook trust table is missing');
  const label = toml('/<session-flags>/config.toml:session_start:0:0');
  argv[index] = argv[index].slice(0, -1) + `,${label}={enabled=true,trusted_hash=${toml(trust)}}}`;
  argv.push('-c', `hooks.SessionStart=[{hooks=[{type="command",command=${toml(command)},timeout=${timeout}}]}]`);
}

if (process.argv[1] && resolve(process.argv[1]) === script) {
  const [sink] = process.argv.slice(2);
  const payload = JSON.parse(readFileSync(0, 'utf8'));
  if (payload.hook_event_name === 'SessionStart' && !payload.agent_id && !payload.isSidechain &&
      typeof payload.session_id === 'string' && payload.session_id) {
    const row = { receivedAt: Date.now(), cwd: payload.cwd, hook_event_name: 'SessionStart', session_id: payload.session_id,
      ...(typeof payload.source === 'string' && { source: payload.source }),
      ...(typeof payload.transcript_path === 'string' && { transcript_path: payload.transcript_path }) };
    appendFileSync(sink, JSON.stringify(row) + '\n', { flush: true, mode: 0o600,
      flag: constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_NONBLOCK });
  }
}
