import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Duplex } from 'node:stream';
import { test } from 'node:test';
import { projectCost } from '../cli/cost.mjs';
import { projectSessions } from '../cli/project.mjs';
import { projectStatus } from '../cli/status.mjs';
import { deliveryId } from '../inbox/message.mjs';
import { writeMemory } from '../memory/project.mjs';
import { createSupervisor } from './supervisor.mjs';

const keyRef = 'loom-memory-extractor-deepseek';
const fixtureKey = 'synthetic-test-key';
const baseURL = 'http://127.0.0.1/fixture/v1';
const model = 'fixture-extractor';
const turnUsage = { input: 13, output: 7 };

function fakeProvider(t, statusFor, usage) {
  const requests = [];
  const addresses = [];
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    requests.push({ path: req.url, method: req.method, headers: req.headers, raw });
    const content = JSON.stringify({ proposals: [] });
    const anthropic = req.url.endsWith('/messages');
    const envelope = anthropic ? {
      id: 'msg-fixture', type: 'message', role: 'assistant', model, stop_reason: 'end_turn',
      content: [{ type: 'text', text: content }],
      usage: { input_tokens: usage.input, output_tokens: usage.output },
    } : {
      id: 'chatcmpl-fixture', object: 'chat.completion', model,
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: usage.input, completion_tokens: usage.output, total_tokens: usage.input + usage.output },
    };
    res.writeHead(statusFor(requests.length), { 'content-type': 'application/json' });
    res.end(JSON.stringify(envelope));
  });
  async function fetch(input, init) {
    const wire = new Request(input, init);
    addresses.push(wire.url);
    assert.ok(wire.url.startsWith(baseURL + '/'), 'all HTTP must go to the configured fake provider');
    const body = Buffer.from(await wire.arrayBuffer());
    // Run Node's real HTTP client and server over a duplex pair. No socket is opened.
    const pipe = peer => new Duplex({
      read() {},
      write(chunk, _, done) { peer().push(chunk); done(); },
      final(done) { peer().push(null); done(); },
    });
    const client = pipe(() => receiver);
    const receiver = pipe(() => client);
    try {
      return await new Promise((resolve, reject) => {
        server.emit('connection', receiver);
        const req = request(wire.url, { method: wire.method, createConnection: () => client,
          headers: { ...Object.fromEntries(wire.headers), 'content-length': body.length } }, async res => {
          try {
            const chunks = [];
            for await (const chunk of res) chunks.push(chunk);
            resolve(new Response(Buffer.concat(chunks), { status: res.statusCode, headers: res.headers }));
          } catch (error) { reject(error); }
        });
        req.on('error', reject);
        req.end(body);
      });
    } finally {
      client.destroy();
      receiver.destroy();
    }
  }
  t.mock.method(globalThis, 'fetch', fetch);
  return { requests, addresses, fetch };
}

