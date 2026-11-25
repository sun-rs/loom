import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import codex, { codex as named } from './index.mjs';
import { plan } from './input.mjs';

function fixture(path) {
  return readFileSync(new URL(`./fixtures/${path}`, import.meta.url), 'utf8');
}

function rows(text) {
  return text.trim().split('\n').map(line => JSON.parse(line));
}

function scratch(t) {
  const directory = mkdtempSync(join(tmpdir(), 'loom-codex-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('exports the native TUI adapter and measured capabilities', () => {
  assert.equal(named, codex);
  assert.equal(codex.id, 'codex');
  assert.deepEqual(codex.capabilities, {
    steer: 'native', interrupt: true, resumeSamePane: true, hookInjection: 'cli-flag',
  });
});

test('launch configures an isolated native TUI invocation and quotes the hook sink', t => {
  const root = scratch(t);
  const cwd = join(root, 'repo.="a b"');
  mkdirSync(cwd);
  const hookSink = 'events dir/cli\'s events.jsonl';
  const { argv, env } = codex.launch({
    cwd, model: 'small-model', effort: 'low', hookSink, prompt: '-- How much is 2 + 2?',
    extraArgs: ['-c', 'web_search="disabled"'],
  });
  assert.equal(argv[0], 'codex');
  assert.ok(argv.includes('--no-daemon'));
  assert.ok(argv.includes('--no-alt-screen'));
  assert.equal(argv[argv.indexOf('--ask-for-approval') + 1], 'never');
  assert.equal(argv[argv.indexOf('--sandbox') + 1], 'workspace-write');
  assert.equal(argv[argv.indexOf('--model') + 1], 'small-model');
  assert.ok(argv.includes('model_reasoning_effort="low"'));
  const directory = realpathSync(cwd);
  assert.equal(argv[argv.indexOf('--cd') + 1], directory);
  assert.ok(argv.includes(`projects={${JSON.stringify(directory)}={trust_level="trusted"}}`));
  assert.ok(argv.includes('check_for_update_on_startup=false'));
  assert.ok(argv.includes('web_search="disabled"'));
  assert.deepEqual(argv.slice(-2), ['--', '-- How much is 2 + 2?']);
  assert.deepEqual(env, {});
  const state = argv.find(arg => arg.startsWith('hooks.state='));
  assert.equal([...state.matchAll(/trusted_hash="sha256:[a-f0-9]{64}"/g)].length, 5);
  assert.match(state, /<session-flags>\/config.toml:stop:0:0/);
  assert.equal(existsSync(join(cwd, '.codex')), false);
  assert.equal(existsSync(join(cwd, hookSink)), false);

  const stopConfig = argv.find(arg => arg.startsWith('hooks.Stop='));
  const command = JSON.parse(/command=("(?:[^"\\]|\\.)*")/.exec(stopConfig)[1]);
  const payload = { ...rows(fixture('live/hooks.jsonl'))[1], prompt: 'excluded', tool_input: { input: 'excluded' } };
  const capture = spawnSync('/bin/sh', ['-c', command], { input: JSON.stringify(payload), cwd, encoding: 'utf8' });
  assert.equal(capture.status, 0, capture.stderr);
  assert.equal(capture.stdout, '');
  const [written] = rows(readFileSync(join(cwd, hookSink), 'utf8'));
  assert.ok(written.receivedAt > 0);
  assert.equal(written.turn_id, payload.turn_id);
  assert.equal(written.last_assistant_message, '4');
  assert.equal(written.prompt, undefined);
  assert.equal(written.tool_input, undefined);
});

test('supports launch without a prompt or hook sink and reserves the prompt separator', () => {
  const cwd = process.cwd();
  const { argv } = codex.launch({ cwd });
  assert.ok(!argv.includes('--'));
  assert.ok(!argv.some(arg => arg.startsWith('hooks.')));
  assert.throws(() => codex.launch({ cwd, extraArgs: ['--'] }), TypeError);
  assert.throws(() => codex.launch({ cwd, hookSink: '' }), TypeError);
});

for (const [path, expected] of [
  ['live/trust.txt', 'trust-dialog'],
  ['live/picker.txt', 'picker'],
  ['live/idle.txt', 'idle'],
  ['live/busy.txt', 'busy'],
  ['live/queue.txt', 'busy'],
  ['live/steer.txt', 'busy'],
  ['live/interrupted.txt', 'idle'],
  ['orca/codex-model-capacity.txt', 'rate-limit'],
  ['experiment/codex-idle.txt', 'idle'],
  ['experiment/codex-busy.txt', 'busy'],
  ['experiment/codex-auth-fail-synthetic.txt', 'auth-fail'],
  ['experiment/codex-rate-limit-synthetic.txt', 'rate-limit'],
  ['experiment/codex-trust-dialog-synthetic.txt', 'trust-dialog'],
  ['experiment/codex-tool-error.txt', 'idle'],
]) {
  test(`classifies ${path} as ${expected}`, () => {
    assert.equal(codex.screen.classify(fixture(path)), expected);
  });
}

test('ignores stale errors from before the latest turn and returns keys for known menus', () => {
  const { classify, dialogKeys } = codex.screen;
  assert.equal(classify(''), 'unknown');
  assert.equal(classify('› earlier\n• Error: HTTP 429\n\n› new question\n\n• Working (2s • esc to interrupt)\n\n› Ask Codex to do anything'), 'busy');
  assert.equal(classify('\x1b[31m■ Unexpected status 401 Unauthorized\x1b[0m'), 'auth-fail');
  assert.deepEqual(dialogKeys('trust-dialog', fixture('live/trust.txt')), ['enter']);
  assert.deepEqual(dialogKeys('picker', fixture('live/picker.txt')), ['esc']);
  assert.deepEqual(dialogKeys('unknown'), []);
});

test('normalizes native hook rows including final replies and cancelled turns', () => {
  const raw = rows(fixture('live/hooks.jsonl'));
  const normal = raw.map(codex.hooks.normalize);
  assert.deepEqual(normal[0], { type: 'turn-start', sessionId: raw[0].session_id, transcriptPath: raw[0].transcript_path });
  assert.deepEqual(normal[1], { ...normal[0], type: 'turn-end', finalReply: '4' });
  assert.ok(normal.every(event => event.sessionId === raw[0].session_id));
  assert.deepEqual(normal.filter(event => event.type === 'stop-failure'), [
    { ...normal[0], type: 'stop-failure' }, { ...normal[0], type: 'stop-failure' },
  ]);
  assert.deepEqual(raw.filter(row => row.turn_id === 'turn-4').map(row => row.hook_event_name),
    ['UserPromptSubmit', 'UserPromptSubmit', 'Stop']);
  assert.deepEqual(normal.filter(event => event.type === 'turn-end').map(event => event.finalReply),
    ['4', '7', '8', '9', '6', '6']);
  assert.equal(codex.hooks.normalize({ ...raw[0], agent_id: 'child' }), null);
  assert.equal(codex.hooks.normalize({ ...raw[0], hook_event_name: 'SessionStart' }), null);
  assert.equal(codex.hooks.normalize(null), null);
});

test('normalizes tools, nullable rollouts, and failure events', () => {
  const payload = { session_id: 's', transcript_path: null };
  const expected = { sessionId: 's', transcriptPath: null };
  for (const hook of ['PreToolUse', 'PostToolUse']) {
    assert.deepEqual(codex.hooks.normalize({ ...payload, hook_event_name: hook }), { ...expected, type: 'tool' });
  }
  assert.deepEqual(codex.hooks.normalize({ ...payload, hook_event_name: 'StopFailure' }), { ...expected, type: 'stop-failure' });
  assert.deepEqual(codex.hooks.normalize({ ...payload, hook_event_name: 'Stop', last_assistant_message: ' \n ' }),
    { ...expected, type: 'turn-end' });
});

test('locates the matching active or archived session, ignoring unrelated and linked files', t => {
  const root = scratch(t);
  const cwd = join(root, 'workspace');
  mkdirSync(cwd);
  const { session_id: sessionId } = rows(fixture('live/hooks.jsonl'))[0];
  const home = join(root, 'codex-home');
  const name = `rollout-2026-11-25T01-00-00-${sessionId}.jsonl`;
  const active = join(home, 'sessions', '2026', '11', '25', name);
  const archived = join(home, 'archived_sessions', name);
  const metadata = `\uFEFF${JSON.stringify({ type: 'session_meta', payload: { id: sessionId, cwd } })}\r\n`;
  for (const path of [active, archived]) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, metadata);
  }

  const request = { sessionId, cwd, codexHome: home };
  assert.equal(codex.transcript.locate(request), realpathSync(active));
  assert.equal(codex.transcript.locate({ ...request, cwd: join(root, 'different') }), null);
  assert.equal(codex.transcript.locate({ ...request, sessionId: `${sessionId}12` }), null);
  assert.equal(codex.transcript.locate({ ...request, sessionId: '../other' }), null);
  rmSync(active);
  symlinkSync(archived, active);
  assert.equal(codex.transcript.locate(request), realpathSync(archived));
  writeFileSync(archived, 'invalid header\n');
  assert.equal(codex.transcript.locate(request), null);
});

