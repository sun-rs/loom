import assert from 'node:assert/strict';
import { spawn as spawnProcess, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { projectIndex } from '../cli/project.mjs';
import { retainedRecords } from '../handover/index.mjs';
import codex from '../adapters/codex/index.mjs';
import { deliveryId } from '../inbox/message.mjs';
import { addCodexStartHook } from '../runtimes/tui/codex-start.mjs';
import { request } from './rpc.mjs';

const fixture = path => fileURLToPath(new URL('../tasks/PROTO-HARDEN-0/fixtures/' + path, import.meta.url));
const repository = fileURLToPath(new URL('..', import.meta.url));

test('the launch-only Codex SessionStart hook records the owned root and ignores compact or foreign input', t => {
  const f = fixtureProject(t);
  const sink = join(f.project, "it's the root events.jsonl");
  const { argv } = codex.launch({ cwd: f.project, hookSink: sink });
  addCodexStartHook(argv, sink, f.project);
  const settings = argv.find(arg => arg.startsWith('hooks.state='));
  assert.match(settings, /:user_prompt_submit:0:0/);
  assert.match(settings, /:session_start:0:0/);
  const rule = argv.find(arg => arg.startsWith('hooks.SessionStart='));
  const quoted = rule.slice(rule.indexOf('command=') + 'command='.length, rule.lastIndexOf(',timeout='));
  const run = payload => {
    const result = spawnSync('/bin/sh', ['-c', JSON.parse(quoted)], { input: JSON.stringify(payload) });
    assert.equal(result.status, 0, String(result.stderr));
  };
  const input = { hook_event_name: 'SessionStart', source: 'startup', cwd: f.project, session_id: randomUUID() };
  run({ ...input, source: 'compact' });
  run({ ...input, cwd: '/foreign' });
  run({ ...input, agent_id: 'child' });
  assert.equal(existsSync(sink), false);
  run(input);
  assert.equal(f.lines("it's the root events.jsonl")[0].session_id, input.session_id);
});

async function until(read, message, wait = 18_000) {
  const deadline = Date.now() + wait;
  let last;
  do {
    try { if ((last = await read())) return last; }
    catch (error) { last = error.message; }
    await delay(10);
  } while (Date.now() < deadline);
  assert.fail(message + ': ' + JSON.stringify(last));
}
function fixtureProject(t, options = {}) {
  const root = process.env.LOOM_HARDEN_TEST_ROOT ?? realpathSync(tmpdir());
  const project = mkdtempSync(join(root, 'lh-'));
  const read = name => JSON.parse(readFileSync(join(project, name), 'utf8'));
  const write = (name, data) => writeFileSync(join(project, name), JSON.stringify(data) + '\n');
  const lines = name => {
    const path = join(project, name);
    return existsSync(path) ? readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
  };
  const mail = () => read('.project/inbox/state.json').messages;
  const waveState = () => read('.project/relay/state.json');
  const native = () => lines('native-deliveries.jsonl');
  const deliveries = id => native().filter(row => deliveryId(row.text) === id);
  const fixtureEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !['HC_TERMINAL_ID', 'LOOM_ADDR', 'LOOM_WAVE_WINDOW_MS', 'LOOM_WAVE_SEAL_MS', 'LOOM_WAVE_PARTIAL_MS',
      'LOOM_UNCERTAIN_MS', 'LOOM_BLOCKED_COALESCE_MS'].includes(key)));
  const codex = join(project, 'codex');
  const agy = join(project, 'agy');
  for (const cli of [codex, agy]) writeFileSync(cli, '#!' + process.execPath + '\nimport(' +
    JSON.stringify(new URL('../tasks/PROTO-HARDEN-0/fixtures/native.mjs', import.meta.url).href) + ');\n', { mode: 0o700 });
  for (const dir of ['codex-local', 'xdg-state', 'xdg-config', 'xdg-data']) mkdirSync(join(project, dir));
  mkdirSync(join(project, '.project'));
  write('.project/policy.json', { preferred: [], deny: [], delivery: { coalesceMs: 0 } });
  Object.assign(fixtureEnv, { LOOM_CODEX_BIN: codex, LOOM_AGY_BIN: agy,
    OAR_CODEX_BIN: codex, OAR_ANTIGRAVITY_BIN: agy, CODEX_HOME: join(project, 'codex-local'),
    XDG_STATE_HOME: join(project, 'xdg-state'), XDG_CONFIG_HOME: join(project, 'xdg-config'),
    XDG_DATA_HOME: join(project, 'xdg-data'), LOOM_FAULT_PROJECT: project,
    NODE_OPTIONS: '--import=' + new URL('../tasks/HOTSWAP-1/fault-host.mjs', import.meta.url).href, ...options.env });
  write('panes.json', []);
  const children = [];
  const rpc = (command, args) => request(project, command, args);
  function launch() {
    const child = spawnProcess(process.execPath, ['--import', fixture('fault.mjs'), fixture('loomd.mjs'), project], {
      env: fixtureEnv, cwd: repository, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const exit = once(child, 'exit');
    let log = '';
    for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { log += chunk; });
    const childState = { child, exit, log: () => log };
    children.push(childState);
    return childState;
  }
  async function start() {
    const proc = launch();
    await until(async () => {
      if (proc.child.exitCode != null || proc.child.signalCode) throw new Error(proc.log());
      const result = await rpc('daemon-status');
      return result.pid === proc.child.pid && result;
    }, 'loomd did not start: ' + project);
    return proc;
  }
  function arm(stage, moment) {
    write('fault.json', { stage, moment });
  }
  async function killed(proc, stage, moment) {
    assert.deepEqual(await Promise.race([proc.exit, delay(18_000, null, { ref: false })]), [null, 'SIGKILL'], proc.log());
    assert.deepEqual(read('fault-fired.json'), { stage, moment });
    write('verified-fault.json', { stage, moment, signal: 'SIGKILL' });
  }
  const spawn = (role, task, options = {}) => rpc('spawn', { role, project, task, wave: role === 'worker' ? 'FAULT-W' : 'ROOT',
    cli: 'codex', mode: 'headless', model: 'fixture', effort: 'high', cwd: project, prompt: 'start', ...options });
  const send = (target, text, options = {}) => rpc('send', { target, mode: 'queue', id: randomUUID(), text, ...options });
  const waitMail = (id, check = value => value?.completion?.body) => until(() => {
    const message = mail().find(value => value.id === id);
    return check(message) && message;
  }, 'mail ' + id);
  t.after(async () => {
    if (children.length) {
      await Promise.all(projectIndex(project).query({ backend: 'headless', endedAt: null }).map(row =>
        rpc('stop', { target: row.addr }).catch(() => {})));
    }
    for (const proc of children.reverse()) {
      if (proc.child.exitCode === null && proc.child.signalCode === null) proc.child.kill('SIGTERM');
      const result = await Promise.race([proc.exit, delay(3500, null, { ref: false })]);
      if (!result && proc.child.exitCode === null && proc.child.signalCode === null) {
        proc.child.kill('SIGKILL');
        await proc.exit;
      }
      if (process.env.LOOM_HARDEN_TEST_ROOT) write('loomd-' + proc.child.pid + '.json', { result, log: proc.log() });
    }
    if (!process.env.LOOM_HARDEN_TEST_ROOT) rmSync(project, { recursive: true, force: true });
  });
  return { project, read, write, lines, mail, waveState, native, deliveries, rpc, launch, start, arm, killed, spawn, send, waitMail };
}

