import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { deliveryId } from '../inbox/message.mjs';
import { publish } from '../inbox/store.mjs';
import { estimateTokens } from '../lib/token-budget.mjs';
import { writeMemory } from '../memory/project.mjs';
import { createSupervisor } from './supervisor.mjs';

function fixture(t, options) {
  const project = mkdtempSync(join(realpathSync(tmpdir()), 'loomd-test-'));
  t.after(() => rmSync(project, { recursive: true, force: true }));
  mkdirSync(join(project, '.project'));
  const policy = settings => writeFileSync(join(project, '.project/policy.json'), JSON.stringify(settings));
  policy({ preferred: [], deny: [] });
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
    let nativeStep = 0;
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
        active = { input, inputId, sinceSeq: seq, spanId: randomUUID(), at: Date.now() };
        prompts.push({ addr: row.addr, input });
        emit('turn_started', { requestId, input });
        if (row.cli === 'agy') emit('tool_call_started', { callId: 'fixture-call' });
        else emit('turn_active', { inputId });
        const prompt = input.split('\n').slice(1).join('\n').split('\n\n## Loom task conventions', 1)[0];
        const body = row.role === 'reviewer' ? prompt.split('\n\n').at(-1) : prompt;
        if (!body.startsWith('HOLD') &&
            (row.role !== 'leader' || body.includes('波次') || body.includes('续作批次') || body.endsWith('replacement')) &&
            (row.task != null || body.startsWith('RETURN '))) {
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
    function emit(kind, data = {}, receivedAt = Date.now()) {
      observer?.({ kind, ...data, agentPath: [], sessionId: id, seq: seq++, receivedAt, spanId: active?.spanId });
    }
    function finish(body, outcome = { kind: 'completed' }, at = Date.now()) {
      if (row.cli === 'codex') {
        const timestamp = new Date(at).toISOString();
        const turn_id = active.spanId;
        const rows = [{ type: 'task_started', turn_id }, { type: 'task_complete', turn_id, last_agent_message: body }];
        appendFileSync(path, rows.map(payload => JSON.stringify({ type: 'event_msg', timestamp, payload }) + '\n').join(''));
      } else if (row.cli === 'agy') {
        const rows = [
          { source: 'USER_EXPLICIT', type: 'USER_INPUT', content: active.input },
          { source: 'MODEL', type: 'PLANNER_RESPONSE', status: 'DONE', content: body },
        ];
        appendFileSync(path, rows.map(value =>
          JSON.stringify({ ...value, step_index: nativeStep++, created_at: new Date().toISOString() }) + '\n').join(''));
      }
      emit('text_delta', { phase: 'final_answer', text: body }, at);
      emit('turn_ended', { inputId: active.inputId, outcome }, at);
      active = undefined;
    }
    function check(command, duration, exitCode) {
      const callId = randomUUID();
      const end = Date.now();
      emit('tool_call_started', { callId, toolName: 'exec_command', input: { cmd: command } }, end - duration);
      emit('tool_call_ended', { callId, toolName: 'exec_command', exitCode }, end);
    }
    sessions.set(row.addr, { finish, check, session, loseEnd: () => { active = undefined; } });
    return session;
  }

  const daemon = () => createSupervisor(project, { report: () => {}, externalNotification: async () => {},
    sessionOptions: { open }, ...options });
  const spawn = (d, role, task, parent, fields = {}) => d.handle('spawn', {
    role, task, wave: role === 'worker' ? 'W' : 'ROOT', cli: 'codex', model: 'model', effort: 'high',
    cwd: project, project, mode: 'headless', prompt: 'start', ...fields,
  }, parent);
  const barrier = (d, task, parent, fields = {}) => spawn(d, 'worker', task, parent,
    { deliver: 'barrier', barrier: fields.wave ?? 'W', ...fields });
  const git = (...args) => execFileSync('/usr/bin/git', args, { cwd: project, encoding: 'utf8' }).trim();
  return { daemon, spawn, barrier, read, policy, git, sessions, prompts, resumes, project };
}

