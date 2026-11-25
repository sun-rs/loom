import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { access, mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';
import { request } from '../../daemon/rpc.mjs';
import { readRequestBook } from '../../tui/request-book.mjs';

const exec = promisify(execFile);
const repo = join(import.meta.dirname, '../..');
const project = await mkdtemp('/Users/sun/Code/exp-relay/pty-integ-0/recovery-');
const options = { cwd: project, env: { ...process.env, LOOM_CLAUDE_BIN: join(import.meta.dirname, 'fake-claude.mjs'),
  LOOM_UNCERTAIN_MS: '1200', LOOM_DESKTOP_NOTIFY: '0' } };
delete options.env.HC_TERMINAL_ID;
delete options.env.LOOM_ADDR;

const hc = async (verb, ...args) => JSON.parse((await exec('hc', [verb, '--json', ...args], options)).stdout);
const record = (test, value) => console.log(JSON.stringify({ test, ...value }));
async function until(read, predicate) {
  for (let attempt = 0; attempt < 90; attempt++) {
    const result = await read();
    if (predicate(result)) return result;
    await sleep(100);
  }
  throw new Error('Condition timed out');
}
let daemon;
const panes = new Set();
async function start() {
  daemon = spawn(process.execPath, [join(repo, 'bin/loomd'), '--project', project], { ...options, stdio: ['ignore', 'ignore', 'inherit'] });
  await until(() => request(project, 'daemon-status').catch(() => null), value => value?.running);
}
async function halt() {
  if (daemon?.exitCode === null && daemon.signalCode === null) {
    const exited = once(daemon, 'exit');
    daemon.kill('SIGKILL');
    await exited;
  }
}
try {
  await start();
  const observer = await request(project, 'spawn', { role: 'super', cwd: project, cli: 'claude',
    model: 'sonnet', effort: 'low', mode: 'tui', prompt: 'NORMAL' });
  panes.add(observer.session.pane);
  const opened = await request(project, 'spawn', { role: 'leader', cwd: project, cli: 'claude',
    model: 'sonnet', effort: 'low', mode: 'tui', prompt: 'NORMAL' });
  const pane = opened.session.pane;
  panes.add(pane);
  const addr = opened.session.addr;
  const state = () => request(project, 'state', { target: addr });
  const answered = await until(state, result => result.deliveries.some(item =>
    item.id === opened.deliveryId && item.deliveryStatus === 'answered'));
  const jobFile = join(project, '.project', 'loomd', 'sessions', addr + '.json');
  const job = JSON.parse(await readFile(jobFile, 'utf8'));
  const wrapper = await hc('get', pane);
  assert.equal(wrapper.cwd, project);
  assert.ok(wrapper.argv.some(arg => arg.endsWith('/tui/loom-pty')));
  assert.equal(wrapper.pid, job.paneBinding.pid);
  const id = randomUUID();
  await request(project, 'send', { target: addr, text: 'HOLD PASTE', mode: 'queue', id });
  await until(() => access(join(project, 'pasted')).then(() => true, () => false), Boolean);
  const first = readRequestBook(job.tui.bookPath);
  assert.equal(first.get(opened.deliveryId).confirmation.count, 1);
  assert.ok(first.has(id));
  assert.equal(first.get(id).confirmation, undefined);
  record('before-failure', { project, pane, firstId: opened.deliveryId, unknownId: id,
    first: answered.deliveries.find(r => r.id === opened.deliveryId).deliveryStatus, pendingBook: true });
  await halt();
  process.kill(wrapper.pid, 'SIGKILL');
  const dead = await until(() => hc('get', pane), terminal => terminal.state === 'finished');
  await start();
  const after = await until(state, result => result.state === 'exited' &&
    result.notifications.some(item => item.deliveryId === id));
  const command = JSON.parse((await exec(join(repo, 'bin/loom'), ['state', addr, '--project', project], options)).stdout);
  assert.equal(command.state, 'exited');
  assert.equal(command.deliveries.find(item => item.id === id).deliveryStatus, 'uncertain');
  const uncertain = after.deliveries.find(item => item.id === id);
  assert.equal(uncertain.deliveryStatus, 'uncertain');
  assert.equal(uncertain.issue, 'uncertain-target-exited');
  assert.equal(after.deliveries.find(item => item.id === opened.deliveryId).deliveryStatus, 'answered');
  assert.equal(after.notifications.filter(item => item.deliveryId === id).length, 1);
  const retry = await request(project, 'send', { target: addr, text: 'HOLD PASTE', mode: 'queue', id });
  assert.equal(retry.deliveryStatus, 'uncertain');
  const observed = await request(project, 'state', { target: observer.session.addr });
  assert.deepEqual(observed.deliveries.map(item => item.id), [observer.deliveryId]);
  record('after-restart', { state: command.state, hc: dead.state, uncertain, notifications: after.notifications,
    retry: retry.deliveryStatus, unrelatedPaneDeliveries: observed.deliveries.length,
    first: after.deliveries.find(item => item.id === opened.deliveryId).deliveryStatus });
} finally {
  for (const pane of panes) {
    if ((await hc('get', pane)).state !== 'finished') await hc('kill', pane);
    record('cleanup', { pane, state: (await hc('get', pane)).state });
  }
  await halt();
}
