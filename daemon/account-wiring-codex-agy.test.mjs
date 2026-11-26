import assert from 'node:assert/strict';
import { execFileSync, mkdtempSync } from '../fixtures/test-process.mjs';
import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { events } from '../holder/protocol.mjs';
import { codexPipeSession } from './codex-pipe-session.mjs';
import { createSupervisor } from './supervisor.mjs';
import { openTui } from './tui.mjs';
import { eventPath } from './io.mjs';

const fixtures = new URL('../adapters/accounts/fixtures/', import.meta.url);
const rollout = readFileSync(new URL('codex-rollout.jsonl', fixtures), 'utf8').trim().split('\n').map(JSON.parse);
const push = JSON.parse(readFileSync(new URL('codex-app-server-push.json', fixtures), 'utf8'));
const agy = JSON.parse(readFileSync(new URL('agy-statusline.json', fixtures), 'utf8'));

function projectFixture(t) {
  const project = mkdtempSync(join(realpathSync(tmpdir()), 'loom-passive-wiring-'));
  t.after(() => rmSync(project, { recursive: true, force: true }));
  mkdirSync(join(project, '.project'));
  writeFileSync(join(project, '.project', 'policy.json'), '{"preferred":[],"deny":[]}');
  const observations = () => JSON.parse(readFileSync(join(project, '.project', 'loomd', 'accounts.json'), 'utf8'));
  return { project, observations };
}

const spawn = (daemon, cwd, cli, mode) => daemon.handle('spawn', {
  role: 'leader', cli, mode, model: 'model', effort: 'high', cwd, project: cwd, prompt: 'Read passive account evidence',
});

test('loomd reads only a bound Codex rollout and persists the recorded windows', async t => {
  const { project, observations } = projectFixture(t);
  const id = randomUUID();
  const transcript = join(project, 'rollout.jsonl');
  const line = row => JSON.stringify(row) + '\n';
  writeFileSync(transcript, line({ type: 'session_meta', payload: { id, cli_version: '0.171.0', cwd: project } }));
  let onEvent;
  const daemon = createSupervisor(project, {
    report: () => {}, externalNotification: async () => {},
    accountOptions: { bindSession: () => ({ accountRef: 'fixture-codex', email: ['fixture', 'example.test'].join('@') }) },
    sessionOptions: { open: async () => ({
      id, status: () => ({ value: { kind: 'idle' } }),
      events: observer => { onEvent = observer; return () => {}; }, records: () => [], nativeSessionFile: async () => transcript,
    }) },
  });
  const { session } = await spawn(daemon, project, 'codex', 'headless');
  const timestamp = new Date(Math.max(Date.now(), session.startedAt)).toISOString();
  appendFileSync(transcript, [
    { ...rollout[1], timestamp, session_id: randomUUID() }, rollout[2], { ...rollout[0], timestamp },
  ].map(line).join(''));
  await daemon.tick();
  const { snapshots } = observations();
  assert.equal(snapshots.length, 1);
  const [window] = snapshots;
  assert.equal(window.cli, 'codex');
  assert.equal(window.session_id, id);
  assert.equal(window.source, 'codex-rollout');
  assert.equal(window.used_percent, 58);
  assert.equal(window.window_minutes, 10080);
  assert.equal(window.observed_at, timestamp);
  assert.equal(window.sequence, 4);
  assert.equal(window.account_ref, 'fixture-codex');
  assert.equal(window.masked_account, 'f***@example.test');
  onEvent({ kind: 'turn_ended', sessionId: id, agentPath: [], seq: 8, receivedAt: Date.now(),
    outcome: { kind: 'failed', failure: 'auth' } });
  const { incidents } = observations();
  assert.equal(incidents.length, 1);
  assert.equal(incidents[0].account_ref, 'fixture-codex');
  assert.equal(incidents[0].status, 'auth-expired');
});

test('the owned Codex pipe projects pushes once with holder sequence and the first receipt time', async t => {
  const { project } = projectFixture(t);
  const incarnation = randomUUID();
  const id = randomUUID();
  const addr = 'oar-' + randomUUID();
  const observedAt = Date.parse('2026-11-26T10:10:00.000Z');
  let clock = observedAt;
  let offset = 0n;
  const journal = [];
  const output = frame => {
    const data = Buffer.from(JSON.stringify(frame) + '\n');
    journal.push({ type: events.output, seq: BigInt(journal.length + 1), offset, data });
    offset += BigInt(data.length);
  };
  const client = {
    snapshot: async () => ({ pipes: true, eventSeq: BigInt(journal.length), outputOffset: offset, stderrOffset: 0n }),
    read: async after => journal.filter(event => event.seq > after),
    async write(_, data) {
      const request = JSON.parse(data);
      if (request.method === 'initialize') output({ id: request.id, result: { userAgent: 'loom/0.171.0 (fixture)' } });
      if (request.method === 'thread/start') output({ id: request.id, result: { thread: { id } } });
      return { status: 'applied', written: data.length };
    },
  };
  const open = () => codexPipeSession(project, { addr, cwd: project }, project, incarnation, client,
    () => {}, () => false, { now: () => clock });
  const first = open();
  await first.ready();
  output(push);
  await first.pull();
  const rows = () => readFileSync(eventPath(project, addr), 'utf8').trim().split('\n').map(JSON.parse)
    .filter(row => row.type === 'account-evidence');
  const [evidence] = rows();
  assert.equal(evidence.sessionId, id);
  assert.equal(evidence.incarnation, incarnation);
  assert.equal(evidence.observations[0].observed_at, new Date(observedAt).toISOString());
  assert.equal(evidence.observations[0].sequence, journal.length * 8192);
  assert.equal(evidence.observations[0].used_percent, 64);
  // There is no holder wall time for bytes first encountered during reattachment.
  clock += 60_000;
  output(push);
  await open().pull();
  assert.deepEqual(rows(), [evidence]);
});

