import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { openIndex } from '../index/index.mjs';
import { spawnProfile } from './policy.mjs';
import { projectIndex, socketPath } from './project.mjs';
import { estimateTokens } from '../lib/token-budget.mjs';
import { writeMemory } from '../memory/project.mjs';

const executable = fileURLToPath(new URL('../bin/loom', import.meta.url));
const file = path => new URL(path, import.meta.url);

function fixture(t) {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'loom-cli-')));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const path = join(cwd, 'index.sqlite');
  const index = openIndex(path);
  const env = { ...process.env, HC_TERMINAL_ID: '', LOOM_PROJECT: '', LOOM_ADDR: '', LOOM_INDEX_PATH: path, PATH: `${cwd}${delimiter}${process.env.PATH}` };
  const cli = (...args) => spawnSync(executable, args, { cwd, env, encoding: 'utf8' });
  const run = (code, ...args) => {
    const result = cli(...args);
    assert.equal(result.status, code, result.stderr || result.stdout);
    return JSON.parse(result.stdout);
  };
  const register = (addr, changes = {}) => index.register({ addr, project: cwd, backend: 'tui', cli: 'codex', cwd, ...changes });
  return { cwd, index, env, cli, run, register };
}

test('memory search limits count and serialized tokens across title and keyword matches', t => {
  const f = fixture(t);
  const project = join(f.cwd, 'other');
  mkdirSync(project);
  writeFileSync(join(project, 'proof.txt'), 'proof');
  for (let n = 0; n < 12; n++) {
    writeMemory(project, { id: `fact-${n}`, scope: 'project', owner: 'leader',
      source: 'proof.txt', verified: '2025-01-01', keywords: n < 6 ? 'short' : 'long',
      title: n < 6 ? `Fact ${n}` : '限'.repeat(115) + n, body: 'Confirmed.' });
  }
  const args = ['--project', project, '--json'];
  assert.equal(f.run(0, 'memory', 'search', 'short', ...args).length, 5);
  const long = f.cli('memory', 'search', '限', ...args);
  assert.equal(long.status, 0, long.stderr || long.stdout);
  assert.equal(JSON.parse(long.stdout).length, 3);
  assert.ok(estimateTokens(long.stdout) <= 500);
  assert.match(f.cli('memory', 'search', 'Fact 0', '--project', project).stdout, /fact-0\.md.*Fact 0/);
  assert.deepEqual(f.run(0, 'memory', 'search', 'short', '--json'), []);
  assert.equal(f.run(2, 'memory', 'search').error.code, 'invalid-arguments');
});

test('lists the index and reads the newest requested turns from native Codex and agy headless logs', t => {
  const f = fixture(t);
  assert.deepEqual(f.run(0, 'ls').sessions, []);
  f.register('t1', { role: 'worker', task: 'T1', backend: 'headless', transcriptPath: fileURLToPath(file('../adapters/codex/fixtures/experiment/codex.jsonl')) });
  const other = join(f.cwd, 'other');
  mkdirSync(other);
  f.register('t2', { project: other, role: 'worker', backend: 'headless', cli: 'agy',
    transcriptPath: fileURLToPath(file('../adapters/agy/fixtures/orca-experiment.jsonl')) });

  assert.deepEqual(f.run(0, 'ls', '--project', f.cwd).sessions.map(row => row.addr), ['t1']);
  const l1 = f.run(0, 'hist', 'T1', '--turns', '2', '--json').turns;
  assert.deepEqual(l1.map(turn => turn.index), [4, 5]);
  assert.ok(l1.every(turn => Buffer.byteLength(turn.summary) <= 800));
  assert.match(l1[1].summary, /回复.*非零退出.*\(1\)/s);
  assert.equal(l1[1].status, 'completed');
  assert.ok(!l1[1].outcomes.includes('failed'));
  const l2 = f.run(0, 'hist', 't1', '--level', 'L2', '--json').turns;
  assert.equal(l2.length, 1);
  assert.match(l2[0].reply, /预期的文件不存在错误/);
  assert.equal(l2[0].calls, undefined);
  assert.equal(l2[0].tools[0].ordinal, 1);
  assert.ok(l2[0].tools[0].timestamp);
  assert.equal(f.run(0, 'hist', 't1', '--with-calls', '--json').turns[0].calls.length, 2);
  assert.ok(f.run(0, 'hist', 't2', '--turns', '1', '--json').turns[0].summary);
  assert.equal(f.run(2, 'hist', 't1', '--turns', '0', '--json').error.code, 'invalid-arguments');
  assert.equal(f.run(3, 'hist', 'nobody', '--json').error.code, 'not-found');
});