const perSender = process.env.LOOM_HARDEN_STRESS ? 500 : 12;
test(`real OAR and hc-shaped TUI prompts share durable idempotency for two concurrent senders and ${2 * perSender} messages`, { timeout: 240_000 }, async t => {
  const f = fixtureProject(t);
  await f.start();
  const leader = await f.spawn('leader', 'HEADLESS');
  const terminal = await f.spawn('auditor', 'TUI', { mode: 'tui' });
  await f.waitMail(leader.deliveryId);
  await f.waitMail(terminal.deliveryId);
  assert.equal((await f.rpc('state', { target: leader.session.addr })).state, 'idle');
  const receipt = await f.send(leader.session.addr, 'HOLD for two publishers');
  await f.waitMail(receipt.id, message => message?.received);
  assert.equal((await f.rpc('state', { target: leader.session.addr })).state, 'busy');
  const ids = [[], []];
  const producer = async (target, sender) => {
    for (let i = 0; i < perSender; i++) {
      const result = await f.send(target, 'Sender ' + sender + ' message ' + i);
      assert.equal(result.deliveryStatus, 'accepted');
      ids[sender].push(result.id);
    }
  };
  await Promise.all([producer(leader.session.addr, 0), producer(terminal.session.addr, 1)]);
  assert.equal(f.native().filter(row => row.text.includes('Sender 0 message')).length, 0);
  const interrupt = await f.send(leader.session.addr, 'release', { mode: 'interrupt' });
  await f.waitMail(interrupt.id);
  await until(() => f.mail().filter(message => message.completion?.body && message.text.startsWith('Sender ')).length === 2 * perSender,
    'all deliveries completed', 100_000);
  for (let sender = 0; sender < 2; sender++) {
    const ordered = f.native().filter(row => row.text.includes('Sender ' + sender + ' message')).map(row => deliveryId(row.text));
    assert.deepEqual(ordered, ids[sender]);
  }
  const repeated = await f.send(leader.session.addr, 'Sender 0 message 0', { id: ids[0][0] });
  assert.equal(repeated.deliveryStatus, 'answered');
  await assert.rejects(f.send(leader.session.addr, 'different', { id: ids[0][0] }), { code: 'id-conflict' });
  assert.equal(f.deliveries(repeated.id).length, 1);
  f.write('verified-concurrency.json', { accepted: 2 * perSender, delivered: 2 * perSender, answered: 2 * perSender, duplicates: 0, fifo: true });
});