test('agy launch settings pass statusline data through loomd into the project account store', async t => {
  const { project, observations } = projectFixture(t);
  const nativeId = agy.session_id;
  const terminalPath = join(project, 'pane.json');
  const argvPath = join(project, 'argv.json');
  const substitute = join(project, 'agy-fixture');
  const hc = join(project, 'hc-fixture.cjs');
  // The normal TUI version probe runs against this explicitly bound fake executable.
  writeFileSync(substitute, `#!${process.execPath}\nif (process.argv.slice(2).join(' ') !== '--version') process.exit(19);\nconsole.log('1.5.17');\n`, { mode: 0o700 });
  writeFileSync(hc, `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
const path = ${JSON.stringify(terminalPath)};
if (args[0] === 'run') {
  const next = name => args[args.indexOf(name) + 1];
  const labels = Object.fromEntries(args.slice(0, args.indexOf('--')).flatMap((value, i) =>
    value === '--label' ? [args[i + 1].split('=')] : []));
  const terminal = { name: next('--name'), cwd: next('--cwd'), labels, address: 't1234',
    created_ms: Date.now(), status_ms: Date.now(), state: 'live', pid: process.pid };
  fs.writeFileSync(path, JSON.stringify(terminal));
  fs.writeFileSync(${JSON.stringify(argvPath)}, JSON.stringify(args.slice(args.indexOf('--') + 1)));
}
console.log(fs.readFileSync(path, 'utf8'));
`, { mode: 0o700 });

  const previousAgy = process.env.LOOM_AGY_BIN;
  process.env.LOOM_AGY_BIN = substitute;
  t.after(() => {
    if (previousAgy === undefined) delete process.env.LOOM_AGY_BIN;
    else process.env.LOOM_AGY_BIN = previousAgy;
  });
  const userCommand = '/bin/cat';
  const daemon = createSupervisor(project, {
    report: () => {}, externalNotification: async () => {},
    sessionOptions: {
      accountStatusline: () => ({ statusLine: { type: 'command', command: userCommand } }),
      callHc: async command => {
        if (command === 'get') return JSON.parse(readFileSync(terminalPath, 'utf8'));
        if (command === 'read') return { text: '' };
        throw new Error(`Unexpected account fixture hc command ${command}`);
      },
      getPane: async () => {
        try { return JSON.parse(readFileSync(terminalPath, 'utf8')); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      },
      openPane: (job, row, project, recordTemporary, recordBinding, controller, capabilityPath, statusline) =>
        openTui({ ...job, tui: { transport: 'plain-hc' }, herdr: { hcCommand: hc } },
          row, project, recordTemporary, recordBinding, controller, capabilityPath, statusline),
    },
  });
  const { session } = await spawn(daemon, project, 'agy', 'tui');
  const argv = JSON.parse(readFileSync(argvPath, 'utf8'));
  const settings = JSON.parse(argv[argv.indexOf('--settings') + 1]);
  const input = JSON.stringify(agy) + '\n';
  const run = payload => execFileSync('/bin/sh', ['-c', settings.statusLine.command], {
    cwd: project, env: { HOME: project, PATH: '', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
    input: payload, encoding: 'utf8',
  });
  assert.equal(run(JSON.stringify({ ...agy, session_id: 'foreign-session' })), JSON.stringify({ ...agy, session_id: 'foreign-session' }));
  assert.equal(run(input), input);
  appendFileSync(eventPath(project, session.addr), JSON.stringify({
    cwd: project, conversationId: nativeId, hook_event_name: 'Stop', receivedAt: Date.now(), fullyIdle: true,
  }) + '\n');
  await daemon.tick();
  const { snapshots } = observations();
  assert.equal(snapshots.length, 2);
  assert.ok(snapshots.every(row => row.cli === 'agy' && row.session_id === nativeId && row.source === 'agy-statusline'));
  assert.deepEqual(snapshots.map(({ model, window_minutes, used_percent }) => [model, window_minutes, used_percent]), [
    ['Gemini Models', 300, 25.6], ['Gemini Models', 10080, 13.6],
  ]);
});