test('L2 distinguishes explicit tool cancellation from work still open at interruption', t => {
  const f = fixture(t);
  const path = join(f.cwd, 'interrupted.jsonl');
  const time = new Date().toISOString();
  const call = id => ({ type: 'tool_use', id, name: 'Bash', input: { command: 'echo ' + id } });
  const result = (id, fields = {}) => ({ ...fields, message: { content: [{ type: 'tool_result', tool_use_id: id,
    ...(fields.is_error && { is_error: true }), content: 'tool response' }] }, type: 'user' });
  const rows = [
    { type: 'user', uuid: 'input', message: { content: 'Start several tools' } },
    { type: 'assistant', uuid: 'tools', message: { content: ['done', 'fail', 'cancel', 'open'].map(call) } },
    result('done'),
    result('fail', { is_error: true }),
    result('cancel', { toolUseResult: { interrupted: true } }),
    { type: 'user', message: { content: '[Request interrupted by user]' } },
  ].map(row => JSON.stringify({ ...row, timestamp: time }));
  writeFileSync(path, rows.join('\n') + '\n');
  f.register('t-interrupted', { cli: 'claude', transcriptPath: path });
  const [turn] = f.run(0, 'hist', 't-interrupted', '--level', 'L2', '--json').turns;
  assert.equal(turn.status, 'interrupted');
  assert.deepEqual(turn.tools.map(tool => tool.status), ['completed', 'failed', 'canceled', 'open']);
  assert.equal(turn.facts.openCalls, 1);
  assert.deepEqual(f.run(0, 'hist', 't-interrupted', '--only-failed', '--json').turns[0].tools.map(tool => tool.status), ['failed']);
});

test('status JSON shows the auth mode from Claude launch evidence even offline', t => {
  const f = fixture(t);
  const jobs = join(f.cwd, '.project', 'loomd', 'sessions');
  mkdirSync(jobs, { recursive: true });
  for (const authMode of ['subscription', 'api-key']) {
    const addr = 'loom-' + authMode;
    projectIndex(f.cwd).register({ addr, project: f.cwd, cwd: f.cwd, cli: 'claude', backend: 'tui' });
    writeFileSync(join(jobs, addr + '.json'), JSON.stringify({ authMode }));
  }
  const result = f.run(0, 'status', '--project', f.cwd, '--json');
  assert.deepEqual(result.sessions.map(row => row.authMode).sort(), ['api-key', 'subscription']);
});

