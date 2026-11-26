import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { relay } from './project.mjs';

function fixture(t) {
  const project = mkdtempSync(join(realpathSync(tmpdir()), 'loom-relay-test-'));
  t.after(() => rmSync(project, { recursive: true, force: true }));
  const terminals = new Map();
  const calls = [];
  const inbox = [];
  const fake = { send: (target, text) => inbox.push([target, text]) };
  const path = (...parts) => join(project, ...parts);
  const put = (file, text) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); };
  const rows = text => put(path('.project/workers.md'), text);
  const read = name => readFileSync(path('.project', name), 'utf8');
  const worker = (addr, state = 'working', turn = 0, status_ms = 9000) => {
    const cwd = path(addr);
    mkdirSync(cwd, { recursive: true });
    terminals.set(addr, { cwd, address: addr, state: 'live', created_ms: 1000, turn, status_ms, status: { state } });
    return cwd;
  };
  const event = (addr, payload, at = 9000) => {
    const file = path('.project/relay/events', `${addr}.jsonl`);
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, JSON.stringify({ receivedAt: at, cwd: path(addr), ...payload }) + '\n');
  };
  const log = (file, records) => put(file, records.map(row => JSON.stringify(row)).join('\n') + '\n');
  const call = async (command, target, ...args) => {
    calls.push([command, target, ...args]);
    if (command === 'send') return fake.send(target, ...args);
    const terminal = terminals.get(target);
    if (command === 'get') return terminal;
    if (command === 'wait') return { ended: true, reason: 'status', turn: terminal.turn, status: terminal.status.state };
    if (command === 'read') return { text: 'screen tail\n' };
    assert.fail(command);
  };
  const run = (targets = ['leader'], window = 900_000) => relay(project, targets, window, call, () => {});
  return { project, path, put, read, rows, worker, terminals, event, log, calls, inbox, fake, run };
}

const codex = (turn_id, last_assistant_message) => ({ hook_event_name: 'Stop', session_id: 'cx', turn_id, last_assistant_message });
const agyStop = transcriptPath => ({ conversationId: 'ag', executionNum: 0, fullyIdle: true, transcriptPath });
const agyRow = (step_index, ms, content, user = false) => ({ step_index, created_at: new Date(ms).toISOString(), content,
  source: user ? 'USER_EXPLICIT' : 'MODEL', type: user ? 'USER_INPUT' : 'PLANNER_RESPONSE' });

test('merges OAR and TUI replies on the same wave across a restart', async t => {
  const f = fixture(t);
  const addr = 'oar-14ef8403-3958-45ad-b214-967b6be2ecb7';
  f.rows(`A | t1 | codex | dispatched | | wave=W1\nB | ${addr} | agy | dispatched | | wave=W1\n`);
  f.worker('t1', 'done', 1);
  f.event('t1', codex('first', 'DONE A\nTUI reply'));
  f.event(addr, { eventId: `${addr}:1:turn-start`, addr, at: 9000, type: 'turn-start', turn: 1 });
  await f.run()(10_000);
  assert.equal(f.inbox.length, 0);
  const finalReply = 'DONE B\n原生正文 🧵\n\n';
  const end = { eventId: `${addr}:8:turn-end`, addr, at: 11_000, type: 'turn-end', turn: 1, finalReply };
  f.event(addr, end);
  f.event(addr, end);
  await f.run()(12_000);
  await f.run()(13_000);
  assert.equal(f.inbox.length, 1);
  assert.equal(f.inbox[0][0], 'leader');
  assert.match(f.inbox[0][1], /波次 W1[\s\S]*TUI reply[\s\S]*原生正文 🧵/);
  assert.equal(f.read('replies/B.md'), finalReply);
  assert.ok(f.calls.every(([, target]) => target !== addr));
});

