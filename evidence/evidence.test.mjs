import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { relay } from '../relay/project.mjs';
import { estimateTokens } from '../lib/token-budget.mjs';
import { checkEvidence } from './checks.mjs';
import { compareClaims } from './claims.mjs';
import { diffFiles, testChanges } from './git.mjs';
import { evidence } from './index.mjs';
import { agyCommands, collectVerification } from './transcript.mjs';
import { workerRedFacts } from '../daemon/routing.mjs';

const jsonl = rows => rows.map(row => JSON.stringify(row)).join('\n') + '\n';
const failedOutput = '# tests 3\n# pass 1\n# fail 2\n# skipped 0\n';
const event = payload => ({ type: 'event_msg', payload });
const response = payload => ({ type: 'response_item', payload });

function makeCodexTurn(id, { exitCode, output, command = 'node --test', finalReply = 'DONE T1\n全绿，通过 3 项' }) {
  const callId = `call-${id}`;
  return [
    event({ type: 'task_started', turn_id: id }),
    { type: 'turn_context', payload: { turn_id: id, sandbox_policy: { type: 'workspace-write' } } },
    response({ type: 'function_call', call_id: callId, name: 'exec_command', arguments: JSON.stringify({ cmd: command }) }),
    event({ type: 'exec_command_begin', turn_id: id, call_id: callId, command: ['/bin/sh', '-c', command] }),
    event({ type: 'exec_command_end', turn_id: id, call_id: callId, exit_code: exitCode, aggregated_output: output }),
    response({ type: 'function_call', call_id: `unused-${id}`, name: 'exec_command', arguments: '{"cmd":"go test ./..."}' }),
    event({ type: 'task_complete', turn_id: id, last_agent_message: finalReply }),
  ];
}

function directory(t) {
  const project = mkdtempSync(join(import.meta.dirname, '.evidence-test-'));
  t.after(() => rmSync(project, { recursive: true, force: true }));
  return project;
}

test('keeps Git rename and binary numstat paths as NUL-delimited values', () => {
  const renamed = 'tests/after\tname\n.test.mjs';
  const raw = [':100644 100644 0011111 0022222 R80', 'tests/before.test.mjs', renamed,
    ':100644 100644 0044444 0055555 M', 'image.png', '2\t1\t', 'tests/before.test.mjs', renamed,
    '-\t-\timage.png', ''].join('\0');
  assert.deepEqual(diffFiles(raw), [
    { path: renamed, previousPath: 'tests/before.test.mjs', status: 'R', added: 2, deleted: 1 },
    { path: 'image.png', previousPath: null, status: 'M', added: null, deleted: null },
  ]);
});

test('counts deleted assertion lines and new skip/only lines in test patches', () => {
  const patch = [
    'diff --git a/test/example.test.mjs b/test/example.test.mjs', '--- a/test/example.test.mjs', '+++ b/test/example.test.mjs',
    '@@ -2,4 +2,5 @@', '-  assert.equal(output, 12);', '-  expect(a).toBe(b); expect(c).toBe(d);',
    '-  // assert.equal(output, 8)', '-  const note = "expect(x)";', '+  test.skip("skipped", check);',
    '+  describe.only("subset", setup);', '+  test("options", { skip: true }, check);',
    '+  // test.skip("documentation", check);', '+  const note = "test.only()";',
    'diff --git a/tests/test_old.py b/tests/test_old.py', '--- a/tests/test_old.py', '+++ /dev/null',
    '@@ -1,2 +0,0 @@', '-    self.assertEqual(a, b)', '-    assert enabled',
  ].join('\n');
  assert.deepEqual(testChanges(patch), { removedAssertions: 4, rewrittenAssertions: 0, addedSkip: 2, addedOnly: 1 });
  assert.deepEqual(testChanges('test.only("fixture", () => {});\n', true),
    { removedAssertions: 0, rewrittenAssertions: 0, addedSkip: 0, addedOnly: 1 });
});

test('T6 assertion rewrites do not enter a gate as deletions', () => {
  const patch = ['@@ -1,78 +1,77 @@', ...Array.from({ length: 78 }, (_, i) => `-assert.equal(value${i}, oldValue);`),
    ...Array.from({ length: 77 }, (_, i) => `+assert.equal(value${i}, newValue);`)].join('\n');
  const changes = testChanges(patch);
  assert.equal(changes.removedAssertions, 1);
  assert.equal(changes.rewrittenAssertions, 77);
  const rewritten = testChanges('@@ -1 +1 @@\n-assert(a);\n+assert(b);');
  assert.deepEqual(workerRedFacts({ tests: [{ path: 'T6.test.mjs', changes: rewritten },
    { path: 'legacy.test.mjs', changes: { removedAssertions: 78 } }] }), []);
  assert.deepEqual(workerRedFacts({ tests: [{ path: 'T6.test.mjs', changes }] }),
    [{ reason: 'assertion', file: 'T6.test.mjs' }]);
});