test('queries parent chains and role timelines by time and turn across sessions', t => {
  const f = fixture(t);
  function transcript(name, time) {
    const path = join(f.cwd, `${name}.jsonl`);
    const rows = [
      { type: 'task_started', turn_id: name },
      { type: 'user_message', message: `verify ${name}` },
      { type: 'task_complete', turn_id: name, last_agent_message: name },
    ].map(payload => JSON.stringify({ type: 'event_msg', timestamp: time, payload }));
    writeFileSync(path, rows.join('\n') + '\n');
    return path;
  }
  const first = '2026-11-24T00:00:00Z';
  const next = '2026-11-24T01:00:00Z';
  f.register('t-super', { role: 'super', transcriptPath: transcript('outside', first) });
  f.register('t-old', { role: 'leader', parent: 't-super', transcriptPath: transcript('before', first) });
  f.register('t-new', { role: 'leader', parent: 't-old', transcriptPath: transcript('after', next) });
  f.register('t-other', { role: 'leader', project: join(f.cwd, 'Q') });
  const byAddr = f.run(0, 'hist', 't-new', '--json');
  assert.deepEqual(byAddr.turns.map(turn => turn.addr), ['t-old', 't-new']);
  assert.equal(f.run(3, 'hist', 'leader', '--json').error.code, 'ambiguous-target');
  f.env.HC_TERMINAL_ID = 't-super';
  assert.equal(f.run(0, 'hist', 'leader', '--json').addr, 't-new');

  const role = ['hist', '--role', 'leader', '--project', f.cwd, '--json'];
  assert.deepEqual(f.run(0, ...role, '--since', next).turns.map(turn => turn.addr), ['t-new']);
  assert.deepEqual(f.run(0, ...role, '--since', 'turn:2').turns.map(turn => turn.timelineIndex), [2]);
  assert.equal(f.run(0, ...role, '--since', 'turn:t-old#1', '--level', 'L2').turns[0].reply, 'before');
  assert.equal(f.run(2, ...role, '--since', 'yesterday').error.code, 'invalid-arguments');

  f.register('t-unbound', { role: 'leader', parent: 't-new' });
  const partial = f.run(0, ...role);
  assert.equal(partial.turns.length, 2);
  assert.deepEqual(partial.missing.map(row => [row.addr, row.code]), [['t-unbound', 'not-ready']]);

  f.register('t-z', { project: 'undated', role: 'auditor', transcriptPath: transcript('first', undefined) });
  f.register('t-a', { project: 'undated', role: 'auditor', parent: 't-z', transcriptPath: transcript('second', undefined) });
  const undated = f.run(0, 'hist', '--role', 'auditor', '--project', f.cwd, '--json');
  assert.deepEqual(undated.turns.map(turn => turn.addr), ['t-z', 't-a']);
});

test('classifies hc read JSON and reports the headless stub, exits and read errors', t => {
  const f = fixture(t);
  const screen = readFileSync(file('../adapters/codex/fixtures/live/trust.txt'), 'utf8');
  f.env.LOOM_TEST_SCREEN = JSON.stringify({ text: screen });
  writeFileSync(join(f.cwd, 'hc'), '#!/bin/sh\n[ "$*" = "read --json -- t1" ] || exit 8\nprintf "%s\\n" "$LOOM_TEST_SCREEN"\n', { mode: 0o700 });
  f.register('t1');
  f.register('t2', { backend: 'headless' });
  f.register('t3', { endedAt: 100 });
  f.register('t4');
  const { state, reason, project, signals } = f.run(0, 'state', 't1');
  assert.equal(state, 'stuck');
  assert.equal(reason, 'trust');
  assert.equal(project, f.cwd);
  assert.deepEqual(signals.context, { tokens: null, contextWindow: null, percent: null });
  assert.equal(f.run(1, 'state', 't2').error.code, 'unsupported');
  assert.equal(f.run(0, 'state', 't3').state, 'exited');
  assert.equal(f.run(1, 'state', 't4').error.code, 'unavailable');
  assert.equal(f.run(1, 'hist', 't1', '--json').error.code, 'not-ready');
});