test('only Leader and Auditor get a bounded project memory block on spawn', async t => {
  const f = fixture(t);
  writeFileSync(join(f.project, 'proof.txt'), 'proof');
  writeFileSync(join(f.project, '.project/charter.md'), '## 红线\n- Require approval\n');
  writeFileSync(join(f.project, '.project/rulings.md'), '## 1\n> Record decisions\n');
  for (let n = 0; n < 6; n++) {
    writeMemory(f.project, { id: `fact-${n}`, scope: 'project', owner: 'leader', source: 'proof.txt',
      verified: '2025-01-01', title: '记'.repeat(125) + n, body: 'Confirmed.' });
  }
  const daemon = f.daemon();
  const { session: leader } = await f.spawn(daemon, 'leader', 'L');
  const { session: auditor } = await f.spawn(daemon, 'auditor', 'A');
  const { session: worker } = await f.spawn(daemon, 'worker', 'W', leader.addr);
  await daemon.tick();
  for (const { addr } of [leader, auditor]) {
    const prompt = f.prompts.find(item => item.addr === addr).input;
    assert.ok(prompt.endsWith('\n\nstart'));
    const memory = prompt.slice(0, -'start'.length);
    assert.ok(estimateTokens(memory) <= 400);
    assert.match(memory, /charter\.md.*Require approval.*rulings\.md.*items\/fact-0\.md/s);
    assert.doesNotMatch(memory, /fact-5\.md/);
  }
  assert.doesNotMatch(f.prompts.find(item => item.addr === worker.addr).input, /项目记忆|memory\/items/);
});

test('large OpenCode exports recover the consecutive-failure stuck state', async t => {
  let terminal;
  const logs = [];
  const f = fixture(t, { report: message => logs.push(message), sessionOptions: {
    async openPane(_job, row) {
      terminal = { address: 't1', cwd: row.cwd, pid: 101, created_ms: 1, status_ms: 1, state: 'live', status: { state: 'idle' } };
      return { terminal };
    },
    getPane: async () => terminal,
    async callHc(command) {
      if (command === 'get') return terminal;
      if (command === 'read') return { text: 'idle' };
      throw new Error('Unexpected fixture hc command');
    },
  } });
  const binary = join(f.project, 'opencode');
  const broken = join(f.project, 'export-broken');
  mkdirSync(join(f.project, '.project', 'relay', 'events'), { recursive: true });
  writeFileSync(binary, `#!${process.execPath}
import { existsSync } from 'node:fs';
if (existsSync(${JSON.stringify(broken)})) process.exit(4);
console.log(JSON.stringify({ info: { id: process.argv[4] }, messages: [], padding: 'x'.repeat(9 * 1024 * 1024) }));
`, { mode: 0o700 });
  const previous = process.env.LOOM_OPENCODE_BIN;
  process.env.LOOM_OPENCODE_BIN = binary;
  t.after(() => {
    if (previous === undefined) delete process.env.LOOM_OPENCODE_BIN;
    else process.env.LOOM_OPENCODE_BIN = previous;
  });
  const d = f.daemon();
  const { session } = await f.spawn(d, 'super', 'OPENCODE-EXPORT', undefined, { cli: 'opencode', mode: 'tui' });
  const state = () => d.handle('state', { target: session.addr });
  const job = () => f.read(`loomd/sessions/${session.addr}.json`);
  writeFileSync(broken, '');
  for (let n = 1; n <= 3; n++) {
    await d.tick();
    assert.equal(job().exportFailure.count, n);
    if (n < 3) assert.notEqual((await state()).state, 'stuck');
  }
  const stuck = await state();
  assert.equal(stuck.state, 'stuck');
  assert.equal(stuck.reason, 'opencode-export-failed');
  assert(stuck.notifications.some(event => event.type === 'stuck' && event.reason === 'opencode-export-failed'));
  assert.equal(logs.filter(value => value.includes('OpenCode export failed 3 times')).length, 1);
  rmSync(broken);
  await d.tick();
  assert.equal(job().exportFailure, undefined, JSON.stringify(logs));
  assert.notEqual((await state()).state, 'stuck');
  assert.match(readFileSync(join(f.project, '.project/relay/events', session.addr + '.jsonl'), 'utf8'), /SessionStart/);
});