test('T6 and T13 baseline claims use the referenced command on expectRed cards', async t => {
  const project = directory(t);
  mkdirSync(join(project, '.project'));
  writeFileSync(join(project, '.project/evidence.json'), JSON.stringify({ tasks: { T13: { expectRed: true } } }));
  const base = 'node --test memory/memory.test.mjs';
  const added = 'node --test memory/v1-core.test.mjs';
  const tools = [
    { tool: 'shell', command: added, exitCode: 1, output: '# tests 29\n# pass 0\n# fail 29\n' },
    { tool: 'shell', command: base, exitCode: 0, output: '# tests 4\n# pass 4\n# fail 0\n' },
  ];
  const { data } = await evidence.forTurn({ project, cwd: null, provider: 'codex', task: 'T13', turn: 3,
    finalReply: 'DONE T13\n基线套件全绿', projected: { tools, turnStatus: 'completed' } });
  assert.equal(data.verification.expectRed, true);
  assert.equal(data.claims.find(claim => claim.kind === 'all-green').status, 'MATCH');
  assert.equal(compareClaims('原测试 4/4 全绿', {}, data.verification)[0].status, 'MATCH');
  assert.equal(compareClaims('新测试见红，`memory.test.mjs` 4/4 全绿', {}, data.verification)[0].status, 'MATCH');
  assert.equal(compareClaims('新测试见红，`memory.test.mjs` 4/4 全绿',
    {}, { ...data.verification, commands: [data.verification.commands[0]] })[0].status, 'UNVERIFIED');
  const mixed = checkEvidence({ command: 'node --test mixed.test.mjs', exitCode: 1,
    output: '# tests 103\n# pass 80\n# fail 23' });
  assert.equal(compareClaims('新增 23 个用例全部见红，既有 80 项测试全部通过',
    {}, { ...data.verification, commands: [mixed] }).find(claim => claim.kind === 'all-green').status, 'MATCH');
  assert.equal(compareClaims(`\`${added}\` 全绿`, {}, data.verification)[0].status, 'MISMATCH');
  assert.equal(compareClaims('全绿', {}, data.verification)[0].status, 'MISMATCH');
});

test('L3 attributes the completed agy background test to its original command', () => {
  const task = 'conversation/task-83';
  const rows = [
    { source: 'MODEL', type: 'PLANNER_RESPONSE', tool_calls: [{ name: 'run_command',
      args: { CommandLine: 'git worktree add /fixture && npm test' } }] },
    { source: 'MODEL', type: 'GENERIC', status: 'RUNNING', content: `Created At: native\nTool is running as a background task with task id: ${task}` },
    { source: 'MODEL', type: 'PLANNER_RESPONSE', tool_calls: [{ name: 'manage_task', args: { TaskId: task } }] },
    { source: 'SYSTEM', type: 'SYSTEM_MESSAGE', content: `<SYSTEM_MESSAGE>\n[Message] timestamp=t sender=${task} priority=HIGH content=Task id "${task}" finished with result:\nCommand exited with code 0.\n\nCommand output:\n# tests 350\n# pass 350\n# fail 0\n</SYSTEM_MESSAGE>` },
  ];
  const commands = agyCommands(rows, null, true);
  assert.equal(commands.length, 1);
  assert.equal(commands[0].source, 'agy.background-completion');
  const check = checkEvidence(commands[0]);
  assert.equal(check.result, 'passed');
  assert.equal(check.counts.passed, 350);
});