test('sends one successful wave after a gap longer than 60 seconds and a restart', async t => {
  const f = fixture(t);
  f.rows('Heading\r\n| A | t1 | codex | dispatched | | wave=W1 |\r\nB | t2 | agy | dispatched | | wave=W1\r\n');
  f.worker('t1', 'done', 1);
  const cwd = f.worker('t2');
  f.event('t1', codex('a-1', 'DONE A\nCodex final'));
  const step = f.run(['leader', 'audit']);
  await step(10_000);
  assert.equal(f.inbox.length, 0);
  assert.match(f.read('workers.md'), /\| A \| t1 \| codex \| done \| DONE A \| wave=W1 \|\r\n/);
  const resumed = f.run(['leader', 'audit']);
  await resumed(71_000);
  assert.equal(f.inbox.length, 0);
  f.worker('t2', 'done', 1, 75_000);
  const full = join(cwd, 'transcript_full.jsonl');
  f.log(full, [agyRow(0, 73_000, 'prompt', true), agyRow(1, 74_500, 'DONE B\nAgy final')]);
  f.log(join(cwd, 'transcript.jsonl'), [agyRow(1, 74_500, 'old compact')]);
  f.event('t2', agyStop(join(cwd, 'transcript.jsonl')), new Date(75_000).toISOString());
  await resumed(76_000);
  const message = '波次 W1\n\nA t1 DONE\nDONE A\nCodex final\n\nB t2 DONE\nDONE B\nAgy final';
  assert.deepEqual(f.inbox, [['leader', message]]);
  assert.equal(f.read('replies/B.md'), 'DONE B\nAgy final');
  await f.run(['leader', 'audit'])(1_000_000);
  assert.equal(f.inbox.length, 1);
  assert.equal(f.calls.some(([command]) => command === 'read' || command === 'wait'), false);
});

test('persists the registration deadline and sends independent waves once', async t => {
  const f = fixture(t);
  f.rows('A | t1 | codex | dispatched | | wave=W1\nB | t2 | codex | dispatched | | wave=W1\n');
  f.worker('t1');
  f.worker('t2');
  const targets = ['leader', 'audit'];
  await f.run(targets, 60_000)(10_000);
  const step = f.run(targets);
  f.rows(f.read('workers.md') + 'C | t3 | codex | dispatched | | wave=W2\n');
  f.worker('t3', 'done', 1, 20_000);
  f.event('t3', codex('c-1', 'DONE C'), 20_000);
  await step(21_000);
  assert.deepEqual(f.inbox, [['leader', '波次 W2\n\nC t3 DONE\nDONE C']]);
  f.worker('t1', 'done', 1, 68_000);
  f.event('t1', codex('a-1', 'DONE A'), 68_000);
  await step(69_999);
  assert.equal(f.inbox.length, 1);
  await step(70_000);
  assert.deepEqual(f.inbox[1], ['leader', '波次 W1（超时）\n\nA t1 DONE\nDONE A\n\n未完成：B t2']);
  f.worker('t2', 'done', 1, 71_000);
  f.event('t2', codex('b-1', 'DONE B'), 71_000);
  await step(72_000);
  assert.equal(f.read('replies/B.md'), 'DONE B');
  assert.match(f.read('workers.md'), /B \| t2 \| codex \| done \| DONE B \| wave=W1/);
  assert.equal(f.inbox.length, 2);
});

test('reports a deadline with zero finished workers and archives a late completion without a wake', async t => {
  const f = fixture(t);
  f.rows('A | t1 | codex | dispatched | | wave=W1\n');
  f.worker('t1');
  const step = f.run(['leader', 'audit'], 1000);
  await step(10_000);
  f.worker('t1', 'done', 1, 11_150);
  f.event('t1', codex('a-1', 'DONE A'), 11_150);
  await step(11_200);
  assert.deepEqual(f.inbox, [['leader', '波次 W1（超时）\n\n未完成：A t1']]);
  assert.equal(f.read('replies/A.md'), 'DONE A');
  assert.deepEqual(JSON.parse(f.read('relay/state.json')).queue, []);
});

