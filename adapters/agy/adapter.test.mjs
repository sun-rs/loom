import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import agy, { agy as namedAdapter } from './index.mjs';

const dir = dirname(fileURLToPath(import.meta.url));
const fixture = name => readFileSync(join(dir, 'fixtures', name), 'utf8');
const jsonl = rows => rows.map(row => JSON.stringify(row)).join('\n');

function scratch(t) {
  const path = mkdtempSync(join(realpathSync(tmpdir()), 'loom-agy-test-'));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  return path;
}

function logs(cwd, id) {
  return join(cwd, '.gemini', 'antigravity-cli', 'brain', id, '.system_generated', 'logs');
}

test('exposes the verified PROTO-1 capabilities and input plans', () => {
  assert.equal(agy, namedAdapter);
  assert.equal(agy.id, 'agy');
  assert.deepEqual(agy.capabilities, { steer: 'tui-queue', interrupt: true, resumeSamePane: true, hookInjection: 'project-file' });
  const send = [{ type: 'text' }, { type: 'key', key: 'enter' }];
  assert.deepEqual(agy.input.plan('queue'), { mode: 'queue', downgraded: false, steps: send });
  assert.deepEqual(agy.input.plan('steer'), { mode: 'queue', downgraded: true, steps: send });
  assert.deepEqual(agy.input.plan('interrupt'), { mode: 'interrupt', downgraded: false, steps: [{ type: 'key', key: 'esc' }, ...send] });
  assert.throws(() => agy.input.plan('invalid'), RangeError);
});

