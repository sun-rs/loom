import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { deliveryId } from '../inbox/message.mjs';
import { estimateTokens } from '../lib/token-budget.mjs';
import { createSupervisor } from './supervisor.mjs';

function fixture(t, options) {
  const project = mkdtempSync(join(realpathSync(tmpdir()), 'loomd-test-'));
  t.after(() => rmSync(project, { recursive: true, force: true }));
  mkdirSync(join(project, '.project'));
  writeFileSync(join(project, '.project/policy.json'), '{"preferred":[],"deny":[]}');
  const sessions = new Map();
  const prompts = [];
  const resumes = [];
  const read = part => JSON.parse(readFileSync(join(project, '.project', part), 'utf8'));

  async function open(row, _, resume) {
    if (resume) resumes.push(resume);
    const id = resume ?? randomUUID();
    const path = join(project, `${id}.jsonl`);
    writeFileSync(path, '', { flag: 'a' });
    let seq = 0;
    let observer;
    let active;
    const session = {
      id,
      records: () => [],
      status: () => ({ value: active ? { kind: 'running', sinceSeq: active.sinceSeq, lastEventAt: active.at } : { kind: 'idle' } }),
      events: notify => { observer = notify; return () => { observer = undefined; }; },
      nativeSessionFile: async () => path,
      async dispose() { emit('exited'); },
      async prompt(input) {
        const inputId = deliveryId(input);
        const requestId = randomUUID();
        active = { inputId, sinceSeq: seq, spanId: randomUUID(), at: Date.now() };
        prompts.push({ addr: row.addr, input });
        emit('turn_started', { requestId, input });
        if (row.cli === 'agy') emit('tool_call_started', { callId: 'fixture-call' });
        else emit('turn_active', { inputId });
        const body = input.split('\n').slice(1).join('\n').split('\n\n## Loom task conventions', 1)[0];
        if (!body.startsWith('HOLD') &&
            (row.role !== 'leader' || body.includes('波次') || body.includes('续作批次') || body.endsWith('replacement'))) {
          finish(body.startsWith('RETURN ') ? body.slice(7) : row.task);
        }
        return { kind: 'accepted', requestId, seq: seq - 1 };
      },
      async abort() {
        emit('turn_ended', { outcome: { kind: 'aborted' } });
        active = undefined;
        return { kind: 'accepted', requestId: randomUUID(), seq: seq - 1 };
      },
    };
    function emit(kind, data = {}) {
      observer?.({ kind, ...data, agentPath: [], sessionId: id, seq: seq++, receivedAt: Date.now(), spanId: active?.spanId });
    }
    function finish(body, outcome = { kind: 'completed' }) {
      if (row.cli === 'codex') {
        const timestamp = new Date().toISOString();
        const turn_id = active.spanId;
        const rows = [{ type: 'task_started', turn_id }, { type: 'task_complete', turn_id, last_agent_message: body }];
        appendFileSync(path, rows.map(payload => JSON.stringify({ type: 'event_msg', timestamp, payload }) + '\n').join(''));
      }
      emit('text_delta', { phase: 'final_answer', text: body });
      emit('turn_ended', { inputId: active.inputId, outcome });
      active = undefined;
    }
    sessions.set(row.addr, { finish, session, loseEnd: () => { active = undefined; } });
    return session;
  }

  const daemon = () => createSupervisor(project, { report: () => {}, externalNotification: async () => {},
    sessionOptions: { open }, ...options });
  const spawn = (d, role, task, parent, fields = {}) => d.handle('spawn', {
    role, task, wave: role === 'worker' ? 'W' : 'ROOT', cli: 'codex', model: 'model', effort: 'high',
    cwd: project, project, mode: 'headless', prompt: 'start', ...fields,
  }, parent);
  return { daemon, spawn, read, sessions, prompts, resumes, project };
}