test('uses agy transcript identity across resume, even when executionNum and text repeat', async t => {
  const f = fixture(t);
  f.rows('A | t1 | agy | dispatched |\n');
  const cwd = f.worker('t1', 'done', 1);
  const transcript = join(cwd, 'transcript_full.jsonl');
  const history = [agyRow(0, 8000, 'first', true), agyRow(1, 8500, 'DONE A')];
  f.log(transcript, history);
  f.event('t1', { ...agyStop(transcript), fullyIdle: false }, 8700);
  f.event('t1', agyStop(transcript), 9000);
  f.event('t1', agyStop(transcript), 9100);
  await f.run()(12_000);
  assert.deepEqual(f.inbox, [['leader', 'A t1 DONE\nDONE A']]);
  f.worker('t1', 'working', 1, 13_000);
  const step = f.run();
  await step(13_100);
  f.log(transcript, [...history, agyRow(2, 13_000, 'resume', true), agyRow(3, 14_000, 'DONE A')]);
  f.worker('t1', 'done', 2, 15_000);
  f.event('t1', agyStop(transcript), 15_000);
  await step(17_000);
  await f.run()(20_000);
  assert.deepEqual(f.inbox, [['leader', 'A t1 DONE\nDONE A'], ['leader', 'A t1 DONE\nDONE A']]);
});

test('extracts the root Claude assistant message and reports explicit failure', async t => {
  const f = fixture(t);
  f.rows('A | t1 | claude | dispatched | | wave=W1\nB | t2 | claude | dispatched | | wave=W1\n');
  const cwd = f.worker('t1', 'done', 1);
  f.worker('t2', 'error', 1);
  const transcript = join(cwd, 'claude.jsonl');
  const message = (id, content, extra) => ({ type: 'assistant', message: { id, content }, ...extra });
  const text = text => ({ type: 'text', text });
  f.log(transcript, [message('tool', [text('progress'), { type: 'tool_use', id: 'tid', name: 'Bash' }]),
    message('final', [text('DONE A'), text('verified')]), message('side', [text('ignore')], { isSidechain: true })]);
  f.event('t1', { hook_event_name: 'Stop', session_id: 'ca', transcript_path: transcript });
  f.event('t2', { hook_event_name: 'StopFailure', session_id: 'cb' });
  await f.run(['leader', 'audit'])(12_000);
  assert.equal(f.read('replies/A.md'), 'DONE A\nverified');
  assert.equal(f.read('replies/B.md'), 'FAILED B\nclaude Stop failure');
  assert.match(f.inbox[0][1], /B t2 FAILED/);
  assert.deepEqual(f.inbox, [['leader', f.inbox[0][1]], ['audit', f.inbox[0][1]]]);
  await f.run(['leader', 'audit'])(24_000);
  assert.equal(f.inbox.length, 2);
});

test('uses hc wait, then the cwd-scoped transcript or marked screen fallback', async t => {
  const f = fixture(t);
  f.rows('A | t1 | codex | dispatched | | wave=W1\nB | t2 | codex | dispatched | | wave=W1\n');
  const cwd = f.worker('t1', 'idle');
  f.worker('t2', 'idle');
  const step = f.run();
  await step(12_000);
  assert.equal(f.inbox.length, 0);
  f.log(join(cwd, '.project/relay/t1.jsonl'), [{ type: 'response_item', payload: { type: 'message',
    role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text: 'DONE A' }] } }]);
  f.worker('t1', 'idle', 1);
  f.worker('t2', 'done', 1);
  await step(13_000);
  assert.equal(f.inbox.length, 1);
  assert.match(f.inbox[0][1], /A t1 DONE\nDONE A\n\nB t2 FAILED \[fallback: hc read\]\nscreen tail$/);
  assert.deepEqual(f.calls.filter(([command]) => command === 'wait').map(([, target]) => target), ['t1', 't2']);
  f.event('t1', codex('late-a-1', 'DONE A'), 13_500);
  await step(17_000);
  assert.equal(f.inbox.length, 1);
});