test('keeps queue, steer and interrupt boundaries in the native rollout', () => {
  const session = codex.transcript.parse(fixture('live/rollout.jsonl'));
  assert.deepEqual(session.turns.map(turn => turn.id), Array.from({ length: 8 }, (_, i) => `turn-${i + 1}`));
  assert.deepEqual(session.turns.map(turn => turn.reply), ['4', '7', '8', '9', null, '6', null, '6']);
  assert.deepEqual(session.turns.filter(turn => turn.status === 'interrupted').map(turn => turn.index), [5, 7]);
  assert.match(codex.transcript.turnSummary(session, 4), /STEER-BASE.+STEER-NEXT/);
  assert.equal(codex.transcript.turnSummary(session, 0), null);
  assert.equal(codex.transcript.turnSummary(session, 9), null);
});

test('summarizes commands and tool counts in the experimental rollout', () => {
  const session = codex.transcript.parse(fixture('experiment/codex.jsonl'));
  const last = codex.transcript.turnSummary(session, 5);
  assert.match(last, /工具 1 次/);
  assert.match(last, /非零退出 \(1\) cat missing-fixture-file\.txt/);
  assert.match(last, /回复 预期的文件不存在错误已记录 🍃/);
});

test('coalesces dual tool encodings and bounds the L1 summary on Unicode', () => {
  const event = payload => ({ type: 'event_msg', payload });
  const item = payload => ({ type: 'response_item', payload });
  const call = { call_id: 'tool-one' };
  const session = codex.transcript.parse([
    event({ type: 'task_started', turn_id: 'native-turn' }),
    event({ type: 'user_message', message: '🧪测试'.repeat(1000) }),
    item({ type: 'function_call', ...call, name: 'exec_command', arguments: '{"cmd":"exit 7"}' }),
    event({ type: 'exec_command_begin', ...call, command: ['/bin/sh', '-c', 'exit 7'] }),
    event({ type: 'exec_command_end', ...call, exit_code: 7 }),
    event({ type: 'task_complete', turn_id: 'native-turn', last_agent_message: `${'🔭结果'.repeat(1000)}\n\n第二段` }),
  ].map(value => JSON.stringify(value)).join('\n'));
  const summary = codex.transcript.turnSummary(session, 1);
  assert.ok(Buffer.byteLength(summary) <= 400);
  assert.ok(!summary.includes('\uFFFD'));
  assert.ok(!summary.includes('第二段'));
  assert.match(summary, /工具 1 次（exec_command）/);
  assert.match(summary, /非零退出 \(7\) exit 7/);
  assert.match(summary, /回复 🔭结果/);
});

test('plans serialized bracketed paste, native steer, and a reported queue fallback', () => {
  const queue = codex.input.plan('queue');
  const steer = codex.input.plan('steer');
  const interrupt = codex.input.plan('interrupt');
  assert.deepEqual(queue.steps[0], { type: 'wait', state: 'idle' });
  assert.deepEqual(steer.steps[0], { type: 'require', state: 'busy' });
  assert.deepEqual(interrupt.steps.slice(0, 2), [
    { type: 'key', key: 'esc', when: 'busy' }, { type: 'wait', state: 'idle' },
  ]);
  for (const send of [queue, steer, interrupt]) {
    assert.equal(send.downgraded, false);
    assert.deepEqual(send.steps.at(-2), { type: 'text', prefix: '\x1b[200~', suffix: '\x1b[201~', delayAfterMs: 50 });
    assert.deepEqual(send.steps.at(-1), { type: 'key', key: 'enter' });
  }
  for (const capability of ['tui-queue', 'none']) {
    assert.deepEqual(plan('steer', capability), { ...queue, downgraded: true });
  }
  assert.throws(() => codex.input.plan('invalid'), RangeError);
});