test('seals a wave at the dispatching root turn and delivers it once across daemon recovery', async t => {
  const f = fixture(t);
  const daemon = f.daemon();
  const { session: leader } = await f.spawn(daemon, 'leader', 'L');
  await daemon.tick();
  const { session: first } = await f.spawn(daemon, 'worker', 'T1', leader.addr);
  await daemon.tick();
  await daemon.tick();
  assert.equal(Object.values(f.read('relay/state.json').waves)[0].deadline, null);
  const { session: second } = await f.spawn(daemon, 'worker', 'T2', leader.addr);
  await daemon.tick();
  await daemon.tick();
  assert.equal(f.prompts.filter(item => item.input.includes('波次 W')).length, 0);
  f.sessions.get(leader.addr).finish('leader first turn');
  await daemon.tick();

  const before = f.read('inbox/state.json').messages.filter(message => message.waveBatch);
  assert.equal(before.length, 1);
  assert.equal(before[0].phase, 'queued');
  assert.match(before[0].text, /T1.*证据.*T2.*证据/s);
  await daemon.shutdown();

  const recovered = f.daemon();
  await recovered.tick();
  await recovered.tick();
  const after = f.read('inbox/state.json').messages.filter(message => message.waveBatch);
  assert.deepEqual(f.resumes.sort(), [leader.sessionId, first.sessionId, second.sessionId].sort());
  assert.equal(after.length, 1);
  assert.equal(after[0].id, before[0].id);
  assert.equal(after[0].phase, 'received');
  assert.equal(f.prompts.filter(item => item.input.includes('波次 W')).length, 1);
  assert.ok(f.read('relay/state.json').outbox.length === 0);
});

test('keeps a pending shell request durable and reconciles a missing response from its native transcript', async t => {
  const f = fixture(t);
  const daemon = f.daemon();
  const { session: leader } = await f.spawn(daemon, 'leader', 'L');
  await daemon.tick();
  f.sessions.get(leader.addr).finish('startup response');
  await daemon.tick();
  const receipt = await daemon.handle('send', { target: leader.addr, text: 'shell question', mode: 'queue' });
  await daemon.tick();
  const mail = f.read('inbox/state.json').messages.find(message => message.id === receipt.id);
  assert.equal(mail.phase, 'sending');
  const id = 'native-turn-after-lost-frame';
  const at = new Date().toISOString();
  const record = payload => JSON.stringify({ type: 'event_msg', timestamp: at, payload });
  writeFileSync(join(f.project, `${leader.sessionId}.jsonl`), [
    record({ type: 'task_started', turn_id: id }),
    record({ type: 'user_message', message: `[loom:${receipt.id}]\nshell question` }),
    record({ type: 'task_complete', turn_id: id, last_agent_message: 'shell answer' }),
  ].join('\n') + '\n');

  const recovered = f.daemon();
  await recovered.tick();
  const result = f.read('inbox/state.json').messages.find(message => message.id === receipt.id);
  assert.equal(result.phase, 'received');
  assert.equal(result.completion.body, 'shell answer');
  assert.equal(result.completion.source, 'native transcript');
  assert.equal(f.prompts.filter(item => item.input.endsWith('shell question')).length, 1);
});

test('uses native agy activity to interrupt an in-flight queue delivery and continue', async t => {
  const f = fixture(t);
  const daemon = f.daemon();
  const { session, deliveryId: first } = await daemon.handle('spawn', {
    role: 'leader', task: 'L', wave: 'W', cli: 'agy', model: 'model', effort: 'high',
    cwd: f.project, project: f.project, mode: 'headless', prompt: 'start',
  });
  await daemon.tick();
  const receipt = await daemon.handle('send', { target: session.addr, text: 'replacement', mode: 'interrupt' });
  for (let i = 0; i < 4; i++) await daemon.tick();
  const { messages } = f.read('inbox/state.json');
  assert.equal(messages.find(message => message.id === first).completion.outcome.kind, 'aborted');
  const replacement = messages.find(message => message.id === receipt.id).completion;
  assert.equal(replacement.body, undefined);
  assert.equal(replacement.unconfirmedBody, 'L');
  assert.equal(replacement.unconfirmed, true);
  assert.equal(f.prompts.length, 2);
});

test('counts Chinese per character and clips English by the approximate token budget', async () => {
  const { clipTokens } = await import('../lib/token-budget.mjs');
  assert.equal(estimateTokens('甲乙abcd'), 3);
  for (const budget of [300, 1500]) {
    const chinese = clipTokens('字'.repeat(budget + 1), budget);
    assert.equal(estimateTokens(chinese), budget);
    assert.equal(Array.from(chinese).length, budget);
    const english = clipTokens('abcd'.repeat(budget + 1), budget);
    assert.equal(estimateTokens(english), budget);
    assert.ok(english.length > budget);
  }
});

