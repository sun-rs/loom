import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { execFile, execFileSync, mkdtempSync } from '../fixtures/test-process.mjs';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { deliveryId, payloadDigest, wireText } from '../inbox/message.mjs';
import { publish } from '../inbox/store.mjs';
import { estimateTokens } from '../lib/token-budget.mjs';
import { writeMemory } from '../memory/project.mjs';
import { createSupervisor } from './supervisor.mjs';
import { socketPath } from '../cli/project.mjs';
import { readArtifacts } from '../cli/artifacts.mjs';
import { recordSeniorToolDenial } from '../lib/senior-tool-guard.mjs';
import { seniorToolLog } from './senior-tools.mjs';
import { authorizeSocketCommand, socketCapabilities } from './socket-auth.mjs';

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

  async function open(row, _, resume, capability) {
    if (resume) resumes.push(resume);
    const id = resume ?? randomUUID();
    const path = join(project, `${id}.jsonl`);
    writeFileSync(path, '', { flag: 'a' });
    let seq = 0;
    let nativeStep = 0;
    let observer;
    let active;
    const records = [];
    const nativeStops = [];
    const session = {
      id,
      records: () => records,
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
        const prompt = input.split('\n').slice(1).join('\n').split('\n\n## Loom task conventions', 1)[0]
          .split('\n\n## Startup request\n').at(-1);
        const body = prompt;
        if (!/^(?:Loom Super message\n\n)?HOLD/.test(body) &&
            !(row.role === 'auditor' && body.startsWith('Read gate packet') && body.includes('rotation-policy spot-check')) &&
            (row.role !== 'leader' || body.includes('波次') || body.includes('续作批次') || body.endsWith('replacement')) &&
            (row.task != null || body.startsWith('RETURN '))) {
          finish(body.startsWith('RETURN ') ? body.slice(7) :
            row.role === 'auditor' && /^(?:Read gate packet|Loom red escalation)/.test(body) ?
              options?.auditVerdict?.() ?? '合入批准，候选已核对。' : row.task);
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
      } else if (row.cli === 'opencode') {
        nativeStops.push({ session_id: id, deliveryId: active.inputId, hook_event_name: 'Stop', last_assistant_message: body });
      }
      emit('text_delta', { phase: 'final_answer', text: body }, at);
      emit('turn_ended', { inputId: active.inputId, outcome }, at);
      active = undefined;
    }
    function check(command, duration, exitCode, end = Date.now()) {
      const callId = randomUUID();
      emit('tool_call_started', { callId, toolName: 'exec_command', input: { cmd: command } }, end - duration);
      emit('tool_call_ended', { callId, toolName: 'exec_command', exitCode }, end);
    }
    const context = tokens => emit('usage', { usage: { context: { tokens, contextWindow: 300_000 } } });
    const compact = () => {
      emit('compaction_started');
      emit('compaction_ended', { outcome: 'completed' });
    };
    function question(text, at) {
      const requestId = randomUUID();
      records.push({ kind: 'request', id: requestId, body: { native: { questions: [
        { question: text, options: ['one', 'two'] },
      ] } } });
      emit('app_request', { requestId, type: 'item/tool/requestUserInput' }, at);
      return () => emit('app_answered', { requestId });
    }
    sessions.set(row.addr, { finish, check, context, compact, session, question, capability, nativeStops, loseEnd: () => { active = undefined; } });
    return session;
  }

  const daemon = () => {
    const supervisor = createSupervisor(project, { report: () => {}, externalNotification: async () => {},
      ...options, sessionOptions: { open, exportOpenCode: async row => ({ events: sessions.get(row.addr).nativeStops }), ...options?.sessionOptions } });
    return { ...supervisor, handle: (command, args, caller, identity = { external: !caller }) =>
      supervisor.handle(command, args, caller, identity) };
  };
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
  const guidance = [/Make decisions.*dispatch Workers.*integration Worker supplies fixed-candidate and full-suite evidence.*reply file path.*poll loom state/,
    /Decide the gate verdict.*Ask for the integration Worker evidence.*phase boundaries.*Worker to reproduce/];
  for (const [{ addr }, rule] of [[leader, guidance[0]], [auditor, guidance[1]]]) {
    const prompt = f.prompts.find(item => item.addr === addr).input;
    assert.ok(prompt.endsWith('\n\n## Startup request\nstart'));
    assert.match(prompt, rule);
    const memory = prompt.slice(0, prompt.indexOf('## Loom role guidance'));
    assert.ok(estimateTokens(memory) <= 400);
    assert.match(memory, /charter\.md.*Require approval.*rulings\.md.*items\/fact-0\.md/s);
    assert.doesNotMatch(memory, /fact-5\.md/);
  }
  assert.doesNotMatch(f.prompts.find(item => item.addr === worker.addr).input, /项目记忆|memory\/items/);
});

async function cliFor(t, f, daemon, caller) {
  const state = mkdtempSync(join(realpathSync(tmpdir()), 'loom-cli-auth-'));
  t.after(() => rmSync(state, { recursive: true, force: true }));
  const capabilities = socketCapabilities(f.project, { XDG_STATE_HOME: state });
  const capability = caller ? capabilities.ensureSession(caller).token : '';
  const server = createServer(socket => socket.once('data', async body => {
    const request = JSON.parse(body);
    try {
      const d = daemon();
      const actor = capabilities.identify(request.capability, d.liveCaller);
      authorizeSocketCommand(request.command, request.args, actor);
      socket.end(JSON.stringify({ ok: true, ...await d.handle(request.command, request.args, actor?.addr, { external: actor?.external }) }));
    }
    catch (error) { socket.end(JSON.stringify({ ok: false, error: { code: error.code, message: error.message } })); }
  })).listen(socketPath(f.project));
  t.after(() => new Promise(resolve => server.close(resolve)));
  await once(server, 'listening');
  const loom = new URL('../bin/loom', import.meta.url);
  const runAs = (asCaller, ...args) => promisify(execFile)(process.execPath, [loom.pathname, ...args], {
    env: { ...process.env, LOOM_PROJECT: f.project, LOOM_ADDR: asCaller ?? '',
      LOOM_CAPABILITY: asCaller ? capabilities.ensureSession(asCaller).token : '', HC_TERMINAL_ID: '' },
  });
  return Object.assign((...args) => runAs(caller, ...args), { as: runAs });
}

test('senior overrides cap output, keep reasons, and permit emergency retries past the gate budget', async t => {
  let advance = 0;
  const f = fixture(t, { now: () => Date.now() + advance });
  const d = f.daemon();
  t.after(d.shutdown);
  const { session: leader } = await f.spawn(d, 'leader', 'L');
  const cli = await cliFor(t, f, () => d, leader.addr);
  await d.tick();
  const command = '/usr/bin/seq 1 65';
  const retry = () => cli('senior-tool', '--reason', 'inspect candidate during this exception', '--', `/usr/bin/seq  "1" '65'`);
  const requiresDenial = error => JSON.parse(error.stdout).error.code === 'senior-override-needs-denial';
  await assert.rejects(retry(), requiresDenial);
  const log = seniorToolLog(f.project, leader.addr);
  assert.match(recordSeniorToolDenial(log, f.project, f.project, 'Bash', { command }), /带理由重试/);
  for (const reason of ['', 'probe', 'true', 'just checking']) {
    await assert.rejects(cli('senior-tool', '--reason', reason, '--', command),
      error => JSON.parse(error.stdout).error.code === 'senior-override-required');
  }
  const { stdout } = await retry();
  assert.match(stdout, /final 40 lines.*\n26\n.*\n65\n$/s);
  assert.doesNotMatch(stdout, /^25$/m);
  await assert.rejects(retry(), requiresDenial);
  f.policy({ delivery: { stallMs: 1 } });
  await d.handle('send', { target: leader.addr, mode: 'queue', text: 'HOLD for an SLA test' });
  advance = 100;
  await d.tick();
  for (let i = 0; i < 4; i++) await cli('senior-tool', '--', `/usr/bin/seq ${i + 1} 2`);
  const history = (await d.handle('notifications', { history: true })).notifications;
  assert.equal(history.filter(event => event.type === 'senior-override-budget').length, 1);
  const status = JSON.parse((await cli('status', '--json')).stdout);
  assert.deepEqual(status.seniorTools.map(item => [item.type, item.count]), [['senior-tool-denied', 1], ['senior-override', 5]]);
  assert.equal(status.seniorTools[1].reasons.at(-1).reason, 'worker-unavailable');
  f.sessions.get(leader.addr).finish('DONE');
  await d.tick();
  const nativeHistory = JSON.parse((await cli('hist', '--role', 'leader', '--json')).stdout);
  assert.ok(nativeHistory.turns[0].seniorTools.some(event => event.reason === 'inspect candidate during this exception'));
});

test('senior denial receipts bind one exact command and its work directory to the issuing session and gate', async t => {
  let advance = 0;
  const f = fixture(t, { now: () => Date.now() + advance });
  const d = f.daemon();
  t.after(d.shutdown);
  const { session: leader } = await f.spawn(d, 'leader', 'L');
  const { session: auditor } = await f.spawn(d, 'auditor', 'A');
  const cli = await cliFor(t, f, () => d, leader.addr);
  const cwd = join(f.project, 'nested');
  mkdirSync(cwd);
  writeFileSync(join(cwd, 'proof file.txt'), 'local proof\n');
  const command = '/bin/cat "proof file.txt" | /usr/bin/head -n 1';
  const deny = () => recordSeniorToolDenial(seniorToolLog(f.project, leader.addr), f.project, f.project, 'exec_command',
    { command: ['/bin/sh', '-lc', command], workdir: 'nested' });
  const receipt = deny();
  const [, id, reason] = /^"\$LOOM_BIN" senior-tool --retry ([a-f0-9-]+) --reason "([^"]+)"$/m.exec(receipt);
  assert.ok(!receipt.includes('proof file.txt'));
  const args = { retryId: id, reason };
  await assert.rejects(d.handle('senior-override', args, auditor.addr), { code: 'senior-override-needs-denial' });
  await assert.rejects(cli('senior-tool', '--retry', id, '--reason', 'probe'),
    error => JSON.parse(error.stdout).error.code === 'senior-override-required');
  await assert.rejects(cli('senior-tool', '--retry', id, '--reason', reason, '--', '/bin/pwd'),
    error => JSON.parse(error.stdout).error.code === 'invalid-arguments');
  const results = await Promise.allSettled([cli('senior-tool', '--retry', id, '--reason', reason),
    cli('senior-tool', '--retry', id, '--reason', reason)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'fulfilled').value.stdout, 'local proof\n');
  assert.equal(JSON.parse(results.find(result => result.status === 'rejected').reason.stdout).error.code, 'senior-override-needs-denial');
  const second = /--retry ([a-f0-9-]+)/.exec(deny())[1];
  advance = 1_000;
  await d.handle('notifications', { gateComplete: 'new-gate' }, leader.addr);
  await assert.rejects(d.handle('senior-override', { ...args, retryId: second }, leader.addr),
    { code: 'senior-override-needs-denial' });
});

test('Leader gate rotation waits for a card and publishes no Auditor wake', async t => {
  let advance = 0;
  const f = fixture(t, { now: () => Date.now() + advance });
  f.policy({ roles: { leader: { rotateAt: 'gate', maxContextTokens: 999_999 } } });
  const d = f.daemon();
  t.after(d.shutdown);
  const { session: leader } = await f.spawn(d, 'leader', 'L');
  const { session: auditor } = await f.spawn(d, 'auditor', 'A');
  await d.tick();
  const { session: worker } = await f.spawn(d, 'worker', 'W', leader.addr, { prompt: 'HOLD worker' });
  await d.tick();
  const notices = async () => (await d.handle('notifications', { history: true })).notifications
    .filter(event => event.type === 'leader-rotation-proposed');
  await d.handle('notifications', { gateComplete: 'SAFE' }, leader.addr);
  assert.deepEqual(await notices(), []);
  f.sessions.get(worker.addr).finish('DONE W');
  f.sessions.get(leader.addr).finish('Waiting');
  advance = 31_000;
  await d.tick();
  const [proposal] = await notices();
  assert.deepEqual([proposal.gate, proposal.reason, proposal.logOnly], ['SAFE', 'gate', true]);
  await d.handle('notifications', { gateComplete: 'SAFE' }, leader.addr);
  assert.equal((await notices()).length, 1);
  assert.equal(f.prompts.filter(item => item.addr === auditor.addr).length, 1);
});

async function nativeCost(f, row, at, inputTokens, contextTokens = inputTokens) {
  const id = randomUUID();
  const records = [
    { type: 'event_msg', payload: { type: 'task_started', turn_id: id } },
    { type: 'token_usage_record', payload: { response_id: id, usage: { input_tokens: inputTokens, output_tokens: 10 } } },
    { type: 'event_msg', payload: { type: 'token_count',
      info: { model_context_window: 300_000, last_token_usage: { total_tokens: contextTokens } } } },
    { type: 'event_msg', payload: { type: 'task_complete', turn_id: id, last_agent_message: 'done' } },
  ];
  const path = await f.sessions.get(row.addr).session.nativeSessionFile();
  appendFileSync(path, records.map(record => JSON.stringify({ ...record, timestamp: new Date(at).toISOString() }) + '\n').join(''));
}

test('consumption drift warms up before reaching Super and a restart preserves the one-hour throttle', async t => {
  let advance = 0;
  const f = fixture(t, { now: () => Date.now() + advance });
  let d = f.daemon();
  t.after(() => d.shutdown());
  const { session: superSession } = await f.spawn(d, 'super', 'S');
  const { session: auditor } = await f.spawn(d, 'auditor', 'A');
  const { session: leader } = await f.spawn(d, 'leader', 'L');
  await d.tick();
  advance = 31_000;
  await nativeCost(f, auditor, Date.now(), 80, 120);
  await d.tick();
  const ledger = async () => (await d.handle('notifications', { history: true })).notifications
    .filter(event => event.type === 'consumption-pyramid');
  const delivery = event => f.read('inbox/state.json').messages.filter(message => message.projectEvents?.includes(event.id));
  assert.deepEqual(await ledger(), []);
  const warmBoard = await d.handle('board', {});
  assert.equal(warmBoard.pyramids[0].byRole.worker.modelCalls, 0);
  assert.equal(warmBoard.roles.find(role => role.addr === auditor.addr).contextPercent, 100 * 120 / 300_000);
  const { session: worker } = await f.spawn(d, 'worker', 'W', leader.addr, { prompt: 'HOLD worker' });
  async function addSample() {
    for (const [row, calls, tokens] of [[auditor, 4, 80], [leader, 3, 60], [worker, 3, 50]]) {
      for (let i = 0; i < calls; i++) await nativeCost(f, row, Date.now() + advance - 1_000, tokens);
    }
  }
  advance += 31_000;
  await addSample();
  await d.tick();
  const initial = await ledger();
  assert.equal(initial.length, 1);
  assert.deepEqual(delivery(initial[0]).map(item => item.target.addr), [superSession.addr]);
  await d.shutdown();
  d = f.daemon();
  advance += 59 * 60_000;
  await d.tick();
  assert.equal((await ledger()).length, 1);
  advance += 120_000;
  await addSample();
  await d.tick();
  const afterThrottle = await ledger();
  assert.equal(afterThrottle.length, 2);
  assert.ok(afterThrottle[1].at - afterThrottle[0].at >= 3_600_000);
  assert.deepEqual(delivery(afterThrottle[1]).map(item => item.target.addr), [superSession.addr]);
});

test('the board uses the latest native input and the reported or estimated model window for senior roles', async t => {
  const f = fixture(t);
  const d = f.daemon();
  t.after(d.shutdown);
  const { session: leader } = await f.spawn(d, 'leader', 'L', undefined, { cli: 'agy', model: 'gemini-4-neon' });
  const { session: auditor } = await f.spawn(d, 'auditor', 'A', undefined, { cli: 'claude', model: 'sonnet' });
  const timestamp = new Date().toISOString();
  async function record(session, rows) {
    const path = await f.sessions.get(session.addr).session.nativeSessionFile();
    appendFileSync(path, rows.map(row => JSON.stringify(row)).join('\n') + '\n');
  }
  await record(leader, [
    { type: 'USER_INPUT', source: 'USER_EXPLICIT', content: 'Check the queue.' },
    { type: 'PLANNER_RESPONSE', source: 'MODEL', model: 'gemini-4-neon-xhigh', input_tokens: 100_000, content: 'Checking' },
    { type: 'PLANNER_RESPONSE', source: 'MODEL', model: 'gemini-4-neon-xhigh', input_tokens: 8192,
      cache_read_tokens: 57_344, status: 'DONE', content: 'Checked.' },
  ].map((row, step_index) => ({ ...row, step_index, created_at: timestamp })));
  await record(auditor, [
    { type: 'user', message: { role: 'user', content: 'Check the verdict.' } },
    { type: 'assistant', message: { role: 'assistant', id: 'msg_fixture', model: 'claude-sonnet-5-5',
      content: [{ type: 'text', text: 'Checked.' }], stop_reason: 'end_turn',
      usage: { input_tokens: 5000, cache_read_input_tokens: 40_000, cache_creation_input_tokens: 5000 } } },
    { type: 'result', modelUsage: { 'claude-sonnet-5-5': { contextWindow: 200_000 } } },
  ].map(row => ({ ...row, timestamp })));
  await d.tick();
  const { roles } = await d.handle('board', {});
  const context = role => {
    const { contextTokens, contextWindow, contextPercent, contextEstimated } = roles.find(item => item.role === role);
    return [contextTokens, contextWindow, contextPercent, contextEstimated];
  };
  assert.deepEqual(context('leader'), [65_536, 512_000, 12.8, true]);
  assert.deepEqual(context('auditor'), [50_000, 200_000, 25, false]);
});

test('Auditor wake overruns notify Super once per gate without proposing a rotation', async t => {
  let time = Date.now();
  const f = fixture(t, { now: () => time });
  f.policy({ roles: { auditor: { maxWakesPerGate: 1 } } });
  const d = f.daemon();
  t.after(d.shutdown);
  const { session: superSession } = await f.spawn(d, 'super', 'S');
  const { session: leader } = await f.spawn(d, 'leader', 'L');
  const { session: auditor } = await f.spawn(d, 'auditor', 'A');
  await d.tick();
  const events = async () => (await d.handle('notifications', { history: true })).notifications;
  const budgets = async () => (await events()).filter(event => event.type === 'auditor-budget-exceeded');
  time += 31_000;
  await nativeCost(f, auditor, time - 2, 290_000);
  await nativeCost(f, auditor, time - 1, 295_000);
  await d.tick();
  const [first] = await budgets();
  assert.ok(first.usage.wakes > first.usage.maxWakesPerGate);
  assert.equal(first.sampledAt, time);
  assert.deepEqual(f.read('inbox/state.json').messages.filter(message => message.projectEvents?.includes(first.id))
    .map(message => message.target.addr), [superSession.addr]);
  time += 31_000;
  await nativeCost(f, auditor, time - 1, 296_000);
  await d.tick();
  assert.equal((await budgets()).length, 1);
  assert.equal((await budgets())[0].id, first.id);
  assert.equal((await budgets())[0].sampledAt, first.sampledAt);
  assert.deepEqual((await budgets())[0].usage, first.usage);
  assert.equal(f.read('inbox/state.json').messages.filter(message => message.projectEvents?.includes(first.id)).length, 1);
  await d.handle('notifications', { gateComplete: 'G1' }, leader.addr);
  assert.ok((await events()).some(event => event.type === 'gate-completed' && event.gate === 'G1'));
  assert.equal((await budgets())[0].gate, 'G1');
  assert.equal((await events()).filter(event => event.type.endsWith('-rotation-proposed')).length, 0);
  time += 31_000;
  await nativeCost(f, auditor, time - 2, 299_000);
  await nativeCost(f, auditor, time - 1, 299_000);
  await d.tick();
  assert.equal((await budgets()).length, 2);
  assert.notEqual((await budgets())[1].id, first.id);
  assert.equal((await budgets())[1].afterGate, 'G1');
  assert.equal((await budgets())[1].sampledAt, time);
});

test('an explicit window threshold waits for the native turn and in-flight card to settle', async t => {
  let time = Date.now();
  const f = fixture(t, { now: () => time });
  f.policy({ roles: { leader: { maxContextFraction: 0.6 } } });
  const d = f.daemon();
  t.after(d.shutdown);
  const { session: leader } = await f.spawn(d, 'leader', 'L', undefined, { prompt: 'HOLD initial turn' });
  await d.tick();
  time += 31_000;
  await nativeCost(f, leader, time - 1, 180_000);
  const proposals = async () => (await d.handle('notifications', { history: true })).notifications
    .filter(event => event.type === 'leader-rotation-proposed');
  await d.tick();
  assert.deepEqual(await proposals(), []);
  const { session: worker } = await f.spawn(d, 'worker', 'W', leader.addr, { prompt: 'HOLD worker' });
  f.sessions.get(leader.addr).finish('Initial turn complete');
  time += 31_000;
  await d.tick();
  assert.deepEqual(await proposals(), []);
  f.sessions.get(worker.addr).finish('DONE W');
  time += 31_000;
  await d.tick();
  const [event] = await proposals();
  assert.deepEqual([event.reason, event.usage.inputTokens, event.usage.contextWindow], ['context-window', 180_000, 300_000]);
});

