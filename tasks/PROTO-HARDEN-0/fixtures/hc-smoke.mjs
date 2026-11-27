import assert from 'node:assert/strict';
import { spawn, mkdtempSync } from '../../../fixtures/test-process.mjs';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { request } from '../../../daemon/rpc.mjs';
import { deliveryId } from '../../../inbox/message.mjs';
import { hc } from './real-hc.mjs';

const root = process.argv[2];
assert.ok(root?.endsWith('/proto-harden-0'));
assert.ok(process.env.HC_SOCKET?.startsWith(root + '/hc/'));
assert.equal(process.env.HC_TERMINAL_ID, undefined);
const project = mkdtempSync(join(root, 'hc-smoke-'));
const fixture = file => fileURLToPath(new URL(file, import.meta.url));
const codex = join(project, 'codex');
writeFileSync(codex, '#!' + process.execPath + '\nimport(' + JSON.stringify(new URL('native.mjs', import.meta.url).href) + ');\n',
  { mode: 0o700 });
mkdirSync(join(project, 'codex-local'));
const env = { ...process.env, OAR_CODEX_BIN: codex, CODEX_HOME: join(project, 'codex-local'),
  LOOM_REAL_HC: '1', LOOM_FAULT_PROJECT: project, LOOM_DESKTOP_NOTIFY: '0' };
const ledger = () => JSON.parse(readFileSync(join(project, '.project/inbox/state.json'), 'utf8')).messages;
const call = (command, args) => request(project, command, args);
const action = (role, task, mode, fields) => call('spawn', { mode, role, task, wave: 'HC', cli: 'codex',
  model: 'fixture', effort: 'high', cwd: project, project, prompt: 'START', ...fields });
async function until(read, label) {
  for (let i = 0; i < 240; i++) {
    try { const value = await read(); if (value) return value; } catch {}
    await delay(100);
  }
  assert.fail(label);
}
const instances = [];
async function launch() {
  const child = spawn(process.execPath, ['--import', fixture('fault.mjs'), fixture('loomd.mjs'), project], {
    env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', chunk => process.stdout.write(chunk));
  child.stderr.on('data', chunk => process.stderr.write(chunk));
  const exit = once(child, 'exit');
  instances.push({ child, exit });
  await until(async () => (await call('daemon-status')).pid === child.pid, 'loomd startup');
  return { child, exit };
}
const before = await hc('server', 'status');
assert.equal(before.live, 0);
let pane;
try {
  const first = await launch();
  const leader = await action('leader', 'LEADER', 'tui');
  pane = leader.session.pane;
  await until(() => ledger().some(message => message.id === leader.deliveryId && message.completion?.body), 'PTY first turn');
  const identity = await hc('get', pane);
  const tracked = () => readFileSync(join(project, 'native-deliveries.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  const inFlight = randomUUID();
  const firstPayload = { target: leader.session.addr, mode: 'queue', id: inFlight, text: 'FAULT REQUEST' };
  writeFileSync(join(project, 'fault.json'), JSON.stringify({ stage: 'native-ack', moment: 'after' }));
  await call('send', firstPayload).catch(() => {});
  assert.deepEqual(await Promise.race([first.exit, delay(12_000, null, { ref: false })]), [null, 'SIGKILL']);
  assert.equal(JSON.parse(readFileSync(join(project, 'fault-fired.json'), 'utf8')).stage, 'native-ack');
  const second = await launch();
  await call('send', firstPayload);
  await until(() => ledger().find(message => message.id === inFlight && message.completion?.body), 'PTY crash reconciliation');
  assert.equal(tracked().filter(row => deliveryId(row.text) === inFlight).length, 1);
  writeFileSync(join(project, 'fault.json'), JSON.stringify({ stage: 'wave-inbox', moment: 'after' }));
  await action('worker', 'FAULT-WORKER', 'headless', { parent: leader.session.addr, prompt: 'RETURN DONE HC-WORKER' });
  assert.deepEqual(await Promise.race([second.exit, delay(12_000, null, { ref: false })]), [null, 'SIGKILL']);
  assert.ok(existsSync(join(project, 'fault-fired.json')));
  const restarted = await hc('server', 'restart');
  const after = await hc('server', 'status');
  assert.notEqual(after.pid, before.pid);
  const rebound = await hc('get', pane);
  assert.equal(rebound.pid, identity.pid);
  assert.equal(rebound.created_ms, identity.created_ms);
  await launch();
  const delivery = await until(() => ledger().find(message => message.waveBatch && message.completion?.body), 'wave after both restart');
  assert.match(delivery.text, /DONE HC-WORKER/);
  assert.equal(tracked().filter(row => deliveryId(row.text) === delivery.id).length, 1);
  const questionId = randomUUID();
  const args = { target: leader.session.addr, mode: 'queue', id: questionId, text: 'after hc restart' };
  await call('send', args);
  await call('send', args);
  await until(() => ledger().find(message => message.id === questionId && message.completion?.body), 'duplicate RPC delivery');
  assert.equal(tracked().filter(row => deliveryId(row.text) === questionId).length, 1);
  writeFileSync(join(project, 'verification.json'), JSON.stringify({ before, restarted, after, pane, wave: delivery.id,
    loomdSignal: 'SIGKILL', inFlight, inFlightPtyNativeCount: 1, wavePtyNativeCount: 1, duplicateRequestPtyNativeCount: 1 }, null, 2) + '\n');
  console.log(project);
} finally {
  if (pane) {
    await hc('kill', pane).catch(() => {});
    const terminal = await until(async () => { const terminal = await hc('get', pane); return terminal.state === 'finished' && terminal; },
      'pane cleanup');
    writeFileSync(join(project, 'cleanup.json'), JSON.stringify({ pane, state: terminal.state, cause: terminal.cause }) + '\n');
  }
  for (const { child, exit } of instances) {
    if (child.exitCode == null && !child.signalCode) child.kill('SIGTERM');
    if (!await Promise.race([exit, delay(5000, null, { ref: false })])) { child.kill('SIGKILL'); await exit; }
  }
}