test('index membership ignores edited Markdown and seal fallback plus partial window wake a Leader without a turn end', async t => {
  let advance = 0;
  const f = fixture(t, { sealWindow: 100_000, window: 600_000, partialWindow: 20_000, uncertainWindow: 800_000,
    now: () => Date.now() + advance });
  const d = f.daemon();
  const leader = (await f.spawn(d, 'leader', 'L')).session.addr;
  await d.tick();
  await f.spawn(d, 'worker', 'FAST', leader, { prompt: 'RETURN DONE FAST' });
  const slow = await f.spawn(d, 'worker', 'SLOW', leader, { prompt: 'HOLD worker' });
  writeFileSync(join(f.project, '.project', 'workers.md'), 'FAKE | t777 | codex | dispatched | | wave=W\n');
  await d.tick();
  await d.tick();
  let wave = Object.values(f.read('relay/state.json').waves)[0];
  assert.equal(wave.deadline, null);
  assert.equal(wave.members.length, 2);
  assert.equal(f.prompts.filter(row => row.input.includes('波次 W')).length, 0);
  f.sessions.get(leader).loseEnd();
  advance = 130_000;
  await d.tick();
  await d.tick();
  wave = Object.values(f.read('relay/state.json').waves)[0];
  assert.equal(wave.deadline - wave.sealedAt, 20_000);
  const timeouts = f.read('inbox/state.json').messages.filter(message => message.waveBatch);
  assert.equal(timeouts.length, 1);
  assert.match(timeouts[0].text, /FAST.*DONE.*SLOW.*STUCK.*最近活动/s);
  assert.doesNotMatch(timeouts[0].text, /FAKE/);
  assert.equal(f.prompts.filter(row => row.input.includes('波次 W')).length, 1);
  assert.ok((await d.handle('state', { target: leader })).notifications.some(event => event.type === 'wave-timeout'));
  await assert.rejects(f.spawn(d, 'worker', 'EXTRA', leader), { code: 'wave-sealed' });
  const replacement = await f.spawn(d, 'worker', 'SLOW', leader, { wave: 'W2', prompt: 'RETURN DONE SLOW new wave' });
  f.sessions.get(slow.session.addr).finish('DONE SLOW old wave');
  for (let i = 0; i < 4; i++) await d.tick();
  assert.match(readFileSync(join(f.project, '.project/workers.md'), 'utf8'), /SLOW .*superseded.*wave=W/);
  assert.equal(f.prompts.filter(row => row.input.includes('DONE SLOW old wave')).length, 0);
  assert.ok(f.prompts.some(row => row.input.includes('DONE SLOW new wave') && row.addr !== replacement.session.addr));
});

test('coalesces BLOCKED and finished members once, keeps the wave open, and copies only FAILED/MISMATCH', async t => {
  let advance = 0;
  const f = fixture(t, { now: () => Date.now() + advance, uncertainWindow: 800_000 });
  const d = f.daemon();
  const auditor = (await f.spawn(d, 'auditor', 'AUDIT')).session.addr;
  const leader = (await f.spawn(d, 'leader', 'L')).session.addr;
  await d.tick();
  await f.spawn(d, 'worker', 'BLOCK1', leader, { prompt: 'RETURN BLOCKED BLOCK1' });
  await f.spawn(d, 'worker', 'BLOCK2', leader, { prompt: 'RETURN BLOCKED BLOCK2' });
  await f.spawn(d, 'worker', 'FAILED', leader, { prompt: 'RETURN FAILED FAILED' });
  const tail = (await f.spawn(d, 'worker', 'TAIL', leader, { prompt: 'HOLD TAIL' })).session.addr;
  for (let i = 0; i < 3; i++) await d.tick();
  const batches = () => f.read('inbox/state.json').messages.filter(message => message.waveBatch);
  assert.equal(batches().length, 0);
  f.sessions.get(leader).finish('dispatch ended');
  await assert.rejects(f.spawn(d, 'worker', 'CROSS', leader), { code: 'wave-sealed' });
  advance = 61_000;
  for (let i = 0; i < 3; i++) await d.tick();
  const early = batches().filter(message => message.target.addr === leader);
  assert.equal(early.length, 1);
  assert.match(early[0].text, /波次 W（阻塞）[\s\S]*BLOCKED BLOCK1[\s\S]*BLOCKED BLOCK2[\s\S]*FAILED FAILED/);
  const copies = batches().filter(message => message.target.addr === auditor);
  assert.equal(copies.length, 1);
  assert.match(copies[0].text, /FAILED FAILED/);
  assert.doesNotMatch(copies[0].text, /BLOCKED/);
  assert.equal(Object.values(f.read('relay/state.json').waves)[0].closed, undefined);
  f.sessions.get(tail).finish('DONE TAIL');
  await d.shutdown();
  const recovered = f.daemon();
  for (let i = 0; i < 4; i++) await recovered.tick();
  const finished = batches().filter(message => message.target.addr === leader);
  assert.equal(finished.length, 2);
  assert.match(finished[1].text, /DONE TAIL/);
  assert.doesNotMatch(finished[1].text, /BLOCKED|FAILED/);
  assert.equal(f.prompts.filter(row => row.addr === leader && row.input.includes('波次 W')).length, 2);
  await f.spawn(recovered, 'worker', 'MISMATCH', leader, { wave: 'M', prompt: 'RETURN DONE MISMATCH\n全绿，通过 8 项' });
  for (let i = 0; i < 4; i++) await recovered.tick();
  assert.ok(f.prompts.some(row => row.addr === auditor && /波次 M.*证据 MISMATCH/s.test(row.input)));
});

