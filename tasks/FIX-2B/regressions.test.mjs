import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { history, historyReader } from '../../cli/history.mjs';
import { worktreeAt, worktreeDelta } from '../../evidence/worktree.mjs';
import { forTurn } from '../../evidence/index.mjs';
import { collectVerification } from '../../evidence/transcript.mjs';
import { linkTuiInputHead, oarTurnEndHead, observeTuiHeads, saveTuiInputHead, turnHeadsPath } from '../../daemon/turn-heads.mjs';
import { eventPath } from '../../daemon/io.mjs';
import { trackOar } from '../../daemon/oar.mjs';

const put = (directory, file, content) => writeFileSync(join(directory, file), content);
const jsonl = rows => rows.map(row => JSON.stringify(row)).join('\n') + '\n';
const at = i => new Date(Date.UTC(2026, 10, 24) + i * 1000).toISOString();
const testOutput = (passed, total) => `ℹ tests ${total}\nℹ pass ${passed}\nℹ fail ${total - passed}\nℹ skipped 0\n`;
function directory(t) {
  const cwd = mkdtempSync(join(realpathSync(tmpdir()), 'loom-fix-2b-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  return cwd;
}
const read = async (cwd, session, options = {}) => (await history([session], historyReader(cwd),
  { level: 'L2', count: Infinity, tail: 10, ...options })).turns;
const session = (cwd, cli, basename, addr = 'fixture') => ({ cli, addr, project: cwd, cwd,
  transcriptPath: join(cwd, basename), endedAt: null });

function codexFixture() {
  const id = 'codex-native-turn';
  let time = 0;
  const event = payload => ({ type: 'event_msg', timestamp: at(time++), payload: { ...payload, turn_id: id } });
  const response = payload => ({ type: 'response_item', timestamp: at(time++), payload });
  const command = 'node --test smoke.test.mjs';
  const run = (call, cmd, exit, output) => [
    event({ type: 'exec_command_begin', call_id: call, command: ['/bin/zsh', '-lc', cmd] }),
    event({ type: 'exec_command_end', call_id: call, exit_code: exit, aggregated_output: output }),
  ];
  return [
    event({ type: 'task_started' }),
    event({ type: 'user_message', message: 'The spec mentions rate-limit.' }),
    ...run('ls', 'ls -d lib test', 1, 'ls: test: No such file or directory'),
    ...run('rg', 'rg -n whitespace .', 1, ''),
    ...run('cat', 'cat SPEC.md', 0, 'API rate-limit state. HTTP 429 is a documented value.'),
    response({ type: 'function_call', name: 'read_file', call_id: 'read', arguments: '{"path":"SPEC.md"}' }),
    response({ type: 'function_call_output', call_id: 'read', output: 'rate-limited: a state name' }),
    response({ type: 'custom_tool_call', name: 'exec', call_id: 'wrapper',
      input: `text(await tools.exec_command({cmd:${JSON.stringify(command)}}))` }),
    ...run('test-first', command, 1, testOutput(1, 2)),
    response({ type: 'custom_tool_call_output', call_id: 'wrapper', output: [
      { type: 'input_text', text: 'Script completed\nWall time: 0.01 seconds\nOutput:\n' },
      { type: 'input_text', text: JSON.stringify({ exit_code: 1, output: testOutput(1, 2) }) },
    ] }),
    ...run('test-again', command, 0, testOutput(2, 2)),
    event({ type: 'task_complete', last_agent_message: 'DONE SMOKE\n2 tests passed' }),
  ];
}

test('Codex smoke keeps one native entry per attempt and separates recovered checks from lifecycle', async t => {
  const cwd = directory(t);
  const transcript = jsonl(codexFixture());
  const row = session(cwd, 'codex', 'codex.jsonl');
  put(cwd, 'codex.jsonl', transcript);
  const [l1] = await read(cwd, row, { level: 'L1' });
  assert.equal(l1.status, 'completed');
  assert.deepEqual(l1.outcomes, ['recovered']);
  assert.deepEqual(l1.facts.exitCodes, [1, 1, 0, 1, 0]);
  assert.match(l1.summary, /1\/2 → 2\/2 · exit 0/);
  assert.match(l1.summary, /recovered node --test/);
  assert.equal(l1.summary.match(/非零退出/g).length, 1);
  const [l2] = await read(cwd, row, { onlyFailed: true, tool: 'shell' });
  assert.equal(l2.calls, undefined);
  assert.deepEqual(l2.tools.map(tool => [tool.ordinal, Boolean(tool.timestamp)]), [[1, true], [2, true], [5, true]]);
  assert.deepEqual(await read(cwd, row, { outcome: 'quota' }), []);
  assert.deepEqual(await read(cwd, row, { outcome: 'failed' }), []);
  const verification = collectVerification({ provider: 'codex', transcript, nativeTurnId: 'codex-native-turn' });
  assert.deepEqual(verification.commands.map(check => [check.exitCode, check.counts.passed]), [[1, 1], [0, 2]]);
  const card = await forTurn({ project: cwd, task: 'SMOKE', turn: 1, provider: 'codex', transcript,
    nativeTurnIndex: 1, nativeTurnId: 'different-headless-span', finalReply: 'DONE SMOKE\n2 tests passed' });
  assert.match(card.card, /验证 1\/2 通过/);
  assert.equal(card.data.verification.commands.length, 2);
});

test('a native quota error has a quota status and a completed turn without checks gives no MATCH', async t => {
  const cwd = directory(t);
  const row = session(cwd, 'codex', 'codex.jsonl');
  const ended = { type: 'event_msg', timestamp: at(2), payload: { type: 'task_complete', turn_id: '1',
    last_agent_message: 'DONE EMPTY' } };
  const start = { type: 'event_msg', timestamp: at(0), payload: { type: 'task_started', turn_id: '1' } };
  put(cwd, 'codex.jsonl', jsonl([start, { type: 'event_msg', timestamp: at(1),
    payload: { type: 'error', message: 'HTTP 429: rate limit reached' } }, ended]));
  assert.equal((await read(cwd, row, { outcome: 'quota' }))[0].status, 'quota');

  const result = await forTurn({ project: cwd, task: 'EMPTY', turn: 1, provider: 'codex', transcript: jsonl([start, ended]) });
  assert.match(result.card, /无可确认测试命令/);
  assert.deepEqual(result.data.claims.map(claim => claim.status), ['UNVERIFIED']);
});

test('agy fast-edit verification keeps exit 1, explicit unknown counts, and the successful retry', async t => {
  const cwd = directory(t);
  const command = 'node --test test/screen.test.mjs';
  const row = (type, step_index, data) => ({ type, step_index, source: 'MODEL', created_at: at(step_index), ...data });
  const checkCall = row('PLANNER_RESPONSE', 3, { tool_calls: [{ name: 'run_command', args: { CommandLine: command } }] });
  const file = 'agy.jsonl';
  const transcript = jsonl([
    { ...row('REQUEST', 0, { content: 'Test the screen parser' }), source: 'USER' },
    row('PLANNER_RESPONSE', 1, { tool_calls: [{ name: 'mcp_agy-fast_fast_apply_edits' }] }),
    row('GENERIC', 2, { content: `Created At: clock\nVerify [FAIL (exit 1) in 80ms] \`${command}\`:\n${testOutput(10, 11)}agy-rate-limit-synthetic.txt` }),
    checkCall, checkCall,
    row('GENERIC', 4, { content: 'Completed At: clock\nCommand exited with code 0.\n\nCommand output:\nℹ tests 11\n' }),
    row('PLANNER_RESPONSE', 5, { tool_calls: [{ name: 'run_command', args: { CommandLine: command } }] }),
    row('GENERIC', 6, { content: 'Command exited with code 0.\n\nCommand output:\n' + testOutput(11, 11) }),
    row('PLANNER_RESPONSE', 7, { status: 'DONE', content: 'DONE T4\n11 tests passed' }),
  ]);
  put(cwd, file, transcript);
  const [detail] = await read(cwd, session(cwd, 'agy', file), { tool: 'shell', command: /^node --test/ });
  assert.deepEqual(detail.tools.map(tool => tool.exitCode), [1, 0, 0]);
  assert.deepEqual(detail.tests.map(check => check.countStatus), ['recognised', 'count unrecognised', 'recognised']);
  assert.deepEqual(detail.outcomes, ['recovered']);
  assert.deepEqual(collectVerification({ provider: 'agy', transcript }).commands.map(check => check.exitCode), [1, 0, 0]);
});

test('Claude peels prompt wrappers and attributes native user interruption and queued inputs', async t => {
  const cwd = directory(t);
  const row = (type, i, data = {}) => ({ type, timestamp: at(i), ...data });
  const file = 'claude.jsonl';
  put(cwd, file, jsonl([
    row('user', 0, { uuid: 'first', message: { content: '<pasted_content id="1"><hc from="worker">[loom:123]\nRun sleep</hc></pasted_content id="1">' } }),
    row('attachment', 1, { attachment: { type: 'queued_command', commandMode: 'prompt', prompt: 'steer now' } }),
    row('user', 2, { message: { content: '[Request interrupted by user]' } }),
  ]));
  const [l1] = await read(cwd, session(cwd, 'claude', file), { level: 'L1' });
  assert.match(l1.summary, /任务 Run sleep/);
  assert.match(l1.summary, /轮中输入 1 · 中断方 user/);
  assert.deepEqual(l1.outcomes, ['aborted']);
});

function repo(t) {
  const cwd = directory(t);
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '--quiet');
  mkdirSync(join(cwd, 'test'));
  put(cwd, 'unchanged.txt', 'base\n');
  put(cwd, 'tracked.txt', 'before\n');
  put(cwd, 'test/old.test.mjs', 'assert.equal(output, 1);\n\nassert.ok(other);\n');
  git('add', '.');
  const fixtureCommit = tree => git('-c', 'user.name=Test Fixture', '-c', 'user.email=fixture@example.invalid',
    'commit-tree', tree, '-m', 'Snapshot fixture');
  git('update-ref', 'HEAD', fixtureCommit(git('write-tree')));
  return { cwd, git, fixtureCommit };
}

test('Git delta excludes pre-existing dirt, counts subsequent edits and finds assertion and scope guards', t => {
  const { cwd, git, fixtureCommit } = repo(t);
  put(cwd, 'unchanged.txt', 'dirty before\n');
  put(cwd, 'pre-existing.txt', 'local scratch\n');
  put(cwd, 'modified-untracked.txt', 'line\n');
  const staged = readFileSync(join(cwd, '.git/index'));
  const start = worktreeAt(cwd);
  assert.deepEqual(start.dirty.map(file => file.path).sort(), ['modified-untracked.txt', 'pre-existing.txt', 'unchanged.txt']);
  assert.ok(start.dirty.every(file => /^[a-f\d]{40,64}$/.test(file.hash)));
  put(cwd, 'modified-untracked.txt', 'line\nadded\n');
  put(cwd, 'test/old.test.mjs', 'assert.equal(output, 2);\n\ntest.skip("other");\n');
  put(cwd, 'tracked.txt', 'before\nnow\n');
  put(cwd, 'brand-new.txt', 'one\ntwo');
  const end = worktreeAt(cwd);
  const settings = { protectedPaths: ['test/**'], allowedPaths: ['test/**', 'tracked.txt'] };
  const delta = worktreeDelta(cwd, start, end, settings);
  assert.equal(delta.status, 'ok');
  assert.equal(delta.uncommitted, true);
  assert.deepEqual(delta.files.map(file => [file.path, file.added, file.deleted]), [
    ['brand-new.txt', 2, 0], ['modified-untracked.txt', 1, 0], ['test/old.test.mjs', 2, 2], ['tracked.txt', 1, 0],
  ]);
  assert.deepEqual(delta.numstat, { added: 6, deleted: 2, net: 4 });
  assert.deepEqual(delta.protectedHits.map(hit => hit.path), ['test/old.test.mjs']);
  assert.deepEqual(delta.scopeHits, ['brand-new.txt', 'modified-untracked.txt']);
  assert.deepEqual(delta.testAssertions.map(edit => edit.kind), ['modified', 'deleted']);
  assert.equal(delta.tests[0].changes.addedSkip, 1);
  assert.deepEqual(readFileSync(join(cwd, '.git/index')), staged);
  git('add', 'tracked.txt');
  git('update-ref', 'HEAD', fixtureCommit(git('write-tree')));
  const committed = worktreeDelta(cwd, start, worktreeAt(cwd), settings);
  assert.notEqual(committed.baseCommit, committed.head);
  assert.deepEqual(committed.files, delta.files);
});

test('TUI managed delivery and OAR journal persist independent Git facts at the closing boundary', async t => {
  const { cwd } = repo(t);
  mkdirSync(join(cwd, '.project/loomd/sessions'), { recursive: true });
  const tui = { cwd, addr: 'tui-fixture' };
  const message = { id: 'delivery', mode: 'queue' };
  const now = Date.now();
  put(cwd, 'pre-existing.txt', 'scratch\n');
  saveTuiInputHead(cwd, tui, message);
  put(cwd, 'tracked.txt', 'before\nfrom TUI\n');
  saveTuiInputHead(cwd, tui, message);
  observeTuiHeads(cwd, tui, [
    { hook_event_name: 'UserPromptSubmit', receivedAt: now },
    { hook_event_name: 'Stop', receivedAt: now + 1 },
  ]);
  linkTuiInputHead(cwd, tui, message, { at: now + 1, completion: { at: now + 1 } });
  const [turn] = JSON.parse(readFileSync(turnHeadsPath(cwd, tui.addr)));
  assert.equal(turn.startedAt, now);
  assert.deepEqual(turn.end.git.files.map(file => file.path), ['tracked.txt']);

  const oar = { cwd, addr: 'oar-fixture', cli: 'codex' };
  let receive;
  const sessionPeer = {
    id: 'native-session', status: () => ({ value: { kind: 'idle' } }), records: () => [],
    events: fn => { receive = fn; return () => {}; },
  };
  const runtime = trackOar(cwd, oar, sessionPeer, error => { throw error; });
  t.after(runtime.unsubscribe);
  const emit = (kind, seq, fields) => receive({ kind, seq, receivedAt: now + seq,
    agentPath: [], sessionId: sessionPeer.id, spanId: 'span', ...fields });
  runtime.sampleInputHead();
  emit('turn_active', 1);
  emit('tool_call_started', 2, { callId: 'check', toolName: 'commandExecution', input: 'node --test test/old.test.mjs' });
  emit('tool_call_ended', 3, { callId: 'check', exitCode: 0, content: [{ type: 'text', text: testOutput(1, 1) }] });
  put(cwd, 'from-oar.txt', 'new\n');
  emit('text_delta', 4, { phase: 'final_answer', messageId: 'reply', text: 'DONE OAR' });
  emit('turn_ended', 5, { outcome: { kind: 'completed' } });
  const start = runtime.rows.find(row => row.type === 'turn-start');
  const end = runtime.rows.find(row => row.type === 'turn-end');
  put(cwd, 'after-oar.txt', 'later\n');
  assert.deepEqual(oarTurnEndHead(cwd, oar, start, end).git.files.map(file => file.path), ['from-oar.txt']);
  const oarRow = { ...oar, project: cwd, endedAt: null, transcriptPath: eventPath(cwd, oar.addr) };
  const [details] = await read(cwd, oarRow, { showDiff: true });
  assert.equal(details.diff.turn.files[0].path, 'from-oar.txt');
  assert.equal(details.tests[0].counts.passed, 1);
  const [summary] = await read(cwd, oarRow, { level: 'L1' });
  assert.match(summary.summary, /改动 1 · 净 \+1 · Git\nfrom-oar\.txt \+1\/-0/);
  assert.ok(Buffer.byteLength(summary.summary) <= 600);
});