test('validates the policy example and rejects malformed capacity, drift, fast and model guidance', t => {
  const { cwd } = fixture(t);
  mkdirSync(join(cwd, '.project'));
  const path = join(cwd, '.project', 'policy.json');
  const example = JSON.parse(readFileSync(file('../examples/policy.json'), 'utf8'));
  assert.ok(!example.deny.some(({ cli }) => cli === 'claude'));
  for (const role of ['super', 'leader', 'auditor', 'reviewer', 'worker']) {
    assert.ok(new Set(example.roles[role].preferred.map(({ cli }) => cli)).size >= 2, `${role} needs at least two CLI vendors`);
  }
  const select = role => spawnProfile(cwd, { role }).selected;
  writeFileSync(path, JSON.stringify(example));
  assert.equal(select('leader').effort, 'high');
  assert.equal(select('worker').effort, 'medium');
  assert.notEqual(select('auditor').cli, select('worker').cli);

  for (const invalid of [
    { roles: { leader: { maxActiveWorkers: 5 } } },
    { roles: { leader: { maxActiveWorkers: 2.5 } } },
    { roles: { worker: { maxActiveWorkers: 3 } } },
    { drift: { slowCommandFactor: 1 } },
    { delivery: { coalesceMs: -1 } },
    { roles: { reviewer: { maxDurationMs: 0 } } },
    { roles: { leader: { auth: 'yes' } } },
    { roles: { worker: { preferred: [{ cli: 'codex', model: 'fixture', effort: 'high', fast: 'true' }] } } },
    { roles: { auditor: { guidance: { vendorFamily: 'same' } } } },
    { roles: { worker: { guidance: { routineEffort: ['xhigh'] } } } },
  ]) {
    writeFileSync(path, JSON.stringify({ ...example, ...invalid }));
    assert.throws(() => select('worker'), { code: 'invalid-policy' });
  }
});

test('worker admission counts live sessions by parent and project across waves', async t => {
  const { cwd, env } = fixture(t);
  mkdirSync(join(cwd, '.project'));
  const policy = join(cwd, '.project', 'policy.json');
  writeFileSync(policy, '{}');
  const index = projectIndex(cwd);
  const register = (addr, role, changes = {}) =>
    index.register({ addr, role, project: cwd, backend: 'headless', cli: 'codex', cwd, ...changes });
  register('lead', 'leader', { pane: 'lead-pane' });
  register('other-lead', 'leader');
  register('foreign', 'worker', { project: 'other-project', parent: 'lead' });
  register('exited', 'worker', { parent: 'lead', endedAt: 1 });
  register('other', 'worker', { parent: 'other-lead' });
  register('audit', 'auditor', { parent: 'lead' });
  register('initial', 'worker', { parent: 'lead', wave: 'earlier' });

  const server = createServer(socket => {
    socket.once('data', body => {
      const { args, caller } = JSON.parse(body);
      try {
        assert.equal(args.workerCaller, caller);
        if (args.task === 'second') assert.deepEqual([args.deliver, args.barrier], ['barrier', 'W']);
        spawnProfile(cwd, args);
        const session = register(args.task, 'worker', { parent: 'lead', wave: args.wave });
        socket.end(JSON.stringify({ ok: true, session }));
      } catch (error) {
        socket.end(JSON.stringify({ ok: false, error: { code: error.code, message: error.message } }));
      }
    });
  }).listen(socketPath(cwd));
  t.after(() => new Promise(resolve => server.close(resolve)));
  await once(server, 'listening');

  async function spawn(task, ...parent) {
    const args = [executable, 'spawn', 'worker', '--cwd', cwd, '--project', cwd, '--task', task,
      '--wave', task, '--cli', 'codex', '--model', 'fixture', '--effort', 'medium', ...parent, 'start'];
    try {
      const { stdout } = await promisify(execFile)(process.execPath, args, { env: { ...env, HC_TERMINAL_ID: 'lead-pane' } });
      return JSON.parse(stdout);
    } catch (error) {
      assert.equal(error.code, 1, error.stderr);
      return JSON.parse(error.stdout);
    }
  }
  assert.equal((await spawn('second', '--parent', 'lead', '--deliver', 'barrier', '--barrier', 'W')).ok, true);
  const attempts = await Promise.all([spawn('third'), spawn('fourth', '--parent', 'lead-pane')]);
  assert.equal(attempts.filter(result => result.ok).length, 1);
  assert.match(attempts.find(result => !result.ok).error.message, /lead.*3 active workers \(limit 3\)/);
  index.update('initial', { endedAt: 2 });
  assert.equal((await spawn('replacement')).ok, true);

  writeFileSync(policy, '{"roles":{"leader":{"maxActiveWorkers":4}}}');
  assert.equal((await spawn('extra-one')).ok, true);
  assert.equal((await spawn('extra-two')).error.code, 'worker-capacity');
  assert.equal((await spawn('over-limit')).error.code, 'worker-capacity');
});