test('a sealed wave whose BLOCKED members and final result arrive within the window wakes Leader once', async t => {
  let advance = 0;
  const f = fixture(t, { blockedWindow: 10_000, now: () => Date.now() + advance });
  const d = f.daemon();
  const leader = (await f.spawn(d, 'leader', 'L')).session.addr;
  await d.tick();
  await f.spawn(d, 'worker', 'B1', leader, { prompt: 'RETURN BLOCKED B1' });
  await f.spawn(d, 'worker', 'B2', leader, { prompt: 'RETURN BLOCKED B2' });
  const tail = (await f.spawn(d, 'worker', 'FAST', leader, { prompt: 'HOLD FAST' })).session.addr;
  f.sessions.get(leader).finish('dispatch ended');
  for (let i = 0; i < 3; i++) await d.tick();
  assert.equal(f.read('inbox/state.json').messages.filter(message => message.waveBatch).length, 0);
  f.sessions.get(tail).finish('DONE FAST');
  for (let i = 0; i < 3; i++) await d.tick();
  advance = 11_000;
  await d.tick();
  const received = f.read('inbox/state.json').messages.filter(message => message.waveBatch);
  assert.equal(received.length, 1);
  assert.match(received[0].text, /BLOCKED B1.*BLOCKED B2.*DONE FAST/s);
  assert.equal(f.prompts.filter(row => row.addr === leader && row.input.includes('波次 W')).length, 1);
});

test('continuation batch reports in acceptance order and does not separately forward member completions', async t => {
  const f = fixture(t);
  const d = f.daemon();
  const leader = (await f.spawn(d, 'leader', 'L')).session.addr;
  await d.tick();
  f.sessions.get(leader).finish('ready');
  await d.tick();
  const a = (await f.spawn(d, 'worker', 'A', leader)).session.addr;
  const b = (await f.spawn(d, 'worker', 'B', leader)).session.addr;
  for (let i = 0; i < 4; i++) await d.tick();
  const batch = randomUUID(), batchSize = 2;
  const first = await d.handle('send', { target: a, mode: 'queue', text: 'HOLD A', batch, batchSize }, leader);
  const second = await d.handle('send', { target: b, mode: 'queue', text: 'RETURN DONE B', batch, batchSize }, leader);
  for (let i = 0; i < 3; i++) await d.tick();
  assert.equal(f.read('inbox/state.json').messages.some(message => message.continuationBatch), false);
  f.sessions.get(a).finish('DONE A');
  for (let i = 0; i < 3; i++) await d.tick();
  const messages = f.read('inbox/state.json').messages;
  const work = messages.filter(message => message.continuationBatch === batch);
  assert.equal(work.length, 1);
  assert.equal(work[0].target.addr, leader);
  assert.match(work[0].text, /DONE A.*DONE B/s);
  assert.equal(messages.some(message => [first.id, second.id].includes(message.replyTo)), false);
});