test('compares DONE, all-green, pass count, and merge claims using only the bound turn', () => {
  const transcript = jsonl([
    ...makeCodexTurn('prior', { exitCode: 0, output: '# pass 3\n# fail 0\n' }),
    ...makeCodexTurn('target', { exitCode: 1, output: failedOutput }),
    ...makeCodexTurn('later', { exitCode: 0, output: '# pass 9\n# fail 0\n' }),
  ]);
  const verification = collectVerification({ provider: 'codex', transcript, nativeTurnId: 'target' });
  assert.equal(verification.commands.length, 1);
  const [command] = verification.commands;
  assert.equal(command.exitCode, 1);
  assert.equal(command.sandboxed, true);
  assert.equal(command.tail, failedOutput.trimEnd());
  assert.equal(command.tailSha256, createHash('sha256').update(command.tail).digest('hex'));
  const claims = compareClaims('**DONE T1**\n全绿，通过 3 项\n已合入\n> 通过 8 项', { merge: { integrated: false } }, verification);
  assert.deepEqual(claims.map(({ kind, status }) => [kind, status]), [
    ['done', 'MATCH'], ['all-green', 'MISMATCH'], ['pass-count', 'MISMATCH'], ['merged', 'MISMATCH'],
  ]);
  assert.equal(collectVerification({ provider: 'codex', transcript, nativeTurnId: 'absent' }).status, 'unmatched-turn');
});

test('flags agy runtime skips even when pytest exits with code zero', () => {
  const transcript = jsonl([
    { source: 'USER', type: 'REQUEST', step_index: 0, content: 'Run checks' },
    { source: 'MODEL', type: 'PLANNER_RESPONSE', step_index: 1, tool_calls: [{ name: 'run_command', args: { CommandLine: 'cd repo && pytest -q' } }] },
    { source: 'MODEL', type: 'GENERIC', step_index: 2, content: 'Command exited with code 0.\n\nCommand output:\n=== 2 passed, 1 skipped in 0.05s ===' },
    { source: 'MODEL', type: 'PLANNER_RESPONSE', step_index: 3, status: 'DONE', content: '全绿，通过 2 项' },
  ]);
  const verification = collectVerification({ provider: 'agy', transcript, nativeTurnId: '0', sandboxed: true });
  const [command] = verification.commands;
  assert.equal(command.sandboxed, true);
  assert.equal(command.exitCode, 0);
  assert.deepEqual(command.counts, { passed: 2, failed: null, skipped: 1 });
  assert.deepEqual(compareClaims('全绿，通过 2 项', {}, verification).map(claim => claim.status), ['MISMATCH', 'MATCH']);
});

test('reads Claude Bash tool results and ignores sidechains and denied calls', () => {
  const bash = (id, command, extra = {}) => ({ type: 'tool_use', id, name: 'Bash', input: { command, ...extra } });
  const transcript = jsonl([
    { type: 'user', uuid: 'prompt', message: { content: 'Run checks' } },
    { type: 'assistant', isSidechain: true, message: { id: 'side', content: [bash('side-id', 'go test ./...')] } },
    { type: 'assistant', message: { id: 'calls', content: [bash('one', 'npm test', { dangerouslyDisableSandbox: true }), bash('two', 'pytest')] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'one', content: '# pass 2\n# fail 0\n' }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'two', is_error: true, content: 'Permission refused' }] } },
    { type: 'assistant', message: { id: 'reply', content: 'All tests passed' } },
  ]);
  const verification = collectVerification({ provider: 'claude', transcript, nativeTurnId: 'prompt', sandboxed: true });
  assert.deepEqual(verification.commands.map(({ command, exitCode, sandboxed }) => [command, exitCode, sandboxed]), [['npm test', 0, false]]);
  const git = { tests: [{ changes: { addedOnly: 1 } }] };
  assert.equal(compareClaims('全绿', git, verification)[0].status, 'MISMATCH');
  assert.equal(compareClaims('尚未合入\n```txt\n全绿\n```', git, verification).length, 0);
});

test('distinguishes a test exit from a shell pipeline exit', () => {
  const run = command => checkEvidence({ command, exitCode: 0, output: '' });
  assert.equal(run('echo "node --test"'), null);
  assert.equal(run('# developer example; node --test'), null);
  assert.equal(run('node --test | tail -n 5').result, 'unknown');
  assert.equal(run("/bin/bash -lc 'cd repo && go test ./...'").result, 'passed');
  assert.equal(run('node --test --test-only').selective, true);
});