test('an explicit barrier spans tracking waves and delivers its whole set once across daemon recovery', async t => {
  const f = fixture(t);
  const daemon = f.daemon();
  const { session: leader } = await f.spawn(daemon, 'leader', 'L');
  await daemon.tick();
  const { session: first, deliver, barrier } = await f.barrier(daemon, 'T1', leader.addr, { wave: 'W-A', barrier: 'W' });
  assert.deepEqual([deliver, barrier], ['barrier', 'W']);
  await daemon.tick();
  await daemon.tick();
  assert.equal(Object.values(f.read('relay/state.json').waves)[0].deadline, null);
  const { session: second } = await f.barrier(daemon, 'T2', leader.addr, { wave: 'W-B', barrier: 'W', prompt: 'HOLD second' });
  await daemon.tick();
  await daemon.tick();
  assert.equal(f.prompts.filter(item => item.input.includes('波次 W')).length, 0);
  f.sessions.get(leader.addr).finish('leader first turn');
  await daemon.tick();
  assert.equal(f.read('inbox/state.json').messages.filter(message => message.waveBatch).length, 0);
  f.sessions.get(second.addr).finish('DONE T2');
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

test('streams a fast result after the default 45 seconds and lets Leader refill the same tracking wave', async t => {
  let advance = 0;
  const f = fixture(t, { now: () => Date.now() + advance, watchOptions: { busyMs: 120_000 } });
  const d = f.daemon();
  t.after(d.shutdown);
  const leader = (await f.spawn(d, 'leader', 'L')).session.addr;
  await d.tick();
  const held = { prompt: 'HOLD worker' };
  const fast = await f.spawn(d, 'worker', 'FAST', leader, held);
  const slow = await f.spawn(d, 'worker', 'SLOW', leader, held);
  const slower = await f.spawn(d, 'worker', 'SLOWER', leader, held);
  assert.equal(fast.deliver, 'stream');
  await assert.rejects(f.spawn(d, 'worker', 'NEXT', leader, held), { code: 'worker-capacity' });
  await d.tick();
  f.sessions.get(leader).finish('dispatch ended');
  await d.tick();
  f.sessions.get(fast.session.addr).finish('DONE FAST');
  await d.tick();
  const wakes = () => f.prompts.filter(row => row.addr === leader && row.input.includes('波次 W'));
  assert.equal(wakes().length, 0);
  advance = 43_000;
  await d.tick();
  assert.equal(wakes().length, 0);
  advance = 46_000;
  await d.tick();
  assert.equal(wakes().length, 1);
  assert.match(wakes()[0].input, /DONE FAST/);
  assert.doesNotMatch(wakes()[0].input, /SLOW/);
  for (const worker of [slow, slower]) {
    assert.equal((await d.handle('state', { target: worker.session.addr })).state, 'busy');
  }
  const next = await f.spawn(d, 'worker', 'NEXT', leader, held);
  await d.tick();
  assert.equal((await d.handle('state', { target: next.session.addr })).state, 'busy');
  assert.equal((await d.handle('state', { target: fast.session.addr })).state, 'idle');
  await d.handle('send', { target: fast.session.addr, mode: 'queue', text: 'RETURN DONE FAST follow-up' }, leader);
  await d.tick();
  assert.equal(f.prompts.filter(row => row.addr === fast.session.addr).length, 1);
  f.sessions.get(slow.session.addr).finish('DONE SLOW', undefined, Date.now() + advance);
  await d.tick();
  assert.equal(f.prompts.filter(row => row.addr === fast.session.addr).length, 2);
});

test('coalesces results within the configured window and joins a busy Leader backlog across windows and restart', async t => {
  let advance = 0;
  const f = fixture(t, { now: () => Date.now() + advance });
  f.policy({ delivery: { coalesceMs: 10_000 } });
  const d = f.daemon();
  const leader = (await f.spawn(d, 'leader', 'L')).session.addr;
  await d.tick();
  const held = { prompt: 'HOLD worker' };
  const one = (await f.spawn(d, 'worker', 'ONE', leader, held)).session.addr;
  const two = (await f.spawn(d, 'worker', 'TWO', leader, held)).session.addr;
  await d.tick();
  f.sessions.get(leader).finish('dispatch ended');
  await d.tick();
  const finish = (addr, body) => f.sessions.get(addr).finish(body, undefined, Date.now() + advance);
  const wakes = () => f.prompts.filter(row => row.addr === leader && row.input.includes('波次 W'));
  finish(one, 'DONE ONE');
  await d.tick();
  advance = 4_000;
  finish(two, 'BLOCKED TWO');
  await d.tick();
  assert.equal(wakes().length, 0);
  advance = 12_000;
  await d.tick();
  assert.equal(wakes().length, 1);
  assert.match(wakes()[0].input, /DONE ONE.*BLOCKED TWO/s);
  await d.tick();
  await d.handle('send', { target: leader, mode: 'queue', text: 'HOLD leader' });
  await d.tick();
  const three = (await f.spawn(d, 'worker', 'THREE', leader, held)).session.addr;
  const four = (await f.spawn(d, 'worker', 'FOUR', leader, held)).session.addr;
  await d.tick();
  finish(three, 'DONE THREE');
  await d.tick();
  advance = 27_000;
  finish(four, 'FAILED FOUR');
  await d.tick();
  assert.equal(wakes().length, 1);
  finish(leader, 'Leader finished');
  await d.shutdown();
  const recovered = f.daemon();
  t.after(recovered.shutdown);
  await recovered.tick();
  await recovered.tick();
  assert.equal(wakes().length, 2);
  assert.match(wakes()[1].input, /DONE THREE.*FAILED FOUR/s);
  const records = f.read('inbox/state.json').messages.filter(message => message.waveBatch);
  assert.equal(records.length, 4);
  assert.ok(records.every(message => message.phase === 'received'));
  assert.equal(records.filter(message => message.combinedInto).length, 2);
});

test('reports a streamed worker timeout and late result once without replaying an already delivered peer', async t => {
  let advance = 0;
  const f = fixture(t, { window: 30_000, now: () => Date.now() + advance,
    watchOptions: { busyMs: 120_000 } });
  f.policy({ delivery: { coalesceMs: 0 } });
  const d = f.daemon();
  t.after(d.shutdown);
  const leader = (await f.spawn(d, 'leader', 'L')).session.addr;
  const auditor = (await f.spawn(d, 'auditor', 'A')).session.addr;
  await d.tick();
  const fast = (await f.spawn(d, 'worker', 'FAST', leader, { prompt: 'HOLD worker' })).session.addr;
  const slow = (await f.spawn(d, 'worker', 'SLOW', leader, { prompt: 'HOLD worker' })).session.addr;
  await d.tick();
  f.sessions.get(leader).finish('dispatch ended');
  f.sessions.get(fast).finish('FAILED FAST');
  await d.tick();
  await d.tick();
  const batches = () => f.read('inbox/state.json').messages.filter(message => message.waveBatch);
  assert.deepEqual(new Set(batches().map(message => message.target.addr)), new Set([leader, auditor]));
  advance = 31_000;
  await d.tick();
  await d.tick();
  const [timeout] = batches().filter(message => message.waveKind === 'timeout');
  assert.equal(timeout.target.addr, leader);
  assert.match(timeout.text, /SLOW.*STUCK.*最近活动/s);
  assert.doesNotMatch(timeout.text, /FAILED FAST/);
  f.sessions.get(slow).finish('DONE SLOW', undefined, Date.now() + advance);
  await d.tick();
  await d.tick();
  assert.deepEqual(batches().filter(message => message.target.addr === leader).map(message => message.waveKind),
    ['stream', 'timeout', 'late']);
  assert.match(batches().at(-1).text, /DONE SLOW/);
  assert.equal((await d.handle('notifications', { history: true })).notifications.filter(item => item.type === 'wave-timeout').length, 1);
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
  await f.barrier(d, 'FAST', leader, { prompt: 'RETURN DONE FAST' });
  const slow = await f.barrier(d, 'SLOW', leader, { prompt: 'HOLD worker' });
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
  await assert.rejects(f.barrier(d, 'EXTRA', leader), { code: 'wave-sealed' });
  const replacement = await f.barrier(d, 'SLOW', leader, { wave: 'W2', prompt: 'RETURN DONE SLOW new wave' });
  f.sessions.get(slow.session.addr).finish('DONE SLOW old wave');
  for (let i = 0; i < 4; i++) await d.tick();
  assert.match(readFileSync(join(f.project, '.project/workers.md'), 'utf8'), /SLOW .*superseded.*wave=W/);
  assert.equal(f.prompts.filter(row => row.input.includes('DONE SLOW old wave')).length, 0);
  assert.ok(f.prompts.some(row => row.input.includes('DONE SLOW new wave') && row.addr !== replacement.session.addr));
});

test('a blocked barrier escalates once while holding the set and copies only FAILED/MISMATCH to Auditor', async t => {
  let advance = 0;
  const f = fixture(t, { now: () => Date.now() + advance, uncertainWindow: 800_000 });
  f.policy({ roles: { leader: { maxActiveWorkers: 4 } } });
  const d = f.daemon();
  const auditor = (await f.spawn(d, 'auditor', 'AUDIT')).session.addr;
  const leader = (await f.spawn(d, 'leader', 'L')).session.addr;
  await d.tick();
  await f.barrier(d, 'BLOCK1', leader, { prompt: 'RETURN BLOCKED BLOCK1' });
  await f.barrier(d, 'BLOCK2', leader, { prompt: 'RETURN BLOCKED BLOCK2' });
  await f.barrier(d, 'FAILED', leader, { prompt: 'RETURN FAILED FAILED' });
  const tail = (await f.barrier(d, 'TAIL', leader, { prompt: 'HOLD TAIL' })).session.addr;
  for (let i = 0; i < 3; i++) await d.tick();
  const batches = () => f.read('inbox/state.json').messages.filter(message => message.waveBatch);
  assert.equal(batches().length, 0);
  f.sessions.get(leader).finish('dispatch ended');
  await assert.rejects(f.barrier(d, 'CROSS', leader), { code: 'wave-sealed' });
  advance = 61_000;
  for (let i = 0; i < 3; i++) await d.tick();
  assert.equal(batches().length, 0);
  const blocked = (await d.handle('notifications', { history: true })).notifications.filter(item => item.type === 'blocked-escalation');
  assert.equal(blocked.length, 1);
  assert.match(blocked[0].text, /波次 W（阻塞）.*BLOCKED BLOCK1.*BLOCKED BLOCK2/s);
  assert.doesNotMatch(blocked[0].text, /FAILED/);
  assert.equal(Object.values(f.read('relay/state.json').waves)[0].closed, undefined);
  f.sessions.get(tail).finish('DONE TAIL');
  await d.shutdown();
  const recovered = f.daemon();
  for (let i = 0; i < 4; i++) await recovered.tick();
  const finished = batches().filter(message => message.target.addr === leader);
  assert.equal(finished.length, 1);
  assert.match(finished[0].text, /BLOCKED BLOCK1.*BLOCKED BLOCK2.*FAILED FAILED.*DONE TAIL/s);
  const copies = batches().filter(message => message.target.addr === auditor);
  assert.equal(copies.length, 1);
  assert.match(copies[0].text, /FAILED FAILED/);
  assert.doesNotMatch(copies[0].text, /BLOCKED|DONE TAIL/);
  assert.equal(f.prompts.filter(row => row.addr === leader && row.input.includes('波次 W')).length, 1);
  await recovered.handle('stop', { target: tail });
  await f.barrier(recovered, 'MISMATCH', leader, { wave: 'M', prompt: 'RETURN DONE MISMATCH\n全绿，通过 8 项' });
  for (let i = 0; i < 4; i++) await recovered.tick();
  assert.ok(f.prompts.some(row => row.addr === auditor && /波次 M.*证据 MISMATCH/s.test(row.input)));
});

test('a sealed wave whose BLOCKED members and final result arrive within the window wakes Leader once', async t => {
  let advance = 0;
  const f = fixture(t, { blockedWindow: 10_000, now: () => Date.now() + advance });
  const d = f.daemon();
  const leader = (await f.spawn(d, 'leader', 'L')).session.addr;
  await d.tick();
  await f.barrier(d, 'B1', leader, { prompt: 'RETURN BLOCKED B1' });
  await f.barrier(d, 'B2', leader, { prompt: 'RETURN BLOCKED B2' });
  const tail = (await f.barrier(d, 'FAST', leader, { prompt: 'HOLD FAST' })).session.addr;
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
  await f.barrier(d, 'FAST', leader, { prompt: 'RETURN DONE FAST' });
  const late = await f.barrier(d, 'LATE', leader, { prompt: 'HOLD worker' });
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
  test(`${explicit ? 'explicit' : 'streaming'} worker continuations coalesce BLOCKED into one early wake and one remainder`, async t => {
    let advance = 0;
    const f = fixture(t, { blockedWindow: 10_000, now: () => Date.now() + advance });
    f.policy({ delivery: { coalesceMs: 10_000 }, roles: { leader: { maxActiveWorkers: 4 } } });
    const d = f.daemon();
    const leader = (await f.spawn(d, 'leader', 'L')).session.addr;
    await d.tick();
    const tasks = ['BLOCK1', 'BLOCK2', 'FINISHED', 'TAIL'];
    const workers = [];
    for (const task of tasks) workers.push((await f.barrier(d, task, leader)).session.addr);
    f.sessions.get(leader).finish('dispatch done');
    for (let i = 0; i < 4; i++) await d.tick();
    const fields = explicit ? { batch: randomUUID(), batchSize: tasks.length } : {};
    const messages = ['RETURN BLOCKED BLOCK1', 'RETURN BLOCKED BLOCK2', 'RETURN DONE FINISHED', 'HOLD TAIL'];
    for (const [i, target] of workers.entries()) await d.handle('send', { target, mode: 'queue', text: messages[i], ...fields }, leader);
    for (let i = 0; i < 3; i++) await d.tick();
    const wakes = () => f.read('inbox/state.json').messages.filter(message => message.continuationBatch);
    assert.equal(wakes().length, explicit ? 0 : 3);
    advance = 11_000;
    await d.tick();
    await d.tick();
    assert.equal(wakes().length, explicit ? 1 : 3);
    const firstWake = f.prompts.find(row => row.addr === leader && row.input.includes('续作批次')).input;
    assert.match(firstWake, /BLOCKED BLOCK1.*BLOCKED BLOCK2.*DONE FINISHED/s);
    assert.doesNotMatch(firstWake, /TAIL/);
    f.sessions.get(workers[3]).finish('DONE TAIL');
    for (let i = 0; i < 4; i++) await d.tick();
    assert.equal(wakes().length, explicit ? 2 : 4);
    assert.match(wakes().at(-1).text, /DONE TAIL/);
    assert.doesNotMatch(wakes().at(-1).text, /BLOCKED|DONE FINISHED/);
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
  for (const task of ['B1', 'B2']) await f.barrier(d, task, leader.addr, { prompt: 'RETURN BLOCKED ' + task });
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
  const id = randomUUID();
  const attemptAt = Date.now() - 61_000;
  publish(f.project, { id, text: 'unconfirmed test input', phase: 'sending', issue: 'uncertain', attemptAt,
    createdAt: attemptAt, requestedMode: 'queue', mode: 'queue',
    target: { addr: auditor.addr, backend: auditor.backend, provider: auditor.cli, createdAt: auditor.startedAt } });
  await recovered.tick();
  const uncertain = (await recovered.handle('notifications', { take: true }, superSession.addr)).notifications;
  assert.equal(uncertain.length, 1);
  assert.equal(uncertain[0].type, 'delivery-uncertain');
  assert.equal(uncertain[0].deliveryId, id);
  assert.equal(pushed().at(-1).target.addr, superSession.addr);
  assert.match(pushed().at(-1).text, /delivery-uncertain/);
  assert.deepEqual(external, []);
  await recovered.shutdown();
});

test('switches queued input, a pending wave and a pending continuation after binding the successor', async t => {
  const f = fixture(t);
  writeFileSync(join(f.project, '.project/charter.md'), '## 目标\n- 验证交接\n');
  writeFileSync(join(f.project, '.project/rulings.md'), '## 3\n> 先看原件。\n');
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
  const prompt = f.prompts.find(message => message.addr === successor.addr).input;
  assert.match(prompt, new RegExp(leader.addr + '.*start replacement', 's'));
  assert.match(prompt, /## 项目章程\n\.project\/charter\.md\n目标 · 验证交接/);
  assert.match(prompt, /## 裁决账本\n\.project\/rulings\.md\n裁决 3\n> 先看原件。/);

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

test('puts Super first and includes a newly settled wave in the same turn despite more Super mail', async t => {
  const f = fixture(t);
  const d = f.daemon();
  t.after(d.shutdown);
  const leader = (await f.spawn(d, 'leader', 'L')).session.addr;
  const superAddr = (await f.spawn(d, 'super', 'S')).session.addr;
  await d.tick();
  const worker = (await f.spawn(d, 'worker', 'PRIORITY', leader, { prompt: 'HOLD worker' })).session.addr;
  await d.tick();
  await d.handle('send', { target: leader, mode: 'queue', text: 'ordinary worker mail' }, worker);
  const priority = await d.handle('send', { target: leader, mode: 'queue', text: 'external Super first' });
  await d.handle('send', { target: leader, mode: 'queue', text: 'managed Super second' }, superAddr);
  f.sessions.get(worker).finish('DONE PRIORITY');
  f.sessions.get(leader).finish('dispatch ended');
  await d.tick();
  await d.tick();
  assert.match(f.prompts.filter(row => row.addr === leader)[1].input, /external Super first\n\n--- Loom wave results ---\n\n波次 W.*DONE PRIORITY/s);
  assert.match(f.prompts.filter(row => row.addr === leader)[2].input, /managed Super second$/);
  f.sessions.get(leader).finish('second Super answer');
  await d.tick();
  assert.match(f.prompts.filter(row => row.addr === leader)[3].input, /ordinary worker mail$/);
  const waves = f.read('inbox/state.json').messages.filter(message => message.waveBatch);
  assert.equal(waves.length, 1);
  assert.equal(waves[0].combinedInto, priority.id);
  assert.equal(waves[0].phase, 'received');
});

test('reviewers occupy no worker seat, relay one result, and stop at the deadline', async t => {
  let advance = 0;
  const f = fixture(t, { now: () => Date.now() + advance });
  const d = f.daemon();
  t.after(d.shutdown);
  const leader = (await f.spawn(d, 'leader', 'L')).session.addr;
  await d.tick();
  for (const task of ['A', 'B', 'C']) await f.spawn(d, 'worker', task, leader, { prompt: 'HOLD worker' });
  await assert.rejects(f.spawn(d, 'worker', 'D', leader), { code: 'worker-capacity' });
  const review = (await f.spawn(d, 'reviewer', 'REVIEW', leader, { prompt: 'RETURN review conclusion' })).session;
  const job = f.read('loomd/sessions/' + review.addr + '.json');
  assert.equal(job.reviewDeadline - review.startedAt, 1_800_000);
  await d.tick();
  await d.handle('send', { target: review.addr, mode: 'queue', text: 'another question' });
  await d.tick();
  assert.equal((await d.handle('state', { target: review.addr })).state, 'exited');
  assert.equal(f.prompts.filter(row => row.addr === review.addr).length, 1);
  assert.match(f.prompts.find(row => row.addr === review.addr).input, /read-only.*one question/s);
  f.policy({ roles: { reviewer: { maxDurationMs: 5_000 } } });
  const late = (await f.spawn(d, 'reviewer', 'LATE', leader, { prompt: 'HOLD reviewer' })).session;
  await d.tick();
  advance = 10_000;
  await d.tick();
  await d.tick();
  const results = f.read('inbox/state.json').messages.filter(message => message.reviewerResult);
  assert.deepEqual(results.map(message => message.target.addr), [leader, leader]);
  assert.match(results[0].text, /review conclusion/);
  assert.match(results[1].text, /TIMED OUT/);
  assert.equal((await d.handle('state', { target: late.addr })).state, 'exited');
});

test('switches Claude Leader to agy and agy Auditor to Codex under one durable succession guard', async t => {
  const f = fixture(t);
  f.git('init', '-q');
  writeFileSync(join(f.project, 'actual.mjs'), 'export const accepted_metric = 1;\n');
  f.git('add', 'actual.mjs');
  f.git('-c', 'user.name=Loom', '-c', 'user.email=loom@example.invalid', 'commit', '-qm', 'fixture');
  const sha = f.git('rev-parse', 'HEAD');
  const profile = (cli, model, fast) => ({ cli, model, effort: 'high', mode: 'headless', fast });
  f.policy({ roles: {
    leader: { preferred: [profile('claude', 'opus'), profile('agy', 'gemini', true)] },
    auditor: { preferred: [profile('agy', 'gemini'), profile('codex', 'codex-model', true)] },
  } });
  const d = f.daemon();
  t.after(d.shutdown);
  const leader = (await f.spawn(d, 'leader', 'L', undefined, { cli: 'claude', model: 'opus' })).session;
  const auditor = (await f.spawn(d, 'auditor', 'A', undefined, { cli: 'agy', model: 'gemini' })).session;
  await d.tick();
  const switched = await d.handle('switch', { role: 'leader', to: '2' });
  assert.equal(switched.handoverFrom, leader.addr);
  assert.equal(switched.session.cli, 'agy');
  assert.deepEqual(switched.warnings.map(warning => warning.code), ['preferred-fallback', 'fast-unsupported']);
  await assert.rejects(d.handle('switch', { role: 'auditor', to: '2' }), { code: 'rotation-in-progress' });
  await d.tick();
  f.sessions.get(switched.session.addr).finish('Current SHA deadbee. Missing file `absent.mjs`.');
  await d.tick();
  const rotation = () => d.handle('state', { target: switched.session.addr }).then(value => value.rotations[0]);
  assert.equal((await rotation()).firstReportMisses, 2);
  assert.equal((await rotation()).verifiedAt, null);
  await assert.rejects(d.handle('switch', { role: 'auditor', to: '2' }), { code: 'rotation-in-progress' });
  const fact = f.read('inbox/state.json').messages.find(message => message.orgEvents);
  assert.equal(fact.target.addr, auditor.addr);
  assert.match(fact.text, /fact-miss.*absent\.mjs/);
  await d.handle('send', { target: switched.session.addr, mode: 'queue', text: 'Please correct the report' });
  await d.tick();
  f.sessions.get(switched.session.addr).finish('SHA ' + sha + ' in `actual.mjs` with metric `accepted_metric`.');
  await d.tick();
  assert.ok((await rotation()).verifiedAt);
  const nextAuditor = await d.handle('switch', { role: 'auditor', to: '2' });
  assert.equal(nextAuditor.handoverFrom, auditor.addr);
  assert.equal(nextAuditor.session.cli, 'codex');
  assert.equal(nextAuditor.selected.fast, true);
  await assert.rejects(d.handle('switch', { role: 'leader', to: '1' }), { code: 'rotation-in-progress' });
  await d.tick();
  f.sessions.get(nextAuditor.session.addr).finish('Auditor verified `actual.mjs`.');
  await d.tick();
  const state = await d.handle('state', { target: nextAuditor.session.addr });
  assert.deepEqual(state.rotations.map(item => [item.role, Boolean(item.verifiedAt)]), [['leader', true], ['auditor', true]]);
  assert.ok((await d.handle('notifications', { history: true })).notifications.some(item => item.type === 'preferred-fallback'));
});

test('sends one Auditor wake for card drift and includes worker fact misses in its evidence', async t => {
  const f = fixture(t);
  f.git('init', '-q');
  const taskDir = join(f.project, 'tasks/DRIFT');
  mkdirSync(taskDir, { recursive: true });
  const budget = n => writeFileSync(join(taskDir, 'TASK.md'), '- 净行数预算上限 ' + n + ' 行\n');
  budget(1);
  f.git('add', 'tasks/DRIFT/TASK.md');
  f.git('-c', 'user.name=Loom', '-c', 'user.email=loom@example.invalid', 'commit', '-qm', 'fixture');
  f.policy({ drift: { planLines: 2, sampleIntervalMs: 0 } });
  const d = f.daemon();
  t.after(d.shutdown);
  const leader = (await f.spawn(d, 'leader', 'L')).session.addr;
  const auditor = (await f.spawn(d, 'auditor', 'A', undefined, { prompt: 'HOLD auditor' })).session.addr;
  await d.tick();
  const worker = (await f.spawn(d, 'worker', 'DRIFT', leader, { prompt: 'HOLD worker' })).session.addr;
  await d.tick();
  budget(2);
  await d.tick();
  budget(3);
  writeFileSync(join(taskDir, 'PLAN-draft.md'), 'one\ntwo\nthree\n');
  writeFileSync(join(f.project, 'extra.txt'), 'one\ntwo\nthree\nfour\n');
  f.sessions.get(worker).check('npm test', 100, 1);
  f.sessions.get(worker).check('npm test', 500, 1);
  const missing = ['unreal.mjs', ...Array.from({ length: 5 }, (_, i) => `unreal-${i}.mjs`)];
  f.sessions.get(worker).finish('DONE DRIFT\nSee ' + missing.map(path => '`' + path + '`').join(', '));
  await d.tick();
  await d.tick();
  const notices = f.read('inbox/state.json').messages.filter(message => message.orgEvents);
  assert.equal(notices.length, 1);
  assert.equal(notices[0].target.addr, auditor);
  for (const type of ['budget-raised', 'line-budget', 'plan-growth', 'slow-command', 'repeated-failure', 'fact-miss']) {
    assert.match(notices[0].text, new RegExp(type));
  }
  const evidence = Object.values(f.read('loomd/org.json').notices);
  assert.equal(evidence.length, 6);
  const drift = evidence.filter(item => item.type === 'fact-miss');
  assert.equal(drift.length, 1);
  assert.equal(drift[0].count, 6);
  assert.deepEqual(drift[0].misses.map(item => item.value), missing.slice(0, 5));
  assert.doesNotMatch(notices[0].text, /unreal-4\.mjs/);
  f.sessions.get(leader).finish('dispatch ended');
  await d.tick();
  assert.match(f.read('inbox/state.json').messages.find(message => message.waveBatch).text, /fact-miss 6 · unreal\.mjs/);
});

test('worker switch affects only new spawns and a quota failure keeps the selected CLI', async t => {
  const f = fixture(t);
  f.policy({ deny: [{ model: 'denied' }], roles: { worker: { preferred: [
    { cli: 'codex', model: 'before', effort: 'high' }, { cli: 'agy', model: 'after', effort: 'high' },
  ] } } });
  const d = f.daemon();
  t.after(d.shutdown);
  const implicit = { cli: undefined, effort: undefined, model: undefined, prompt: 'HOLD worker' };
  const old = (await f.spawn(d, 'worker', 'OLD', undefined, implicit)).session;
  assert.equal(old.model, 'before');
  await assert.rejects(d.handle('switch', { role: 'worker', to: 'codex/denied/high' }), { code: 'policy-denied' });
  const override = await d.handle('switch', { role: 'worker', to: '2' });
  assert.equal(override.selected.model, 'after');
  const after = (await f.spawn(d, 'worker', 'AFTER', undefined, implicit)).session;
  assert.equal(after.cli, 'agy');
  await d.tick();
  f.sessions.get(after.addr).finish('', { kind: 'failed', failure: 'quota' });
  await d.tick();
  const live = (await d.handle('status', {})).sessions.map(row => row.addr);
  assert.deepEqual(new Set(live), new Set([old.addr, after.addr]));
  await d.shutdown();
  const recovered = f.daemon();
  t.after(recovered.shutdown);
  const next = (await f.spawn(recovered, 'worker', 'NEW', undefined, { ...implicit, wave: 'FUTURE' })).session;
  assert.equal(next.model, 'after');
});