test('headless quiet and quota conditions journal one edge across restart and queue a single external notification', async t => {
  let advance = 0;
  const f = fixture(t, { now: () => Date.now() + advance, watchOptions: { busyMs: 25 } });
  const d = f.daemon();
  const { session: leader } = await f.spawn(d, 'leader', 'L');
  await d.tick();
  advance = 1000;
  await d.tick();
  await d.tick();
  const headless = await d.handle('state', { target: leader.addr });
  assert.equal(headless.state, 'stuck');
  assert.equal(headless.reason, 'busy-without-output');
  f.sessions.get(leader.addr).finish('', { kind: 'failed', failure: 'rate_limited' });
  await d.tick();
  await d.tick();
  await d.shutdown();
  const resumed = f.daemon();
  await resumed.tick();
  assert.deepEqual((await resumed.handle('notifications', { take: true })).notifications.map(row => row.reason),
    ['busy-without-output', 'rate-limit']);
  assert.deepEqual((await resumed.handle('notifications', { take: true })).notifications, []);
});

test('ordinary late result gets one supplement across restart under the original registration', async t => {
  let advance = 0;
  const f = fixture(t, { window: 200_000, partialWindow: 30_000, now: () => Date.now() + advance });
  const d = f.daemon();
  const leader = (await f.spawn(d, 'leader', 'L')).session.addr;
  await d.tick();
  await f.spawn(d, 'worker', 'FAST', leader, { prompt: 'RETURN DONE FAST' });
  const late = await f.spawn(d, 'worker', 'LATE', leader, { prompt: 'HOLD worker' });
  f.sessions.get(leader).finish('dispatch ended');
  for (let i = 0; i < 3; i++) await d.tick();
  advance = 35_000;
  for (let i = 0; i < 3; i++) await d.tick();
  const initial = f.read('inbox/state.json').messages.filter(message => message.waveBatch);
  assert.equal(initial.length, 1);
  assert.match(initial[0].text, /LATE.*STUCK/);
  f.sessions.get(late.session.addr).finish('DONE LATE');
  await d.tick();
  await d.shutdown();
  const recovered = f.daemon();
  for (let i = 0; i < 4; i++) await recovered.tick();
  const deliveries = f.read('inbox/state.json').messages.filter(message => message.waveBatch);
  assert.equal(deliveries.length, 2);
  assert.equal(deliveries[0].id, initial[0].id);
  assert.match(deliveries[1].text, /波次 W（补投）[\s\S]*DONE LATE/);
  assert.equal(f.prompts.filter(({ input }) => input.includes('波次 W（补投）')).length, 1);
});

test('a stale headless interrupt leaves the successor root running', async t => {
  const f = fixture(t);
  const d = f.daemon();
  const leader = (await f.spawn(d, 'leader', 'L')).session.addr;
  await d.tick();
  const pending = await d.handle('send', { mode: 'interrupt', target: leader, text: 'must not run' });
  const target = f.sessions.get(leader);
  target.finish('first root complete');
  await target.session.prompt('[loom:' + randomUUID() + ']\nHOLD successor');
  await d.tick();
  const state = await d.handle('state', { target: leader });
  assert.equal(state.state, 'busy');
  const result = state.deliveries.find(delivery => delivery.id === pending.id);
  assert.equal(result.deliveryStatus, 'refused');
  assert.equal(result.issue, 'target-turn-ended');
  assert.equal(f.prompts.some(({ input }) => input.endsWith('must not run')), false);
});

for (const explicit of [true, false]) {
  test(`${explicit ? 'explicit' : 'implicit'} worker continuations coalesce BLOCKED into one early wake and one remainder`, async t => {
    let advance = 0;
    const f = fixture(t, { blockedWindow: 10_000, now: () => Date.now() + advance });
    const d = f.daemon();
    const leader = (await f.spawn(d, 'leader', 'L')).session.addr;
    await d.tick();
    const tasks = ['BLOCK1', 'BLOCK2', 'FINISHED', 'TAIL'];
    const workers = [];
    for (const task of tasks) workers.push((await f.spawn(d, 'worker', task, leader)).session.addr);
    f.sessions.get(leader).finish('dispatch done');
    for (let i = 0; i < 4; i++) await d.tick();
    const fields = explicit ? { batch: randomUUID(), batchSize: tasks.length } : {};
    const messages = ['RETURN BLOCKED BLOCK1', 'RETURN BLOCKED BLOCK2', 'RETURN DONE FINISHED', 'HOLD TAIL'];
    for (const [i, target] of workers.entries()) await d.handle('send', { target, mode: 'queue', text: messages[i], ...fields }, leader);
    for (let i = 0; i < 3; i++) await d.tick();
    const wakes = () => f.read('inbox/state.json').messages.filter(message => message.continuationBatch);
    assert.equal(wakes().length, 0);
    advance = 11_000;
    await d.tick();
    await d.tick();
    assert.equal(wakes().length, 1);
    assert.match(wakes()[0].text, /BLOCKED BLOCK1.*BLOCKED BLOCK2.*DONE FINISHED/s);
    assert.doesNotMatch(wakes()[0].text, /TAIL/);
    f.sessions.get(workers[3]).finish('DONE TAIL');
    for (let i = 0; i < 4; i++) await d.tick();
    assert.equal(wakes().length, 2);
    assert.match(wakes()[1].text, /DONE TAIL/);
    assert.doesNotMatch(wakes()[1].text, /BLOCKED|DONE FINISHED/);
    assert.equal(f.prompts.filter(row => row.addr === leader && row.input.includes('续作批次')).length, 2);
  });
}