test('keeps a started Codex check with an unknown exit and reads structured tool results', () => {
  const transcript = jsonl([
    event({ type: 'task_started', turn_id: 'turn' }),
    event({ type: 'exec_command_begin', call_id: 'started', command: ['go', 'test', './...'] }),
    response({ type: 'function_call', call_id: 'ran', name: 'exec_command', arguments: '{"cmd":"npm test"}' }),
    response({ type: 'function_call_output', call_id: 'ran', output: { exit_code: 0, output: '# pass 3\n', sandboxed: false } }),
    event({ type: 'task_complete', turn_id: 'turn', last_agent_message: '全绿' }),
  ]);
  const verification = collectVerification({ provider: 'codex', transcript, nativeTurnId: 'turn' });
  assert.deepEqual(verification.commands.map(check => [check.command, check.exitCode, check.sandboxed, check.result]), [
    ['go test ./...', null, null, 'unknown'], ['npm test', 0, false, 'passed'],
  ]);
  assert.equal(compareClaims(verification.finalReply, {}, verification)[0].status, 'UNVERIFIED');
});

test('counts every sandbox denial, including stderr on successful non-test commands', async t => {
  const project = directory(t);
  const output = [
    "error: Unable to create '/fixture/.git/packed-refs.lock': Operation not permitted",
    "zsh:1: can't create temp file for here document: operation not permitted",
    'zsh:2: operation not permitted: /fixture/external',
  ].join('\n');
  const transcript = jsonl(makeCodexTurn('denial', { command: 'git commit', exitCode: 0, output }));
  const { data, card } = await evidence.forTurn({
    project, cwd: null, task: 'PILOT-TOOLS', turn: 'denial', provider: 'codex', nativeTurnId: 'denial', transcript,
    projected: { tools: [{ tool: 'shell', command: 'git commit', output }], turnStatus: 'completed' },
  });
  assert.equal(data.verification.sandboxDenials, 3);
  assert.deepEqual(data.verification.commands, []);
  assert.match(card, /沙箱拒绝 3/);
  const projected = await evidence.forTurn({
    project, cwd: null, task: 'PILOT-TOOLS', turn: 'fallback', provider: 'codex',
    projected: { tools: [{ tool: 'shell', output }], turnStatus: 'completed' },
  });
  assert.equal(projected.data.verification.sandboxDenials, 3);
});

test('persists one bounded card and retains the first observation across retries', async t => {
  const project = directory(t);
  const finalReply = 'DONE EVID\n全绿\n已合入';
  const transcript = jsonl(makeCodexTurn('stored', { exitCode: 1, output: failedOutput, finalReply }));
  const options = { project, cwd: null, task: 'EVID', turn: 1, provider: 'codex', finalReply, transcript };
  const first = await evidence.forTurn(options);
  const second = await evidence.forTurn({ ...options, transcript: null, finalReply: null });
  assert.deepEqual(second, first);
  assert.equal(first.path, join(project, '.project/evidence/EVID-1.json'));
  assert.equal(first.data.claims.find(claim => claim.kind === 'merged').status, 'UNVERIFIED');
  assert.match(first.card, /MISMATCH/);
  assert.equal(readFileSync(first.textPath, 'utf8'), first.card + '\n');
  assert.ok(estimateTokens(first.card + '\n') <= 300);
});

test('attaches one optional card to an OAR turn-end without modifying the archived reply', async t => {
  const project = directory(t);
  const put = (file, text) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); };
  const addr = 'oar-f4199209-50a4-4ed5-ba5f-706dbca2c58e';
  const transcriptPath = join(project, 'own-transcript.jsonl');
  const finalReply = 'DONE A\n全绿';
  put(transcriptPath, jsonl(makeCodexTurn('oar-turn', { exitCode: 1, output: failedOutput, finalReply })));
  put(join(project, '.project/workers.md'), `A | ${addr} | codex | dispatched |\n`);
  put(join(project, '.project/relay/oar', `${addr}.json`), JSON.stringify({
    addr, task: 'A', cli: 'codex', cwd: project, baseCommit: 'fixture-has-no-base', transcriptPath,
  }));
  const end = { addr, type: 'turn-end', turn: 1, finalReply, eventId: `${addr}:5:turn-end`, at: 1500 };
  put(join(project, '.project/relay/events', `${addr}.jsonl`), jsonl([end, end]));
  const delivered = [];
  const call = async (verb, target, text) => delivered.push({ verb, target, text });
  const run = () => relay(project, ['leader'], 60_000, call, () => {}, undefined, { withEvidence: true });
  await run()(2000);
  await run()(3000);
  assert.equal(delivered.length, 1);
  assert.match(delivered[0].text, /DONE A\n全绿\n证据 MISMATCH 1/);
  assert.equal(readFileSync(join(project, '.project/replies/A.md'), 'utf8'), finalReply);
  assert.equal(readdirSync(join(project, '.project/evidence')).length, 2);
});