test('launch stages private hook definitions outside cwd and trusts both exact workspaces', t => {
  const root = scratch(t);
  const cwd = join(root, 'work');
  const sink = join(root, 'sink', 'events.jsonl');
  mkdirSync(cwd);
  const request = { model: 'Gemini 3.8 Flash', effort: 'low', cwd, prompt: 'one\n--model literal', hookSink: sink, extraArgs: ['--sandbox'] };
  const first = agy.launch(request);
  const second = agy.launch(request);
  const { argv, env } = first;
  const stage = argv[argv.indexOf('--add-dir') + 1];
  assert.deepEqual(argv.slice(0, 5), ['agy', '--dangerously-skip-permissions', '--mode', 'accept-edits', '--sandbox']);
  assert.equal(argv[argv.indexOf('--model') + 1], 'Gemini 3.8 Flash (Low)');
  assert.deepEqual(argv.slice(-2), ['--prompt-interactive', request.prompt]);
  assert.equal(env.AGY_CLI_DISABLE_AUTO_UPDATE, 'true');
  assert.equal(env.LOOM_AGY_HOOK_WORKSPACE, stage);
  assert.notEqual(stage, second.env.LOOM_AGY_HOOK_WORKSPACE);
  assert.match(relative(cwd, stage), /^\.\.\//);
  assert.equal(existsSync(join(cwd, '.agents')), false);
  assert.deepEqual(JSON.parse(argv[argv.indexOf('--settings') + 1]), {
    queuedMessages: 'queue', trustedWorkspaces: [cwd, stage],
  });
  const config = JSON.parse(readFileSync(join(stage, '.agents', 'hooks.json'), 'utf8'))['loom-agy'];
  assert.deepEqual(Object.keys(config).sort(), ['PostToolUse', 'PreInvocation', 'PreToolUse', 'Stop']);
  assert.equal(config.PreToolUse[0].matcher, '*');
  assert.equal(config.Stop[0].type, 'command');
  assert.throws(() => agy.launch({ ...request, extraArgs: ['--print=x'] }), TypeError);
});

test('launch accepts a workspace-relative sink without adding hook configuration to cwd', t => {
  const root = scratch(t);
  const cwd = join(root, 'work');
  mkdirSync(cwd);
  const old = process.env.TMPDIR;
  process.env.TMPDIR = root;
  t.after(() => {
    if (old === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = old;
  });
  const { env } = agy.launch({ cwd, hookSink: '.local/events.jsonl' });
  assert.match(relative(cwd, env.LOOM_AGY_HOOK_WORKSPACE), /^\.\.\//);
  assert.equal(existsSync(join(cwd, '.agents')), false);
  assert.equal(agy.launch({ cwd }).argv.includes('--add-dir'), false);
});

for (const [name, expected] of Object.entries({
  'agy-idle.txt': 'overlay', 'agy-busy.txt': 'busy', 'agy-trust-dialog.txt': 'trust-dialog',
  'agy-sign-in-warning.txt': 'idle', 'agy-auth-fail-synthetic.txt': 'auth-fail', 'agy-rate-limit-synthetic.txt': 'rate-limit',
})) {
  test(`classifies the experiment screen ${name}`, () => {
    assert.equal(agy.screen.classify(fixture(name)), expected);
  });
}

test('classifies captured trust, model picker, busy and idle frames', () => {
  const screens = JSON.parse(fixture('live-screens.json'));
  for (const [state, text] of Object.entries(screens)) {
    assert.equal(agy.screen.classify(`\x1b[32m${text}\x1b[0m`), state);
  }
  assert.equal(agy.screen.classify('Select login method:\n> 1. Google OAuth'), 'auth-fail');
  assert.equal(agy.screen.classify('plain shell output'), 'unknown');
  assert.deepEqual(agy.screen.dialogKeys('trust-dialog', screens['trust-dialog']), ['enter']);
  assert.deepEqual(agy.screen.dialogKeys('picker', screens.picker), ['esc']);
  assert.deepEqual(agy.screen.dialogKeys('rate-limit'), []);
  assert.deepEqual(agy.screen.dialogKeys('auth-fail'), []);
});

test('normalizes the actual 1.5.16 hook and OSC samples', () => {
  const { hooks, firstDone } = JSON.parse(fixture('live-hooks.json'));
  assert.deepEqual(hooks.map(row => agy.hooks.normalize(row)?.type), [
    'turn-start', 'turn-end', 'turn-start', 'tool', 'tool', 'turn-end',
  ]);
  assert.deepEqual(agy.hooks.normalize({ ...hooks[1], finalReply: firstDone }), {
    type: 'turn-end', sessionId: 'live-fixture-001', transcriptPath: hooks[1].transcriptPath, finalReply: 'AGY-ADAPTER-OK',
  });
  assert.deepEqual(agy.hooks.normalize({ ...hooks[1], fullyIdle: false }), {
    type: 'turn-paused', sessionId: 'live-fixture-001', transcriptPath: hooks[1].transcriptPath,
  });
  assert.equal(agy.hooks.normalize({ ...hooks[0], invocationNum: 1 }), null);
  assert.deepEqual(agy.hooks.normalize({ ...hooks[1], terminationReason: 'USER_CANCELED', finalReply: firstDone }), {
    type: 'stop-failure', sessionId: 'live-fixture-001', transcriptPath: hooks[1].transcriptPath,
  });
  assert.deepEqual(agy.hooks.normalize({ event: 'StopFailure' }), { type: 'stop-failure', sessionId: null, transcriptPath: null });
  assert.deepEqual(agy.hooks.normalize({ conversation_id: 'legacy-session', fully_idle: true, termination_reason: 'error' }), {
    type: 'stop-failure', sessionId: 'legacy-session', transcriptPath: null,
  });
  assert.equal(agy.hooks.normalize(undefined), null);
});

test('capture uses the scoped transcript and the exact current turn, with POSIX quoting', t => {
  const root = scratch(t);
  const cwd = join(root, "work ' quoted");
  const transcriptDir = logs(cwd, 'owned-session');
  const compact = join(transcriptDir, 'transcript.jsonl');
  const transcript = join(transcriptDir, 'transcript_full.jsonl');
  const sink = join(root, "events ' quoted.jsonl");
  mkdirSync(transcriptDir, { recursive: true });
  const { argv } = agy.launch({ cwd, hookSink: sink });
  const config = JSON.parse(readFileSync(join(argv[argv.indexOf('--add-dir') + 1], '.agents', 'hooks.json'), 'utf8'))['loom-agy'];
  const native = { workspacePaths: [cwd], conversationId: 'owned-session', transcriptPath: compact, lastUserInput: 'same prompt' };
  const run = (name, fields = {}) => {
    const handler = config[name][0];
    const result = spawnSync('/bin/sh', ['-c', handler.command ?? handler.hooks[0].command], {
      input: JSON.stringify({ ...native, ...fields }), encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  const read = () => readFileSync(sink, 'utf8').trimEnd().split('\n').map(JSON.parse);
  const rows = [
    { step_index: 0, type: 'USER_INPUT', source: 'USER_EXPLICIT', content: '<USER_REQUEST>same prompt</USER_REQUEST>' },
    { step_index: 1, type: 'PLANNER_RESPONSE', source: 'MODEL', content: 'first answer' },
  ];
  writeFileSync(transcript, jsonl(rows));
  writeFileSync(compact, '');

  assert.equal(run('PreInvocation', { initialNumSteps: 1, invocationNum: 0 }), '{}');
  assert.equal(run('PreToolUse', { toolCall: { name: 'read_file', args: { Path: 'omitted' } } }), '');
  assert.equal(run('Stop', { executionNum: 0, fullyIdle: false }), '{"decision":""}');
  assert.equal(run('Stop', { executionNum: 0, fullyIdle: true }), '{"decision":""}');
  assert.equal(read().length, 4);
  assert.equal(read()[2].fullyIdle, false);
  assert.equal(agy.hooks.normalize(read()[2]).type, 'turn-paused');
  assert.equal(read()[1].toolName, 'read_file');
  assert.ok(!('toolCall' in read()[1]));
  assert.equal(agy.hooks.normalize(read().at(-1)).finalReply, 'first answer');

  run('PreInvocation', { initialNumSteps: 3, invocationNum: 0 });
  run('Stop', { fullyIdle: true });
  assert.ok(!('finalReply' in read().at(-1)), 'a stale answer with the same request must not be reused');
  const visible = read().length;
  run('Stop', { workspacePaths: [root], fullyIdle: true });
  assert.equal(read().length, visible);
});

test('locates only exact session paths and prefers full to compact', t => {
  const cwd = scratch(t);
  const id = 'fixture-locate-only';
  const path = logs(cwd, id);
  mkdirSync(path, { recursive: true });
  const full = join(path, 'transcript_full.jsonl');
  const compact = join(path, 'transcript.jsonl');
  writeFileSync(compact, '');
  assert.equal(agy.transcript.locate({ cwd, sessionId: id }), compact);
  symlinkSync(compact, full);
  assert.equal(agy.transcript.locate({ cwd, sessionId: id }), compact);
  rmSync(full);
  writeFileSync(full, '');
  assert.equal(agy.transcript.locate({ cwd, sessionId: id }), full);
  assert.equal(agy.transcript.locate({ cwd, sessionId: '../' + id }), null);
  assert.equal(agy.transcript.locate({ cwd, sessionId: 'fixture-nonexistent-adapt-agy' }), null);
});

test('preserves the loom-transcript session shape and the captured turn boundaries', () => {
  const session = agy.transcript.parse(fixture('orca-experiment.jsonl'));
  assert.deepEqual(Object.keys(session).sort(), ['lastReply', 'provider', 'turns', 'usage']);
  assert.deepEqual(Object.keys(session.turns[0]).sort(), ['calls', 'endedAt', 'id', 'index', 'reply', 'startedAt', 'status', 'usage']);
  assert.deepEqual(session.turns.map(turn => turn.status), ['completed', 'completed', 'interrupted', 'completed']);
  assert.equal(session.provider, 'agy');
  assert.equal(session.usage.calls, session.turns.reduce((sum, turn) => sum + turn.usage.calls, 0));
  assert.equal(session.lastReply, '中断后已恢复 ✅');
  assert.match(agy.transcript.turnSummary(session, 1), /工具调用 2 read_file、run_command/);
  assert.match(agy.transcript.turnSummary(session, 3), /中断/);
});

test('summarizes nonzero exits without double-counting command result steps', () => {
  const rows = [
    { source: 'USER', type: 'REQUEST', step_index: 0, content: '<USER_REQUEST>Run the example</USER_REQUEST>' },
    { source: 'MODEL', type: 'PLANNER_RESPONSE', step_index: 1, tool_calls: [{ name: 'run_command', args: { CommandLine: 'false' } }] },
    { source: 'MODEL', type: 'GENERIC', step_index: 2, content: 'Created At: now\nCommand exited with code 7.\n\nCommand output:\nCommand exited with code 99.' },
    { source: 'MODEL', type: 'RUN_COMMAND', step_index: 3, command: 'exit 2', exit_code: 2 },
    { source: 'MODEL', type: 'PLANNER_RESPONSE', step_index: 4, status: 'DONE', content: 'First paragraph.\n\nSecond paragraph.' },
  ];
  const text = jsonl(rows);
  const session = agy.transcript.parse(text + '\n{"source":');
  assert.equal(agy.transcript.turnSummary(session, 1), '任务（完成） Run the example\n工具调用 2 run_command\n非零退出 7 false、2 exit 2\n回复 First paragraph.');
  const stop = { hookEventName: 'Stop', fullyIdle: true, transcriptText: text, lastUserInput: 'Run the example', turnStep: 0 };
  assert.equal(agy.hooks.normalize(stop).finalReply, 'First paragraph.\n\nSecond paragraph.');
  assert.ok(!('finalReply' in agy.hooks.normalize({ ...stop, turnStep: 100 })));
});

test('keeps multilingual L1 summaries in the token budget and flags unavailable details', () => {
  const long = '🪴繁'.repeat(500);
  const session = agy.transcript.parse(jsonl([
    { source: 'USER', type: 'REQUEST', step_index: 0, content: long },
    { source: 'MODEL', type: 'RUN_COMMAND', step_index: 1, name: long, command: long, exit_code: 1 },
    { source: 'MODEL', type: 'PLANNER_RESPONSE', step_index: 2, content: long + '\n\nEXCLUDED' },
  ]));
  const summary = agy.transcript.turnSummary(session, 1);
  assert.ok(Buffer.byteLength(summary) <= 400);
  assert.doesNotMatch(summary, /\uFFFD|EXCLUDED/);
  assert.match(agy.transcript.turnSummary(structuredClone(session), 1), /工具调用 未知/);
  assert.equal(agy.transcript.turnSummary(session, 2), '找不到该轮。');
});

test('records the last activity or the explicit native timestamp for an interrupted turn', () => {
  const start = '2026-11-25T00:00:00.000Z';
  const activity = '2026-11-25T00:00:02.000Z';
  const interrupted = '2026-11-25T00:00:04.000Z';
  const next = '2026-11-25T00:00:06.000Z';
  const request = (step_index, created_at) => ({ source: 'USER_EXPLICIT', type: 'USER_INPUT', step_index, created_at });
  const tool = { source: 'MODEL', type: 'PLANNER_RESPONSE', status: 'DONE', step_index: 1, created_at: activity,
    tool_calls: [{ name: 'run_command' }] };
  const later = request(3, next);
  const marker = { source: 'MODEL', type: 'PLANNER_RESPONSE', status: 'CANCELED', step_index: 2, created_at: interrupted };
  for (const [rows, expected] of [[[request(0, start), tool, later], activity],
    [[request(0, start), tool, marker, later], interrupted]]) {
    const [turn] = agy.transcript.parse(jsonl(rows)).turns;
    assert.equal(turn.status, 'interrupted');
    assert.equal(turn.endedAt, expected);
  }
});