test('pushes a coalesced BLOCKED wave and explicit project events once to the managed Super', async t => {
  const external = [];
  const f = fixture(t, { externalNotification: async (_, events) => external.push(events) });
  const d = f.daemon();
  const { session: superSession } = await f.spawn(d, 'super', 'S');
  const { session: leader } = await f.spawn(d, 'leader', 'L');
  const { session: auditor } = await f.spawn(d, 'auditor', 'A');
  await d.tick();
  for (const task of ['B1', 'B2']) await f.spawn(d, 'worker', task, leader.addr, { prompt: 'RETURN BLOCKED ' + task });
  f.sessions.get(leader.addr).finish('dispatch complete');
  await d.tick();
  await d.tick();
  const pushed = () => f.read('inbox/state.json').messages.filter(message => message.projectEvents);
  assert.equal(pushed().length, 1);
  assert.equal(pushed()[0].target.addr, superSession.addr);
  assert.match(pushed()[0].text, /BLOCKED B1.*BLOCKED B2/s);

  await assert.rejects(d.handle('notifications', { decision: 'ordinary review' }, auditor.addr), { code: 'invalid-arguments' });
  await assert.rejects(d.handle('notifications', { take: true }, leader.addr), { code: 'invalid-arguments' });
  await d.handle('notifications', { decision: 'blocking audit evidence', auditEscalation: 'major-risk' }, auditor.addr);
  await d.handle('notifications', { complete: 'controlled project complete' });
  const seen = (await d.handle('notifications', {})).notifications;
  assert.deepEqual(seen.map(event => event.type).sort(), ['blocked-escalation', 'needs-decision', 'project-completed']);
  assert.deepEqual((await d.handle('notifications', {})).notifications, seen);
  assert.equal((await d.handle('notifications', { take: true }, superSession.addr)).notifications.length, 3);
  assert.deepEqual((await d.handle('notifications', {})).notifications, []);
  await d.tick();
  await d.tick();
  assert.equal(pushed().length, 2);
  assert.match(pushed()[1].text, /blocking audit evidence.*controlled project complete/s);
  await d.shutdown();
  const recovered = f.daemon();
  await recovered.tick();
  assert.equal(pushed().length, 2);
  assert.equal((await recovered.handle('notifications', { history: true })).notifications.length, 3);
  assert.deepEqual(external, []);
  await recovered.shutdown();
});

test('switches queued input, a pending wave and a pending continuation after binding the successor', async t => {
  const f = fixture(t);
  const d = f.daemon();
  const { session: leader } = await f.spawn(d, 'leader', 'L');
  await d.tick();
  const { session: worker, deliveryId: workerFirst } = await f.spawn(d, 'worker', 'W1', leader.addr, { prompt: 'HOLD FIRST' });
  await d.tick();
  const continuation = await d.handle('send', { target: worker.addr, text: 'RETURN DONE W1 continued', mode: 'queue' }, leader.addr);
  const input = { target: leader.addr, text: 'an unattempted request', mode: 'queue', id: randomUUID() };
  await d.handle('send', input);
  const { session: successor, retired, deliveryId } = await f.spawn(d, 'leader', 'NEXT', undefined, {
    'handover-from': leader.addr, prompt: 'start replacement',
  });
  assert.equal(retired, leader.addr);
  assert.equal((await d.handle('state', { target: leader.addr })).state, 'exited');
  const pending = await d.handle('ls', {});
  assert.equal(pending.pendingContinuations[0].parent, successor.addr);
  assert.ok(pending.pendingDeliveries.some(message => message.id === input.id && message.target === successor.addr));
  await d.tick();
  assert.equal(f.prompts.find(message => message.addr === successor.addr).input.startsWith('[loom:' + deliveryId + ']'), true);
  assert.match(f.prompts.find(message => message.addr === successor.addr).input, new RegExp(leader.addr + '.*start replacement', 's'));

  f.sessions.get(worker.addr).finish('DONE W1 first wave');
  await d.tick();
  await d.tick();
  await d.tick();
  const messages = f.read('inbox/state.json').messages;
  assert.equal(messages.find(message => message.id === input.id).target.addr, successor.addr);
  assert.equal(messages.find(message => message.id === workerFirst).waveParent, leader.addr);
  assert.equal(messages.find(message => message.waveBatch).target.addr, successor.addr);
  assert.equal(messages.find(message => message.continuationMembers?.includes(continuation.id)).target.addr, successor.addr);
  assert.equal((await d.handle('send', input)).id, input.id);
  await d.shutdown();
});