test('real ACP text chunks without a final boundary produce an UNCONFIRMED wave wakeup', { timeout: 25_000 }, async t => {
  const f = fixtureProject(t);
  await f.start();
  const leader = await f.spawn('leader', 'LEADER', { mode: 'tui' });
  await f.waitMail(leader.deliveryId);
  const worker = await f.spawn('worker', 'ACP', { cli: 'agy', parent: leader.session.addr });
  const delivery = await f.waitMail(worker.deliveryId, message => message?.completion?.unconfirmed);
  assert.equal(delivery.completion.body, undefined);
  assert.match(delivery.completion.unconfirmedBody, /ACP body without/);
  const message = await until(() => f.mail().find(message => message.waveBatch && message.completion?.body), 'ACP wave wakeup');
  assert.match(message.text, /UNCONFIRMED.*未确认正文/s);
  assert.equal(f.deliveries(message.id).length, 1);
});

test('SIGKILL around delivery, registry, relay and history durability boundaries', { concurrency: 3, timeout: 120_000 }, async t => {
  const stages = [];
  for (const stage of ['accepted', 'attempt', 'native-ack', 'receipt', 'completion', 'turn-start', 'input-received', 'turn-end']) {
    for (const moment of ['before', 'after']) stages.push({ kind: 'send', stage, moment });
  }
  for (const stage of ['job', 'index-insert', 'pane-binding', 'stream-opened', 'wave-registration', 'evidence-json', 'evidence-text', 'relay-result', 'reply-archive',
    'relay-published', 'worker-view', 'outbox-intent', 'wave-inbox', 'outbox-sent', 'outbox-prune']) {
    for (const moment of ['before', 'after']) stages.push({ kind: 'wave', stage, moment });
  }
  for (const stage of ['abort-intent', 'abort-ack', 'stopped']) {
    for (const moment of ['before', 'after']) stages.push({ kind: 'interrupt', stage, moment });
  }
  await Promise.all(stages.map(({ kind, stage, moment }) => t.test(stage + ' ' + moment, async t => {
    const f = fixtureProject(t);
    const proc = await f.start();
    const leader = await f.spawn('leader', 'LEADER', kind === 'send' || kind === 'interrupt' ? {} : { mode: 'tui' });
    await f.waitMail(leader.deliveryId);
    const target = leader.session.addr;
    const id = randomUUID();
    if (kind === 'send') {
      const sender = await f.spawn('super', 'SENDER', { mode: 'tui' });
      await f.waitMail(sender.deliveryId);
      const options = { id, from: sender.session.addr };
      f.arm(stage, moment);
      await f.send(target, 'FAULT REQUEST', options).catch(() => {});
      await f.killed(proc, stage, moment);
      await f.start();
      const retry = await f.send(target, 'FAULT REQUEST', options);
      assert.equal(retry.id, id);
      const result = await f.waitMail(id);
      assert.equal(result.completion.body, 'OK FAULT REQUEST');
      const routed = await until(() => f.mail().find(message => message.replyTo === id && message.completion?.body), 'routed reply');
      assert.equal(f.deliveries(id).length, 1);
      assert.equal(f.deliveries(routed.id).length, 1);
      assert.equal(f.mail().filter(message => message.replyTo === id).length, 1);
    } else if (kind === 'wave') {
      f.arm(stage, moment);
      const startWorker = () => f.spawn('worker', 'FAULT-WORKER', { parent: target, prompt: 'RETURN DONE FAULT-WORKER',
        ...(stage === 'pane-binding' && { mode: 'tui' }) });
      await startWorker().catch(() => {});
      await f.killed(proc, stage, moment);
      await f.start();
      if (stage === 'job' && moment === 'before') await startWorker();
      const batch = await until(() => f.mail().find(message => message.waveBatch && message.completion?.body), 'recovered wave');
      assert.equal(f.deliveries(batch.id).length, 1);
      assert.match(batch.text, /DONE FAULT-WORKER/);
      assert.equal(f.native().filter(row => row.text.split('\n')[1] === 'RETURN DONE FAULT-WORKER').length, 1);
      assert.equal(f.mail().filter(message => message.waveBatch).length, 1);
      assert.equal(projectIndex(f.project).query({ role: 'worker' }).length, 1);
    } else {
      const hold = await f.send(target, 'HOLD interrupted turn');
      await f.waitMail(hold.id, value => value?.received);
      f.arm(stage, moment);
      await f.send(target, 'replacement', { id, mode: 'interrupt' }).catch(() => {});
      await f.killed(proc, stage, moment);
      await f.start();
      assert.equal((await f.waitMail(id)).completion.body, 'OK replacement');
      assert.equal(f.deliveries(id).length, 1);
    }
  })));
});