function fixture(t, { config = {}, statusFor = () => 200, usage = turnUsage, runStage } = {}) {
  const project = mkdtempSync(join(tmpdir(), 'loom-memory-extractor-'));
  const provider = fakeProvider(t, statusFor, usage);
  const keyReads = [];
  const sessions = new Map();
  const prompts = [];
  const logs = [];
  let clock = Date.UTC(2026, 10, 26, 12);
  const policy = { memory: { extractor: { format: 'openai', baseURL, model, keyRef, ...config } } };
  mkdirSync(join(project, '.project'));
  writeFileSync(join(project, '.project/policy.json'), JSON.stringify(policy));
  writeFileSync(join(project, 'fixture.txt'), 'file-content-sentinel');

  async function open(row) {
    const id = randomUUID();
    const path = join(project, id + '.jsonl');
    writeFileSync(path, '');
    let observer, active, seq = 0;
    const emit = (kind, fields = {}) => observer?.({ kind, ...fields, agentPath: [],
      sessionId: id, seq: seq++, receivedAt: clock, spanId: active?.turnId });
    function finish(reply, { tools = false, inputTokens = 40 } = {}) {
      assert.ok(active, 'fixture turn was dispatched');
      const { input, inputId, turnId } = active;
      const timestamp = new Date(clock).toISOString();
      const event = payload => ({ timestamp, type: 'event_msg', payload: { turn_id: turnId, ...payload } });
      const transcript = [event({ type: 'task_started' }), event({ type: 'user_message', message: input }),
        { timestamp, type: 'token_usage_record', payload: { turn_id: turnId, response_id: turnId,
          usage: { input_tokens: inputTokens, output_tokens: 10 } } }];
      if (tools) {
        const tool = { callId: 'read-fixture', toolName: 'read_file' };
        const output = 'tool-output-sentinel file-content-sentinel';
        emit('tool_call_started', { ...tool, input: { path: 'fixture.txt', metadata: 'tool-argument-sentinel' } });
        emit('tool_call_ended', { ...tool, output, exitCode: 0 });
        transcript.push(...[
          { type: 'function_call', name: tool.toolName, call_id: tool.callId, arguments: '{"path":"fixture.txt"}' },
          { type: 'function_call_output', call_id: tool.callId, output },
        ].map(payload => ({ timestamp, type: 'response_item', payload })));
      }
      transcript.push(event({ type: 'task_complete', last_agent_message: reply }));
      appendFileSync(path, transcript.map(record => JSON.stringify(record) + '\n').join(''));
      emit('text_delta', { phase: 'final_answer', text: reply });
      emit('turn_ended', { inputId, outcome: { kind: 'completed' } });
      active = undefined;
    }
    sessions.set(row.addr, { finish });
    return {
      id, records: () => [], nativeSessionFile: async () => path,
      events(fn) { observer = fn; return () => { observer = undefined; }; },
      status: () => ({ value: active ? { kind: 'running', sinceSeq: active.seq, lastEventAt: clock } : { kind: 'idle' } }),
      async prompt(input) {
        const requestId = randomUUID();
        active = { input, inputId: deliveryId(input), turnId: randomUUID(), seq };
        prompts.push({ addr: row.addr, input });
        emit('turn_started', { requestId, input });
        emit('turn_active', { inputId: active.inputId });
        return { kind: 'accepted', requestId, seq: seq - 1 };
      },
      async dispose() { emit('exited'); },
    };
  }

  // Proposed injection seams for the two external dependencies and the HTTP transport.
  const daemon = createSupervisor(project, { now: () => clock, sessionOptions: { open },
    report: message => logs.push(message), externalNotification: async () => {},
    memoryExtractorOptions: { fetch: provider.fetch, runStage, readKeychain(service, account) {
      keyReads.push([service, account]);
      assert.deepEqual([service, account], [keyRef, 'loom']);
      return fixtureKey;
    } },
  });
  t.after(async () => {
    try { await daemon.shutdown(); }
    finally { rmSync(project, { recursive: true, force: true }); }
  });
  async function tick() {
    for (let i = 0; i < 3; i++) await daemon.tick();
  }
  async function spawn(role, prompt, caller, options = {}) {
    const { session: { addr } } = await daemon.handle('spawn', { role, project, cwd: project,
      cli: 'codex', model: 'fixture-main', effort: 'high', mode: 'headless', prompt,
      task: role === 'worker' ? 'FIXTURE' : undefined, wave: 'ROOT', ...options }, caller);
    await tick();
    return addr;
  }
  async function finish(addr, reply, options) {
    sessions.get(addr).finish(reply, options);
    await tick();
  }
  async function send(addr, text) {
    const receipt = await daemon.handle('send', { target: addr, text, mode: 'queue' });
    await tick();
    return receipt;
  }
  const read = path => readFileSync(join(project, path), 'utf8');
  return { project, daemon, ...provider, keyReads, logs, prompts, tick, spawn, finish, send, read,
    advance: (ms = 86_400_000) => { clock += ms; },
    cost: () => projectCost(project, projectSessions(project), { now: clock }),
    status: () => projectStatus(project) };
}