test('times out a hanging single continuation, reports its last activity and supplements the answer once', async t => {
  let advance = 0;
  const external = [];
  const f = fixture(t, { window: 25_000, now: () => Date.now() + advance,
    externalNotification: async (_, events) => external.push(events.map(event => event.type)) });
  const d = f.daemon();
  const { session: leader } = await f.spawn(d, 'leader', 'L');
  await d.tick();
  f.sessions.get(leader.addr).finish('first turn');
  const { session: worker } = await f.spawn(d, 'worker', 'CONT', leader.addr);
  await d.tick();
  await d.tick();
  const request = await d.handle('send', { target: worker.addr, text: 'HOLD continuation', mode: 'queue' }, leader.addr);
  await d.tick();
  const state = await d.handle('state', { target: leader.addr });
  assert.equal(state.pendingContinuations[0].pending[0].deliveryId, request.id);
  assert.ok(state.pendingDeliveries.some(message => message.id === request.id && message.target === worker.addr));

  advance = 30_000;
  await d.tick();
  const summaries = () => f.read('inbox/state.json').messages.filter(message => message.continuationBatch);
  assert.equal(summaries().length, 1);
  assert.equal(summaries()[0].target.addr, leader.addr);
  assert.match(summaries()[0].text, /CONT.*STUCK.*最近活动/s);
  assert.deepEqual(external, [['continuation-timeout']]);

  f.sessions.get(worker.addr).finish('DONE CONT late');
  await d.tick();
  await d.tick();
  const all = summaries();
  assert.deepEqual(all.map(message => message.continuationKind), ['timeout', 'late']);
  assert.match(all[1].text, /DONE CONT late/);
  assert.deepEqual((await d.handle('ls', {})).pendingContinuations, []);
  await d.shutdown();
});

test('refuses to spawn without the required policy and selects role defaults with combined denials', async t => {
  const f = fixture(t);
  const policy = join(f.project, '.project/policy.json');
  rmSync(policy);
  const d = f.daemon();
  await assert.rejects(f.spawn(d, 'leader', 'L'), {
    code: 'invalid-policy', message: /\.project\/policy\.json: Required.*examples\/policy\.json/,
  });
  const profile = (cli, model, effort) => ({ cli, model, effort });
  writeFileSync(policy, JSON.stringify({
    preferred: [profile('codex', 'general', 'high')],
    deny: [{ model: 'blocked-global' }],
    roles: { leader: { preferred: [profile('agy', 'leader-model', 'high')] },
      worker: { preferred: [profile('codex', 'worker-model', 'high')], deny: [{ model: 'blocked-worker' }] } },
  }));
  const { spawnProfile } = await import('../cli/policy.mjs');
  assert.deepEqual(spawnProfile(f.project, { role: 'leader' }).selected, { ...profile('agy', 'leader-model', 'high'), mode: 'tui' });
  assert.deepEqual(spawnProfile(f.project, { role: 'auditor' }).selected, { ...profile('codex', 'general', 'high'), mode: 'tui' });
  assert.deepEqual(spawnProfile(f.project, { role: 'worker' }).selected, { ...profile('codex', 'worker-model', 'high'), mode: 'headless' });
  for (const model of ['blocked-global', 'blocked-worker']) {
    assert.throws(() => spawnProfile(f.project, { role: 'worker', ...profile('codex', model, 'high') }), { code: 'policy-denied' });
  }
});