test('prints the project board while offline and sends an explicit switch profile to loomd', async t => {
  const f = fixture(t);
  mkdirSync(join(f.cwd, '.project', 'loomd'), { recursive: true });
  projectIndex(f.cwd).register({ addr: 'lead', role: 'leader', project: f.cwd, backend: 'headless',
    cli: 'codex', cwd: f.cwd });
  const board = f.run(0, 'status', '--project', f.cwd, '--json');
  assert.equal(board.running, false);
  assert.equal(board.sessions[0].state, 'offline');
  assert.deepEqual(board.notices, []);
  assert.match(f.cli('status', '--project', f.cwd).stdout, /Roles.*leader codex offline.*\n.*Waves and cards/s);
  const server = createServer(socket => {
    socket.once('data', body => {
      const { command, args } = JSON.parse(body);
      socket.end(JSON.stringify({ ok: true, command, ...args }));
    });
  }).listen(socketPath(f.cwd));
  t.after(() => new Promise(resolve => server.close(resolve)));
  await once(server, 'listening');
  const { stdout } = await promisify(execFile)(process.execPath, [executable, 'switch', 'worker',
    '--project', f.cwd, '--to', 'codex/fixture/high/fast'], { env: f.env });
  const receipt = JSON.parse(stdout);
  assert.equal(receipt.command, 'switch');
  assert.equal(receipt.role, 'worker');
  assert.equal(receipt.to, 'codex/fixture/high/fast');
});

test('cost totals native usage and counts only calls after the passing result', t => {
  const f = fixture(t);
  function transcript(name, entries) {
    const path = join(f.cwd, `${name}.jsonl`);
    writeFileSync(path, entries.map(([seconds, type, payload]) =>
      JSON.stringify({ type, timestamp: new Date(seconds * 1000).toISOString(), payload })).join('\n') + '\n');
    return path;
  }
  const start = (time, id) => [time, 'event_msg', { type: 'task_started', turn_id: id }];
  const end = (time, id) => [time, 'event_msg', { type: 'task_complete', turn_id: id, last_agent_message: 'DONE' }];
  const call = (time, id, input, cached, write, output) => [time, 'token_usage_record', { response_id: id, usage: {
    input_tokens: input, cached_input_tokens: cached, cache_write_input_tokens: write, output_tokens: output,
  } }];
  const command = (time, id) => [time, 'response_item', { type: 'function_call', call_id: id,
    name: 'exec_command', arguments: '{"cmd":"npm test"}' }];
  const result = (time, id, exitCode) => [time, 'event_msg', { type: 'exec_command_end', call_id: id, exit_code: exitCode }];
  const worker = transcript('worker', [
    start(1, 'worker-1'), command(2, 'early-pass'), result(3, 'early-pass', 0), call(4, 'early', 100, 50, 0, 5),
    command(5, 'final-pass'), call(6, 'during', 110, 60, 10, 5), result(7, 'final-pass', 0),
    call(8, 'tail', 120, 80, 0, 5), end(9, 'worker-1'),
    start(10, 'worker-2'), command(11, 'fail'), result(12, 'fail', 1), call(13, 'failure', 30, 0, 0, 5), end(14, 'worker-2'),
  ]);
  f.register('worker', { role: 'worker', task: 'TEST', transcriptPath: worker });
  f.register('worker-alias', { role: 'worker', transcriptPath: worker });
  f.register('leader', { role: 'leader', transcriptPath: transcript('leader', [
    start(20, 'leader-1'), call(21, 'startup', 20, 0, 0, 5), end(22, 'leader-1'),
    start(23, 'leader-2'), call(24, 'wake', 10, 5, 0, 5), end(25, 'leader-2'),
  ]) });
  f.register('unbound', { role: 'auditor' });
  f.register('foreign', { role: 'worker', project: join(f.cwd, 'other') });

  const report = f.run(0, 'cost', '--project', f.cwd);
  assert.deepEqual(report.byRole.worker, {
    sessions: 2, turns: 2, turnsWithUsage: 2, modelCalls: 4, rawTokens: 380, inputTokens: 360,
    freshInputTokens: 160, cachedInputTokens: 190, cacheWriteInputTokens: 10, outputTokens: 20, reasoningOutputTokens: 0,
  });
  assert.equal(report.leaderWakes, 1);
  assert.equal(report.rawTokens, 420);
  assert.equal(report.workerShare, 380 / 420);
  assert.deepEqual(report.workerTurns.map(turn => [turn.turn, turn.modelCalls, turn.lastPassingAcceptanceAt, turn.callsAfterAcceptance]), [
    [1, 3, new Date(7000).toISOString(), 1], [2, 1, null, null],
  ]);
  assert.deepEqual(report.missing, [{ addr: 'unbound', code: 'not-ready' }]);
});

