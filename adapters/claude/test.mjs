import assert from 'node:assert/strict';
import { spawnSync, mkdtempSync } from '../../fixtures/test-process.mjs';
import { mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { claudeIdleCompaction } from '../../cli/policy.mjs';
import claude from './index.mjs';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const rows = (text) => text.trim().split('\n').map((line) => JSON.parse(line));
const jsonl = (...records) => records.map((row) => JSON.stringify(row)).join('\n');

function scratch(t) {
  const path = mkdtempSync(join(realpathSync(tmpdir()), 'loom-claude-test-'));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  return path;
}

test('launch uses session settings and literal argv without creating files', (t) => {
  const cwd = scratch(t);
  const prompt = '--literal prompt with "quotes" and\na newline';
  const launch = claude.launch({
    model: 'haiku', effort: 'low', cwd, prompt, extraArgs: ['--tools', 'Bash'],
    hookSink: 'event logs/worker\'s.jsonl',
  });
  const { argv, env } = launch;
  assert.equal(claude.id, 'claude');
  assert.deepEqual(env, {});
  assert.deepEqual(argv.slice(0, 12), ['claude', '--tools', 'Bash', '--dangerously-skip-permissions',
    '--setting-sources', '', '--strict-mcp-config', '--model', 'haiku', '--effort', 'low', '--settings']);
  assert.deepEqual(argv.slice(-2), ['--', prompt]);
  const settings = JSON.parse(argv[12]);
  assert.equal(settings.skipDangerousModePermissionPrompt, true);
  assert.equal(settings.idleCompaction, false);
  assert.deepEqual(Object.keys(settings.hooks), ['UserPromptSubmit', 'Stop', 'StopFailure', 'PreToolUse',
    'PostToolUse', 'PostToolUseFailure', 'PermissionRequest', 'Notification']);
  assert.match(settings.hooks.Notification[0].matcher, /permission_prompt/);
  assert.equal(settings.hooks.Stop[0].hooks[0].args[1], join(cwd, 'event logs/worker\'s.jsonl'));
  assert.equal(settings.hooks.PostToolUse[0].matcher, '*');
  assert.deepEqual(readdirSync(cwd), []);
  assert.throws(() => claude.launch({ extraArgs: ['--'] }), TypeError);
  assert.deepEqual(JSON.parse(claude.launch().argv.at(-1)), { skipDangerousModePermissionPrompt: true, idleCompaction: false });
});

test('Claude idle compaction can be enabled per role', t => {
  const project = scratch(t);
  mkdirSync(join(project, '.project'));
  const path = join(project, '.project', 'policy.json');
  writeFileSync(path, JSON.stringify({ roles: { auditor: { claude: { idleCompaction: true } } } }));
  const idleCompaction = claudeIdleCompaction(project, 'auditor');
  assert.equal(JSON.parse(claude.launch({ idleCompaction }).argv.at(-1)).idleCompaction, true);
  assert.equal(claudeIdleCompaction(project, 'leader'), false);
  writeFileSync(path, JSON.stringify({ roles: { auditor: { claude: { idleCompaction: 'false' } } } }));
  assert.throws(() => claudeIdleCompaction(project, 'auditor'), { code: 'invalid-policy' });
});

test('the injected hook writes native fields to its literal sink without a decision', (t) => {
  const cwd = scratch(t);
  const sink = 'event logs/worker\'s.jsonl';
  const { argv } = claude.launch({ cwd, hookSink: sink });
  const { command, args } = JSON.parse(argv.at(-1)).hooks.Stop[0].hooks[0];
  const run = (input) => spawnSync(command, args, { cwd, input, encoding: 'utf8' });
  const stop = {
    hook_event_name: 'Stop', session_id: 'session', transcript_path: '/fixture/session.jsonl',
    last_assistant_message: ' final\n\nparagraph ', stop_hook_active: false,
    prompt_id: 'prompt-1', prompt: 'native prompt', tool_input: { private: 'not captured' },
  };
  for (const input of ['invalid JSON', JSON.stringify(stop), JSON.stringify({ ...stop, agent_id: 'child' })]) {
    const child = run(input);
    assert.equal(child.status, 0);
    assert.equal(child.stdout, '');
    assert.equal(child.stderr, '');
  }
  const [record] = rows(readFileSync(join(cwd, sink), 'utf8'));
  assert.equal(record.prompt, undefined);
  assert.equal(record.tool_input, undefined);
  assert.equal(record.prompt_id, 'prompt-1');
  assert.equal(claude.hooks.normalize(record).finalReply, stop.last_assistant_message);
  assert.equal(rows(readFileSync(join(cwd, sink), 'utf8')).length, 1);
});

test('normalizes captured provider hooks with Stop text reserved for a completed root turn', () => {
  const { normalize } = claude.hooks;
  const startsAndTools = rows(fixture('orca-permission-hooks.jsonl')).map(normalize).map((event) => event?.type ?? null);
  assert.deepEqual(startsAndTools, ['turn-start', 'tool', 'tool', null, 'tool', 'tool', 'tool', null]);

  const payload = { session_id: 'session', transcript_path: '/fixture/session.jsonl', last_assistant_message: 'reply' };
  assert.deepEqual(normalize({ ...payload, hook_event_name: 'Stop' }), {
    type: 'turn-end', sessionId: 'session', transcriptPath: '/fixture/session.jsonl', finalReply: 'reply',
  });
  const interrupted = normalize({ ...payload, hook_event_name: 'Stop', is_interrupt: true });
  assert.equal(interrupted.finalReply, undefined);
  assert.deepEqual(normalize({ ...payload, hook_event_name: 'StopFailure', error: 'rate_limit' }), {
    type: 'stop-failure', sessionId: 'session', transcriptPath: '/fixture/session.jsonl',
  });
  assert.equal(normalize({ ...payload, hook_event_name: 'Stop', agent_id: 'child' }), null);
  assert.equal(normalize({ hook_event_name: 'Stop' }), null);
});

test('real hook replay keeps the merged tool reply and both streaming replies', () => {
  const events = rows(fixture('live-hooks.jsonl')).map(claude.hooks.normalize);
  assert.equal(events[0].type, 'turn-start');
  assert.equal(events[1].finalReply, 'ADAPT_FINAL_OK');
  assert.deepEqual(events.slice(2, 7).map(({ type }) => type),
    ['turn-start', 'tool', 'turn-start', 'tool', 'turn-end']);
  assert.equal(events[6].finalReply, 'ADAPT_TOOL_A_DONE ADAPT_TOOL_B_DONE');
  assert.deepEqual(events.slice(7, 11).map(({ type }) => type), ['turn-start', 'turn-start', 'turn-end', 'turn-end']);
  const replies = events.flatMap((event) => event.finalReply ? [event.finalReply.split('\n').at(-1)] : []);
  assert.deepEqual(replies, ['ADAPT_FINAL_OK', 'ADAPT_TOOL_A_DONE ADAPT_TOOL_B_DONE', 'ADAPT_STREAM_A_DONE',
    'ADAPT_STREAM_B_DONE', 'ADAPT_RESUME_ESC_OK', 'ADAPT_RESUME_CTRL_C_OK', 'ADAPT_INLINE_OK']);
  assert.ok(events.slice(0, -2).every((event) => event.sessionId === 'live-session'));
  assert.equal(events.at(-1).sessionId, 'inline-session');
});

for (const [name, expected] of Object.entries({
  'experiment-auth-fail-synthetic': 'auth-fail',
  'experiment-busy': 'busy',
  'experiment-idle': 'idle',
  'experiment-rate-limit-synthetic': 'rate-limit',
  'experiment-trust-dialog-synthetic': 'trust-dialog',
  'live-busy': 'busy',
  'live-bypass': 'picker',
  'live-idle': 'idle',
  'live-idle-compaction': 'idle',
  'live-interrupted': 'idle',
  'live-model-picker': 'picker',
  'live-trust': 'trust-dialog',
})) {
  test(`classifies ${name} as ${expected}`, () => assert.equal(claude.screen.classify(fixture(`${name}.txt`)), expected));
}

test('only sends known menu sequences for the active matching dialog', () => {
  const { classify, dialogKeys } = claude.screen;
  const trust = fixture('live-trust.txt');
  assert.deepEqual(dialogKeys('trust-dialog'), []);
  assert.deepEqual(dialogKeys('trust-dialog', trust), ['down', 'enter']);
  const exact = trust.replace('<lab>/trust-repo', '/private/lab/trust-repo');
  assert.deepEqual(dialogKeys('trust-dialog', exact, '/private/lab/trust-repo'), ['down', 'enter']);
  assert.deepEqual(dialogKeys('trust-dialog', exact, '/private/lab/other-repo'), []);
  assert.deepEqual(dialogKeys('trust-dialog', trust.replace('❯ No, exit', '  No, exit').replace('   Yes,', ' ❯ Yes,')), ['enter']);
  assert.deepEqual(dialogKeys('trust-dialog', `${trust}\n❯ `), []);
  assert.deepEqual(dialogKeys('trust-dialog', fixture('experiment-trust-dialog-synthetic.txt')), []);
  assert.deepEqual(dialogKeys('picker', fixture('live-bypass.txt')), ['down', 'enter']);
  assert.deepEqual(dialogKeys('picker', fixture('live-model-picker.txt')), ['esc']);
  const signedOut = 'Select login method:\n❯ 1. Claude account with subscription\n2. Anthropic Console account';
  assert.equal(classify(signedOut), 'picker');
  assert.deepEqual(dialogKeys('picker', signedOut), []);
  assert.equal(classify('Syntax theme: Dark (ctrl+t to disable)'), 'picker');
});

test('screen rejects historical prompts and ignores error strings emitted by tools', () => {
  const { classify } = claude.screen;
  assert.equal(classify('Claude Code v2.1.322\n❯ What is 2 + 2?\n⏺ 4'), 'unknown');
  assert.equal(classify('⏺ Compacted (ctrl+o to see full summary)'), 'idle');
  assert.equal(classify('⏺ Compacted while idle\n✻ Compacting conversation…'), 'compacting');
  assert.equal(classify('⏺ Compacted while idle\n❯ pending draft'), 'unknown');
  assert.equal(classify('Claude Code v2.1.322\n⏺ Bash(echo error)\n  ⎿  Invalid API key\n──────────\n❯ \n──────────\n? for shortcuts'), 'idle');
  assert.equal(classify('Claude Code (example)\r\x1b[31mInvalid API key\x1b[0m\r'), 'auth-fail');
  assert.equal(classify(''), 'unknown');
});

test('transcript locates only a regular session file in the cwd bucket', async (t) => {
  const base = scratch(t);
  const cwd = join(base, 'workspace.with space');
  const configDir = join(base, 'profile');
  const projects = join(configDir, 'projects');
  const bucket = join(projects, cwd.replace(/[^a-zA-Z0-9]/g, '-'));
  mkdirSync(cwd);
  mkdirSync(bucket, { recursive: true });
  const expected = join(bucket, 'session-a.jsonl');
  writeFileSync(expected, '{}\n');
  symlinkSync(expected, join(bucket, 'linked.jsonl'));
  const at = (sessionId, options) => claude.transcript.locate({ cwd, configDir, projectDirName: '', sessionId, ...options });
  assert.equal(await at('session-a'), expected);
  assert.equal(await at('gone'), null);
  assert.equal(await at('linked'), null);
  assert.equal(await at('../session-a'), null);
  assert.equal(await at('session-a', { cwd: join(base, 'another') }), null);
  const custom = join(projects, 'custom');
  symlinkSync(bucket, custom);
  assert.equal(await at('session-a', { projectDirName: 'custom' }), null);
  rmSync(custom);
  mkdirSync(custom);
  writeFileSync(join(custom, 'session-a.jsonl'), '{}\n');
  assert.equal(await at('session-a', { projectDirName: 'custom' }), join(custom, 'session-a.jsonl'));
});

test('transcript locates modern long-path buckets using the cwd prefix', async (t) => {
  const base = scratch(t);
  const cwd = join(base, 'x'.repeat(220));
  const configDir = join(base, 'profile');
  const bucket = join(configDir, 'projects', `${cwd.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 200)}-hash`);
  mkdirSync(bucket, { recursive: true });
  const path = join(bucket, 'session-a.jsonl');
  writeFileSync(path, '{}\n');
  assert.equal(await claude.transcript.locate({ cwd, configDir, projectDirName: '', sessionId: 'session-a' }), path);
});

test('preserves loom-transcript turns, interruption, compact boundary, and usage', () => {
  const session = claude.transcript.parse(fixture('experiment-transcript.jsonl'));
  assert.equal(session.provider, 'claude');
  assert.equal(session.turns.length, 5);
  assert.equal(session.usage.calls, 7);
  assert.equal(session.usage.inputTokens, 62884);
  assert.equal(session.turns[2].status, 'interrupted');
  assert.equal(session.turns[2].reply, null);
  assert.equal(session.lastReply, '压缩后的新一轮已完成 🍃');
  assert.deepEqual(session.turns[0].tools.map((tool) => tool.name), ['Read', 'Bash']);
  assert.equal(session.turns[2].tools[0].exitCode, null);
});

test('records a queued prompt in its active turn and counts each tool use once', () => {
  const user = (content) => ({ type: 'user', message: { role: 'user', content } });
  const assistant = (id, content, extra = {}) => ({ type: 'assistant', message: { id, content, ...extra } });
  const bash = { type: 'tool_use', name: 'Bash', id: 'tool-1', input: { command: 'printf hi; exit 7' } };
  const result = { type: 'tool_result', tool_use_id: 'tool-1', is_error: true, content: 'Exit code 7\nhi' };
  const text = jsonl(user('Report the result'), assistant('call', [bash], { stop_reason: 'tool_use' }),
    assistant('call', [bash]), { type: 'attachment', attachment: { type: 'queued_command', commandMode: 'prompt', prompt: 'Include the exit code' } },
    user([result]), assistant('reply', 'The check failed.\n\nSecond paragraph.', { stop_reason: 'end_turn' }));
  const session = claude.transcript.parse(`\uFEFF${text}\n{"bad"`);
  assert.equal(session.turns.length, 1);
  assert.deepEqual(session.turns[0].prompts, ['Report the result', 'Include the exit code']);
  assert.deepEqual(session.turns[0].tools, [{ id: 'tool-1', name: 'Bash', command: 'printf hi; exit 7', exitCode: 7 }]);
  const summary = claude.transcript.turnSummary(session, 1);
  assert.match(summary, /工具 1 次 Bash×1/);
  assert.match(summary, /\[7\] printf hi; exit 7/);
  assert.match(summary, /The check failed\./);
  assert.doesNotMatch(summary, /Second paragraph/);
});

test('a long L1 summary is byte-bounded and retains all four fields', () => {
  const session = { turns: [{ index: 1, status: 'completed', prompts: ['任务🧪'.repeat(300)],
    reply: `${'回复🧪'.repeat(500)}\n\nSecond paragraph`,
    tools: Array.from({ length: 50 }, (_, index) => ({ name: `工具${index}`, command: 'long command '.repeat(30), exitCode: 8 })) }] };
  const summary = claude.transcript.turnSummary(session, 1);
  assert.ok(Buffer.byteLength(summary) <= 400);
  assert.match(summary, /^第 1 轮 已完成\n任务 /);
  assert.match(summary, /工具 50 次/);
  assert.match(summary, /非零退出 50 条 \[8\]/);
  assert.match(summary, /回复 回复/);
  assert.ok(!summary.includes('\uFFFD'));
  assert.equal(claude.transcript.turnSummary(session, 0), null);
  assert.equal(claude.transcript.turnSummary(session, 2), null);
});

test('input plans separate idle queueing, Claude busy delivery, and Esc with same-pane resume', () => {
  assert.deepEqual(claude.capabilities, { steer: 'tui-queue', interrupt: true, resumeSamePane: true, hookInjection: 'settings-arg' });
  const { plan } = claude.input;
  assert.deepEqual(plan('queue'), { mode: 'queue', steps: [{ type: 'wait', state: 'idle' }, { type: 'text', submit: true }] });
  assert.deepEqual(plan('steer'), { mode: 'steer', delivery: 'tui-queue', requires: 'busy', fallback: 'queue',
    steps: [{ type: 'text', submit: true }] });
  assert.deepEqual(plan('interrupt'), { mode: 'interrupt', steps: [{ type: 'keys', keys: ['esc'] },
    { type: 'wait', state: 'idle' }, { type: 'text', submit: true }] });
  assert.throws(() => plan('spurious'), RangeError);
});