for (const format of ['openai', 'anthropic']) {
  test(`5e ${format}: configured wire format and key reference, senior turns only, isolated redacted input`, async t => {
    const f = fixture(t, { config: format === 'openai' ? { format } : { format, redact: false } });
    const leader = await f.spawn('leader', 'leader-delivery <private>leader-private-sentinel</private>\napi_key=' + fixtureKey);
    const auditor = await f.spawn('auditor', 'auditor-delivery');
    const worker = await f.spawn('worker', 'worker-delivery', leader);
    const superAddr = await f.spawn('super', 'super-delivery');
    assert.equal(f.requests.length, 0, 'open turns must not be sent');
    await f.finish(worker, 'DONE FIXTURE worker-reply');
    await f.finish(superAddr, 'super-reply');
    assert.equal(f.requests.length, 0, 'Worker and Super turns must not be sent');
    await f.daemon.handle('notifications', { decision: 'decision-sentinel', kind: 'decision' }, leader);
    await f.daemon.handle('notifications', { gateComplete: 'GATE-SENTINEL' }, leader);
    await f.finish(leader, 'leader-reply <private>reply-private-sentinel</private>', { tools: true });
    await f.finish(auditor, 'auditor-reply');
    await f.send(leader, 'fresh-delivery');
    await f.finish(leader, 'fresh-reply');
    assert.equal(f.requests.length, 3, 'one request per completed Leader/Auditor turn');
    assert.ok(f.keyReads.length > 0, 'the injected keychain reader must be used');
    const anthropic = format === 'anthropic';
    for (const { path, method, headers, raw } of f.requests) {
      assert.equal(method, 'POST');
      assert.equal(path, '/fixture/v1/' + (anthropic ? 'messages' : 'chat/completions'));
      assert.ok((anthropic ? headers['x-api-key'] : headers.authorization) ===
        (anthropic ? fixtureKey : 'Bearer ' + fixtureKey), 'auth uses the injected fixture value');
      if (anthropic) assert.ok(headers['anthropic-version']);
      const body = JSON.parse(raw);
      assert.equal(body.model, model);
      assert.ok(Array.isArray(body.messages));
      assert.doesNotMatch(raw, /private-sentinel|<private>|synthetic-test-key|tool-(?:output|argument)-sentinel|file-content-sentinel|worker-reply|super-reply/);
    }
    const [first, second, third] = f.requests.map(req => req.raw);
    for (const text of ['leader-delivery', 'leader-reply', 'decision-sentinel', 'GATE-SENTINEL', 'read_file']) {
      assert.ok(first.includes(text), `missing current-turn signal: ${text}`);
    }
    assert.match(second, /auditor-delivery.*auditor-reply/s);
    assert.match(third, /fresh-delivery.*fresh-reply/s);
    assert.doesNotMatch(third, /leader-delivery|leader-reply|auditor-delivery|auditor-reply/);
    assert.equal(f.addresses.length, 3, 'no secondary requests or telemetry');
    assert.doesNotMatch(f.logs.join('\n'), /synthetic-test-key/);
  });
}

for (const [limit, value, beforeStop] of [
  ['maxInputBytes', 2048, 0], ['dailyCalls', 1, 1], ['dailyTokens', 4096, 1],
]) {
  test(`5e ${limit}: stops outbound traffic and exposes the reason in status and cost`, async t => {
    const f = fixture(t, { config: { limits: { [limit]: value } },
      usage: limit === 'dailyTokens' ? { input: 4089, output: 7 } : turnUsage });
    const leader = await f.spawn('leader', limit === 'maxInputBytes' ? '界'.repeat(900) : 'first-delivery');
    await f.finish(leader, 'first-reply');
    if (beforeStop) {
      await f.send(leader, 'over-budget-delivery');
      await f.finish(leader, 'over-budget-reply');
    }
    assert.equal(f.requests.length, beforeStop);
    for (const [command, result] of [['status', await f.status()], ['cost', f.cost()]]) {
      assert.equal(result.memoryExtractor?.stopReason, limit, `loom ${command} must report the hard limit`);
    }
    f.advance();
    await f.send(leader, 'next-day-delivery');
    await f.finish(leader, 'next-day-reply');
    assert.equal(f.requests.length, beforeStop + 1, 'a fresh eligible turn may run again');
    assert.match(f.requests.at(-1).raw, /next-day-reply/);
    assert.doesNotMatch(f.requests.at(-1).raw, /over-budget-reply|first-reply/);
  });
}

test('5e HTTP failure is discarded and never replayed on idle ticks, new turns or a new day', async t => {
  const f = fixture(t, { statusFor: attempt => attempt === 1 ? 503 : 200 });
  const leader = await f.spawn('leader', 'failed-delivery');
  await f.finish(leader, 'failed-turn-reply');
  await f.tick();
  assert.equal(f.requests.length, 1, 'only one attempt for a failed turn');
  f.advance();
  await f.send(leader, 'successful-delivery');
  await f.finish(leader, 'successful-turn-reply');
  assert.equal(f.requests.length, 2);
  assert.match(f.requests[1].raw, /successful-turn-reply/);
  assert.doesNotMatch(f.requests[1].raw, /failed-delivery|failed-turn-reply/);
});