test('cost splits Claude and agy cache usage and pairs their passing results', t => {
  const f = fixture(t);
  const time = seconds => new Date(seconds * 1000).toISOString();
  const add = (cli, rows) => {
    const transcriptPath = join(f.cwd, `${cli}.jsonl`);
    writeFileSync(transcriptPath, rows.map(row => JSON.stringify(row)).join('\n') + '\n');
    f.register(cli, { role: 'worker', cli, transcriptPath });
  };
  const agy = (step_index, source, type, payload) =>
    ({ step_index, source, type, created_at: time(step_index + 1), ...payload });
  const agyUsage = { input_tokens: 10, cache_read_tokens: 5, cache_write_tokens: 3, output_tokens: 2 };
  add('agy', [
    agy(0, 'USER_EXPLICIT', 'USER_INPUT', { content: 'Run acceptance' }),
    agy(1, 'MODEL', 'PLANNER_RESPONSE', { ...agyUsage, tool_calls: [{ name: 'run_command', args: { CommandLine: 'npm test' } }] }),
    agy(2, 'MODEL', 'GENERIC', { content: 'Command exited with code 0.\nCommand output:\npassed' }),
    agy(3, 'MODEL', 'PLANNER_RESPONSE', { ...agyUsage, content: 'DONE' }),
  ]);
  const claude = (seconds, type, content, message = {}) =>
    ({ timestamp: time(seconds), uuid: String(seconds), type, message: { content, ...message } });
  const claudeUsage = { input_tokens: 10, cache_read_input_tokens: 5, cache_creation_input_tokens: 3, output_tokens: 2 };
  add('claude', [
    claude(1, 'user', [{ type: 'text', text: 'Run acceptance' }]),
    claude(2, 'assistant', [{ type: 'tool_use', id: 'check', name: 'Bash', input: { command: 'npm test' } }],
      { stop_reason: 'tool_use', usage: claudeUsage }),
    claude(3, 'user', [{ type: 'tool_result', tool_use_id: 'check', content: 'passed' }]),
    claude(4, 'assistant', [{ type: 'text', text: 'DONE' }], { stop_reason: 'end_turn', usage: claudeUsage }),
  ]);

  const report = f.run(0, 'cost', '--project', f.cwd);
  const { rawTokens, freshInputTokens, cachedInputTokens, cacheWriteInputTokens } = report.byRole.worker;
  assert.deepEqual([rawTokens, freshInputTokens, cachedInputTokens, cacheWriteInputTokens], [80, 40, 20, 12]);
  assert.deepEqual(report.workerTurns.map(turn => [turn.addr, turn.lastPassingAcceptanceAt, turn.callsAfterAcceptance]),
    [['agy', time(3), 1], ['claude', time(3), 1]]);
});