test('real OAR child exit refuses queued work and retains accepted input and leader-exited notification', { timeout: 30_000 }, async t => {
  const f = fixtureProject(t);
  await f.start();
  const leader = await f.spawn('leader', 'LEADER');
  await f.waitMail(leader.deliveryId);
  const id = leader.session.addr;
  const hold = await f.send(id, 'HOLD until runtime dies');
  await f.waitMail(hold.id, message => message?.received);
  const queued = await f.send(id, 'WAITING');
  const runtime = f.lines('runtime-pids.jsonl').find(row => row.session === leader.session.sessionId);
  process.kill(runtime.pid, 'SIGKILL');
  assert.equal((await f.waitMail(queued.id, message => message?.phase === 'refused')).issue, 'target-exited');
  assert.equal(f.deliveries(queued.id).length, 0);
  assert.equal(f.deliveries(hold.id).length, 1);
  await until(async () => (await f.rpc('state', { target: id })).notifications
    .some(event => event.type === 'leader-exited'), 'leader exit published');
  await f.rpc('notifications', { complete: 'controlled run complete' });
  const taken = await f.rpc('notifications', { take: true });
  assert.deepEqual(taken.notifications.map(event => event.type).sort(), ['leader-exited', 'project-completed']);
  assert.deepEqual((await f.rpc('notifications', { take: true })).notifications, []);
});

test('a real daemon running a fixture TUI never confirms Claude using bare matching text', { timeout: 30_000 }, async t => {
  const f = fixtureProject(t, { env: { LOOM_UNCERTAIN_MS: '0' } });
  await f.start();
  const leader = await f.spawn('leader', 'LEADER', { mode: 'tui' });
  await f.waitMail(leader.deliveryId);
  const worker = await f.spawn('worker', 'CLAUDE', { mode: 'tui', cli: 'claude', parent: leader.session.addr });
  await f.waitMail(worker.deliveryId, value => value?.received);
  const input = await f.send(worker.session.addr, 'NO MARKER');
  const message = await f.waitMail(input.id, value => value?.issue === 'uncertain-timeout');
  assert.equal(message.received, undefined);
  assert.equal(f.deliveries(input.id).length, 1);
  const notice = await until(() => f.mail().find(message => message.uncertainOf === input.id && message.completion?.body), 'uncertain escalation');
  assert.equal(notice.target.addr, leader.session.addr);
  assert.equal(f.deliveries(notice.id).length, 1);
  assert.equal(f.mail().filter(value => value.uncertainOf === input.id).length, 1);
  await assert.rejects(f.send(worker.session.addr, 'never type Escape', { mode: 'interrupt' }), { code: 'unsupported' });
});