test('gate pack snapshots scoped evidence into one compact file and enqueues one pointer across restart', async t => {
  const f = fixture(t);
  const commit = name => f.git('-c', 'user.name=Loom', '-c', 'user.email=loom@example.invalid', 'commit', '-qm', name);
  f.git('init', '-q');
  writeFileSync(join(f.project, 'fixture.mjs'), 'old\n');
  f.git('add', 'fixture.mjs');
  commit('base');
  const base = f.git('rev-parse', 'HEAD');
  writeFileSync(join(f.project, 'fixture.mjs'), 'new\n');
  f.git('add', 'fixture.mjs');
  commit('candidate');
  const candidate = f.git('rev-parse', 'HEAD');
  let d = f.daemon();
  t.after(() => d.shutdown());
  f.policy({ roles: { auditor: { maxWakesPerGate: 1 } } });
  const { session: leader } = await f.spawn(d, 'leader', 'L');
  const { session: auditor } = await f.spawn(d, 'auditor', 'A');
  await d.tick();
  f.sessions.get(leader.addr).finish('Ready for worker evidence');
  const { session: worker } = await f.spawn(d, 'worker', 'W', leader.addr, { wave: 'GATE', prompt: 'HOLD work' });
  await assert.rejects(f.spawn(d, 'reviewer', 'R', leader.addr, { wave: 'GATE' }), { code: 'invalid-arguments' });
  await assert.rejects(f.spawn(d, 'reviewer', 'R', undefined, { parent: auditor.addr, wave: 'GATE' }), { code: 'invalid-arguments' });
  await d.tick();
  f.sessions.get(worker.addr).check('npm test', 5, 0);
  f.sessions.get(worker.addr).finish('DONE W');
  for (let i = 0; i < 3; i++) await d.tick();
  writeFileSync(join(f.project, '.project', 'evidence', 'red-fixture.json'), JSON.stringify({
    addr: worker.addr, card: 'Planned safeguards', git: { protectedHits: [{ path: 'fence.md' }],
      tests: [{ path: 'case.test.mjs', changes: { removedAssertions: 1, rewrittenAssertions: 0, addedSkip: 1 } }] },
  }));
  await assert.rejects(d.handle('gate-pack', { gate: '../elsewhere' }, leader.addr), { code: 'invalid-arguments' });
  await assert.rejects(d.handle('gate-pack', { gate: 'GATE' }, worker.addr), { code: 'invalid-arguments' });
  const packet = await d.handle('gate-pack', { gate: 'GATE', base, candidate, question: '答'.repeat(1900) }, leader.addr);
  assert.equal(packet.round, 1);
  assert.equal(packet.path, join(f.project, '.project', 'gates', `GATE.r1.${packet.deliveryId}.md`));
  const contents = readFileSync(packet.path, 'utf8');
  assert.ok(Buffer.byteLength(contents) <= 2048);
  assert.match(contents, /Evidence cards.*\.project\/evidence\/.*Diff --stat.*fixture\.mjs.*Test summary.*1 passed.*Open questions.*答.*Pointers/s);
  assert.match(contents, /Red facts.*protected-file.*fence\.md.*assertion.*case\.test\.mjs.*skip-only/s);
  assert.doesNotMatch(contents, /Reviewer verdicts|Gate has no reviewer/);
  assert.match(contents, /Full: .*\.full\.md#open-questions/);
  assert.ok(readFileSync(packet.fullPath, 'utf8').includes('答'.repeat(1900)));
  assert.equal(packet.warnings, undefined);
  await d.shutdown();
  d = f.daemon();
  await assert.rejects(d.handle('gate-pack', { gate: 'GATE', round: 1 }, leader.addr), { code: 'gate-round-exists' });
  const retry = await d.handle('gate-pack', { gate: 'GATE', round: 1, reuse: true }, leader.addr);
  assert.equal(retry.deliveryId, packet.deliveryId);
  assert.equal(readFileSync(packet.path, 'utf8'), contents);
  for (let i = 0; i < 3; i++) await d.tick();
  await assert.rejects(f.spawn(d, 'reviewer', 'RETIRED', auditor.addr, { wave: 'GATE' }), { code: 'invalid-arguments' });
  const auditMessages = f.read('inbox/state.json').messages.filter(message => message.target.addr === auditor.addr && !message.startup);
  assert.deepEqual(auditMessages.map(message => message.text), [`Read gate packet ${packet.path}`]);
  assert.equal(f.prompts.filter(message => message.addr === auditor.addr && message.input.includes(packet.path)).length, 1);
  const related = f.read('inbox/state.json').messages.filter(message => message.replyTo === packet.deliveryId);
  assert.deepEqual(related.map(message => message.target.addr), [leader.addr]);
  const budget = await d.handle('notifications', { gateComplete: 'GATE', history: true }, leader.addr);
  assert.equal(budget.notifications.find(event => event.type === 'auditor-budget-exceeded').usage.wakes, 2);
  assert.ok(budget.notifications.some(event => event.gate === 'GATE' && event.type === 'gate-completed'));
  writeFileSync(join(f.project, '.project/evidence/next-round.json'), JSON.stringify({ addr: worker.addr, card: 'New round evidence' }));
  const next = await d.handle('gate-pack', { gate: 'GATE', candidate, question: 'Latest question' }, leader.addr);
  assert.equal(next.round, 2);
  assert.notEqual(next.deliveryId, packet.deliveryId);
  const nextText = readFileSync(next.path, 'utf8');
  assert.match(nextText, /Latest question/);
  assert.doesNotMatch(nextText, /Reviewer verdicts/);
  assert.match(nextText + (next.fullPath ? readFileSync(next.fullPath, 'utf8') : ''), /next-round\.json/);
  assert.equal(readFileSync(packet.path, 'utf8'), contents);

  const missing = await d.handle('gate-pack', { gate: 'MISSING', candidate }, leader.addr);
  assert.equal(missing.warnings, undefined);
  assert.doesNotMatch(readFileSync(missing.path, 'utf8'), /Gate has no reviewer conclusion\./);
  assert.equal((await d.handle('gate-pack', { gate: 'MISSING', reuse: true }, leader.addr)).deliveryId, missing.deliveryId);
  await d.shutdown();
  d = f.daemon();
  await assert.rejects(f.spawn(d, 'reviewer', 'RESTART', auditor.addr, { wave: 'GATE' }), { code: 'invalid-arguments' });
});

test('Super sees one completion per phase and a plain Auditor decision across daemon restart', async t => {
  const f = fixture(t);
  let d = f.daemon();
  t.after(() => d.shutdown());
  const { session: superSession } = await f.spawn(d, 'super', 'S');
  const { session: auditor } = await f.spawn(d, 'auditor', 'A');
  await assert.rejects(d.handle('notifications', { phase: 'goal-3' }, auditor.addr), { code: 'invalid-arguments' });
  await assert.rejects(d.handle('notifications', { decision: 'mixed', kind: 'decision', auditEscalation: 'major-risk' }, auditor.addr),
    { code: 'invalid-arguments' });
  await d.handle('notifications', { complete: 'finished goal 3', phase: 'goal-3' }, auditor.addr);
  await d.handle('notifications', { complete: 'finished goal 4', phase: 'goal-4' }, auditor.addr);
  await d.handle('notifications', { decision: 'choose a default', kind: 'decision' }, auditor.addr);
  await d.tick();
  const pushes = f.read('inbox/state.json').messages.filter(message => message.projectEvents);
  assert.ok(pushes.every(push => push.target.addr === superSession.addr));
  assert.match(pushes.map(push => push.text).join('\n'), /\[goal-3\] finished goal 3.*\[goal-4\] finished goal 4.*choose a default/s);
  await d.shutdown();
  d = f.daemon();
  await assert.rejects(d.handle('notifications', { complete: 'duplicate summary', phase: 'goal-3' }, auditor.addr), { code: 'id-conflict' });
  const { notifications } = await d.handle('notifications', { take: true }, superSession.addr);
  assert.deepEqual(notifications.map(({ type, phase, kind, reason, text }) => [type, phase, kind, reason, text]), [
    ['project-completed', 'goal-3', undefined, undefined, 'finished goal 3'],
    ['project-completed', 'goal-4', undefined, undefined, 'finished goal 4'],
    ['needs-decision', undefined, 'decision', undefined, 'choose a default'],
  ]);
  assert.deepEqual((await d.handle('notifications', {}, superSession.addr)).notifications, []);
});

test('pilot goal 3 and 4 unphased CLI completions each persist and enter Super’s durable inbox', async t => {
  const f = fixture(t);
  const d = f.daemon();
  t.after(d.shutdown);
  const { session: superSession } = await f.spawn(d, 'super', 'S');
  const { session: auditor } = await f.spawn(d, 'auditor', 'A');
  const cli = await cliFor(t, f, () => d, auditor.addr);
  const first = 'pilot-2 完成：记忆 v1 一阶段已合入 pilot-2(1cdbd1bf)，未合 main';
  const goal3 = '追加目标3完成：记忆v1必修a–g已合入 pilot-2(85bd8eee)，未合 main，472 测试全过。';
  const goal4 = '目标4完成:a–e已合入pilot-2(2c2349e3),全量582过0失败,未进main。报告 .project/goal4-final-report.md,含5项待你定。';
  const complete = async text => JSON.parse((await cli('notifications', '--project', f.project, '--complete', text)).stdout);
  const accepted = [];
  for (const text of [first, goal3, goal4]) accepted.push(await complete(text));
  const history = JSON.parse((await cli('notifications', '--project', f.project, '--history')).stdout);
  const events = history.notifications.filter(event => event.type === 'project-completed');
  assert.deepEqual(events.map(event => event.text), [first, goal3, goal4]);
  assert.deepEqual(accepted.map(result => result.completion.id), events.map(event => event.id));
  const deliveries = f.read('inbox/state.json').messages.filter(message => message.projectEvents);
  assert.ok(events.every(event => deliveries.some(message => message.target.addr === superSession.addr && message.projectEvents.includes(event.id))));
  assert.equal((await complete(goal4)).completion.id, accepted.at(-1).completion.id);
});

test('completion without a working Super route exits nonzero and remains retryable', async t => {
  const f = fixture(t, { externalNotification: async () => { throw new Error('banner failed'); } });
  const d = f.daemon();
  t.after(d.shutdown);
  const { session: auditor } = await f.spawn(d, 'auditor', 'A');
  const cli = await cliFor(t, f, () => d, auditor.addr);
  const complete = () => cli('notifications', '--project', f.project, '--complete', 'recoverable completion');
  await assert.rejects(complete(), error => JSON.parse(error.stdout).error.code === 'notification-pending');
  const [prior] = f.read('loomd/notifications.json').filter(event => event.type === 'project-completed');
  assert.equal(prior.pushRoute, undefined);
  const { session: superSession } = await f.spawn(d, 'super', 'S');
  const recovered = JSON.parse((await complete()).stdout).completion;
  assert.equal(recovered.id, prior.id);
  assert.equal(recovered.pushRoute, superSession.addr);
});

test('an uncertain delivery becomes terminal after its target stops and stays settled after restart', async t => {
  const f = fixture(t);
  let d = f.daemon();
  t.after(() => d.shutdown());
  const { session: leader } = await f.spawn(d, 'leader', 'L');
  const id = randomUUID();
  const attemptAt = Date.now();
  publish(f.project, { id, text: 'pending proof', phase: 'sending', issue: 'uncertain', attemptAt, createdAt: attemptAt,
    requestedMode: 'queue', mode: 'queue', target: { addr: leader.addr, backend: leader.backend, provider: leader.cli, createdAt: leader.startedAt } });
  await d.tick();
  assert((await d.handle('ls', {})).pendingDeliveries.some(message => message.id === id && message.deliveryStatus === 'uncertain'));
  await d.handle('stop', { target: leader.addr });
  assert(!(await d.handle('ls', {})).pendingDeliveries.some(message => message.id === id));
  await d.shutdown();
  d = f.daemon();
  await d.tick();
  const state = await d.handle('state', { target: leader.addr });
  const delivery = state.deliveries.find(message => message.id === id);
  assert.equal(delivery.phase, 'target-ended');
  assert.equal(delivery.deliveryStatus, 'target-ended');
  assert.equal(delivery.issue, 'target-ended');
  assert(!(await d.handle('ls', {})).pendingDeliveries.some(message => message.id === id));
});

test('Auditor dispatch admits only user messages and one Leader gate or red escalation per gate', async t => {
  const f = fixture(t);
  f.git('init', '-q');
  f.git('-c', 'user.name=Loom', '-c', 'user.email=loom@example.invalid', 'commit', '--allow-empty', '-qm', 'candidate');
  let d = f.daemon();
  t.after(() => d.shutdown());
  const { session: leader } = await f.spawn(d, 'leader', 'L');
  const { session: auditor } = await f.spawn(d, 'auditor', 'A');
  const { session: superSession } = await f.spawn(d, 'super', 'S');
  await d.tick();
  const note = 'DONE G4-MERGE：条件全部满足，已快进合入 pilot-2。记录路径：.project/goal4-fulltest.md';
  const invalid = await d.handle('send', { target: auditor.addr, mode: 'interrupt', text: note }, leader.addr);
  assert.equal(invalid.issue, 'auditor-wake-filtered');
  assert.equal(invalid.reason, 'auditor-wake-filtered');
  assert.equal(invalid.nextWakeDigest, true);
  assert.equal(invalid.status, 'refused');
  const legacy = randomUUID();
  publish(f.project, { id: legacy, createdAt: Date.now(), requestedMode: 'queue', mode: 'queue', phase: 'queued',
    target: { addr: auditor.addr, backend: 'headless', provider: auditor.cli, createdAt: auditor.startedAt },
    text: 'Legacy drift', superPriority: true, orgEvents: ['legacy'] });
  const args = { gate: 'G1', reason: 'confirmed-fact-miss', evidence: 'I checked the claimed SHA against the Git object database.' };
  await assert.rejects(d.handle('escalate', { ...args, reason: 'ordinary-failure' }, leader.addr), { code: 'invalid-arguments' });
  await assert.rejects(d.handle('escalate', { ...args, evidence: '' }, leader.addr), { code: 'invalid-arguments' });
  await assert.rejects(d.handle('escalate', args, superSession.addr), { code: 'invalid-arguments' });
  const red = await d.handle('escalate', args, leader.addr);
  assert.equal(red.wakeQueued, true);
  assert.match(readFileSync(red.path, 'utf8'), /Red facts.*confirmed-fact-miss.*Git object database/s);
  await d.shutdown();
  d = f.daemon();
  assert.equal((await d.handle('escalate', args, leader.addr)).wakeQueued, false);
  assert.equal((await d.handle('gate-pack', { gate: 'G1', reuse: true }, leader.addr)).deliveryId, red.deliveryId);
  const gate = await d.handle('gate-pack', { gate: 'G2' }, leader.addr);
  const followup = await d.handle('escalate', { ...args, gate: 'G2', reason: 'protected-file' }, leader.addr);
  assert.equal(followup.deliveryId, gate.deliveryId);
  assert.equal(followup.wakeQueued, false);
  assert.equal(readFileSync(join(f.project, followup.evidencePath), 'utf8'), args.evidence);
  const user = await d.handle('send', { target: auditor.addr, mode: 'queue', text: 'RETURN user decision' }, superSession.addr);
  for (let i = 0; i < 6; i++) await d.tick();
  const messages = f.read('inbox/state.json').messages;
  assert.equal(messages.find(message => message.id === legacy).issue, 'auditor-wake-filtered');
  assert.deepEqual(new Set(f.prompts.filter(message => message.addr === auditor.addr).slice(1)
    .map(message => deliveryId(message.input))), new Set([red.deliveryId, gate.deliveryId, user.deliveryId]));
  assert.equal(f.prompts.filter(message => message.addr === auditor.addr).length, 4);
  const digestPrompts = f.prompts.filter(message => message.addr === auditor.addr && message.input.includes(note));
  assert.equal(digestPrompts.length, 1);
  assert.match(digestPrompts[0].input, /Loom Auditor next-wake digest/);
  assert.equal(messages.some(message => message.replyTo === user.deliveryId), false);
  assert.equal((await d.handle('notifications', { history: true })).notifications.filter(event => event.type === 'red-escalation').length, 2);
  const { projectStatus } = await import('../cli/status.mjs');
  const status = await projectStatus(f.project);
  assert.deepEqual(status.routing.filtered.map(item => item.id), [invalid.deliveryId, legacy]);
  assert.equal(status.routing.filtered[0].digest, 'received');
});

test('agy sign-in warnings notify Super once per account without stopping sessions', async t => {
  const terminals = new Map();
  const warning = readFileSync(new URL('../adapters/agy/fixtures/agy-sign-in-warning.txt', import.meta.url), 'utf8');
  const f = fixture(t, { sessionOptions: {
    async openPane(_job, row) {
      const terminal = { address: 't' + (terminals.size + 1), cwd: row.cwd, pid: 101 + terminals.size,
        created_ms: 1, status_ms: 1, state: 'live', status: { state: 'idle' }, email: 'same@example.test' };
      terminals.set(row.addr, terminal);
      return { terminal };
    },
    getPane: async (_job, row) => terminals.get(row.addr),
    async callHc(command, pane) {
      const terminal = [...terminals.values()].find(item => item.address === pane);
      if (command === 'get') return terminal;
      if (command === 'read') return { text: warning.replace('<ACCOUNT>', terminal.email), complete: true, how: 'screen' };
      return {};
    },
  } });
  const d = f.daemon();
  t.after(d.shutdown);
  const { session: leader } = await f.spawn(d, 'leader', 'WARN-LEADER', undefined, { cli: 'agy', mode: 'tui' });
  const { session: auditor } = await f.spawn(d, 'auditor', 'WARN-AUDITOR', undefined, { cli: 'agy', mode: 'tui' });
  const notices = async () => (await d.handle('notifications', { history: true })).notifications
    .filter(event => event.reason === 'auth-warning');
  await d.tick();
  await d.tick();
  assert.equal((await notices()).length, 1);
  assert.match((await notices())[0].text, /^⚠ Sign-in update needed\n  ⎿  Your sign-in is missing permissions.*Run \/logout to sign in again\.$/);
  for (const addr of [leader.addr, auditor.addr]) assert.notEqual((await d.handle('state', { target: addr })).state, 'auth-expired');
  terminals.get(auditor.addr).email = 'different@example.test';
  await d.tick();
  assert.equal((await notices()).length, 2);
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
    assert.equal((await d.handle('state', { target: worker.session.addr })).state, 'working');
  }
  const next = await f.spawn(d, 'worker', 'NEXT', leader, held);
  await d.tick();
  assert.equal((await d.handle('state', { target: next.session.addr })).state, 'working');
  assert.equal((await d.handle('state', { target: fast.session.addr })).state, 'idle-warm');
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
  assert.deepEqual(new Set(batches().map(message => message.target.addr)), new Set([leader]));
  assert.equal(f.prompts.filter(message => message.addr === auditor).length, 1);
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
  assert.equal(replacement.body, 'L');
  assert.equal(replacement.replySource, 'native transcript');
  assert.equal(replacement.unconfirmed, undefined);
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

test('a blocked barrier escalates once while holding the set and keeps FAILED/MISMATCH with the Leader', async t => {
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
  assert.equal(copies.length, 0);
  assert.equal(f.prompts.filter(row => row.addr === leader && deliveryId(row.input) === finished[0].id).length, 1);
  if (f.sessions.get(leader).session.status().value.kind === 'running') f.sessions.get(leader).finish('Wave read.');
  await recovered.handle('stop', { target: tail });
  await f.barrier(recovered, 'MISMATCH', leader, { wave: 'M', prompt: 'RETURN DONE MISMATCH\n全绿，通过 8 项' });
  for (let i = 0; i < 4; i++) await recovered.tick();
  const mismatch = batches().find(message => message.target.addr === leader && /波次 M.*证据 MISMATCH/s.test(message.text));
  assert.ok(mismatch);
  assert.ok(f.prompts.some(row => row.addr === leader && deliveryId(row.input) === mismatch.id));
  assert.equal(f.prompts.filter(row => row.addr === auditor).length, 1);
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
    ['busy-without-output', 'quota-wait']);
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
  const attemptAt = Date.now() - 361_000;
  publish(f.project, { id, text: 'unconfirmed test input', phase: 'sending', issue: 'uncertain', attemptAt,
    createdAt: attemptAt, requestedMode: 'queue', mode: 'queue',
    target: { addr: auditor.addr, backend: auditor.backend, provider: auditor.cli, createdAt: auditor.startedAt } });
  await recovered.tick();
  const uncertain = (await recovered.handle('notifications', { take: true }, superSession.addr)).notifications;
  assert.equal(uncertain.length, 1);
  assert.equal(uncertain[0].type, 'delivery-stalled');
  assert.equal(uncertain[0].deliveryId, id);
  assert.equal(pushed().length, 2);
  assert.deepEqual(external.flat().map(event => event.deliveryId), [id]);
  await recovered.shutdown();
});

function handoverBrief(f, addr) {
  const { input } = f.prompts.find(message => message.addr === addr);
  const [, path, digest] = /Read (\.project\/replies\/([a-f0-9]{64})\.txt) \(SHA-256\)/.exec(input);
  const brief = readFileSync(join(f.project, path), 'utf8');
  const ack = brief.trimEnd().split('\n').at(-1);
  assert.equal(payloadDigest(brief), digest);
  assert.match(ack, /^HANDOVER-ACK [0-9a-f-]+$/);
  assert.ok(!input.includes(ack));
  return { brief, ack };
}

test('holds queued input and worker results until the Leader’s native briefing turn acknowledges the complete file', async t => {
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
  const tail = '交接剩余内容'.repeat(4000);
  const { session: successor, retired, deliveryId } = await f.spawn(d, 'leader', 'NEXT', undefined, {
    'handover-from': leader.addr, prompt: 'start replacement\n' + tail,
  });
  assert.equal(retired, undefined);
  const during = { target: 'leader', text: 'queued by role during handover', mode: 'queue', id: randomUUID() };
  assert.equal((await d.handle('send', during)).addr, leader.addr);
  const urgent = await d.handle('send', { target: 'leader', text: 'held interrupt during handover', mode: 'interrupt' });
  assert.deepEqual([urgent.mode, urgent.downgraded], ['queue', true]);
  await d.tick();
  assert.equal(f.prompts.find(message => message.addr === successor.addr).input.startsWith('[loom:' + deliveryId + ']'), true);
  const { brief, ack } = handoverBrief(f, successor.addr);
  assert.match(brief, new RegExp(leader.addr + '.*start replacement', 's'));
  assert.match(brief, /## 项目章程\n\.project\/charter\.md\n目标 · 验证交接/);
  assert.match(brief, /## 裁决账本\n\.project\/rulings\.md\n裁决 3\n> 先看原件。/);
  assert.ok(brief.includes(tail) && brief.includes(input.id) && brief.includes(continuation.id));
  assert.match(brief, /## 项目文件\n- \.project\/policy\.json.*## 开放卡片和波次\n- W1 · 波次 W/s);

  f.sessions.get(leader.addr).finish('Waiting for handover');
  f.sessions.get(worker.addr).finish('DONE W1 first wave');
  await d.tick();
  await d.tick();
  assert.notEqual((await d.handle('state', { target: leader.addr })).state, 'exited');
  assert.equal(f.prompts.filter(item => item.addr === leader.addr || item.addr === successor.addr).length, 2);
  const waiting = f.read('inbox/state.json').messages.find(message => message.id === during.id);
  assert.equal(waiting.target.addr, leader.addr);
  assert.equal(waiting.phase, 'queued');
  assert.equal(waiting.typedAt, undefined);
  assert.equal(f.read('inbox/state.json').messages.find(message => message.id === urgent.id).typedAt, undefined);
  assert.equal((await d.handle('ls', {})).pendingContinuations[0]?.parent ?? leader.addr, leader.addr);
  f.sessions.get(successor.addr).finish(ack);
  await d.tick();
  assert.equal((await d.handle('state', { target: leader.addr })).state, 'exited');
  await d.tick();
  const messages = f.read('inbox/state.json').messages;
  assert.equal(messages.find(message => message.id === input.id).target.addr, successor.addr);
  assert.equal(messages.find(message => message.id === during.id).target.addr, successor.addr);
  assert.equal(messages.find(message => message.id === urgent.id).target.addr, successor.addr);
  assert.equal((await d.handle('send', during)).id, during.id);
  assert.equal(messages.find(message => message.id === workerFirst).waveParent, leader.addr);
  assert.equal(messages.find(message => message.waveBatch).target.addr, successor.addr);
  assert.equal(messages.find(message => message.continuationMembers?.includes(continuation.id)).target.addr, successor.addr);
  assert.equal((await d.handle('send', input)).id, input.id);
  await d.shutdown();
});

for (const cli of ['claude', 'agy', 'codex', 'opencode']) test(`a long ${cli} TUI handover fits one holder write and preserves the full briefing`, async t => {
  const terminal = { address: 't1', pid: 101, created_ms: 1, status_ms: 1, state: 'live' };
  const f = fixture(t, { sessionOptions: { getPane: async () => terminal, openPane: async () => ({ terminal }) } });
  const d = f.daemon();
  t.after(d.shutdown);
  const { session: old } = await f.spawn(d, 'auditor', 'OLD');
  const prompt = '交接内容。'.repeat(120);
  const { pasteChunk } = await import('../tui/holder-paste.mjs');
  const { session: next, deliveryId } = await f.spawn(d, 'auditor', 'NEXT', undefined, {
    cli, mode: 'tui', 'handover-from': old.addr, prompt,
  });
  const { text } = f.read('inbox/state.json').messages.find(item => item.id === deliveryId);
  assert.ok(Buffer.byteLength('\x1b[200~' + wireText(deliveryId, text) + '\x1b[201~') <= pasteChunk);
  f.prompts.push({ addr: next.addr, input: text });
  const { brief } = handoverBrief(f, next.addr);
  assert.ok(brief.includes(prompt));
  assert.match(brief, /Loom role guidance.*Decide the gate verdict/s);
  assert.ok(brief.includes(old.addr));
});

test('a role delivery waits for the acknowledgement even if the predecessor has exited', async t => {
  const f = fixture(t);
  const d = f.daemon();
  t.after(d.shutdown);
  const { session: old } = await f.spawn(d, 'leader', 'L');
  await d.tick();
  const { session: next } = await f.spawn(d, 'leader', 'NEXT', undefined, { 'handover-from': old.addr });
  const delivery = await d.handle('send', { target: 'leader', mode: 'queue', text: 'Queued before the slot becomes vacant' });
  await d.handle('stop', { target: old.addr });
  await assert.rejects(d.handle('send', { target: 'leader', mode: 'queue', text: 'During the vacant slot' }), { code: 'not-found' });
  const saved = () => f.read('inbox/state.json').messages.find(message => message.id === delivery.id);
  await d.tick();
  assert.deepEqual([saved().target.addr, saved().phase, saved().typedAt], [old.addr, 'queued', undefined]);
  f.sessions.get(next.addr).finish(handoverBrief(f, next.addr).ack);
  await d.tick();
  await d.tick();
  assert.equal(saved().target.addr, next.addr);
});

for (const [role, cli] of [['leader', 'agy'], ['auditor', 'claude']]) test(`${role} self-rotation uses a normal wake and waits for idle and acknowledgement`, async t => {
  const state = mkdtempSync(join(realpathSync(tmpdir()), 'loom-rotation-auth-'));
  t.after(() => rmSync(state, { recursive: true, force: true }));
  const sessionOptions = {};
  const f = fixture(t, { sessionOptions });
  const capabilities = sessionOptions.capabilities = socketCapabilities(f.project, { XDG_STATE_HOME: state });
  f.policy({ roles: { [role]: { rotateAt: 'gate' } } });
  const d = f.daemon();
  t.after(d.shutdown);
  const { session: old } = await f.spawn(d, role, 'OLD', undefined, { cli, model: 'same-model', effort: 'low', prompt: 'HOLD startup' });
  const oldCapability = f.sessions.get(old.addr).capability;
  assert.equal(capabilities.identify(oldCapability, d.liveCaller)?.addr, old.addr);
  await d.tick();
  const prior = f.read('inbox/state.json').messages.length;
  await d.handle('notifications', { gateComplete: 'ROT-SELF' });
  assert.equal(f.read('inbox/state.json').messages.length, prior);
  const existing = await d.handle('send', { target: role, text: 'HOLD existing delivery', mode: 'queue' });
  f.sessions.get(old.addr).finish('Startup finished.');
  await d.tick();
  let wire = f.prompts.find(item => deliveryId(item.input) === existing.id);
  assert.match(wire.input, /换班提示.*rotate --self/s);
  await assert.rejects(d.handle('rotate', { self: true, model: 'override' }, old.addr), { code: 'invalid-arguments' });
  const { rotation: { notePath } } = await d.handle('rotate', { self: true, prepare: true }, old.addr);
  const note = 'Keep the accepted gate. Review only the next candidate.';
  writeFileSync(notePath, note);
  const first = await d.handle('rotate', { self: true, reason: 'handoff readiness' }, old.addr);
  assert.equal((await d.handle('rotate', { self: true }, old.addr)).rotation.requestId, first.rotation.requestId);
  await d.tick();
  assert.equal(f.sessions.size, 1);
  f.sessions.get(old.addr).finish('Ready to hand over.');
  await d.tick();
  await d.tick();
  const next = (await d.handle('state', { target: old.addr })).rotations[0].successor;
  const nextCapability = f.sessions.get(next).capability;
  assert.ok(nextCapability && nextCapability !== oldCapability);
  assert.equal(capabilities.identify(nextCapability, d.liveCaller), undefined);
  assert.equal(capabilities.identify(oldCapability, d.liveCaller)?.addr, old.addr);
  const { brief, ack } = handoverBrief(f, next);
  assert.ok(brief.includes(note) && brief.includes(notePath) && brief.includes('handoff readiness'));
  const job = f.read(`loomd/sessions/${next}.json`);
  assert.deepEqual([job.row.cli, job.row.model, job.row.effort, job.row.backend, job.row.cwd],
    [old.cli, old.model, old.effort, old.backend, old.cwd]);
  assert.equal((await d.handle('state', { target: role })).addr, old.addr);
  f.sessions.get(next).finish(ack);
  await d.tick();
  assert.equal(capabilities.identify(oldCapability, d.liveCaller), undefined);
  assert.equal(capabilities.identify(oldCapability, d.liveCaller), undefined);
  assert.equal(capabilities.identify(nextCapability, d.liveCaller)?.addr, next);
  assert.equal((await d.handle('state', { target: role })).addr, next);
  assert.equal((await d.handle('state', { target: old.addr })).state, 'exited');
  const history = (await d.handle('notifications', { history: true })).notifications;
  const success = history.find(event => event.type === `${role}-rotation-completed`);
  assert.equal(success.addr, next);
  assert.equal(Boolean(success.logOnly), role === 'leader');
});

test('Leader self-rotation lists active work and reports completion on the Auditor’s next ordinary delivery', async t => {
  const f = fixture(t);
  f.policy({ roles: { leader: { rotateAt: 'gate' } } });
  const d = f.daemon();
  t.after(d.shutdown);
  const { session: auditor } = await f.spawn(d, 'auditor', 'AUD');
  const { session: leader } = await f.spawn(d, 'leader', 'LEAD', undefined, { prompt: 'HOLD Leader startup' });
  await d.tick();
  f.sessions.get(leader.addr).finish('Ready.');
  const { session: worker } = await f.spawn(d, 'worker', 'OPEN-CARD', leader.addr, { prompt: 'HOLD active work' });
  await d.tick();
  await d.handle('notifications', { gateComplete: 'GATE-WITH-ACTIVE-CARD' });
  const original = await d.handle('send', { target: 'leader', mode: 'queue', text: 'HOLD ordinary Leader delivery' });
  await d.tick();
  assert.doesNotMatch(f.prompts.find(item => deliveryId(item.input) === original.id).input, /换班提示/);
  f.sessions.get(leader.addr).finish('Ready to hand over.');
  const { rotation: { notePath, inFlight } } = await d.handle('rotate', { self: true, prepare: true }, leader.addr);
  assert.deepEqual(inFlight.map(item => item.addr), [worker.addr]);
  writeFileSync(notePath, 'Wait for the integration result.');
  await assert.rejects(d.handle('rotate', { self: true }, leader.addr), { code: 'rotation-work-unlisted' });
  writeFileSync(notePath, 'Wait for the integration result from OPEN-CARD.');
  await d.handle('rotate', { self: true }, leader.addr);
  await d.tick();
  await d.tick();
  const next = (await d.handle('state', { target: leader.addr })).rotations[0].successor;
  const { brief, ack } = handoverBrief(f, next);
  assert.match(brief, /开放卡片和波次[\s\S]*OPEN-CARD/);
  f.sessions.get(next).finish(ack);
  await d.tick();
  assert.equal(f.read('inbox/state.json').messages.filter(item => item.target.addr === auditor.addr).length, 1);
  const sent = await d.handle('send', { target: 'auditor', mode: 'queue', text: 'HOLD next gate' });
  await d.tick();
  const input = f.prompts.find(item => deliveryId(item.input) === sent.id).input;
  assert.ok(input.includes(`Loom leader 换班完成：${leader.addr} → ${next}`));
});

for (const bound of ['time', 'turns']) test(`an unanswered Leader rotation signal escalates to the Auditor at the ${bound} bound`, async t => {
  let advance = 0;
  const f = fixture(t, { now: () => Date.now() + advance });
  f.policy({ roles: { leader: { rotateAt: 'gate' } } });
  const d = f.daemon();
  t.after(d.shutdown);
  const { session: auditor } = await f.spawn(d, 'auditor', 'AUD');
  const { session: leader } = await f.spawn(d, 'leader', 'LEAD');
  await d.handle('notifications', { gateComplete: 'OVERDUE-GATE' });
  await d.tick();
  assert.equal(f.read('inbox/state.json').messages.filter(item => item.target.addr === auditor.addr).length, 1);
  if (bound === 'time') {
    advance = 15 * 60_000;
  } else {
    f.sessions.get(leader.addr).finish('Startup finished.');
    await d.tick();
    for (let i = 0; i < 3; i++) {
      await d.handle('send', { target: 'leader', mode: 'queue', text: 'HOLD ordinary delivery ' + i });
      await d.tick();
      f.sessions.get(leader.addr).finish('Continuing.');
      await d.tick();
    }
  }
  await d.tick();
  await d.tick();
  const history = (await d.handle('notifications', { history: true })).notifications;
  const overdue = history.filter(event => event.type === 'needs-decision' && event.reason === 'self-rotation-overdue');
  assert.equal(overdue.length, 1);
  assert.equal(overdue[0].addr, leader.addr);
  assert.equal(overdue[0].pushRoute, auditor.addr);
});

test('failed self-rotation reports the first failure on a normal wake and escalates after the retry', async t => {
  const f = fixture(t);
  const d = f.daemon();
  t.after(d.shutdown);
  const { session: old } = await f.spawn(d, 'auditor', 'OLD');
  await d.tick();
  const { rotation: { notePath } } = await d.handle('rotate', { self: true, prepare: true }, old.addr);
  writeFileSync(notePath, 'Keep the current gate and wait for the next candidate.');
  const histories = async () => (await d.handle('notifications', { history: true })).notifications;
  for (let attempt = 0; attempt < 2; attempt++) {
    await d.handle('rotate', { self: true }, old.addr);
    await d.tick();
    await d.tick();
    const next = (await d.handle('state', { target: old.addr })).rotations.at(-1).successor;
    f.sessions.get(next).finish('The fixture omitted the acknowledgement.');
    await d.tick();
    assert.equal((await d.handle('state', { target: 'auditor' })).addr, old.addr);
    const pushed = (await histories()).filter(event => event.id.startsWith('self-rotation:') && event.type === 'needs-decision');
    assert.equal(pushed.length, attempt);
    if (attempt) break;
    const existing = await d.handle('send', { target: 'auditor', text: 'HOLD ordinary input', mode: 'queue' });
    await d.tick();
    assert.match(f.prompts.find(row => deliveryId(row.input) === existing.id).input,
      /first-turn-missing-acknowledgement.*rotate --self/s);
    f.sessions.get(old.addr).finish('Preparing the retry.');
    await d.tick();
  }
  await assert.rejects(d.handle('rotate', { self: true }, old.addr), { code: 'rotation-retry-exhausted' });
});

test('an overdue agy TUI handover closes only its successor pane and retries persisted cleanup', async t => {
  let advance = 0;
  const panes = new Map(), kills = [], sends = [];
  const f = fixture(t, { now: () => Date.now() + advance, sessionOptions: {
    async openPane(_job, row) {
      const pid = 20 + panes.size;
      const terminal = { address: `t${pid}`, cwd: row.cwd, pid, created_ms: Date.now(),
        state: 'live', status: { state: 'idle' }, status_ms: Date.now() };
      panes.set(row.addr, terminal);
      return { terminal };
    },
    async getPane(_job, row) { return panes.get(row.addr); },
    async callHc(command, address) {
      const term = [...panes.values()].find(pane => pane.address === address);
      if (command === 'get') return term;
      if (command === 'read') return { how: 'screen', complete: true, text: '──────────\n>\n──────────\n? for shortcuts' };
      if (command === 'send') { sends.push(address); return; }
      assert.equal(command, 'kill');
      kills.push(address);
      if (kills.length === 1) throw new Error('fixture hc temporarily unavailable');
      Object.assign(term, { state: 'finished', finished_ms: Date.now() });
    },
  } });
  let d = f.daemon();
  t.after(() => d.shutdown());
  const { session: old } = await f.spawn(d, 'leader', 'OLD', undefined, { cli: 'agy', mode: 'tui' });
  const events = join(f.project, '.project', 'relay', 'events');
  mkdirSync(events, { recursive: true });
  appendFileSync(join(events, `${old.addr}.jsonl`), JSON.stringify({ cwd: f.project, receivedAt: Date.now(),
    conversationId: randomUUID(), hook_event_name: 'SessionStart' }) + '\n');
  await d.tick();
  const { rotation: { notePath } } = await d.handle('rotate', { self: true, prepare: true }, old.addr);
  writeFileSync(notePath, 'Continue verification at the next project boundary.');
  await d.handle('rotate', { self: true }, old.addr);
  await d.tick();
  const next = (await d.handle('state', { target: old.addr })).rotations[0].successor;
  const nextPane = panes.get(next);
  advance = 15 * 60_000;
  await d.tick();
  assert.deepEqual(kills, [nextPane.address]);
  assert.ok(!sends.includes(nextPane.address));
  assert.equal((await d.handle('state', { target: 'leader' })).addr, old.addr);
  await d.shutdown();
  // Releases before this fix could persist the failure without marking the job stopping.
  const jobPath = `loomd/sessions/${next}.json`;
  const job = f.read(jobPath);
  assert.equal(job.handoverFailure.reason, 'self-rotation-overdue');
  delete job.stopping;
  writeFileSync(join(f.project, '.project', jobPath), JSON.stringify(job));
  d = f.daemon();
  await d.tick();
  await d.tick();
  assert.deepEqual(kills, [nextPane.address, nextPane.address]);
  assert.equal(nextPane.state, 'finished');
  assert.equal((await d.handle('state', { target: next })).state, 'closed');
  assert.equal((await d.handle('state', { target: 'leader' })).addr, old.addr);
});

for (const [role, startsWork] of [['auditor', true], ['auditor', false], ['leader', false]]) test(`handover Do now ${role} ${startsWork ? 'settles on its phase receipt' : 'nudges once then reports inactivity'}`, async t => {
  let advance = 0;
  const f = fixture(t, { now: () => Date.now() + advance });
  const d = f.daemon();
  t.after(d.shutdown);
  const { session: upstream } = await f.spawn(d, role === 'leader' ? 'auditor' : 'super', 'UPSTREAM');
  const { session: old } = await f.spawn(d, role, 'OLD', undefined, { prompt: 'HOLD old turn' });
  await d.tick();
  f.sessions.get(old.addr).finish('Ready');
  const { rotation: { notePath } } = await d.handle('rotate', { self: true, prepare: true }, old.addr);
  writeFileSync(notePath, '## Do now\n- Register completion for phase `goal5`.\n\n## Background\nAccepted evidence.');
  await d.handle('rotate', { self: true }, old.addr);
  await d.tick();
  await d.tick();
  const next = (await d.handle('state', { target: old.addr })).rotations[0].successor;
  const { brief, ack } = handoverBrief(f, next);
  assert.match(brief, /## Do now\n- Register completion for phase `goal5`\.[\s\S]*## Background\nAccepted evidence/);
  assert.equal(brief.match(/^## Do now$/gm).length, 1);
  const startup = f.prompts.find(item => item.addr === next).input;
  assert.match(startup, /When Loom sends 接管生效, start the Do now items/);
  assert.equal(f.read('inbox/state.json').messages.some(message => message.target.addr === next && message.rotationActivation), false);
  f.sessions.get(next).finish(ack);
  await d.tick();
  await d.tick();
  const activation = f.read('inbox/state.json').messages.find(message => message.target.addr === next && message.rotationActivation);
  assert.match(activation.text, /接管生效[\s\S]*goal5/);
  assert.ok(f.prompts.some(item => deliveryId(item.input) === activation.id));
  if (f.sessions.get(next).session.status().value.kind === 'running') f.sessions.get(next).finish('Ready to continue.');
  if (startsWork) await d.handle('notifications', { complete: 'Goal 5 checked.', phase: 'goal5' }, next);
  else {
    await d.handle('notifications', { complete: 'Unrelated completion.', phase: 'goal4' }, next);
    f.sessions.get(next).check('git rev-parse HEAD', 10, 0);
  }
  await d.tick();
  const nudges = () => f.read('inbox/state.json').messages.filter(message => message.target.addr === next && /^交接里有待办：/.test(message.text));
  advance = 3 * 60_000 + 100;
  await d.tick();
  assert.equal(nudges().length, startsWork ? 0 : 1);
  if (!startsWork) {
    await d.tick();
    assert.ok(f.prompts.some(item => deliveryId(item.input) === nudges()[0].id));
    if (f.sessions.get(next).session.status().value.kind === 'running') f.sessions.get(next).finish('Acknowledged');
  }
  advance += 3 * 60_000 + 100;
  await d.tick();
  await d.tick();
  const alerts = (await d.handle('notifications', { history: true })).notifications
    .filter(event => event.reason === 'handover-work-unstarted');
  assert.equal(alerts.length, startsWork ? 0 : 1);
  assert.equal(nudges().length, startsWork ? 0 : 1);
  if (!startsWork) {
    assert.equal(alerts[0].pushRoute, upstream.addr);
    assert.ok(f.read('inbox/state.json').messages.some(message =>
      message.target.addr === upstream.addr && message.projectEvents?.includes(alerts[0].id)));
  }
});

test('external Super sends to the live role and receives project notification receipts and replies', async t => {
  const f = fixture(t);
  const d = f.daemon();
  t.after(d.shutdown);
  const { session: retired } = await f.spawn(d, 'leader', 'OLD');
  await d.handle('stop', { target: retired.addr });
  const { session: leader } = await f.spawn(d, 'leader', 'LIVE');
  await d.tick();
  f.sessions.get(leader.addr).finish('Startup finished.');
  const cli = await cliFor(t, f, () => d);
  assert.equal(JSON.parse((await cli('state', 'leader')).stdout).addr, leader.addr);
  await assert.rejects(d.handle('send', { target: 'leader', from: 'super', mode: 'queue', text: 'spoof' }, leader.addr),
    { code: 'invalid-arguments' });
  const accepted = await d.handle('send', { target: 'leader', from: 'super', mode: 'queue', expectReply: true, text: 'HOLD request' });
  assert.equal(accepted.addr, leader.addr);
  await d.tick();
  assert.deepEqual(f.read('inbox/state.json').messages.find(item => item.id === accepted.id).from,
    { addr: 'super', role: 'super', external: true });
  f.sessions.get(leader.addr).finish('The requested answer.');
  await d.tick();
  const history = (await d.handle('notifications', { history: true })).notifications.filter(event => event.deliveryId === accepted.id);
  assert.deepEqual(history.map(event => event.type), ['super-delivery-receipt', 'super-delivery-reply']);
  assert.equal(history[1].text, 'The requested answer.');
  const { notifications } = await d.handle('board', {});
  assert.equal(notifications.routineReceipts, 1);
  assert.ok(notifications.last.some(event => event.id === history[1].id));
  assert.ok(notifications.last.every(event => event.id !== history[0].id));
});

test('integration is a headless worker profile and Loom records the suite in the evidence card', async t => {
  const f = fixture(t);
  const d = f.daemon();
  t.after(d.shutdown);
  const { session: leader } = await f.spawn(d, 'leader', 'L');
  await assert.rejects(f.spawn(d, 'auditor', 'BAD', undefined, { integration: true }), { code: 'invalid-arguments' });
  await assert.rejects(f.spawn(d, 'worker', 'TUI', leader.addr, { mode: 'tui', integration: true }), { code: 'invalid-arguments' });
  const { session: worker, workerProfile } = await f.spawn(d, 'worker', 'INTEGRATE', leader.addr, {
    integration: true, prompt: 'HOLD full suite',
  });
  assert.equal(workerProfile, 'integration');
  assert.equal(f.read(`loomd/sessions/${worker.addr}.json`).integration, true);
  await d.tick();
  assert.match(f.prompts.find(item => item.addr === worker.addr).input, /Integration profile.*\$TMPDIR.*evidence card/s);
  f.sessions.get(worker.addr).check('npm test', 10, 0);
  f.sessions.get(worker.addr).finish('DONE INTEGRATE\nnpm test exited 0');
  await d.tick();
  const checks = readArtifacts(f.project).cards(worker.addr).flatMap(card => card.data.verification.commands);
  assert.ok(checks.some(check => check.command === 'npm test' && check.result === 'passed'));
});

test('named worker tiers preserve the existing launch profiles across providers', async t => {
  for (const cli of ['codex', 'agy', 'claude', 'opencode']) await t.test(cli, async t => {
    const f = fixture(t);
    const d = f.daemon();
    t.after(d.shutdown);
    const { session: leader } = await f.spawn(d, 'leader', 'L');
    const baseline = await f.spawn(d, 'worker', 'BASE', leader.addr, { cli });
    const extended = await f.spawn(d, 'worker', 'EXTENDED', leader.addr, { cli, tier: 'integration' });
    assert.equal(baseline.workerTier, 'sandbox');
    assert.equal(extended.workerTier, 'integration');
    assert.equal(extended.workerProfile, 'integration');
    assert.equal(f.read(`loomd/sessions/${baseline.session.addr}.json`).integration, undefined);
    assert.equal(f.read(`loomd/sessions/${extended.session.addr}.json`).integration, true);
    const { workers } = await d.handle('board', {});
    assert.deepEqual(workers.map(row => row.workerTier), ['sandbox', 'integration']);
    await assert.rejects(f.spawn(d, 'worker', 'CONFLICT', leader.addr, { cli, tier: 'sandbox', integration: true }),
      { code: 'invalid-arguments' });
    await assert.rejects(f.spawn(d, 'worker', 'HOST', leader.addr, { cli, tier: 'host' }),
      { code: 'host-grant-required' });
    f.policy({ deny: [], preferred: [], roles: { worker: { tiers: { W: 'host' } } } });
    const host = await f.spawn(d, 'worker', 'HOST', leader.addr, { cli, tier: 'host', prompt: 'HOLD for host evidence' });
    assert.equal(host.workerTier, 'host');
    assert.deepEqual(host.hostGrant.write, []);
    assert.equal(f.read(`loomd/sessions/${host.session.addr}.json`).isolatedWorkerHome, false);
    assert.ok((await d.handle('board', {})).workers.some(row => row.addr === host.session.addr && row.workerTier === 'host'));
  });
});

test('the grant CLI routes authenticated Leader requests and reserves issuance for Super', async t => {
  const f = fixture(t);
  const d = f.daemon();
  t.after(d.shutdown);
  const { session: leader } = await f.spawn(d, 'leader', 'L');
  const { session: superRow } = await f.spawn(d, 'super', 'S');
  const { session: worker } = await f.spawn(d, 'worker', 'W', leader.addr);
  const run = await cliFor(t, f, () => d, leader.addr);
  const reason = 'Read-only account health check';
  const write = [join(f.project, 'output-a'), join(f.project, 'output-b')];
  const { stdout } = await run('grant', 'T-1', 'host', '--request', '--reason', reason, '--ttl', '30m',
    '--write', write[0], '--write', write[1], '--uses', '3');
  const { requested, notificationId } = JSON.parse(stdout);
  assert.deepEqual(requested, { target: 'T-1', tier: 'host', reason, uses: 3, ttlMs: 1_800_000, write, wave: false });
  const { notifications } = await d.handle('notifications', { history: true });
  const notice = notifications.find(item => item.id === notificationId);
  assert.deepEqual(notice.workerTierRequest, requested);
  assert.equal(notice.requestOriginVerified, true);
  assert.match(notice.text, /3 次/);
  const defaultRequest = await run('grant', 'W', 'host', '--request', '--wave', '--reason', reason);
  assert.equal(JSON.parse(defaultRequest.stdout).requested.uses, 1);
  await assert.rejects(run('grant', 'T-1', 'host', '--reason', reason), error => JSON.parse(error.stdout).error.code === 'forbidden');
  for (const caller of [leader.addr, worker.addr, undefined]) {
    await assert.rejects(d.handle('grant', { target: 'T-1', tier: 'host', reason }, caller, { external: false }), { code: 'forbidden' });
  }
  const issued = await d.handle('grant', { target: 'T-1', tier: 'host', reason }, superRow.addr);
  assert.equal(issued.grant.remaining, 1);
  assert.match(issued.warning, /not fail-closed for Codex tool paths/);
  await assert.rejects(d.handle('grant', { target: 'T-1', tier: 'host', reason, request: true }, worker.addr),
    { code: 'forbidden' });
  const spec = { target: 'T-1', tier: 'host', reason, request: true };
  for (const invalid of [{ ttl: '0' }, { uses: '0' }, { uses: '-1' }, { uses: '1.5' }, { uses: '9007199254740992' },
    { uses: null }, { write: ['relative/path'] }, { wave: true, write }]) {
    await assert.rejects(d.handle('grant', { ...spec, ...invalid }, leader.addr), { code: 'invalid-arguments' });
  }
  for (const tiers of [{ '*': 'host' }, { W: 'full' }, { W: { tier: 'host', write } }]) {
    f.policy({ deny: [], preferred: [], roles: { worker: { tiers } } });
    await assert.rejects(f.spawn(d, 'worker', 'BADPOLICY', leader.addr), { code: 'invalid-policy' });
  }
});

test('host grants debit before launch, expire on conclusion, and save all observed shell commands', async t => {
  const f = fixture(t);
  const d = f.daemon();
  t.after(d.shutdown);
  const spec = { target: 'PROBE', tier: 'host', reason: 'Read-only fixture', write: [join(f.project, 'output')] };
  const { grant } = await d.handle('grant', spec);
  const { session } = await f.spawn(d, 'worker', spec.target, undefined, { tier: 'host', prompt: 'HOLD' });
  await assert.rejects(f.spawn(d, 'worker', spec.target, undefined, { tier: 'host' }), { code: 'host-grant-exhausted' });
  assert.deepEqual(f.read('loomd/host-grants.json').grants[0].claims.map(claim => claim.addr), [session.addr]);
  await d.tick();
  f.sessions.get(session.addr).check('/usr/bin/true', 10, 0);
  f.sessions.get(session.addr).finish('DONE PROBE');
  await d.tick();
  const history = (await d.handle('notifications', { history: true })).notifications.filter(event => event.grantId === grant.id);
  assert.deepEqual(history.map(event => event.type), ['host-tier-grant', 'host-tier-used', 'host-tier-refused', 'host-tier-expired']);
  assert.match(history[0].text, /not fail-closed for Codex tool paths/);
  const evidence = f.read(`evidence/PROBE-host-${session.addr}.json`);
  assert.equal(evidence.verification.host.grantId, grant.id);
  assert.deepEqual(evidence.verification.host.commands.map(({ command, exitCode }) => [command, exitCode]), [['/usr/bin/true', 0]]);
  await assert.rejects(f.spawn(d, 'worker', spec.target, undefined, { tier: 'host' }), { code: 'host-grant-expired' });
});

test('unconfined host grants require Super and surface unconfined in receipts, notices, status and board', async t => {
  const f = fixture(t);
  const d = f.daemon();
  t.after(d.shutdown);
  const { session: leader } = await f.spawn(d, 'leader', 'L');
  const { session: superRow } = await f.spawn(d, 'super', 'S');
  const { session: worker } = await f.spawn(d, 'worker', 'W', leader.addr);
  const cli = await cliFor(t, f, () => d, leader.addr);
  const reason = 'Run nested srt and PTY isolation check';
  const req = JSON.parse((await cli('grant', 'CELL-1', 'host', '--request', '--unconfined', '--reason', reason)).stdout);
  assert.equal(req.requested.unconfined, true);
  assert.match((await d.handle('notifications', { history: true })).notifications.find(n => n.id === req.notificationId).text, /host \(unconfined\)/);
  await assert.rejects(cli('grant', 'CELL-1', 'host', '--unconfined', '--reason', reason),
    error => JSON.parse(error.stdout).error.code === 'forbidden');
  for (const caller of [leader.addr, worker.addr, undefined]) {
    await assert.rejects(d.handle('grant', { target: 'CELL-1', tier: 'host', reason, unconfined: true }, caller, { external: false }),
      { code: 'forbidden' });
  }
  await assert.rejects(cli.as(superRow.addr, 'grant', 'CELL-1', 'host', '--unconfined'),
    error => JSON.parse(error.stdout).error.code === 'invalid-arguments');
  await assert.rejects(d.handle('grant', { target: 'CELL-1', tier: 'host', reason, unconfined: 'yes' }, superRow.addr),
    { code: 'invalid-arguments' });
  const { stdout } = await cli.as(superRow.addr, 'grant', 'CELL-1', 'host', '--unconfined', '--reason', reason);
  const issued = JSON.parse(stdout);
  assert.equal(issued.grant.unconfined, true);
  assert.equal(issued.grant.remaining, 1);
  assert.match(issued.warning, /unconfined/i);
  const spawned = await f.spawn(d, 'worker', 'CELL-1', leader.addr, { cli: 'agy', tier: 'host', prompt: 'HOLD' });
  assert.equal(spawned.workerTier, 'host');
  assert.equal(spawned.unconfined, true);
  assert.equal(spawned.hostGrant.unconfined, true);
  const state = await d.handle('state', { target: spawned.session.addr });
  assert.equal(state.workerTier, 'host');
  assert.equal(state.unconfined, true);
  const board = await d.handle('board', {});
  assert.ok(board.workers.some(row => row.addr === spawned.session.addr && row.workerTier === 'host' && row.unconfined === true));
  const statusRpc = await d.handle('status', {});
  assert.ok(statusRpc.sessions.some(row => row.addr === spawned.session.addr && row.workerTier === 'host' && row.unconfined === true));
  const { projectStatus, printStatus } = await import('../cli/status.mjs');
  const status = await projectStatus(f.project);
  assert.ok(status.sessions.some(row => row.addr === spawned.session.addr && row.workerTier === 'host' && row.unconfined === true));
  const lines = [];
  const origLog = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try { printStatus({ ...status, project: f.project }); } finally { console.log = origLog; }
  assert.match(lines.join('\n'), /Elevated workers · .*host\/unconfined · CELL-1/);
  await assert.rejects(f.spawn(d, 'worker', 'CELL-1', leader.addr, { cli: 'agy', tier: 'host' }), { code: 'host-grant-exhausted' });
  await d.tick();
  f.sessions.get(spawned.session.addr).finish('DONE CELL-1');
  await d.tick();
  const history = (await d.handle('notifications', { history: true })).notifications.filter(event => event.grantId === issued.grant.id);
  assert.deepEqual(history.map(event => event.type), ['host-tier-grant', 'host-tier-used', 'host-tier-refused', 'host-tier-expired']);
  for (const event of history) {
    assert.equal(event.unconfined, true);
    assert.match(event.text, /Host \(unconfined\)/);
  }
  const evidence = f.read(`evidence/CELL-1-host-${spawned.session.addr}.json`);
  assert.equal(evidence.verification.host.unconfined, true);
});

test('keeps the predecessor active and releases queued work when the first briefing turn lacks the acknowledgement', async t => {
  const f = fixture(t);
  const d = f.daemon();
  t.after(d.shutdown);
  const { session: old } = await f.spawn(d, 'leader', 'OLD');
  await d.tick();
  f.sessions.get(old.addr).finish('Ready');
  const { session: next } = await f.spawn(d, 'leader', 'NEXT', undefined, { 'handover-from': old.addr });
  const queued = await d.handle('send', { target: old.addr, mode: 'queue', text: 'HOLD next work' });
  await d.tick();
  f.sessions.get(next.addr).finish('I received part of the brief');
  await d.tick();
  assert.equal((await d.handle('state', { target: next.addr })).state, 'closed');
  assert.equal(f.prompts.find(item => deliveryId(item.input) === queued.id).addr, old.addr);
  assert.ok((await d.handle('notifications', { history: true })).notifications.some(event =>
    event.type === 'leader-handover-failed' && event.reason === 'first-turn-missing-acknowledgement'));
  const { projectStatus } = await import('../cli/status.mjs');
  const { exits } = await projectStatus(f.project);
  assert.equal(exits.find(item => item.addr === next.addr)?.reason, 'first-turn-missing-acknowledgement');
  assert.ok(!exits.some(item => item.addr === old.addr));
  await f.spawn(d, 'leader', 'RETRY', undefined, { 'handover-from': old.addr });
});

test('loom status clears the legacy release path when the acknowledged Leader successor takes over', async t => {
  const f = fixture(t);
  let d = f.daemon();
  t.after(() => d.shutdown());
  const { session: old } = await f.spawn(d, 'leader', 'OLD');
  await d.shutdown();
  const jobPath = `loomd/sessions/${old.addr}.json`;
  const job = f.read(jobPath);
  delete job.launchPaths;
  writeFileSync(join(f.project, '.project', jobPath), JSON.stringify(job));
  writeFileSync(join(f.project, '.project/loomd/upgrade.json'), JSON.stringify({ phase: 'committed', finishedAt: Date.now() + 1000 }));
  d = f.daemon();
  const cli = await cliFor(t, f, () => d, '');
  const status = () => cli('status').then(result => result.stdout);
  assert.match(await status(), /Release paths · leader .*legacy CLI path/);
  await d.tick();
  const { session: next } = await f.spawn(d, 'leader', 'NEW', undefined, { 'handover-from': old.addr });
  await d.tick();
  assert.match(await status(), /awaiting handover acknowledgement/);
  f.sessions.get(next.addr).finish(handoverBrief(f, next.addr).ack);
  await d.tick();
  assert.match(await status(), /Release paths · none/);
  assert.equal(f.read(`loomd/sessions/${next.addr}.json`).launchPaths.cli, join(f.project, '.project/loomd/bin/loom'));
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
  assert.deepEqual(external, []);
  assert.ok((await d.handle('notifications', {})).notifications.some(event => event.type === 'continuation-timeout'));

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
  assert.match(f.prompts.filter(row => row.addr === leader)[2].input, /^\[loom:[0-9a-f-]{36}\]\nmanaged Super second(?=$|\n)(?:\n\n背景笔记，仅供参考，使用前核验(?:\n\[(?:add|update|withdraw)\] - memory-(?:event-[0-9a-f]{64}|\d+|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})(?: — [^\r\n\u2028\u2029]+)?(?: \[[^\]\r\n\u2028\u2029]+ @ [^\]\r\n\u2028\u2029]+\])?)+(?:\n增量已截断，剩余变更将在后续投递。)?)?$/);
  f.sessions.get(leader).finish('second Super answer');
  await d.tick();
  assert.match(f.prompts.filter(row => row.addr === leader)[3].input, /ordinary worker mail$/);
  const waves = f.read('inbox/state.json').messages.filter(message => message.waveBatch);
  assert.equal(waves.length, 1);
  assert.equal(waves[0].combinedInto, priority.id);
  assert.equal(waves[0].phase, 'received');
});

test('delivered workers release by Leader or TTL and resume Codex, agy, Claude and OpenCode by native ID', async t => {
  let advance = 0;
  const f = fixture(t, { now: () => Date.now() + advance });
  f.policy({ workers: { idleRetainMs: 60_000 }, delivery: { coalesceMs: 0 }, roles: { leader: { maxActiveWorkers: 4 } } });
  let d = f.daemon();
  t.after(() => d.shutdown());
  const { session: leader } = await f.spawn(d, 'leader', 'L');
  await d.tick();
  const workers = [];
  for (const cli of ['codex', 'agy', 'claude', 'opencode']) {
    const opened = await f.spawn(d, 'worker', cli, leader.addr, { cli, prompt: 'RETURN DONE ' + cli, reason: 'fresh context' });
    assert.equal(opened.dispatch, 'new');
    assert.equal(opened.dispatchReason, 'fresh context');
    workers.push(opened.session);
  }
  const [codex, agy, claude, opencode] = workers;
  const state = worker => d.handle('state', { target: worker.addr });
  const release = worker => d.handle('release', { target: worker.task }, leader.addr);
  await d.handle('keep', { target: claude.task }, leader.addr);
  for (let i = 0; i < 3; i++) await d.tick();
  advance = 61_000;
  await d.tick();
  assert.equal((await state(codex)).state, 'idle-warm');
  assert.equal((await state(codex)).retention.remainingMs, null);
  await assert.rejects(release(codex), { code: 'not-ready' });

  advance = 0;
  f.sessions.get(leader.addr).finish('Ready');
  await d.tick();
  // The result has landed natively but the next daemon scan has yet to run.
  assert.equal((await release(codex)).state, 'offline');
  for (let i = 0; i < 3; i++) await d.tick();
  const retained = (await state(agy)).retention;
  assert(retained.remainingMs > 0);
  advance = 61_000;
  await d.tick();
  assert.equal((await state(agy)).state, 'offline');
  assert.equal((await state(opencode)).state, 'offline');
  assert.equal((await state(claude)).state, 'idle-warm');
  await d.handle('keep', { target: claude.task, keep: false }, leader.addr);
  await d.tick();
  assert.equal((await state(claude)).state, 'offline');

  const attempts = await Promise.all(workers.map(worker => state(worker)));
  assert(attempts.every(attempt => attempt.retention.resumable));
  await d.shutdown();
  d = f.daemon();
  await d.tick();
  assert.equal((await state(codex)).state, 'offline');
  const counts = (await d.handle('board', {})).workerMetrics.find(row => row.gate === 'W');
  assert.deepEqual([counts.newSpawns, counts.leader, counts.ttl], [4, 1, 3]);
  for (const worker of workers.slice(1)) {
    const revived = await d.handle('assign', { target: worker.task }, leader.addr);
    assert.equal(revived.dispatch, 'revived');
    assert.equal(revived.session.sessionId, worker.sessionId);
    assert.equal(revived.session.cwd, worker.cwd);
  }
  const id = randomUUID();
  const args = { id, target: codex.task, text: 'HOLD follow-up', mode: 'queue' };
  assert.equal((await d.handle('send', args, leader.addr)).dispatch, 'revived');
  assert.equal((await d.handle('send', args, leader.addr)).dispatch, 'revived');
  await d.tick();
  assert.equal((await state(codex)).state, 'working');
  await assert.rejects(release(codex), { code: 'not-ready' });
  assert.equal(f.prompts.filter(item => deliveryId(item.input) === id).length, 1);
  for (const worker of workers) assert.equal(f.resumes.filter(id => id === worker.sessionId).length, 1);
});

test('starts retention for a BLOCKED result after the parent reads the result and allows release and resume', async t => {
  let advance = 0;
  const f = fixture(t, { now: () => Date.now() + advance });
  f.policy({ workers: { idleRetainMs: 60_000 }, delivery: { coalesceMs: 0 } });
  const d = f.daemon();
  t.after(d.shutdown);
  const { session: leader } = await f.spawn(d, 'leader', 'L');
  await d.tick();
  const { session: worker } = await f.spawn(d, 'worker', 'BLOCKED', leader.addr, { prompt: 'HOLD worker' });
  const { session: released } = await f.spawn(d, 'worker', 'BLOCKED-REL', leader.addr, { prompt: 'HOLD worker release' });
  await d.tick();
  f.sessions.get(leader.addr).finish('dispatch ended');
  f.sessions.get(worker.addr).finish('BLOCKED cannot continue');
  f.sessions.get(released.addr).finish('BLOCKED release directly');
  await d.tick();
  await d.tick();
  const result = await d.handle('state', { target: worker.addr });
  assert.equal(result.lastResultTag, 'BLOCKED');
  assert.equal(result.retention.eligible, true);
  assert.ok(result.retention.idleSince != null);
  assert.ok(result.retention.remainingMs > 0);
  assert.equal((await d.handle('release', { target: released.addr }, leader.addr)).state, 'offline');
  advance = 61_000;
  await d.tick();
  const offline = await d.handle('state', { target: worker.addr });
  assert.equal(offline.state, 'offline');
  assert.equal(offline.retention.resumable, true);
  const revived = await d.handle('assign', { target: worker.task }, leader.addr);
  assert.equal(revived.dispatch, 'revived');
  assert.equal(revived.session.sessionId, worker.sessionId);
});

test('starts retention, reports UNCONFIRMED to Leader, and releases on TTL when the parent result receipt is missing', async t => {
  let advance = 0;
  const f = fixture(t, { now: () => Date.now() + advance });
  f.policy({ workers: { idleRetainMs: 1_200_000 }, delivery: { coalesceMs: 0 } });
  const d = f.daemon();
  t.after(d.shutdown);
  const { session: leader } = await f.spawn(d, 'leader', 'L');
  await d.tick();
  const { session: worker } = await f.spawn(d, 'worker', 'UNCONFIRMED', leader.addr, { prompt: 'HOLD worker' });
  await d.tick();
  // Keep Leader busy on its startup turn so the worker's wave delivery cannot obtain a native receipt.
  f.sessions.get(worker.addr).finish('DONE worker');
  await d.tick();
  await d.tick();
  advance = 300_000;
  await d.tick();
  const waiting = await d.handle('state', { target: worker.addr });
  assert.equal(waiting.lastResultTag, 'DONE');
  assert.equal(waiting.retention.remainingMs, null);
  await assert.rejects(d.handle('release', { target: worker.addr }, leader.addr), { code: 'not-ready' });

  advance = 601_000;
  await d.tick();
  const result = await d.handle('state', { target: worker.addr });
  assert.equal(result.lastResultTag, 'UNCONFIRMED');
  assert.equal(result.retention.eligible, true);
  assert.ok(result.retention.idleSince != null);
  assert.ok(result.retention.remainingMs > 0);
  const messages = f.read('inbox/state.json').messages;
  assert.ok(messages.some(message => message.target.addr === leader.addr &&
    message.workerNoticeId?.startsWith(`worker-result-unconfirmed:${worker.addr}:`) &&
    /UNCONFIRMED/.test(message.text)));
  assert.ok((await d.handle('notifications', { history: true })).notifications.some(event =>
    event.type === 'worker-result-unconfirmed' && event.addr === worker.addr));

  advance = 1_201_000;
  await d.tick();
  const offline = await d.handle('state', { target: worker.addr });
  assert.equal(offline.state, 'offline');
  assert.equal(offline.retention.resumable, true);
  const revived = await d.handle('assign', { target: worker.task }, leader.addr);
  assert.equal(revived.dispatch, 'revived');
  assert.equal(revived.session.sessionId, worker.sessionId);
});

test('backfills idleSince on hot-upgrade reattach for adopted legacy workers without retention metadata', async t => {
  let advance = 0;
  const f = fixture(t, { now: () => Date.now() + advance });
  f.policy({ workers: { idleRetainMs: 60_000 }, delivery: { coalesceMs: 0 } });
  let d = f.daemon();
  t.after(() => d.shutdown());
  const { session: leader } = await f.spawn(d, 'leader', 'L');
  await d.tick();
  const { session: doneWorker } = await f.spawn(d, 'worker', 'LEGACY-DONE', leader.addr, { prompt: 'HOLD done' });
  const { session: blockedWorker } = await f.spawn(d, 'worker', 'LEGACY-BLOCKED', leader.addr, { prompt: 'HOLD blocked' });
  await d.tick();
  f.sessions.get(leader.addr).finish('dispatch ended');
  f.sessions.get(doneWorker.addr).finish('DONE legacy');
  f.sessions.get(blockedWorker.addr).finish('BLOCKED legacy');
  for (let i = 0; i < 3; i++) await d.tick();
  const doneEnd = readArtifacts(f.project).journal(doneWorker.addr).findLast(event => event.type === 'turn-end').at;
  const blockedEnd = readArtifacts(f.project).journal(blockedWorker.addr).findLast(event => event.type === 'turn-end').at;
  await d.shutdown();
  // Simulate pre-WORKER-REAP-1 stored session files that have no retention metadata.
  for (const addr of [doneWorker.addr, blockedWorker.addr]) {
    const path = join(f.project, '.project', 'loomd', 'sessions', `${addr}.json`);
    const job = JSON.parse(readFileSync(path, 'utf8'));
    delete job.retention;
    writeFileSync(path, JSON.stringify(job) + '\n');
  }
  d = f.daemon();
  await d.reattach([]);
  const adoptedDone = await d.handle('state', { target: doneWorker.addr });
  const adoptedBlocked = await d.handle('state', { target: blockedWorker.addr });
  assert.equal(adoptedDone.retention.idleSince, doneEnd);
  assert.ok(adoptedDone.retention.remainingMs > 0);
  assert.equal(adoptedBlocked.retention.idleSince, blockedEnd);
  assert.ok(adoptedBlocked.retention.remainingMs > 0);
  advance = 61_000;
  await d.tick();
  assert.equal((await d.handle('state', { target: doneWorker.addr })).state, 'offline');
  assert.equal((await d.handle('state', { target: blockedWorker.addr })).state, 'offline');
});

test('alerts Leader and Super explicitly when idle workers survive twice their TTL and clears counts on release', async t => {
  let advance = 0;
  const external = [];
  const f = fixture(t, { now: () => Date.now() + advance, externalNotification: async (name, batch) => { external.push({ name, batch }); } });
  f.policy({ workers: { idleRetainMs: 1_000 }, delivery: { coalesceMs: 0 } });
  const d = f.daemon();
  t.after(d.shutdown);
  const { session: superSession } = await f.spawn(d, 'super', 'S');
  const { session: leader } = await f.spawn(d, 'leader', 'L');
  await d.tick();
  const { session: kept } = await f.spawn(d, 'worker', 'TIMEOUT-KEEP', leader.addr, { prompt: 'HOLD worker', 'keep-warm': true });
  await d.tick();
  f.sessions.get(leader.addr).finish('dispatch ended');
  f.sessions.get(kept.addr).finish('DONE worker');
  await d.tick();
  await d.tick();
  // Also spawn a worker whose result has no parent receipt yet (ineligible for TTL release).
  const { session: stuck } = await f.spawn(d, 'worker', 'TIMEOUT-INELIGIBLE', leader.addr, { prompt: 'HOLD stuck' });
  await d.tick();
  await d.handle('send', { target: leader.addr, mode: 'queue', text: 'HOLD leader busy' });
  await d.tick();
  f.sessions.get(stuck.addr).finish('DONE without receipt');
  await d.tick();
  advance = 2_500;
  await d.tick();
  const board = await d.handle('board', {});
  const status = await d.handle('status', {});
  assert.equal(board.releaseTimeoutCount, 2);
  assert.equal(status.releaseTimeoutCount, 2);
  assert.ok(board.workers.find(row => row.addr === kept.addr).releaseTimedOut);
  assert.ok(board.workers.find(row => row.addr === stuck.addr).releaseTimedOut);
  assert.equal(board.attention.filter(item => item.kind === 'release-timeout').length, 2);
  const notices = (await d.handle('notifications', { history: true })).notifications
    .filter(event => event.type === 'worker-release-timeout');
  assert.equal(notices.length, 2);
  assert.ok(notices.every(event => event.pushRoute === superSession.addr));
  const messages = f.read('inbox/state.json').messages;
  assert.equal(messages.filter(message => message.target.addr === leader.addr &&
    message.workerNoticeId?.startsWith('worker-release-timeout:')).length, 2);
  assert.ok(messages.some(message => message.target.addr === superSession.addr &&
    message.projectEvents?.some(id => id.startsWith(`worker-release-timeout:${kept.addr}:`))));
  // Releasing one timed-out worker must clear its timeout flag and decrement the count.
  await d.handle('keep', { target: kept.addr, keep: false }, leader.addr);
  await d.tick();
  assert.equal((await d.handle('state', { target: kept.addr })).state, 'offline');
  assert.equal((await d.handle('board', {})).releaseTimeoutCount, 1);
  assert.equal((await d.handle('status', {})).releaseTimeoutCount, 1);
  assert.equal(external.length, 0);
});

test('invariant [persistence] retention unconfirmed and release-timeout alerts persist once across restart', async t => {
  let advance = 0;
  const f = fixture(t, { now: () => Date.now() + advance });
  f.policy({ workers: { idleRetainMs: 1_200_000 }, delivery: { coalesceMs: 0 } });
  let d = f.daemon();
  t.after(() => d.shutdown());
  const { session: leader } = await f.spawn(d, 'leader', 'L');
  await d.tick();
  const { session: worker } = await f.spawn(d, 'worker', 'PERSIST', leader.addr, { prompt: 'HOLD worker', 'keep-warm': true });
  await d.tick();
  f.sessions.get(worker.addr).finish('DONE worker');
  await d.tick();
  // Simulate a missing native delivery receipt on the parent wave delivery (e.g. refused/lost receipt).
  const inboxPath = join(f.project, '.project', 'inbox', 'state.json');
  const inboxState = JSON.parse(readFileSync(inboxPath, 'utf8'));
  for (const message of inboxState.messages) {
    if (message.resultWorkers?.includes(worker.addr)) {
      message.phase = 'refused';
      message.issue = 'input-refused';
      message.refusedAt = Date.now();
    }
  }
  writeFileSync(inboxPath, JSON.stringify(inboxState) + '\n');
  await d.shutdown();
  d = f.daemon();
  advance = 601_000;
  await d.tick();
  advance = 2_401_000;
  await d.tick();
  const before = await d.handle('state', { target: worker.addr });
  assert.equal(before.lastResultTag, 'UNCONFIRMED');
  assert.equal(before.retention.releaseTimedOut, true);
  await d.shutdown();
  d = f.daemon();
  await d.reattach([]);
  await d.tick();
  await d.tick();
  const after = await d.handle('state', { target: worker.addr });
  assert.equal(after.retention.idleSince, before.retention.idleSince);
  assert.equal(after.retention.resultUnconfirmedAt, before.retention.resultUnconfirmedAt);
  assert.equal(after.retention.releaseTimeoutAt, before.retention.releaseTimeoutAt);
  const notices = (await d.handle('notifications', { history: true })).notifications;
  assert.equal(notices.filter(event => event.type === 'worker-result-unconfirmed' && event.addr === worker.addr).length, 1);
  assert.equal(notices.filter(event => event.type === 'worker-release-timeout' && event.addr === worker.addr).length, 1);
  const messages = f.read('inbox/state.json').messages;
  assert.equal(messages.filter(message => message.workerNoticeId?.startsWith(`worker-result-unconfirmed:${worker.addr}:`)).length, 1);
  assert.equal(messages.filter(message => message.workerNoticeId?.startsWith(`worker-release-timeout:${worker.addr}:`)).length, 1);
});

test('keeps a planned follow-up warm and closes only approved waves after pending work settles', async t => {
  let verdict = 'REJECT same-file fix needed';
  const f = fixture(t, { auditVerdict: () => verdict });
  f.git('init', '-q');
  f.git('-c', 'user.name=Loom', '-c', 'user.email=loom@example.invalid', 'commit', '--allow-empty', '-qm', 'fixture');
  f.policy({ workers: { warmMs: { codex: 0, agy: 300_000 } }, delivery: { coalesceMs: 0 } });
  const d = f.daemon();
  t.after(d.shutdown);
  const { session: leader } = await f.spawn(d, 'leader', 'L');
  await d.tick();
  f.sessions.get(leader.addr).finish('Ready');
  const { session: auditor } = await f.spawn(d, 'auditor', 'A');
  const { session: warm } = await f.spawn(d, 'worker', 'WARM', leader.addr,
    { 'keep-warm': true, prompt: 'HOLD write tests' });
  const { session: long } = await f.spawn(d, 'worker', 'OTHER', leader.addr,
    { cli: 'agy', wave: 'OTHER', prompt: 'RETURN DONE elsewhere' });
  await d.tick();
  f.sessions.get(warm.addr).context(225_000);
  f.sessions.get(warm.addr).finish('DONE tests first');
  for (let i = 0; i < 4; i++) await d.tick();
  const state = async row => d.handle('state', { target: row.addr });
  const before = await state(warm);
  assert.equal(before.state, 'idle-warm');
  assert.equal(before.retention.keepWarm, true);
  assert.equal(before.contextPercent, 75);
  assert.equal(before.lastResultTag, 'DONE');
  assert((await state(long)).retention.remainingMs > 250_000);
  assert(f.prompts.some(({ addr, input }) => addr === leader.addr &&
    /WARM · idle-warm · kept warm · context 75% · DONE/.test(input)));

  await d.handle('gate-pack', { gate: 'W' }, leader.addr);
  for (let i = 0; i < 3; i++) await d.tick();
  assert.equal((await state(warm)).state, 'idle-warm');
  f.sessions.get(leader.addr).finish('NOREPLY');
  assert.equal((await d.handle('release', { target: warm.task }, leader.addr)).state, 'offline');
  const fix = await d.handle('send', { target: warm.task, mode: 'queue', text: 'HOLD implement tests' }, leader.addr);
  assert.equal(fix.dispatch, 'revived');
  const { session: fresh } = await f.spawn(d, 'worker', 'FRESH', leader.addr, { prompt: 'RETURN DONE second fix' });
  await assert.rejects(d.handle('release', { target: warm.task }, leader.addr), { code: 'not-ready' });
  await d.tick();
  verdict = 'APPROVE wave W';
  const approval = await d.handle('gate-pack', { gate: 'W', round: 2 }, leader.addr);
  for (let i = 0; i < 3; i++) await d.tick();
  assert.equal((await state(warm)).state, 'working');
  const packet = f.read('inbox/state.json').messages.find(message => message.id === approval.deliveryId);
  assert.equal(packet.target.addr, auditor.addr);
  assert.match(packet.completion.body, /^APPROVE/);
  f.sessions.get(warm.addr).context(60_000);
  f.sessions.get(warm.addr).finish('DONE implementation');
  f.sessions.get(leader.addr).finish('NOREPLY');
  for (let i = 0; i < 5; i++) await d.tick();
  const closed = await state(warm);
  assert.equal(closed.state, 'closed');
  assert.equal(closed.retention.closeReason, 'gate-approved');
  assert.equal(closed.retention.resumable, false);
  await assert.rejects(d.handle('assign', { target: warm.task }, leader.addr), { code: 'not-ready' });
  assert.equal((await state(long)).state, 'idle-warm');
  const metrics = (await d.handle('board', {})).workerMetrics.find(entry => entry.gate === 'W');
  assert.equal((await state(fresh)).state, 'closed');
  assert.equal(metrics.closed, 2);
  assert.equal(metrics.ttl, 0);
  assert.deepEqual(metrics.fixAfterReject, {
    new: { rounds: 1, decided: 1, approved: 1 },
    revived: { rounds: 1, decided: 1, approved: 1 },
  });
});

test('cross-card reuse has separate limits from a same-card step handoff', async t => {
  const f = fixture(t);
  f.policy({ delivery: { coalesceMs: 0 } });
  const d = f.daemon();
  t.after(d.shutdown);
  const { session: leader } = await f.spawn(d, 'leader', 'L');
  await d.tick();
  f.sessions.get(leader.addr).finish('Ready');
  const { session: first } = await f.spawn(d, 'worker', 'CONTEXT', leader.addr, { prompt: 'HOLD first card' });
  const { session: second } = await f.spawn(d, 'worker', 'COMPACTED', leader.addr,
    { 'keep-warm': true, prompt: 'HOLD second card' });
  await d.tick();
  const runtime = f.sessions.get(first.addr);
  const compacted = f.sessions.get(second.addr);
  const state = row => d.handle('state', { target: row.addr });
  runtime.context(180_000);
  runtime.finish('DONE first card');
  compacted.context(60_000);
  compacted.compact();
  compacted.compact();
  for (let i = 0; i < 3; i++) await d.tick();
  assert.equal((await state(first)).reuse, 'reusable');
  const waiting = await state(second);
  assert.equal(waiting.state, 'working');
  assert.equal(waiting.compactions, 2);
  assert.equal(waiting.reuse, 'same-card-only');
  assert.equal(waiting.handoff, undefined);
  await assert.rejects(d.handle('send', { target: second.task, mode: 'queue', text: 'HOLD next card', nextCard: true },
    leader.addr), { code: 'not-ready' });
  const stillActive = await d.handle('assign', { target: second.task }, leader.addr);
  assert.equal(stillActive.dispatch, 'continued');
  assert.equal(stillActive.session.sessionId, second.sessionId);

  const continued = await d.handle('send', { target: first.task, mode: 'queue', text: 'HOLD adjacent small card',
    nextCard: true, reason: 'same area and worktree' }, leader.addr);
  assert.equal(continued.dispatch, 'continued');
  assert.equal(continued.nextCard, true);
  await d.tick();
  const acceptance = { wip: 'Finish the parser', passed: 'Parser unit tests', pending: 'Integration suite' };
  runtime.context(270_000);
  await assert.rejects(d.handle('worker-handoff', acceptance, first.addr), { code: 'not-ready' });
  runtime.compact();
  await assert.rejects(d.handle('worker-handoff', acceptance, first.addr), { code: 'not-ready' });
  runtime.context(255_000);
  await assert.rejects(d.handle('worker-handoff', acceptance, first.addr), { code: 'not-ready' });
  runtime.context(255_001);
  await d.tick();
  assert.equal((await state(first)).state, 'working');
  assert.equal((await state(first)).handoff.reason, 'context-after-compaction');
  const { handoff } = await d.handle('worker-handoff', acceptance, first.addr);
  const sheet = readFileSync(handoff.path, 'utf8');
  assert.match(sheet, /Branch .*\nBase SHA .*\nWIP lines .*\nRulings /);
  assert.match(sheet, /Finish the parser[\s\S]*Parser unit tests[\s\S]*Integration suite[\s\S]*HOLD adjacent small card/);
  assert.equal((await state(first)).state, 'working');
  runtime.finish('BLOCKED handoff ready');
  compacted.finish('DONE despite compaction');
  for (let i = 0; i < 6; i++) await d.tick();
  const finished = await Promise.all([state(first), state(second)]);
  assert.deepEqual(finished.map(value => value.state), ['closed', 'idle-warm']);
  assert.equal(finished[0].retention.closeReason, 'worker-handoff');
  await assert.rejects(d.handle('assign', { target: first.task }, leader.addr), { code: 'not-ready' });
  await d.handle('keep', { target: second.task, keep: false }, leader.addr);
  await assert.rejects(d.handle('send', { target: second.task, mode: 'queue', text: 'HOLD next card', nextCard: true }, leader.addr),
    { code: 'worker-not-reusable' });
  const sameCard = await d.handle('send', { target: second.task, mode: 'queue', text: 'HOLD R1 local fix' }, leader.addr);
  assert.equal(sameCard.dispatch, 'continued');
  await d.tick();
  compacted.context(261_000);
  const secondSheet = await d.handle('worker-handoff', { wip: 'R1 fix', passed: 'none', pending: 'rerun fixture' }, second.addr);
  assert.equal(secondSheet.handoff.reason, 'context-after-compaction');
  compacted.finish('BLOCKED handoff ready');
  for (let i = 0; i < 4; i++) await d.tick();
  const metrics = (await d.handle('board', {})).workerMetrics.find(entry => entry.gate === 'W');
  assert.deepEqual([metrics.crossCardReuses, metrics.workerHandoffs, metrics.thresholdRetirements], [1, 2, 2]);
  assert(metrics.averageRetirementContextPercent > 85 && metrics.averageRetirementContextPercent < 87);
});

test('cross-card reuse accepts one compaction and rejects verified facts and scope violations on the current card', async t => {
  const f = fixture(t);
  f.git('init', '-q', '-b', 'verified');
  writeFileSync(join(f.project, 'allowed.txt'), 'baseline\n');
  writeFileSync(join(f.project, '.gitignore'), '*.jsonl\n');
  f.git('add', 'allowed.txt', '.gitignore');
  f.git('-c', 'user.name=Loom', '-c', 'user.email=loom@example.invalid', 'commit', '-qm', 'fixture');
  f.policy({ delivery: { coalesceMs: 0 }, drift: { factMiss: false } });
  writeFileSync(join(f.project, '.project/evidence.json'), JSON.stringify({ allowedPaths: ['allowed.txt', 'adjacent.txt'],
    tasks: { PARSER: { allowedPaths: ['allowed.txt'] } } }));
  const d = f.daemon();
  t.after(d.shutdown);
  const { session: leader } = await f.spawn(d, 'leader', 'L');
  await d.tick();
  f.sessions.get(leader.addr).finish('Ready');
  const { session: worker } = await f.spawn(d, 'worker', 'PARSER', leader.addr, { prompt: 'HOLD parser changes' });
  const { session: overreach } = await f.spawn(d, 'worker', 'SCOPE', leader.addr, { prompt: 'HOLD scope test' });
  await d.tick();
  const first = f.sessions.get(worker.addr);
  const next = title => ({ target: worker.addr, mode: 'queue', nextCard: true, text: `HOLD ${title}` });
  const state = target => d.handle('state', { target });
  first.compact();
  first.context(180_001);
  first.finish('DONE original parser card');
  for (let i = 0; i < 4; i++) await d.tick();
  assert.equal((await state(worker.addr)).retirementReason, 'context-limit');
  await assert.rejects(d.handle('send', next('over limit'), leader.addr), { code: 'worker-not-reusable' });
  await d.handle('send', { target: worker.addr, mode: 'queue', text: 'HOLD original card follow-up' }, leader.addr);
  await d.tick();
  first.context(180_000);
  first.finish('DONE local fix');
  for (let i = 0; i < 4; i++) await d.tick();
  assert.equal((await state(worker.addr)).reuse, 'reusable');
  const continued = await d.handle('send', next('adjacent parser card'), leader.addr);
  assert.equal(continued.nextCard, true);
  await d.tick();
  writeFileSync(join(f.project, 'outside.txt'), 'out-of-scope change\n');
  f.sessions.get(overreach.addr).context(40_000);
  f.sessions.get(overreach.addr).finish('DONE scope report');
  rmSync(join(f.project, 'outside.txt'));
  writeFileSync(join(f.project, 'adjacent.txt'), 'new card change within project scope\n');
  first.finish('DONE added `./missing.mjs`');
  for (let i = 0; i < 5; i++) await d.tick();
  assert.equal((await state(overreach.addr)).retirementReason, 'previous-card-overreach');
  assert.equal((await state(overreach.addr)).handoff.reason, 'overreach');
  assert.equal((await state(worker.addr)).retirementReason, 'previous-card-fact-error');
  const summary = f.read('loomd/org.json').workerFindings;
  assert(Object.values(summary[continued.deliveryId]).some(finding => finding.kind === 'fact-error'));
  assert.equal(Object.values(summary).flatMap(Object.values).filter(finding => finding.kind === 'fact-error').length, 1);
  await assert.rejects(d.handle('send', next('another parser card'), leader.addr), { code: 'worker-not-reusable' });
});

test('Leader can prepare a replacement after 10 minutes without native progress or on a verified incident', async t => {
  let clock;
  const f = fixture(t, { now: () => clock ?? Date.now() });
  const d = f.daemon();
  t.after(d.shutdown);
  const { session: leader } = await f.spawn(d, 'leader', 'L');
  await d.tick();
  f.sessions.get(leader.addr).finish('Ready');
  const { session: worker } = await f.spawn(d, 'worker', 'STALLED', leader.addr, { prompt: 'HOLD active turn' });
  await d.tick();
  const target = worker.addr;
  const runtime = f.sessions.get(target);
  const status = () => d.handle('state', { target });
  const cli = await cliFor(t, f, () => d, leader.addr);
  const turnStart = readArtifacts(f.project).journal(worker.addr).find(event => event.type === 'turn-start').at;
  clock = turnStart + 599_999;
  await assert.rejects(d.handle('worker-handoff', { target }, leader.addr), { code: 'not-ready' });
  clock = turnStart + 600_000;
  const { handoff } = JSON.parse((await cli('worker-handoff', target)).stdout);
  assert.equal(handoff.reason, 'no-progress');
  assert.equal(handoff.ready, false);
  assert.match(readFileSync(handoff.path, 'utf8'), /Reason no-progress[\s\S]*HOLD active turn/);
  assert.equal((await status()).state, 'working');
  runtime.check('/usr/bin/true', 0, 0, clock);
  await d.tick();
  await assert.rejects(d.handle('worker-handoff', { target }, leader.addr), { code: 'not-ready' });
  assert.equal((await status()).handoff, undefined);
  const report = { target, reason: 'fabrication', evidence: 'Original check log contradicts the reported result.' };
  await assert.rejects(d.handle('worker-handoff', report, worker.addr), { code: 'invalid-arguments' });
  await assert.rejects(d.handle('worker-handoff', { target, reason: 'fabrication' }, leader.addr), { code: 'invalid-arguments' });
  const verified = JSON.parse((await cli('worker-handoff', target, '--reason', report.reason, '--evidence', report.evidence)).stdout).handoff;
  assert.equal(verified.reason, 'fabrication');
  assert.match(readFileSync(verified.path, 'utf8'), /Verified finding\nOriginal check log/);
  assert.equal((await status()).state, 'working');
  assert.equal((await status()).retirementReason, 'previous-card-overreach');
  await d.handle('stop', { target }, leader.addr);
  assert.equal((await status()).state, 'closed');
});

test('new Worker verifies checkout, WIP and rulings and a mismatch blocks its first report', async t => {
  const f = fixture(t);
  f.git('init', '-q', '-b', 'verified');
  writeFileSync(join(f.project, 'parser.txt'), 'tracked contents\n');
  f.git('add', 'parser.txt');
  f.git('-c', 'user.name=Loom', '-c', 'user.email=loom@example.invalid', 'commit', '-qm', 'fixture');
  writeFileSync(join(f.project, '.project/rulings.md'), 'R1. Keep parser fixtures.\n');
  writeMemory(f.project, { id: 'parser', owner: 'leader', scope: 'project', title: 'Parser fixtures',
    keywords: 'parser', source: 'parser.txt', verified: '2025-01-01', body: 'Check the parser fixtures first.' });
  f.policy({ delivery: { coalesceMs: 0 } });
  const d = f.daemon();
  t.after(d.shutdown);
  const { session: leader } = await f.spawn(d, 'leader', 'L');
  await d.tick();
  f.sessions.get(leader.addr).finish('Ready');
  const { session: worker, checkpoint } = await f.spawn(d, 'worker', 'VERIFIED', leader.addr, { prompt: 'HOLD parser' });
  assert.equal(checkpoint.branch, 'verified');
  assert.equal(checkpoint.baseSha, f.git('rev-parse', 'HEAD'));
  await d.tick();
  const verified = (await d.handle('worker-check', {}, worker.addr)).firstReportCheck;
  assert.equal(verified.source, 'worker');
  assert.deepEqual(verified.actual, checkpoint);
  assert(f.prompts.some(({ addr, input }) => addr === worker.addr && /Keep parser fixtures[\s\S]*Check the parser fixtures first/.test(input)));
  f.sessions.get(worker.addr).finish('DONE first report');
  for (let i = 0; i < 3; i++) await d.tick();

  const { session: stale } = await f.spawn(d, 'worker', 'STALE', leader.addr);
  f.git('switch', '-qc', 'changed');
  f.git('-c', 'user.name=Loom', '-c', 'user.email=loom@example.invalid', 'commit', '--allow-empty', '-qm', 'changed base');
  writeFileSync(join(f.project, 'parser.txt'), 'tracked contents\nnew WIP line\n');
  writeFileSync(join(f.project, '.project/rulings.md'), 'R1. Changed parser ruling.\n');
  for (let i = 0; i < 6; i++) await d.tick();
  const state = await d.handle('state', { target: stale.addr });
  assert.deepEqual(state.firstReportCheck.mismatches, ['branch', 'baseSha', 'wipLines', 'rulingsDigest']);
  assert.equal(state.retention.closeReason, 'first-report-mismatch');
  assert.equal(f.prompts.some(({ addr }) => addr === stale.addr), false);
  assert(f.prompts.some(({ addr, input }) => addr === leader.addr &&
    /BLOCKED STALE[\s\S]*Worker first-report mismatch/.test(input)));

  const { session: inFlight } = await f.spawn(d, 'worker', 'IN-FLIGHT', leader.addr, { prompt: 'HOLD first edit' });
  await d.tick();
  writeFileSync(join(f.project, 'parser.txt'), 'tracked contents\nnew WIP line\nanother WIP line\n');
  await assert.rejects(d.handle('worker-check', {}, inFlight.addr), { code: 'worker-first-report-mismatch' });
  assert.equal((await d.handle('state', { target: inFlight.addr })).state, 'working');
  f.sessions.get(inFlight.addr).finish('DONE misleading first report');
  for (let i = 0; i < 5; i++) await d.tick();
  const stopped = await d.handle('state', { target: inFlight.addr });
  assert.equal(stopped.retention.closeReason, 'first-report-mismatch');
  assert.equal(stopped.lastResultTag, 'BLOCKED');
  assert.deepEqual(readArtifacts(f.project).cards(inFlight.addr), []);
  assert(f.prompts.some(({ addr, input }) => addr === leader.addr &&
    /BLOCKED IN-FLIGHT[\s\S]*Worker first-report mismatch: wipLines/.test(input)));
});

test('an opt-in resident compaction limit proposes rotation at the idle card boundary', async t => {
  const f = fixture(t);
  f.policy({ roles: { leader: { rotateAtCompactions: 1 } } });
  const d = f.daemon();
  t.after(d.shutdown);
  const { session: leader } = await f.spawn(d, 'leader', 'L');
  await d.tick();
  const runtime = f.sessions.get(leader.addr);
  runtime.compact();
  await d.tick();
  assert.equal((await d.handle('board', {})).roles.find(row => row.addr === leader.addr).rotationDue, true);
  assert.throws(() => f.read('loomd/self-rotation.json'), { code: 'ENOENT' });
  runtime.finish('Card boundary');
  await d.tick();
  assert.equal(f.read('loomd/self-rotation.json')[leader.addr].signal.reason, 'compaction');
});

test('invariant [persistence] audit-only findings are counted once, survive restart, and need a regression before phase completion', async t => {
  const f = fixture(t);
  let d = f.daemon();
  t.after(() => d.shutdown());
  const { session: leader } = await f.spawn(d, 'leader', 'L');
  const { session: auditor } = await f.spawn(d, 'auditor', 'A');
  const record = { phase: 'INTEGRATE', id: 'fingerprint', category: 'retry',
    evidence: 'The retry branch lost its last write fingerprint.' };
  await assert.rejects(d.handle('audit-findings', record, leader.addr), { code: 'invalid-arguments' });
  const cli = await cliFor(t, f, () => d, auditor.addr);
  const filed = JSON.parse((await cli('audit-findings', record.phase, '--id', record.id, '--category', record.category,
    '--evidence', record.evidence)).stdout);
  assert.deepEqual(filed.byCategory, { retry: { reviewOnly: 1, open: 1 } });
  await d.handle('audit-findings', record, auditor.addr);
  await assert.rejects(d.handle('audit-findings', { ...record, evidence: 'Different claim' }, auditor.addr), { code: 'id-conflict' });
  await assert.rejects(d.handle('notifications', { gateComplete: record.phase }, leader.addr), { code: 'audit-findings-open' });
  await assert.rejects(d.handle('notifications', { phase: record.phase, complete: 'Complete' }, leader.addr), { code: 'audit-findings-open' });
  await d.shutdown();
  d = f.daemon();
  await d.reattach([]);
  const close = { phase: record.phase, id: record.id, regression: 'fingerprint.test.mjs' };
  await assert.rejects(d.handle('audit-findings', close, auditor.addr), { code: 'invalid-arguments' });
  writeFileSync(join(f.project, close.regression), "import test from 'node:test';\ntest('retry retains fingerprint', () => {});\n");
  const closed = JSON.parse((await cli('audit-findings', record.phase, '--id', record.id, '--regression', close.regression)).stdout);
  assert.equal(closed.findings[0].regression, close.regression);
  await d.handle('audit-findings', close, auditor.addr);
  assert.deepEqual((await d.handle('audit-findings', { phase: record.phase })).byCategory, { retry: { reviewOnly: 1, open: 0 } });
  assert.deepEqual((await d.handle('audit-findings', { phase: 'OTHER' })).byCategory, {});
  await d.handle('notifications', { gateComplete: record.phase }, leader.addr);
  await assert.rejects(d.handle('audit-findings', { ...record, id: 'post-close' }, auditor.addr), { code: 'not-ready' });
});

test('switches Claude Leader to agy and agy Auditor to Codex under one durable succession guard', async t => {
  const f = fixture(t);
  f.git('init', '-q');
  writeFileSync(join(f.project, 'actual.mjs'), 'export const accepted_metric = 1;\n');
  f.git('add', 'actual.mjs');
  f.git('-c', 'user.name=Loom', '-c', 'user.email=loom@example.invalid', 'commit', '-qm', 'fixture');
  const sha = f.git('rev-parse', 'HEAD');
  const profile = (cli, model, fast) => ({ cli, model, effort: 'high', mode: 'headless', fast });
  f.policy({ drift: { deferAuditorNotices: false }, roles: {
    leader: { preferred: [profile('claude', 'opus'), profile('agy', 'gemini', true)] },
    auditor: { rotateAt: 'gate', preferred: [profile('agy', 'gemini'), profile('codex', 'codex-model', true)] },
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
  await assert.rejects(d.handle('notifications', { gateComplete: 'tests-v1' }, auditor.addr), { code: 'invalid-arguments' });
  await d.handle('notifications', { gateComplete: 'tests-v1' }, switched.session.addr);
  const gates = await d.handle('notifications', { gateComplete: 'tests-v1', history: true }, switched.session.addr);
  assert.deepEqual(gates.notifications.filter(event => event.gate === 'tests-v1').map(event => event.type),
    ['gate-completed']);
  await assert.rejects(d.handle('switch', { role: 'auditor', to: '2' }), { code: 'rotation-in-progress' });
  await d.tick();
  const { ack } = handoverBrief(f, switched.session.addr);
  f.sessions.get(switched.session.addr).finish(ack + '\nCurrent SHA deadbee. Missing file `./absent.mjs`.');
  await d.tick();
  const rotation = () => d.handle('state', { target: switched.session.addr }).then(value => value.rotations[0]);
  assert.equal((await rotation()).firstReportMisses, 2);
  assert.equal((await rotation()).verifiedAt, null);
  await assert.rejects(d.handle('switch', { role: 'auditor', to: '2' }), { code: 'rotation-in-progress' });
  assert.equal(f.read('inbox/state.json').messages.filter(message => message.orgEvents).length, 0);
  await d.handle('send', { target: switched.session.addr, mode: 'queue', text: 'Please correct the report' });
  await d.tick();
  const fact = f.read('inbox/state.json').messages.find(message => message.orgEvents);
  assert.equal(fact.target.addr, switched.session.addr);
  assert.match(fact.orgAppendix, /fact-miss.*absent\.mjs/);
  f.sessions.get(switched.session.addr).finish('SHA ' + sha + ' in `actual.mjs` with metric `accepted_metric`.');
  await d.tick();
  assert.ok((await rotation()).verifiedAt);
  const nextAuditor = await d.handle('switch', { role: 'auditor', to: '2' });
  assert.equal(nextAuditor.handoverFrom, auditor.addr);
  assert.equal(nextAuditor.session.cli, 'codex');
  assert.equal(nextAuditor.selected.fast, true);
  await assert.rejects(d.handle('switch', { role: 'leader', to: '1' }), { code: 'rotation-in-progress' });
  const duringAuditor = await d.handle('send', { target: 'auditor', mode: 'queue', text: 'A user request during Auditor handover' });
  assert.equal(duringAuditor.addr, auditor.addr);
  await d.tick();
  assert.equal(f.read('inbox/state.json').messages.find(message => message.id === duringAuditor.id).phase, 'queued');
  const auditorAck = handoverBrief(f, nextAuditor.session.addr).ack;
  f.sessions.get(nextAuditor.session.addr).finish(auditorAck + '\nAuditor verified `actual.mjs`.');
  await d.tick();
  const state = await d.handle('state', { target: nextAuditor.session.addr });
  assert.deepEqual(state.rotations.map(item => [item.role, Boolean(item.verifiedAt)]), [['leader', true], ['auditor', true]]);
  await d.tick();
  assert.equal(f.read('inbox/state.json').messages.find(message => message.id === duringAuditor.id).target.addr, nextAuditor.session.addr);
  assert.ok((await d.handle('notifications', { history: true })).notifications.some(item => item.type === 'preferred-fallback'));
});

test('attaches drift to the next real Leader wake and suppresses a reply quoting the prior notices', async t => {
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
  appendFileSync(join(f.project, '.project', 'watch', 'events.jsonl'), JSON.stringify({
    type: 'stuck', incidentId: 'fixture-stuck', at: Date.now(), addr: worker, reason: 'fixture stalled',
  }) + '\n');
  budget(2);
  await d.tick();
  budget(3);
  writeFileSync(join(taskDir, 'PLAN-draft.md'), 'one\ntwo\nthree\n');
  writeFileSync(join(f.project, 'extra.txt'), 'one\ntwo\nthree\nfour\n');
  f.sessions.get(worker).check('npm test', 100, 1);
  f.sessions.get(worker).check('npm test', 500, 1);
  const missing = ['./unreal.mjs', ...Array.from({ length: 5 }, (_, i) => `./unreal-${i}.mjs`)];
  f.sessions.get(worker).finish('DONE DRIFT\nSee ' + missing.map(path => '`' + path + '`').join(', '));
  await d.tick();
  await d.tick();
  assert.equal(f.read('inbox/state.json').messages.filter(message => message.orgEvents).length, 0);
  assert.equal(f.prompts.filter(message => message.addr === auditor).length, 1);
  f.sessions.get(auditor).finish('Initial review completed.');
  await d.handle('send', { target: auditor, mode: 'queue', text: 'HOLD user audit update' });
  await d.tick();
  assert.doesNotMatch(f.prompts.filter(message => message.addr === auditor).at(-1).input, /drift and fact checks/);
  f.sessions.get(leader).finish('Initial dispatch complete');
  const wake = await d.handle('send', { target: leader, mode: 'queue', text: 'HOLD review the next real gate' });
  await d.tick();
  const notices = f.read('inbox/state.json').messages.filter(message => message.orgEvents);
  assert.equal(notices.length, 1);
  assert.equal(notices[0].id, wake.id);
  assert.equal(notices[0].target.addr, leader);
  for (const type of ['budget-raised', 'line-budget', 'plan-growth', 'slow-command', 'repeated-failure', 'fact-miss', 'stuck']) {
    assert.match(notices[0].orgAppendix, new RegExp(type));
  }
  const input = f.prompts.filter(message => message.addr === leader).at(-1).input;
  assert.match(input, /HOLD review the next real gate[\s\S]*Loom drift and fact checks/);
  f.sessions.get(leader).finish('Two prior misses, `./unreal.mjs` and `./unreal-0.mjs`, were false positives.');
  await d.tick();
  const evidence = Object.values(f.read('loomd/org.json').notices);
  assert.equal(evidence.length, 6);
  const drift = evidence.filter(item => item.type === 'fact-miss');
  assert.equal(drift.length, 1);
  assert.equal(drift[0].count, 6);
  assert.deepEqual(drift[0].misses.map(item => item.value), missing.slice(0, 5));
  assert.doesNotMatch(notices[0].orgAppendix, /unreal-4\.mjs/);
  assert.match(f.read('inbox/state.json').messages.find(message => message.waveBatch).text, /fact-miss 6 · \.\/unreal\.mjs/);
  const packet = await d.handle('gate-pack', { gate: 'W' }, leader);
  assert.match(readFileSync(packet.path, 'utf8'), /Drift and fact checks\n7 signals/);
});

test('test-first flags preserve red evidence while drift still counts unexpected failures', async t => {
  const f = fixture(t);
  const d = f.daemon();
  t.after(d.shutdown);
  writeFileSync(join(f.project, '.project', 'evidence.json'), JSON.stringify({ tasks: { 'RED-CONFIG': { expectRed: true } } }));
  const { session: leader } = await f.spawn(d, 'leader', 'L');
  await assert.rejects(f.spawn(d, 'reviewer', 'R', leader.addr, { 'expect-red': true }), { code: 'invalid-arguments' });
  for (const [task, options] of [['RED-SPAWN', { 'expect-red': true }], ['RED-CONFIG', {}], ['REGULAR', {}]]) {
    const { session: worker } = await f.spawn(d, 'worker', task, leader.addr, { ...options, prompt: 'HOLD test result' });
    await d.tick();
    const runtime = f.sessions.get(worker.addr);
    for (let i = 0; i < 2; i++) {
      runtime.check('npm test', 5, 1);
      runtime.check('npm run build', 5, 1);
    }
    runtime.finish(`DONE ${task}`);
    await d.tick();
  }
  const repeated = Object.values(f.read('loomd/org.json').notices).filter(notice => notice.type === 'repeated-failure');
  assert.deepEqual(repeated.filter(notice => notice.failureClass === 'test-failed').map(notice => notice.task), ['REGULAR']);
  assert.deepEqual(repeated.filter(notice => notice.failureClass === 'compile-failed').map(notice => notice.task).sort(),
    ['RED-CONFIG', 'RED-SPAWN', 'REGULAR']);
  const cards = (await import('node:fs')).readdirSync(join(f.project, '.project', 'evidence')).filter(path => path.endsWith('.json'));
  for (const task of ['RED-CONFIG', 'RED-SPAWN']) {
    const data = f.read('evidence/' + cards.find(path => path.startsWith(task + '-')));
    assert.equal(data.verification.expectRed, true);
    assert(data.verification.commands.some(command => command.result === 'failed' && command.command === 'npm test'));
  }
});

test('delivers a short digest pointer for a large automatic reply across restart', async t => {
  const f = fixture(t);
  f.policy({ delivery: { replyBytes: 200, coalesceMs: 0 } });
  let d = f.daemon();
  t.after(() => d.shutdown());
  const sender = (await f.spawn(d, 'super', 'S')).session.addr;
  const target = (await f.spawn(d, 'auditor', 'A')).session.addr;
  await d.tick();
  const body = 'DONE\n' + '完整结果🐙'.repeat(30);
  const send = await d.handle('send', { target, mode: 'queue', text: 'HOLD report', expectReply: true }, sender);
  await d.tick();
  f.sessions.get(target).finish(body);
  await d.tick();
  const automatic = () => f.read('inbox/state.json').messages.filter(message => message.replyTo === send.id);
  assert.equal(automatic().length, 1);
  d = f.daemon();
  await d.tick();
  const wire = f.prompts.find(message => message.addr === sender && deliveryId(message.input) === automatic()[0].id).input;
  assert.ok(Buffer.byteLength(wire) <= 200);
  const [, path, digest] = /(\.project\/replies\/([a-f0-9]{64})\.txt)/.exec(wire);
  const saved = readFileSync(join(f.project, path), 'utf8');
  assert.ok(saved.endsWith(body));
  assert.equal(payloadDigest(saved), digest);
  await d.tick();
  assert.equal(automatic().length, 1);

  const leader = (await f.spawn(d, 'leader', 'L')).session.addr;
  const worker = (await f.spawn(d, 'worker', 'LONG', leader)).session.addr;
  await d.tick();
  f.sessions.get(leader).finish('Ready');
  await d.tick();
  if (f.sessions.get(leader).session.status().value.kind === 'running') {
    f.sessions.get(leader).finish('Initial worker result read');
  }
  await d.tick();
  const long = '连续结果🐙'.repeat(1100);
  await d.handle('send', { target: worker, mode: 'queue', text: 'HOLD long continuation' }, leader);
  await d.tick();
  f.sessions.get(worker).finish(long);
  await d.tick();
  await d.tick();
  const continuation = f.read('inbox/state.json').messages.find(message => message.continuationKind === 'merged');
  const delivered = f.prompts.find(message => message.addr === leader && deliveryId(message.input) === continuation.id).input;
  const [, fullPath, fullDigest] = /(\.project\/replies\/([a-f0-9]{64})\.txt)/.exec(delivered);
  const fullReply = readFileSync(join(f.project, fullPath), 'utf8');
  assert.ok(Buffer.byteLength(delivered) <= 200);
  assert.ok(fullReply.endsWith(long));
  assert.equal(payloadDigest(fullReply), fullDigest);
});

test('an explicit senior reply preserves untagged work and carries suppression to the next real wake', async t => {
  const f = fixture(t);
  const d = f.daemon();
  t.after(d.shutdown);
  const leader = (await f.spawn(d, 'leader', 'L')).session.addr;
  const auditor = (await f.spawn(d, 'auditor', 'A')).session.addr;
  await d.tick();
  f.sessions.get(leader).finish('Startup complete');
  await d.tick();

  const ask = text => d.handle('send', { target: leader, mode: 'queue', text, expectReply: true }, auditor);
  const verdict = await ask('HOLD verdict');
  await d.tick();
  f.sessions.get(leader).finish('候选仍有阻断，需补充完整测试记录。');
  await d.tick();
  await d.tick();
  const automatic = f.read('inbox/state.json').messages.filter(row => row.replyTo === verdict.id);
  assert.equal(automatic.length, 1);
  assert.equal(automatic[0].target.addr, auditor);
  assert.match(f.prompts.find(row => deliveryId(row.input) === automatic[0].id).input,
    /未带结论标签\n\n候选仍有阻断，需补充完整测试记录。/);

  const ack = await ask('HOLD acknowledgement');
  await d.tick();
  f.sessions.get(leader).finish('收到，继续等待');
  await d.tick();
  assert.equal(f.read('inbox/state.json').messages.some(row => row.replyTo === ack.id), false);
  const state = await d.handle('state', { target: leader });
  assert.deepEqual(state.deliveries.find(row => row.id === ack.id).relay, { status: 'suppressed', reason: 'acknowledgement' });
  const { projectStatus } = await import('../cli/status.mjs');
  const status = await projectStatus(f.project);
  assert.deepEqual(status.suppressedReplies.map(({ id, from, reason }) => ({ id, from, reason })),
    [{ id: ack.id, from: auditor, reason: 'acknowledgement' }]);
  for (const text of ['next permitted wake', 'another permitted wake']) {
    await d.handle('send', { target: auditor, mode: 'queue', text });
    await d.tick();
    await d.tick();
  }
  const notices = f.prompts.filter(row => row.addr === auditor && row.input.includes(`reply to ${ack.id} suppressed (acknowledgement)`));
  assert.equal(notices.length, 1);
  assert.match(notices[0].input, /next permitted wake/);
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

test('overdue pilot-shaped holds reach Auditor once, are shown on worker cards, and follow the sender on its next wake', async t => {
  const pilotId = '57883071-cae2-a796-329c-d9354090c345';
  const handoverId = '5b58581e-f9a6-4b2d-bfe8-508056c06c1f';
  const at = Date.now();
  let time = at;
  const desktop = [];
  const f = fixture(t, { now: () => time, externalNotification: async (_, events) => desktop.push(...events) });
  let d = f.daemon();
  const { session: leader } = await f.spawn(d, 'leader', 'L');
  const { session: auditor } = await f.spawn(d, 'auditor', 'A');
  const { session: worker } = await f.spawn(d, 'worker', 'W', leader.addr);
  const binding = row => ({ addr: row.addr, backend: row.backend, provider: row.cli, createdAt: row.startedAt, cwd: row.cwd });
  await d.tick();
  f.sessions.get(leader.addr).finish('startup completed');
  await d.tick();
  for (const id of [pilotId, handoverId]) {
    publish(f.project, { id, text: 'held pilot replay', phase: 'sending', issue: 'uncertain',
      attemptAt: at, createdAt: at, mode: 'queue', requestedMode: 'queue', target: binding(leader),
      ...(id === pilotId && { from: binding(worker), waveBatch: 'pilot', resultWorkers: [worker.addr] }) });
  }
  time = at + 119_999;
  await d.tick();
  const stalls = async () => (await d.handle('notifications', { history: true })).notifications.filter(event => event.type === 'delivery-stalled');
  assert.equal((await stalls()).length, 0);
  time++;
  await d.tick();
  assert.deepEqual(new Set((await stalls()).map(event => event.deliveryId)), new Set([pilotId, handoverId]));
  await d.tick();
  await d.tick();
  const notices = f.read('inbox/state.json').messages.filter(message => message.deliveryEscalations);
  assert.equal(notices.length, 1);
  assert.equal(notices[0].target.addr, auditor.addr);
  assert(notices[0].deliveryEscalations.includes(pilotId));
  assert(notices[0].received);
  assert.deepEqual(desktop, []);
  const { projectStatus } = await import('../cli/status.mjs');
  const status = await projectStatus(f.project);
  assert.equal(status.cards.find(card => card.addr === worker.addr).state, 'result-undelivered');
  assert(status.stalledDeliveries.some(delivery => delivery.id === pilotId && delivery.ageMs >= 0));
  await d.handle('send', { target: worker.addr, mode: 'queue', text: 'next actual wake' });
  await d.tick();
  assert.match(f.prompts.find(prompt => prompt.input.includes('next actual wake')).input,
    new RegExp(`your message ${pilotId} to ${leader.addr} is not received`));
  await d.shutdown();
  d = f.daemon();
  await d.tick();
  assert.equal((await stalls()).filter(event => event.deliveryId === pilotId).length, 1);
  assert.equal(f.read('inbox/state.json').messages.filter(message => message.deliveryEscalations).length, 1);
  await d.shutdown();
});


test('a native question holds deliveries and reaches Auditor and desktop once after its bound', async t => {
  let time = Date.now();
  const desktop = [];
  const f = fixture(t, { now: () => time, externalNotification: async (_, events) => desktop.push(...events) });
  const d = f.daemon();
  t.after(() => d.shutdown());
  const { session: leader } = await f.spawn(d, 'leader', 'L');
  const { session: auditor } = await f.spawn(d, 'auditor', 'A');
  await d.tick();
  const answer = f.sessions.get(leader.addr).question('Pick ' + '决'.repeat(140), time);
  const { deliveryId: id } = await d.handle('send', { target: leader.addr, mode: 'queue', text: 'held while asking' });
  await d.tick();
  const expected = { cli: 'codex', kind: 'awaiting-choice', since: time, source: 'native',
    summary: 'Pick ' + '决'.repeat(115), options: 2 };
  const visible = await d.handle('status', {});
  assert.deepEqual(visible.sessions.find(row => row.addr === leader.addr).userPrompt, expected);
  assert.deepEqual((await d.handle('ls', {})).awaitingUser, [{ addr: leader.addr, ...expected }]);
  assert.equal((await d.handle('state', { target: leader.addr })).deliveries.find(row => row.deliveryId === id).reason,
    'target-awaiting-user');
  const notices = async () => (await d.handle('notifications', { history: true })).notifications
    .filter(event => event.type === 'target-awaiting-user');
  assert.equal((await notices()).length, 0);
  time += 120_000;
  await d.tick();
  await d.tick();
  await d.tick();
  const [notice] = await notices();
  assert.equal(notice.summary, expected.summary);
  assert.equal((await notices()).length, 1);
  assert.deepEqual(desktop.map(event => event.id), [notice.id]);
  assert.equal(f.read('inbox/state.json').messages.find(row => row.projectEvents?.includes(notice.id)).target.addr, auditor.addr);
  assert(!f.prompts.some(row => row.input.includes('held while asking')));
  answer();
  f.sessions.get(leader.addr).finish('question resolved');
  await d.tick();
  assert(f.prompts.some(row => row.input.includes('held while asking')));
  assert.deepEqual((await d.handle('ls', {})).awaitingUser, []);
});

async function v2Fixture(t, options) {
  let advance = 0;
  const reports = [];
  const f = fixture(t, { now: () => Date.now() + advance, report: message => reports.push(message) });
  f.policy({ rotation: { mode: 'v2', ...options } });
  const d = f.daemon();
  t.after(d.shutdown);
  f.git('init', '-qb', 'main');
  f.git('config', 'user.name', 'Test Fixture');
  f.git('config', 'user.email', 'fixture@example.invalid');
  writeFileSync(join(f.project, 'proof.txt'), 'Primary source\n');
  f.git('add', 'proof.txt');
  f.git('commit', '-qm', 'Original source');
  const { session: leader } = await f.spawn(d, 'leader', 'LEAD', undefined, { prompt: 'HOLD Leader startup' });
  const { session: auditor } = await f.spawn(d, 'auditor', 'AUD');
  const { session: superRole } = await f.spawn(d, 'super', 'SUPER');
  await d.tick();
  f.sessions.get(leader.addr).finish('Ready.');
  await d.tick();
  const note = async (row, outstanding = '') => {
    const { rotation } = await d.handle('rotate', { self: true, prepare: true }, row.addr);
    writeFileSync(rotation.notePath, rotation.requiredFields.map(field => `## ${field}\nChecked proof.txt.` +
      (field === 'Status' ? '\n' + Object.entries(rotation.repository).map(([name, value]) => `${name}: ${value}`).join('\n') : '')).join('\n\n') + outstanding);
    return rotation;
  };
  const command = (action, args = {}, actor = superRole) => d.handle('rotation-policy', { action, ...args }, actor.addr);
  const scope = phase => command('scope', { phase });
  const state = () => f.read('loomd/rotation-v2.json');
  const evidence = { detail: 'Checked original source', evidence: 'proof.txt:1' };
  const answer = next => [handoverBrief(f, next).ack, ...Object.entries(f.read(`loomd/sessions/${next}.json`).rotationFacts)
    .map(([name, value]) => `${name}: ${value}`)].join('\n');
  const verifyNote = async (row, id, verdict = 'pass') => {
    const delivery = () => f.read('inbox/state.json').messages.find(item => item.id === state().noteReviews?.[id]?.deliveryId);
    for (let attempts = 0; attempts < 4 && !delivery()?.received; attempts++) await d.tick();
    const item = delivery();
    assert.ok(item?.received, JSON.stringify({ review: state().noteReviews?.[id],
      delivery: item && { phase: item.phase, issue: item.issue, pending: item.pendingReason, target: item.target.addr } }));
    return command('verify-note', { target: row.addr, id, verdict, ...evidence }, row.role === 'leader' ? auditor : leader);
  };
  const rotate = async row => {
    const { rotation } = await d.handle('rotate', { self: true }, row.addr);
    await verifyNote(row, rotation.requestId);
    return rotation;
  };
  return { f, d, leader, auditor, superRole, note, scope, state, command, evidence, answer, rotate, verifyNote, reports,
    elapse: ms => { advance += ms; } };
}

test('v2 holds the predecessor read-only until the other senior verifies, then reroutes and delivers the first action', async t => {
  const { f, d, leader, auditor, superRole, note, scope, state, command, evidence, answer, verifyNote } = await v2Fixture(t);
  await scope('initial');
  const { notePath } = await note(leader);
  writeFileSync(notePath, 'Missing required headings.');
  await assert.rejects(d.handle('rotate', { self: true }, leader.addr), { code: 'rotation-note-required' });
  await note(leader, '\n\n## Do now\n- Continue card `CARD-NEXT`.');
  const { rotation: requested } = await d.handle('rotate', { self: true }, leader.addr);
  const queued = await d.handle('send', { target: leader.addr, mode: 'queue', text: 'HOLD resume card' }, superRole.addr);
  await d.tick();
  assert.deepEqual((await d.handle('state', { target: leader.addr })).rotations, []);
  await assert.rejects(command('verify-note', { target: leader.addr, id: requested.requestId, verdict: 'pass', ...evidence }),
    { code: 'permission-denied' });
  await verifyNote(leader, requested.requestId);
  await d.tick();
  await d.tick();
  const next = (await d.handle('state', { target: leader.addr })).rotations[0].successor;
  assert.equal(state().sessions[leader.addr].holding, next);
  assert.equal((await d.handle('state', { target: 'leader' })).addr, leader.addr);
  await assert.rejects(d.handle('send', { target: auditor.addr, mode: 'queue', text: 'restricted' }, leader.addr), { code: 'permission-denied' });
  await assert.rejects(d.handle('gate-pack', { gate: 'restricted' }, leader.addr), { code: 'permission-denied' });
  assert.match(recordSeniorToolDenial(seniorToolLog(f.project, leader.addr), f.project, leader.cwd, 'Bash',
    { command: 'git merge candidate' }), /仅|只允许/);
  const { brief } = handoverBrief(f, next);
  assert.match(brief, /当前事实卡[\s\S]*HEAD: [a-f0-9]{40}/);
  assert.match(brief, new RegExp(queued.id + ' reroute'));
  assert.match(brief, /^## Do now\n- Continue card `CARD-NEXT`\./);
  f.sessions.get(next).finish(answer(next));
  await d.tick();
  assert.equal((await d.handle('state', { target: 'leader' })).addr, leader.addr);
  assert.equal(f.read('inbox/state.json').messages.some(item => item.target.addr === next && item.rotationActivation), false);
  await assert.rejects(command('verify', { target: next, verdict: 'pass', ...evidence }), { code: 'permission-denied' });
  await command('verify', { target: next, verdict: 'pass', ...evidence }, auditor);
  await d.tick();
  await d.tick();
  assert.equal((await d.handle('state', { target: 'leader' })).addr, next);
  assert.equal((await d.handle('state', { target: leader.addr })).state, 'exited');
  assert.equal(f.read('inbox/state.json').messages.find(item => item.id === queued.id).target.addr, next);
  const activation = f.read('inbox/state.json').messages.find(item => item.target.addr === next && item.rotationVerification);
  assert.match(activation.text, /### Do now[\s\S]*CARD-NEXT/);
  assert.ok(f.prompts.some(item => item.addr === next && item.input.includes('立即执行交接单中触发条件已满足的首个动作')),
    JSON.stringify({ activation: activation && [activation.phase, activation.issue, activation.pendingReason, activation.typedAt],
      sent: f.prompts.filter(item => item.addr === next).map(item => item.input.slice(0, 370)) }));
  await assert.rejects(note(auditor), { code: 'rotation-phase-locked' });
  await scope('next');
  await assert.rejects(note(auditor), { code: 'rotation-phase-locked' });
  const packed = await d.handle('gate-pack', { gate: 'FIRST-DECISION' }, next);
  const decision = Object.values(state().handovers[next].decisions).find(item => item.subject === packed.deliveryId);
  assert.equal(decision.reviewer, auditor.addr);
  await assert.rejects(command('verify-decision', { target: next, id: decision.id, verdict: 'pass', ...evidence }),
    { code: 'permission-denied' });
  // A completed full phase still leaves its unverified first decisions with the older counterpart.
  await d.handle('notifications', { complete: 'First full phase finished', phase: 'next' }, superRole.addr);
  await d.tick();
  await assert.rejects(note(auditor), { code: 'rotation-phase-locked' });
  await command('verify-decision', { target: next, id: decision.id, verdict: 'pass', ...evidence }, auditor);
  await note(auditor);
  await assert.rejects(d.handle('switch', { role: 'worker', to: '1' }, next), { code: 'permission-denied' });
  await command('rule-change', { target: next, id: 'budget', ...evidence }, auditor);
  assert.ok(state().sessions[next].confirmations.budget);
});

test('v2 counterpart timeout escalates without a phase failure and permits a Super cancellation', async t => {
  const { f, d, auditor, note, scope, state, elapse, command, answer, rotate } = await v2Fixture(t);
  await scope('phase-1');
  await note(auditor);
  await rotate(auditor);
  await d.tick();
  await d.tick();
  const next = (await d.handle('state', { target: auditor.addr })).rotations[0].successor;
  f.sessions.get(next).finish(answer(next));
  await d.tick();
  elapse(30 * 60_000 + 10);
  await d.tick();
  await d.tick();
  assert.equal((await d.handle('state', { target: 'auditor' })).addr, auditor.addr);
  assert.ok(state().handovers[next].verificationTimedOutAt);
  assert.equal(state().handovers[next].failed, undefined);
  assert.equal(state().sessions[auditor.addr].holding, next);
  assert.deepEqual(state().projects[auditor.project].failures, {});
  assert.ok((await d.handle('notifications', { history: true })).notifications.some(item => item.reason === 'verification-timeout'));
  await command('abort', { target: next, detail: 'Restore prior Auditor' });
  await d.tick();
  await d.tick();
  assert.equal(state().handovers[next].failed.reason, 'verification-cancelled');
  assert.equal(state().sessions[auditor.addr].holding, undefined);
  assert.deepEqual(state().projects[auditor.project].failures, {});
});

test('v2 independently records spot checks, verified errors, and immediate unresolved protected-ref incidents', async t => {
  const { f, d, leader, auditor, command, state, evidence } = await v2Fixture(t, { protectedRefs: ['refs/heads/main'] });
  await assert.rejects(command('incident', { target: leader.addr, verdict: 'overreach', ...evidence }, leader), { code: 'permission-denied' });
  await command('spot-check', { target: leader.addr, verdict: 'ok', ...evidence }, auditor);
  await command('error', { target: leader.addr, ...evidence }, leader);
  assert.equal(state().sessions[leader.addr].errors, 1);
  await command('spot-check', { target: leader.addr, verdict: 'error', ...evidence, detail: 'A second fact was wrong' }, auditor);
  assert.ok(state().sessions[leader.addr].reasons['verified-error']);
  const status = await d.handle('status', {});
  assert.deepEqual(status.rotationPolicy[0].spotChecks, { ok: 1, error: 1 });
  const hold = await d.handle('send', { target: leader.addr, mode: 'queue', text: 'HOLD current Leader turn' });
  await d.tick();
  assert.ok(f.prompts.some(item => deliveryId(item.input) === hold.id));
  writeFileSync(join(f.project, 'proof.txt'), 'Updated source\n');
  f.git('add', 'proof.txt');
  f.git('commit', '-qm', 'Unapproved movement');
  await d.tick();
  await d.tick();
  const frozen = state().sessions[leader.addr].frozen;
  assert.equal(frozen.verdict, 'protected-ref-moved');
  const next = (await d.handle('state', { target: leader.addr })).rotations[0].successor;
  assert.ok(next);
  assert.match(handoverBrief(f, next).brief, /## Next action\n接管生效后向 Super 报告/);
  assert.equal(state().sessions[leader.addr].holding, next);
  await assert.rejects(d.handle('spawn', { role: 'worker' }, leader.addr), { code: 'permission-denied' });
});

test('v2 keeps ordinary gates outside the phase counter and consumes a fixed-SHA authorization once', async t => {
  const { f, d, leader, auditor, scope, state } = await v2Fixture(t, { protectedRefs: ['refs/heads/main'] });
  await scope('initial');
  await d.handle('notifications', { gateComplete: 'ordinary-1' }, leader.addr);
  await d.handle('notifications', { gateComplete: 'ordinary-2' }, leader.addr);
  assert.equal(state().projects[leader.project].phase, 1);
  assert.equal(state().sessions[leader.addr].reasons['phase-change'], undefined);
  f.git('switch', '-qc', 'fixture-candidate');
  writeFileSync(join(f.project, 'proof.txt'), 'Approved update\n');
  f.git('commit', '-qam', 'Prepared candidate');
  const candidate = f.git('rev-parse', 'HEAD');
  f.git('switch', '-q', 'main');
  await assert.rejects(d.handle('notifications', { gateComplete: 'approved', candidate }, leader.addr), { code: 'permission-denied' });
  await d.handle('gate-pack', { gate: 'approved', candidate }, leader.addr);
  await d.tick();
  f.sessions.get(auditor.addr).finish('APPROVE\nChecked this exact SHA.');
  await d.tick();
  const authorization = await d.handle('notifications', { gateComplete: 'approved', candidate }, leader.addr);
  assert.equal(authorization.authorized, true);
  f.git('merge', '--ff-only', 'fixture-candidate');
  await d.tick();
  const exact = Object.values(state().events).find(item => item.kind === 'gate-authorization');
  assert.equal(exact.candidate, candidate);
  assert.equal(exact.consumed, 'refs/heads/main');
  assert.equal(state().sessions[leader.addr].frozen, undefined);
  assert.equal(state().projects[leader.project].phase, 1);
  await scope('next');
  assert.equal(state().projects[leader.project].phase, 2);
  assert.equal(state().sessions[leader.addr].reasons['phase-change'], undefined);
  assert.ok(state().sessions[leader.addr].strict.phase);
});

test('v2 MISMATCH stops a handover immediately and locks out retries in the phase', async t => {
  const { f, d, leader, auditor, note, scope, state, rotate } = await v2Fixture(t);
  await scope('initial');
  await note(leader);
  await rotate(leader);
  await d.tick();
  await d.tick();
  const next = (await d.handle('state', { target: leader.addr })).rotations[0].successor;
  f.sessions.get(next).finish(handoverBrief(f, next).ack + '\nMISMATCH\nUnexpected HEAD.');
  await d.tick();
  assert.equal(state().handovers[next].failed.reason, 'first-report-mismatch');
  assert.equal((await d.handle('state', { target: 'leader' })).addr, leader.addr);
  await assert.rejects(note(auditor), { code: 'rotation-phase-locked' });
  assert.ok((await d.handle('notifications', { history: true })).notifications.some(item => item.reason === 'handover-failed'));
});

test('v2 attaches facts to a long-wait wake without making the wait a rotation reason', async t => {
  const { f, d, leader, superRole, state, elapse } = await v2Fixture(t, { longIdleMs: 30_000 });
  elapse(35_000);
  const message = await d.handle('send', { target: leader.addr, mode: 'queue', text: 'HOLD current facts' }, superRole.addr);
  await d.tick();
  const prompt = f.prompts.find(item => deliveryId(item.input) === message.id)?.input;
  assert.match(prompt, /当前事实卡[\s\S]*Branch: main/);
  assert.doesNotMatch(prompt, /换班提示/);
  assert.deepEqual(state().sessions[leader.addr].reasons, {});
});

test('v2 counts audit return streaks, user corrections and absolute live context independently', async t => {
  const { f, d, auditor, leader, superRole, command, state, evidence } = await v2Fixture(t, {
    highWaterTokens: { codex: 220_000 },
  });
  for (const [verdict, detail] of [['return', 'round 1'], ['pass', 'round 2'], ['return', 'round 3'],
    ['return', 'round 4'], ['return', 'round 5']]) await command('audit', { id: 'CARD', verdict, detail }, auditor);
  for (const detail of ['Correction one', 'Correction two', 'Correction three']) {
    await command('correction', { target: leader.addr, detail });
  }
  const notices = (await d.handle('notifications', { history: true })).notifications;
  assert.equal(notices.filter(item => item.reason === 'audit-returns').length, 1);
  assert.equal(notices.filter(item => item.reason === 'user-corrections').length, 1);
  assert.deepEqual(state().sessions[leader.addr].reasons, {});
  await command('ruling', { target: auditor.addr, ...evidence });
  assert.ok(state().sessions[auditor.addr].reasons['authority-ruling']);

  f.sessions.get(leader.addr).context(221_000);
  const wake = await d.handle('send', { target: leader.addr, mode: 'queue', text: 'HOLD absolute context' }, superRole.addr);
  await d.tick();
  assert.equal(state().sessions[leader.addr].highWater.tokens, 221_000);
  assert.match(f.prompts.find(item => deliveryId(item.input) === wake.id)?.input, /绝对高水位|只读核对/);
  assert.equal((await d.handle('state', { target: 'leader' })).addr, leader.addr);
  await assert.rejects(d.handle('gate-pack', { gate: 'held' }, leader.addr), { code: 'permission-denied' });
  const superEvents = Object.values(state().sessions).filter(item => item.highWater).length;
  assert.equal(superEvents, 1);
});

test('v2 confirms adjacent hard-constraint omissions on real dispatch IDs and waits for a clean boundary', async t => {
  const { f, d, leader, auditor, command, evidence, state, elapse, reports } = await v2Fixture(t);
  const dispatch = async task => {
    const { deliveryId } = await f.spawn(d, 'worker', task, leader.addr, { prompt: 'RETURN DONE ' + task });
    await d.tick();
    await d.tick();
    return deliveryId;
  };
  const flag = (id, actor = auditor, verdict = 'omitted') => command('constraint', { target: leader.addr, id, verdict, ...evidence }, actor);
  const a = await dispatch('A');
  const b = await dispatch('B');
  const c = await dispatch('C');
  await assert.rejects(flag(a, leader), { code: 'permission-denied' });
  await assert.rejects(flag(randomUUID()), { code: 'permission-denied' });
  await flag(a);
  await flag(a);
  await flag(b, auditor, 'present');
  await flag(c);
  assert.equal(state().sessions[leader.addr].reasons['constraint-omissions'], undefined);
  const hold = await d.handle('send', { target: leader.addr, mode: 'queue', text: 'HOLD ongoing decision' });
  await d.tick();
  assert.ok(f.prompts.some(item => deliveryId(item.input) === hold.id));
  const e = await dispatch('E');
  await flag(e);
  await d.tick();
  assert.equal(state().sessions[leader.addr].reasons['constraint-omissions'], e);
  const proposed = () => d.handle('notifications', { history: true }).then(result => result.notifications
    .filter(item => item.reason === 'constraint-omissions'));
  assert.equal((await proposed()).length, 0);
  f.sessions.get(leader.addr).finish('At the boundary.');
  elapse(31_000);
  await d.tick();
  await d.tick();
  assert.equal((await proposed()).length, 1, JSON.stringify({ reports, status: (await d.handle('state', { target: leader.addr })).state,
    holds: f.read('inbox/state.json').messages.filter(item => item.target.addr === leader.addr)
      .map(item => [item.phase, item.issue, Boolean(item.completion)]) }));
});

for (const source of ['compactions', 'runtime', 'phase']) test(`v2 ${source} switches on verification without scheduling rotation`, async t => {
  const { f, d, leader, superRole, scope, elapse, state } = await v2Fixture(t, { ledgerTurns: 2 });
  if (source === 'compactions') for (let i = 0; i < 3; i++) f.sessions.get(leader.addr).compact();
  if (source === 'runtime') elapse(48 * 60 * 60_000 + 100);
  if (source === 'phase') { await scope('integration'); await scope('regression'); }
  const send = () => d.handle('send', { target: leader.addr, mode: 'queue', text: 'HOLD verify wake' }, superRole.addr);
  const wake = await send();
  await d.tick();
  const body = f.prompts.find(item => deliveryId(item.input) === wake.id).input;
  assert.match(body, /加严核对.*SHA.*路径.*数值.*命令/);
  assert.doesNotMatch(body, /换班提示/);
  assert.equal(/换班评估/.test(body), source === 'compactions');
  assert.ok(state().sessions[leader.addr].strict[source]);
  assert.deepEqual(state().sessions[leader.addr].reasons, {});
  f.sessions.get(leader.addr).finish('I checked the facts.');
  await d.tick();
  const second = await send();
  await d.tick();
  const next = f.prompts.find(item => deliveryId(item.input) === second.id).input;
  assert.match(next, /自查裁决账本是否出现漂移/);
  assert.doesNotMatch(next, /加严核对：报告/);
});

test('v2 treats major-goal resets and ruling churn as context changes, not ordinary sub-phases', async t => {
  const { f, d, leader, auditor, scope, state, command } = await v2Fixture(t);
  const ledger = join(f.project, '.project/rulings.md');
  writeFileSync(ledger, '## 1 · Initial rule\n> Use the fixture.\n');
  await d.tick();
  await command('scope', { goal: 'major-one' });
  await scope('integration');
  await scope('regression');
  assert.deepEqual(state().sessions[leader.addr].reasons, {});
  appendFileSync(ledger, '\n## 2 · New rule\n- 取代 1\n> A change.\n');
  await d.tick();
  assert.equal(state().sessions[leader.addr].reasons['ruling-churn'], undefined);
  assert.deepEqual(state().sessions[leader.addr].overturnedRulings, { '2': '1' });
  appendFileSync(ledger, '\n## R3 · Another rule\n- Supersedes: R2\n> Another change.\n');
  await d.tick();
  await d.tick();
  assert.equal(state().sessions[leader.addr].reasons['ruling-churn'], '3');
  assert.equal(state().sessions[auditor.addr].reasons['ruling-churn'], '3');
  await command('scope', { goal: 'major-two' });
  assert.equal(state().sessions[leader.addr].reasons['major-goal-change'], 'major-two');
});

test('v2 probes stale or missing Git facts, then waits for the counterpart to confirm', async t => {
  const { f, d, leader, auditor, command, evidence, state } = await v2Fixture(t);
  const stale = f.git('rev-parse', 'HEAD');
  writeFileSync(join(f.project, 'proof.txt'), 'New head\n');
  f.git('commit', '-qam', 'New head');
  const missing = 'a'.repeat(40);
  const { deliveryId } = await f.spawn(d, 'worker', 'PROBE', leader.addr, { prompt:
    `HOLD\nHEAD: ${stale}\nCommit: ${missing}\nRead \`missing.txt\`.\nCreate \`src/planned.mjs\`.` });
  const hits = (await d.handle('status', {})).rotationPolicy[0].probes.filter(item => item.subject === deliveryId);
  assert.deepEqual(hits.map(item => item.finding.kind).sort(), ['path', 'sha', 'stale-sha']);
  assert.ok(hits.every(item => item.status === 'candidate'));
  assert.equal(state().sessions[leader.addr].errors, undefined);
  const args = { target: leader.addr, id: hits[0].id, ...evidence };
  await assert.rejects(command('error', args, leader), { code: 'permission-denied' });
  await command('error', args, auditor);
  await command('error', args, auditor);
  assert.equal(state().events[hits[0].id].status, 'confirmed');
  assert.equal(state().sessions[leader.addr].errors, 1);
});

test('v2 observes repeated causes on a worker slot without converting probe hits into facts', async t => {
  const { f, d, leader, state } = await v2Fixture(t, { repeatedWorkerFailures: 2 });
  for (const cause of ['temporary-failure', 'missing-fixture', 'missing-fixture']) {
    const { session } = await f.spawn(d, 'worker', 'SAME-SLOT', leader.addr, { prompt: 'HOLD worker attempt' });
    await d.tick();
    f.sessions.get(session.addr).finish('FAILED SAME-SLOT', { kind: 'failed', failure: cause });
    await d.tick();
    await d.tick();
  }
  const probes = Object.values(state().events).filter(item => item.source === 'worker-slot');
  assert.equal(probes.length, 1, JSON.stringify({ failures: state().sessions[leader.addr].workerFailures,
    dispatches: state().sessions[leader.addr].dispatches, observed: f.read('inbox/state.json').messages
      .filter(item => item.waveParent === leader.addr).map(item => [item.phase, item.issue, item.completion?.outcome, item.completion?.body]) }));
  assert.deepEqual(probes[0].finding, { kind: 'repeated-worker-failure', value: 'SAME-SLOT', cause: 'missing-fixture', count: 2 });
  assert.equal(probes[0].status, 'candidate');
  assert.deepEqual(state().sessions[leader.addr].reasons, {});
});

test('v2 reviews the exact note before launch and invalidates approval when HEAD changes', async t => {
  const { f, d, leader, auditor, note, verifyNote, state } = await v2Fixture(t);
  const { notePath } = await note(leader);
  appendFileSync(notePath, '\nRead `absent-note-source.txt`.\n');
  const { rotation } = await d.handle('rotate', { self: true }, leader.addr);
  await d.tick();
  assert.equal((await d.handle('state', { target: leader.addr })).rotations.length, 0);
  await assert.rejects(note(auditor), { code: 'rotation-phase-locked' });
  const candidate = Object.values(state().events).find(item => item.source === 'handover-note');
  assert.equal(candidate.finding.value, 'absent-note-source.txt');
  await verifyNote(leader, rotation.requestId);
  f.git('commit', '--allow-empty', '-qm', 'HEAD moved after the review');
  await d.tick();
  assert.equal(state().noteReviews[rotation.requestId].closed, true);
  assert.equal((await d.handle('state', { target: leader.addr })).rotations.length, 0);
  assert.equal(f.read('loomd/self-rotation.json')[leader.addr].noteChanged.reason, 'rotation-note-stale');
});

test('v2 releases the predecessor when a handover note review times out', async t => {
  const { f, d, leader, note, elapse, state } = await v2Fixture(t);
  await note(leader);
  const { rotation } = await d.handle('rotate', { self: true }, leader.addr);
  await d.tick();
  assert.ok(state().noteReviews[rotation.requestId]);
  elapse(31 * 60_000);
  await d.tick();
  await d.tick();
  assert.equal(state().noteReviews[rotation.requestId].closed, true);
  assert.equal(f.read('loomd/self-rotation.json')[leader.addr].request, undefined);
  assert.equal((await d.handle('state', { target: 'leader' })).addr, leader.addr);
  const history = (await d.handle('notifications', { history: true })).notifications;
  assert.equal(history.filter(item => item.reason === 'note-verification-timeout').length, 1);
});

test('T100 Auditor rotation resets wake budget without inheriting prior auditor turns', async t => {
  let time = Date.now();
  const f = fixture(t, { now: () => time });
  f.policy({ roles: { auditor: { maxWakesPerGate: 3, maxContextTokens: 150_000 } } });
  const d = f.daemon();
  t.after(d.shutdown);
  const { session: first } = await f.spawn(d, 'auditor', 'A1', undefined, {
    cli: 'codex', model: 'same-model', effort: 'low', prompt: 'HOLD startup',
  });
  await d.tick();
  time += 5_000;
  for (let i = 1; i <= 4; i++) await nativeCost(f, first, time + i * 100, 10);
  const { rotation: { notePath } } = await d.handle('rotate', { self: true, prepare: true }, first.addr);
  writeFileSync(notePath, 'Hand off active review without carrying over historical wakes.');
  await d.handle('rotate', { self: true, reason: 'shift handoff' }, first.addr);
  f.sessions.get(first.addr).finish('Ready to hand over.');
  await d.tick();
  await d.tick();
  const nextAddr = (await d.handle('state', { target: first.addr })).rotations[0].successor;
  const { ack } = handoverBrief(f, nextAddr);
  f.sessions.get(nextAddr).finish(ack);
  await d.tick();
  const history = (await d.handle('notifications', { history: true })).notifications;
  assert.ok(history.some(event => event.type === 'auditor-rotation-completed' && event.addr === nextAddr));
  assert.equal(history.filter(event => event.type === 'gate-completed').length, 0);

  const nextRow = f.read(`loomd/sessions/${nextAddr}.json`).row;
  time += 31_000;
  await nativeCost(f, nextRow, time - 1_000, 10);
  await d.tick();
  const budgets = (await d.handle('notifications', { history: true })).notifications
    .filter(event => event.type === 'auditor-budget-exceeded');
  assert.equal(budgets.length, 0, 'successor Auditor with 1 wake must not inherit retired Auditor turns');
});

test('T100 project-completed with phase resets Auditor wake budget and excludes prior alerts from new gate packets', async t => {
  let time = Date.now();
  const f = fixture(t, { now: () => time });
  const commit = name => f.git('-c', 'user.name=Loom', '-c', 'user.email=loom@example.invalid', 'commit', '-qm', name);
  f.git('init', '-q');
  writeFileSync(join(f.project, 'phase.mjs'), 'export const phase = 1;\n');
  f.git('add', 'phase.mjs');
  commit('phase-1-base');
  const base = f.git('rev-parse', 'HEAD');
  writeFileSync(join(f.project, 'phase.mjs'), 'export const phase = 2;\n');
  f.git('add', 'phase.mjs');
  commit('phase-2-candidate');
  const candidate = f.git('rev-parse', 'HEAD');

  f.policy({ roles: { auditor: { maxWakesPerGate: 3, maxContextTokens: 150_000 } } });
  const d = f.daemon();
  t.after(d.shutdown);
  await f.spawn(d, 'super', 'S');
  const { session: leader } = await f.spawn(d, 'leader', 'L');
  const { session: auditor } = await f.spawn(d, 'auditor', 'A');
  await d.tick();
  const budgets = async () => (await d.handle('notifications', { history: true })).notifications
    .filter(event => event.type === 'auditor-budget-exceeded');

  time += 31_000;
  for (let i = 3; i >= 1; i--) await nativeCost(f, auditor, time - i * 100, 10);
  await d.tick();
  const phase1Budgets = await budgets();
  assert.equal(phase1Budgets.length, 1);
  assert.equal(phase1Budgets[0].usage.wakes, 4);

  time += 1_000;
  const phaseCompleteAt = time;
  await d.handle('notifications', { complete: 'finished phase 1', phase: 'phase-1' }, auditor.addr);

  time += 31_000;
  await nativeCost(f, auditor, time - 1_000, 10);
  await d.tick();
  const phase2Budgets = await budgets();
  assert.equal(phase2Budgets.filter(event => (event.sampledAt ?? event.at) >= phaseCompleteAt).length, 0,
    'a single wake after project-completed(phase) must not trigger or refresh auditor-budget-exceeded');
  assert.equal(phase2Budgets[0].usage.wakes, 4, 'prior phase budget alert must not accumulate new phase wakes');

  const packet = await d.handle('gate-pack', { gate: 'PHASE-2', base, candidate, question: 'Verify phase 2.' }, leader.addr);
  const packetBody = readFileSync(packet.path, 'utf8');
  assert.doesNotMatch(packetBody, /Auditor 超出预算|auditor-budget-exceeded/,
    'prior phase budget alert must not pollute a new phase gate packet');
});

test('T103 Auditor wake budget re-alerts in a new cycle after rotation, phase completion, and explicit gate-complete using only new-cycle wakes', async t => {
  let time = Date.now();
  const f = fixture(t, { now: () => time });
  f.policy({ roles: { auditor: { maxWakesPerGate: 3, maxContextTokens: 150_000 } } });
  const d = f.daemon();
  t.after(d.shutdown);
  await f.spawn(d, 'super', 'S');
  const { session: leader } = await f.spawn(d, 'leader', 'L');
  const { session: first } = await f.spawn(d, 'auditor', 'A1', undefined, {
    cli: 'codex', model: 'same-model', effort: 'low', prompt: 'HOLD startup',
  });
  await d.tick();
  const budgets = async () => (await d.handle('notifications', { history: true })).notifications
    .filter(event => event.type === 'auditor-budget-exceeded');

  // Predecessor exceeds wake budget, then rotates to successor.
  time += 5_000;
  for (let i = 1; i <= 4; i++) await nativeCost(f, first, time + i * 100, 10);
  const { rotation: { notePath } } = await d.handle('rotate', { self: true, prepare: true }, first.addr);
  writeFileSync(notePath, 'Hand off active review cleanly.');
  await d.handle('rotate', { self: true, reason: 'shift handoff' }, first.addr);
  f.sessions.get(first.addr).finish('Ready to hand over.');
  await d.tick();
  await d.tick();
  const nextAddr = (await d.handle('state', { target: first.addr })).rotations[0].successor;
  const { ack } = handoverBrief(f, nextAddr);
  f.sessions.get(nextAddr).finish(ack);
  await d.tick();

  // Cycle 1 (after auditor-rotation-completed): 1 wake stays silent; 4 wakes triggers alert counting only new cycle.
  const nextRow = f.read(`loomd/sessions/${nextAddr}.json`).row;
  time += 31_000;
  await nativeCost(f, nextRow, time - 1_000, 10);
  await d.tick();
  assert.equal((await budgets()).length, 0, '1 wake after rotation must not alert');

  time += 31_000;
  for (let i = 3; i >= 1; i--) await nativeCost(f, nextRow, time - i * 100, 10);
  await d.tick();
  const afterRotation = await budgets();
  assert.equal(afterRotation.length, 1, 'exceeding limit in new cycle after rotation must alert');
  assert.equal(afterRotation[0].usage.wakes, 4, 'usage.wakes must count only new-cycle wakes after rotation');

  // Cycle 2 (after project-completed with phase): 1 wake stays silent; 4 wakes triggers a fresh alert with wakes=4.
  time += 1_000;
  await d.handle('notifications', { complete: 'finished phase 1', phase: 'phase-c3' }, nextAddr);
  time += 31_000;
  await nativeCost(f, nextRow, time - 1_000, 10);
  await d.tick();
  assert.equal((await budgets()).length, 1, '1 wake after project-completed(phase) must not alert');

  time += 31_000;
  for (let i = 3; i >= 1; i--) await nativeCost(f, nextRow, time - i * 100, 10);
  await d.tick();
  const afterPhase = await budgets();
  assert.equal(afterPhase.length, 2, 'exceeding limit in new cycle after phase completion must alert');
  assert.equal(afterPhase[1].usage.wakes, 4, 'usage.wakes must count only new-cycle wakes after phase completion');

  // Cycle 3 (after explicit --gate-complete): 1 wake stays silent; 4 wakes triggers a fresh alert with wakes=4.
  time += 1_000;
  await d.handle('notifications', { gateComplete: 'G-C3-RESET' }, leader.addr);
  time += 31_000;
  await nativeCost(f, nextRow, time - 1_000, 10);
  await d.tick();
  assert.equal((await budgets()).length, 2, '1 wake after explicit --gate-complete must not alert');

  time += 31_000;
  for (let i = 3; i >= 1; i--) await nativeCost(f, nextRow, time - i * 100, 10);
  await d.tick();
  const afterGateComplete = await budgets();
  assert.equal(afterGateComplete.length, 3, 'exceeding limit in new cycle after --gate-complete must alert');
  assert.equal(afterGateComplete[2].usage.wakes, 4, 'usage.wakes must count only new-cycle wakes after --gate-complete');
});
