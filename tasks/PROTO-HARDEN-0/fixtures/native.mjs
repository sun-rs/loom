import { appendFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { basename, dirname, join } from 'node:path';

const cli = basename(process.argv[1]).startsWith('agy') ? 'agy' : 'codex';
const argv = process.argv.slice(2);
if (cli === 'agy' && argv[0] === 'acp') {
  const help = readFileSync(new URL('../../../adapters/agy/fixtures/agy-1.5.18-acp-help.txt', import.meta.url), 'utf8');
  if (argv[1] === '--help') {
    const omitted = 'agy-omit-acp-flag.json';
    const flag = existsSync(omitted) ? JSON.parse(readFileSync(omitted, 'utf8')) : null;
    console.error(flag ? help.split('\n').filter(line => line.trimStart().split(/\s+/)[0] !== flag).join('\n') : help);
    process.exit(0);
  }
  const flags = new Set(Array.from(help.matchAll(/^\s+(--[\w-]+)/gm), match => match[1]));
  appendFileSync('agy-acp-argv.jsonl', JSON.stringify(argv) + '\n');
  for (const arg of argv.slice(1).filter(arg => arg.startsWith('-'))) {
    if (flags.has(arg.split('=', 1)[0])) continue;
    console.error(`flags provided but not defined: ${arg}`);
    process.exit(2);
  }
}
if (argv.includes('--version')) {
  console.log(cli === 'agy' ? '1.5.18' : 'codex-cli 0.171.0');
  process.exit(0);
}
if (argv.includes('--help')) {
  console.log(cli === 'agy' ? 'Usage of antigravity-cli: --conversation' : 'Usage: codex app-server');
  process.exit(0);
}

const root = process.cwd();
const out = value => console.log(JSON.stringify(value));
const reply = (id, result = {}) => out({ jsonrpc: '2.0', id, result });
const notify = (method, params) => out({ jsonrpc: '2.0', method, params });
const read = createInterface({ input: process.stdin });
let session;
let turn;
let transcript;

function log(name, value) {
  appendFileSync(join(root, name), JSON.stringify(value) + '\n', { flush: true });
}
function writeNative(payload) {
  appendFileSync(transcript, JSON.stringify({ type: 'event_msg', timestamp: new Date().toISOString(), payload }) + '\n', { flush: true });
}
function open(id) {
  session = id ?? randomUUID();
  transcript = join(root, '.native', session + '.jsonl');
  mkdirSync(dirname(transcript), { recursive: true });
  writeFileSync(transcript, '', { flag: 'a' });
  log('runtime-pids.jsonl', { pid: process.pid, session, cli });
}
function codex({ method, id, params }) {
  const faultPath = join(root, 'codex-rpc-case.json');
  if (existsSync(faultPath)) {
    const fault = JSON.parse(readFileSync(faultPath, 'utf8'));
    if (fault.method === method) {
      unlinkSync(faultPath);
      if (fault.noAck) {
        log('silent-requests.jsonl', { method, id });
        return;
      }
      return out({ id, error: fault.error });
    }
  }
  if (method === 'initialize') return reply(id, { userAgent: 'codex/0.171.0' });
  if (method === 'thread/start' || method === 'thread/resume') {
    if (existsSync('codex-host-probes.json')) {
      const config = argv.flatMap((arg, i) => arg === '-c' ? [argv[i + 1]] : []);
      const sandbox = config.filter(arg => arg.startsWith('sandbox_mode='));
      const profile = config.find(arg => arg.startsWith('default_permissions='));
      const wrapped = existsSync(join(dirname(process.env.TMPDIR), 'host-native'));
      // Model the two Darwin operations without opening a live Seatbelt or PTY.
      const outcome = wrapped || sandbox.at(-1) !== 'sandbox_mode="danger-full-access"' || profile ? 'EPERM' : 'ok';
      log('codex-host-launches.jsonl', { sandbox, profile, wrapped, sandboxExec: outcome, pty: outcome,
        guard: process.env.LOOM_HOST_GUARD === '1', hooks: config.includes('features.hooks=true') });
    }
    open(params.threadId);
    return reply(id, { thread: { id: session, path: transcript }, model: params.model ?? 'fixture', reasoningEffort: 'high' });
  }
  if (method === 'turn/start') {
    turn = randomUUID();
    const text = params.input[0].text;
    const itemId = randomUUID();
    const body = text.split('\n').slice(1).join('\n');
    const scope = { threadId: session, turnId: turn };
    writeNative({ type: 'task_started', turn_id: turn });
    writeNative({ type: 'user_message', message: text });
    log('native-deliveries.jsonl', { backend: 'headless', session, text });
    const hold = body.startsWith('HOLD');
    const finalText = body.startsWith('RETURN ') ? body.slice(7) : 'OK ' + body;
    if (!hold) writeNative({ type: 'task_complete', turn_id: turn, last_agent_message: finalText });
    reply(id, { turn: { id: turn } });
    notify('turn/started', { threadId: session, turn: { id: turn } });
    notify('item/started', { ...scope, item: { id: randomUUID(), clientId: params.clientUserMessageId,
      type: 'userMessage', content: params.input } });
    if (hold) return;
    const item = { type: 'agentMessage', id: itemId, phase: 'final_answer', text: '' };
    notify('item/started', { ...scope, item });
    notify('item/agentMessage/delta', { ...scope, itemId, delta: finalText });
    notify('item/completed', { ...scope, item: { ...item, text: finalText } });
    notify('turn/completed', { threadId: session, turn: { id: turn, status: 'completed' } });
    return;
  }
  if (method === 'turn/interrupt') {
    if (params.turnId === turn) writeNative({ type: 'turn_aborted', turn_id: turn, reason: 'interrupted' });
    reply(id);
    if (params.turnId !== turn) return;
    notify('turn/completed', { threadId: session, turn: { id: turn, status: 'interrupted' } });
    return;
  }
  if (id !== undefined) reply(id);
}
function acp({ method, id, params }) {
  if (method === 'initialize') return reply(id, { protocolVersion: 1,
    agentCapabilities: { loadSession: true, sessionCapabilities: { close: {} } } });
  const configOptions = [
    { id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: 'fixture',
      options: [{ value: 'fixture', name: 'Fixture' }] },
    { id: 'thought_level', name: 'Thought level', category: 'thought_level', type: 'select', currentValue: 'high',
      options: [{ value: 'high', name: 'High' }] },
  ];
  if (method === 'session/new' || method === 'session/load') {
    if (existsSync('agy-fail-start.json')) {
      console.error('fixture rejected ACP startup');
      process.exit(24);
    }
    open(params.sessionId);
    return reply(id, { sessionId: session, configOptions });
  }
  if (method === 'session/set_config_option') {
    notify('session/update', { sessionId: session, update: { sessionUpdate: 'config_option_update', configOptions } });
    return reply(id, { configOptions });
  }
  if (method === 'session/prompt') {
    const text = params.prompt.find(item => item.type === 'text')?.text;
    log('native-deliveries.jsonl', { backend: 'acp', session, text });
    notify('session/update', { sessionId: session, update: {
      sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'ACP body without a final message boundary' },
    } });
    return reply(id, { stopReason: 'end_turn' });
  }
  if (id !== undefined) reply(id);
}
read.on('line', line => {
  const request = JSON.parse(line);
  if (cli === 'agy') log('acp-methods.jsonl', { method: request.method, id: request.id });
  (cli === 'agy' ? acp : codex)(request);
});