test('stale lock permits a single takeover and a malformed committed SQLite file is preserved', { timeout: 30_000 }, async t => {
  const f = fixtureProject(t);
  const first = await f.start();
  first.child.kill('SIGKILL');
  await first.exit;
  const candidates = [f.launch(), f.launch(), f.launch()];
  const status = await until(() => f.rpc('daemon-status').catch(() => null), 'single takeover');
  const winner = candidates.find(proc => proc.child.pid === status.pid);
  assert.ok(winner);
  for (const proc of candidates.filter(proc => proc !== winner)) assert.deepEqual(await proc.exit, [1, null]);
  winner.child.kill('SIGKILL');
  await winner.exit;
  const path = join(f.project, '.project', 'index.sqlite');
  const original = readFileSync(path);
  writeFileSync(path, Buffer.concat([Buffer.from('corrupt SQLite!!'), original.subarray(16)]));
  const corrupted = readFileSync(path);
  const broken = f.launch();
  assert.deepEqual(await broken.exit, [1, null]);
  assert.match(broken.log(), /not a database|malformed/i);
  assert.deepEqual(readFileSync(path), corrupted);
  writeFileSync(path, original);
  assert.equal((await f.start()).child.exitCode, null);
});

test('SQLite rolls back a SIGKILL transaction with pages spilled before commit', { timeout: 30_000 }, async t => {
  const f = fixtureProject(t);
  const index = projectIndex(f.project);
  const row = index.register({ addr: 'original', role: 'leader', project: f.project, backend: 'headless', cwd: f.project });
  const path = join(f.project, '.project/index.sqlite');
  const script = [
    "import { DatabaseSync } from 'node:sqlite'",
    "const db = new DatabaseSync(process.argv[1])",
    "db.exec('PRAGMA journal_mode=DELETE; PRAGMA cache_size=2; BEGIN IMMEDIATE')",
    "db.exec(\"UPDATE sessions SET task='not committed' WHERE addr='original'\")",
    "const put = db.prepare(\"INSERT INTO sessions(addr, project, backend, task) VALUES (?, ?, 'headless', ?)\")",
    "for (let n = 0; n < 96; n++) put.run('partial-' + n, '/fixture', 'x'.repeat(6000))",
    "process.kill(process.pid, 'SIGKILL')",
  ].join('\n');
  const child = spawnProcess(process.execPath, ['--input-type=module', '-e', script, path], { stdio: 'ignore' });
  assert.deepEqual(await once(child, 'exit'), [null, 'SIGKILL']);
  const journal = readFileSync(path + '-journal');
  assert.ok(journal.length > 512);
  assert.equal(journal.subarray(0, 8).toString('hex'), 'd9d505f920a163d7');
  index.initialize();
  assert.deepEqual(index.query(), [row]);
  f.write('verified-sqlite.json', { recovered: true, rows: index.query().length, rollbackBytes: journal.length });
});

test('watch and handover recover published records across daemon SIGKILL', { concurrency: 3, timeout: 65_000 }, async t => {
  const rates = ['before', 'after', 'torn'].map(moment => ['watch-stuck', moment]);
  const stages = [...rates, ['notification', 'before'], ['notification', 'after'], ['retention', 'before'], ['retention', 'after']];
  await Promise.all(stages.map(([stage, moment]) => t.test(stage + ' ' + moment, async t => {
    const f = fixtureProject(t);
    const proc = await f.start();
    const retention = stage === 'retention';
    const { session, deliveryId } = await f.spawn('leader', 'LEADER', retention ? {} : { mode: 'tui' });
    await f.waitMail(deliveryId);
    f.arm(stage, moment);
    if (retention) {
      const native = f.lines('runtime-pids.jsonl').find(row => row.session === session.sessionId);
      process.kill(native.pid, 'SIGKILL');
    } else {
      const panes = f.read('panes.json');
      panes[0].frame = '429 {"error":{"type":"rate_limit_error","message":"Too many requests"}}';
      f.write('panes.json', panes);
    }
    await f.killed(proc, stage, moment);
    await f.start();
    const event = await until(async () => {
      const { notifications } = await f.rpc('state', { target: session.addr });
      return notifications.find(event => (retention ? 'leader-exited' : 'stuck') === event.type);
    }, stage + ' recovered external event');
    assert.ok(event.id);
    if (retention) {
      const [row] = projectIndex(f.project).query({ addr: session.addr });
      assert.notEqual(row.endedAt, null);
      const manifests = await retainedRecords(f.project, row);
      assert.equal(manifests.length, 1);
      assert.equal(manifests[0].kind, 'session-end');
    } else {
      const stuck = f.lines('.project/watch/events.jsonl').filter(event => event.type === 'stuck');
      assert.equal(stuck.length, 1);
      assert.equal(stuck[0].incidentId, event.id);
    }
    assert.equal((await f.rpc('notifications', { take: true })).notifications.length, 1);
    assert.equal((await f.rpc('notifications', { take: true })).notifications.length, 0);
  })));
});