test('5e gate and phase stage runs validate and route sourced proposals without changing memory', async t => {
  const calls = [];
  const f = fixture(t, { runStage: async input => { calls.push(input); return candidates; } });
  const leader = await f.spawn('leader', 'stage-leader');
  const auditor = await f.spawn('auditor', 'stage-auditor');
  const superAddr = await f.spawn('super', 'stage-super');
  await f.finish(leader, 'Ready for stage input.');
  const receipt = await f.send(leader, 'The user prefers blue fixtures.');
  assert.match(f.prompts.at(-1).input, /The user prefers blue fixtures/);
  await f.finish(leader, 'Preference recorded for review.');
  const worker = await f.spawn('worker', 'stage-worker', leader);
  await f.finish(worker, 'DONE FIXTURE stage-history');
  const source = { kind: 'delivery', id: receipt.id };
  const items = Array.from({ length: 10 }, (_, index) => 'item-' + index);
  for (const id of items) writeMemory(f.project, { id, scope: 'project', owner: 'leader',
    source: 'fixture.txt', verified: '2026-11-26', title: id, body: 'Existing project memory.' });
  const projectProposal = (id, fields) => ({ id, scope: 'project', source, ...fields });
  const candidates = [
    projectProposal('valid-merge', { action: 'merge', targets: items.slice(0, 1), target: items[1], body: 'Combined project memory.' }),
    projectProposal('valid-invalidate', { action: 'invalidate', targets: items.slice(2, 3) }),
    { id: 'valid-user', action: 'correct', scope: 'user', source, body: 'The user prefers blue fixtures.' },
    projectProposal('invalid-deletion', { action: 'invalidate', targets: items.slice(3, 6) }),
    projectProposal('invalid-length', { action: 'correct', target: items[6], body: '行\n'.repeat(201) }),
    projectProposal('invalid-source', { action: 'correct', target: items[7], source: { kind: 'delivery', id: 'missing' }, body: 'Update.' }),
    { id: 'invalid-fact', action: 'correct', scope: 'user', source, body: 'The user is allergic to blue dye.' },
  ];
  assert.equal(calls.length, 0, 'ordinary turns do not invoke stage cleanup');
  await f.daemon.handle('notifications', { gateComplete: 'G1' }, leader);
  await f.tick();
  assert.equal(calls.length, 1, 'gate completion invokes the injected headless stage runner');
  assert.match(JSON.stringify(calls[0]), /stage-history/);
  assert.match(JSON.stringify(calls[0]), /Existing project memory/);
  const packet = await f.daemon.handle('gate-pack', { gate: 'G2' }, leader);
  await f.tick();
  const inbox = JSON.parse(f.read('.project/inbox/state.json')).messages;
  assert.equal(inbox.find(msg => msg.id === packet.deliveryId)?.target.addr, auditor);
  const packetText = readFileSync(packet.path, 'utf8');
  const userReview = JSON.stringify(inbox.filter(msg => msg.target.addr === superAddr));
  assert.match(packetText, /valid-merge/);
  assert.match(packetText, /valid-invalidate/);
  assert.ok(packetText.includes(source.id), 'Auditor can trace proposal provenance');
  assert.match(userReview, /valid-user/);
  assert.ok(userReview.includes(source.id), 'Super can trace proposal provenance');
  assert.doesNotMatch(packetText, /valid-user|invalid-(?:deletion|length|source|fact)/);
  assert.doesNotMatch(userReview, /valid-merge|valid-invalidate|invalid-(?:deletion|length|source|fact)/);
  assert.match(f.read('.project/memory/items/item-2.md'), /Existing project memory/);
  await f.daemon.handle('notifications', { complete: 'Phase complete', phase: 'P1' }, leader);
  await f.tick();
  assert.equal(calls.length, 2, 'phase completion also invokes stage cleanup');
  assert.doesNotMatch(JSON.stringify(calls[1]), /stage-history/, 'stage history advances after a boundary');
});

test('5f pilot cost measures model overhead, extractor usage, rotation, fact misses and proposal pass rate', async t => {
  const f = fixture(t);
  const old = await f.spawn('leader', 'previous role');
  await f.finish(old, 'Referenced `./missing-fixture.mjs`.', { inputTokens: 120 });
  const org = JSON.parse(f.read('.project/loomd/org.json'));
  assert.equal(Object.values(org.notices).find(notice => notice.type === 'fact-miss')?.count, 1);
  f.advance(1000);
  const successor = await f.spawn('leader', 'first turn with index', undefined, { 'handover-from': old });
  await f.finish(successor, 'First successor reply.', { inputTokens: 60 });
  const cost = f.cost();
  assert.equal(f.prompts.length, 2, 'one main-role prompt per fixture turn');
  assert.equal(cost.byRole.leader.modelCalls, 2, 'one native request per fixture turn');
  assert.equal(cost.rawTokens, 200, 'native totals stay independent of extractor usage');
  assert.equal(cost.memoryPilot?.extraMainRoleRequestsPerTurn, 0);
  assert.equal(cost.memoryExtractor?.calls, 2);
  assert.equal(cost.memoryExtractor?.tokens, 40);
  const comparison = cost.memoryPilot?.firstTurnTokens;
  assert.equal(comparison?.observed, 70);
  assert.ok(Object.hasOwn(comparison, 'handoverFileBaseline'), 'report a baseline field even before a pilot baseline is collected');
  assert.equal(cost.memoryPilot.factMiss, 1);
  assert.equal(cost.memoryPilot.proposalPassRate, null, 'no reviewed proposals yields an unobserved rate');
});
