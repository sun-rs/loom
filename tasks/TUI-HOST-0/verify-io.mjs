import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { root } from './probe.mjs';

const dir = await mkdtemp(join(root, 'io-'));
const modules = join(root, 'thin-deps');
const require = createRequire(join(modules, 'package.json'));
const pty = require('node-pty');
const wrapper = fileURLToPath(new URL('../../tui/loom-pty', import.meta.url));
const fixture = fileURLToPath(new URL('./io-fixture.mjs', import.meta.url));
const env = { ...process.env };
delete env.HC_TERMINAL_ID;
const run = promisify(execFile);
const hc = async (...args) => JSON.parse((await run('hc', [...args, '--json'], { cwd: dir, env, timeout: 8_000 })).stdout);
async function until(read, accepts, timeout = 6_000) {
  const start = performance.now();
  do {
    const result = await read();
    if (accepts(result)) return { result, ms: Math.round(performance.now() - start) };
    await sleep(50);
  } while (performance.now() - start < timeout);
  return { result: await read(), ms: Math.round(performance.now() - start) };
}

const name = `tui-host-0-io-${randomUUID().slice(0, 9)}`;
const initial = JSON.parse((await run('hc', ['run', '--bg', '--json', '--no-parent', '--no-notify',
  '--cwd', dir, '--name', name, '--', '/usr/bin/env', `LOOM_PTY_MODULES=${modules}`, wrapper, process.execPath, fixture], { env, cwd: dir })).stdout);
assert.equal(initial.name, name);
const id = initial.address;
let attach;
const screen = () => hc('read', id);
try {
  let observed = await until(screen, v => /SIZE=\d+x\d+/.test(v.text));
  assert.match(observed.result.text, /SIZE=\d+x\d+/);
  attach = pty.spawn('hc', ['attach', id], { cwd: dir, env, name: 'xterm-256color', cols: 101, rows: 35 });
  let visible = '';
  attach.onData(bytes => { visible += bytes; });
  observed = await until(screen, v => v.text.includes('SIZE=101x35'));
  assert.ok(observed.result.text.includes('SIZE=101x35'), observed.result.text);
  console.log(JSON.stringify({ pane: id, action: 'attach initial size', columns: 101, rows: 35, ms: observed.ms }));
  attach.resize(117, 31);
  observed = await until(screen, v => v.text.includes('SIZE=117x31'));
  assert.ok(observed.result.text.includes('SIZE=117x31'), observed.result.text);
  console.log(JSON.stringify({ pane: id, action: 'SIGWINCH resize', columns: 117, rows: 31, ms: observed.ms }));
  const pasted = Buffer.from('\x1b[200~中文🐚\x1b[201~');
  attach.write(pasted);
  observed = await until(screen, v => v.text.includes(`INPUT=${pasted.toString('hex')}`));
  assert.ok(observed.result.text.includes(`INPUT=${pasted.toString('hex')}`), observed.result.text);
  assert.ok(visible.includes('SIZE=117x31') || visible.includes('INPUT='));
  console.log(JSON.stringify({ pane: id, action: 'bracketed UTF-8 paste via hc attach', hex: pasted.toString('hex'), ms: observed.ms }));
  attach.write('\x03');
  observed = await until(() => hc('get', id), v => v.state === 'finished');
  assert.equal(observed.result.exit_code, 7);
  assert.ok((await screen()).text.includes('INPUT=03'));
  console.log(JSON.stringify({ pane: id, action: 'raw Ctrl-C and child exit propagation', exitCode: observed.result.exit_code, ms: observed.ms }));
} finally {
  try { attach?.kill(); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  const status = await hc('get', id);
  if (status.state !== 'finished') await hc('kill', id);
  assert.equal((await hc('get', id)).state, 'finished');
}

const { requestControl } = await import('../../tui/pty-control.mjs');
const raceDir = await mkdtemp(join(root, 'race-'));
const raceSocket = join(raceDir, 'pty.sock');
const raceName = `tui-host-0-race-${randomUUID().slice(0, 8)}`;
const raceFixture = fileURLToPath(new URL('./race-fixture.mjs', import.meta.url));
const race = JSON.parse((await run('hc', ['run', '--bg', '--json', '--no-parent', '--no-notify',
  '--cwd', raceDir, '--name', raceName, '--', '/usr/bin/env', `LOOM_PTY_MODULES=${modules}`,
  `LOOM_PTY_SOCKET=${raceSocket}`, 'LOOM_PTY_PROVIDER=claude',
  `LOOM_PTY_EVIDENCE=${JSON.stringify({ cwd: raceDir, evidenceRoot: raceDir, hookSink: join(raceDir, 'hooks.jsonl') })}`,
  wrapper, process.execPath, raceFixture], { env, cwd: raceDir })).stdout);
assert.equal(race.name, raceName);
const call = (method, params) => requestControl(raceSocket, method, params);
const raceScreen = () => hc('read', race.address);
try {
  const ready = await until(async () => (await call('state').catch(() => null))?.ready, Boolean);
  assert.ok(ready.result);
  const automated = call('submit', { text: 'Would be submitted without a racing keystroke', timeoutMs: 500 });
  const paste = await until(raceScreen, v => v.text.includes('PASTE-RECEIVED'));
  assert.ok(paste.result.text.includes('PASTE-RECEIVED'));
  await hc('keys', race.address, 'x');
  const receipt = await automated;
  assert.equal(receipt.kind, 'unconfirmed');
  assert.equal(receipt.hostReceipt.outcome, 'human-or-exit-during-paste');
  const rendered = await until(raceScreen, v => v.text.includes('DRAFT-RETAINED'));
  assert.match(rendered.result.text, /Would be submitted without a racing keystrokex/);
  assert.doesNotMatch(rendered.result.text, /ENTER-RECEIVED/);
  assert.equal((await call('submit', { text: 'Another prompt' })).code, 'previous-input-unconfirmed');
  console.log(JSON.stringify({ pane: race.address, action: 'human input between paste and Enter', receipt: receipt.kind,
    outcome: receipt.hostReceipt.outcome, enter: false, retainedHumanText: true }));
} finally {
  const status = await hc('get', race.address);
  if (status.state !== 'finished') await hc('kill', race.address);
  const retired = await until(() => hc('get', race.address), v => v.state === 'finished');
  assert.equal(retired.result.state, 'finished');
}