test('resumes a legacy in-flight wave from an existing state file', async t => {
  const f = fixture(t);
  f.rows('A | t1 | codex | done | DONE A\nB | t2 | codex | dispatched |\n');
  f.put(f.path('.project/relay/state.json'), JSON.stringify({
    progress: {},
    queue: [{ id: 'A', addr: 't1', outcome: 'DONE', body: 'DONE A', at: 10_000, published: true }],
    outbox: [],
    wave: { at: 10_000, members: ['A/t1', 'B/t2'] },
  }));
  f.worker('t1', 'done', 1);
  f.worker('t2', 'done', 1, 11_000);
  f.event('t1', codex('a-1', 'DONE A'));
  f.event('t2', codex('b-1', 'DONE B'), 11_000);
  await f.run(['leader', 'audit'])(12_000);
  assert.deepEqual(f.inbox, [['leader', 'A t1 DONE\nDONE A\n\nB t2 DONE\nDONE B']]);
});

test('keeps long native replies and updates only the corresponding Markdown row', async t => {
  const f = fixture(t);
  f.rows('Intro\n| A | t1 | codex | dispatched | | wave=W1 |\nOther text\n');
  f.worker('t1', 'done', 1);
  const body = ['DONE A | verified', ...Array.from({ length: 20 }, (_, i) => `line ${i}`)].join('\n');
  f.event('t1', codex('a-1', body));
  const step = f.run();
  await step(12_000);
  assert.equal(f.read('workers.md'), 'Intro\n| A | t1 | codex | done | DONE A \\| verified | wave=W1 |\nOther text\n');
  const archive = f.inbox[0][1].split('完整内容 ')[1];
  assert.ok(archive);
  assert.equal(readFileSync(archive, 'utf8'), body);
  assert.doesNotMatch(f.inbox[0][1], /line 19/);
  f.rows(f.read('workers.md') + 'A | t1 | codex | dispatched | | wave=W2\n');
  f.worker('t1', 'done', 2, 13_000);
  f.event('t1', codex('a-2', 'FAILED A\nnew round'), 13_000);
  await step(14_000);
  assert.match(f.inbox[1][1], /^波次 W2\n\nA t1 FAILED/);
  assert.match(f.read('workers.md'), /done \| DONE A \\\| verified \| wave=W1/);
  assert.equal(f.read('replies/A.md'), 'FAILED A\nnew round');
  assert.equal(readFileSync(archive, 'utf8'), body);
});

test('retargets pending work while keeping the copy already delivered to the auditor', async t => {
  const f = fixture(t);
  f.rows('A | t1 | codex | dispatched |\n');
  f.worker('t1', 'done', 1);
  f.event('t1', codex('a-1', 'FAILED A'));
  f.fake.send = (target, text) => {
    if (target === 'old') throw Object.assign(new Error('finished'), { kind: 'finished' });
    f.inbox.push([target, text]);
  };
  await f.run(['old', 'audit'])(12_000);
  await f.run(['audit'])(13_000);
  assert.deepEqual(f.inbox, [['audit', 'A t1 FAILED\nFAILED A']]);
  assert.deepEqual(JSON.parse(f.read('relay/state.json')).outbox, []);
});

test('retries definite refusal and keeps an ambiguous send at most once', async t => {
  const f = fixture(t);
  f.rows('A | t1 | codex | dispatched |\n');
  f.worker('t1', 'done', 1);
  f.event('t1', codex('a-1', 'DONE A'));
  f.fake.send = (target, text) => {
    if (f.calls.filter(([command]) => command === 'send').length === 1) {
      throw Object.assign(new Error('blocked'), { kind: 'blocked' });
    }
    f.inbox.push([target, text]);
    throw new Error('timeout after paste');
  };
  await f.run()(12_000);
  await f.run()(16_999);
  assert.equal(f.inbox.length, 0);
  await f.run()(17_000);
  await f.run()(30_000);
  assert.deepEqual(f.inbox, [['leader', 'A t1 DONE\nDONE A']]);
});
