import assert from 'node:assert/strict';
import { ChildProcess, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, readlinkSync,
  rmSync, writeFileSync } from 'node:fs';
import { createServer, request, Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Duplex } from 'node:stream';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { inspect } from 'node:util';
import { projectCost } from '../cli/cost.mjs';
import { projectSessions } from '../cli/project.mjs';
import { projectStatus } from '../cli/status.mjs';
import { deliveryId } from '../inbox/message.mjs';
import { estimateTokens } from '../lib/token-budget.mjs';
import { substantiveIndexRow } from '../memory/index-row.mjs';
import { activeItems, searchMemory, writeMemory } from '../memory/project.mjs';
import { memoryStartupPrompt, observationRules, renderMemoryPrompt } from '../memory/prompts.mjs';
import { createSupervisor } from './supervisor.mjs';
import { extractorStatePath, readExtractorState } from './memory-extractor-state.mjs';

const keyRef = 'loom-memory-extractor-deepseek';
const fixtureKey = 'synthetic-test-key';
const baseURL = 'http://127.0.0.1/fixture/v1';
const model = 'fixture-extractor';
const turnUsage = { input: 13, output: 7 };
const LOOM_BIN = fileURLToPath(new URL('../bin/loom', import.meta.url));

function fakeProvider(t, { statusFor = () => 200, usage = turnUsage, proposals = () => [], networkError,
  beforeResponse } = {}) {
  const requests = [];
  const addresses = [];
  const networkAuth = [];
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const status = statusFor(requests.length + 1);
    const auth = req.headers.authorization ?? req.headers['x-api-key'];
    const attempt = { path: req.url, method: req.method, headers: req.headers, raw, status };
    requests.push(attempt);
    const counts = typeof usage === 'function' ? usage(JSON.parse(raw), requests.length) : usage;
    const content = JSON.stringify({ proposals: proposals(requests.length) });
    if (beforeResponse) await beforeResponse(JSON.parse(raw));
    const anthropic = req.url.endsWith('/messages');
    const envelope = anthropic ? {
      id: 'msg-fixture', type: 'message', role: 'assistant', model, stop_reason: 'end_turn',
      content: [{ type: 'text', text: content }],
      usage: { input_tokens: counts.input, output_tokens: counts.output },
    } : {
      id: 'chatcmpl-fixture', object: 'chat.completion', model,
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: counts.input, completion_tokens: counts.output, total_tokens: counts.input + counts.output },
    };
    attempt.responseBody = JSON.stringify(status === 200 ? envelope : { error: { message: `Provider rejected ${auth}` } });
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(attempt.responseBody);
  });
  async function fetch(input, init) {
    const wire = new Request(input, init);
    addresses.push(wire.url);
    assert.ok(wire.url.startsWith(baseURL + '/'), 'all HTTP must go to the configured fake provider');
    if (networkError) {
      const auth = wire.headers.get('authorization');
      networkAuth.push(auth);
      throw new TypeError('fetch failed', { cause: Object.assign(
        new Error(`Connection reset for ${auth}`), { code: 'ECONNRESET' }) });
    }
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
  return { requests, addresses, networkAuth, fetch };
}

function treeFiles(root, prefix = '') {
  return readdirSync(join(root, prefix), { withFileTypes: true, throwIfNoEntry: false })?.flatMap(entry => {
    const path = join(prefix, entry.name);
    if (entry.isDirectory()) return [{ path, bytes: Buffer.alloc(0) }, ...treeFiles(root, path)];
    if (entry.isSymbolicLink()) return [{ path, bytes: readlinkSync(join(root, path), { encoding: 'buffer' }) }];
    return entry.isFile() ? [{ path, bytes: readFileSync(join(root, path)) }] : [];
  }) ?? [];
}

function fixture(t, { config = {}, runStage, fixtureCredential = () => fixtureKey, ...providerOptions } = {}) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'lme-'));
  const project = join(root, 'project');
  const home = join(root, 'home');
  const env = { HOME: home, GIT_CONFIG_GLOBAL: join(home, 'gitconfig'), XDG_CONFIG_HOME: join(home, '.config') };
  const savedEnv = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  let daemon;
  t.after(async () => {
    try { await daemon?.shutdown(); }
    finally {
      for (const [key, value] of Object.entries(savedEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      rmSync(root, { recursive: true, force: true });
    }
  });
  mkdirSync(home);
  const provider = fakeProvider(t, providerOptions);
  const keyReads = [];
  const sessions = new Map();
  const prompts = [];
  const logs = [];
  const reports = [];
  let clock = Date.UTC(2026, 10, 26, 12);
  const policy = { delivery: { coalesceMs: 0 }, memory: { extractor: { format: 'openai', baseURL, model, keyRef, ...config } } };
  mkdirSync(join(project, '.project'), { recursive: true });
  writeFileSync(join(project, '.project/policy.json'), JSON.stringify(policy));
  writeFileSync(join(project, 'fixture.txt'), 'file-content-sentinel');

  async function open(row, _, resume) {
    const id = resume ?? randomUUID();
    const path = join(project, id + '.jsonl');
    writeFileSync(path, '', { flag: 'a' });
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
      return turnId;
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
  const start = () => createSupervisor(project, { now: () => clock, sessionOptions: { open },
    report: message => logs.push(message), externalNotification: async (...args) => { reports.push(args); },
    memoryExtractorOptions: { fetch: provider.fetch, runStage, readKeychain(service, account) {
      keyReads.push([service, account]);
      assert.deepEqual([service, account], [keyRef, 'loom']);
      return fixtureCredential();
    } },
  });
  daemon = start();
  async function restart() {
    await daemon.shutdown();
    sessions.clear();
    daemon = start();
    await tick();
  }
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
  const finishTurn = (addr, reply, options) => sessions.get(addr).finish(reply, options);
  async function finish(addr, reply, options) {
    const turnId = finishTurn(addr, reply, options);
    await tick();
    return turnId;
  }
  async function send(addr, text) {
    const receipt = await daemon.handle('send', { target: addr, text, mode: 'queue' });
    await tick();
    return receipt;
  }
  const read = path => readFileSync(join(project, path), 'utf8');
  function initGit() {
    const git = (...args) => execFileSync('git', args, { cwd: project, stdio: 'pipe' });
    git('init', '-q');
    git('-c', 'user.name=Loom fixture', '-c', 'user.email=fixture@example.invalid',
      'commit', '--allow-empty', '-qm', 'Gate fixture candidate');
  }
  return { root, project, get daemon() { return daemon; }, ...provider, keyReads, logs, reports, prompts,
    tick, restart, spawn, finish, finishTurn, send, read, initGit,
    advance: (ms = 86_400_000) => { clock += ms; },
    cost: () => projectCost(project, projectSessions(project), { now: clock }),
    status: () => projectStatus(project) };
}

function assertNoFixtureKey(label, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(inspect(value, {
    depth: null, maxStringLength: null, maxArrayLength: null, getters: true,
  }));
  assert.ok(!bytes.includes(fixtureKey), `synthetic extractor credential found in ${label}`);
}

for (const scenario of [200, 401, 503, 'network error']) {
  test(`5e key stays out of state, diagnostics and the gate packet after ${scenario}`, async t => {
    const f = fixture(t, { networkError: scenario === 'network error', statusFor: () => scenario });
    f.initGit();
    const leader = await f.spawn('leader', 'Check fixture credential handling.');
    await f.spawn('auditor', 'Review fixture credential handling.');
    const responses = [];
    async function observe(command) {
      try {
        const result = await command();
        responses.push(result);
        return result;
      } catch (error) {
        responses.push(error);
      }
    }
    await observe(() => f.finish(leader, 'Fixture turn complete.'));
    await observe(() => f.tick());
    await observe(() => f.status());
    await observe(() => f.cost());
    await observe(() => f.daemon.handle('state', { target: leader }, leader));
    const packet = await observe(() => f.daemon.handle('gate-pack', {
      gate: 'KEY-CHECK', question: 'Review extraction diagnostics. '.repeat(20),
    }, leader));
    await observe(() => f.tick());
    assertNoFixtureKey('command responses and errors', responses);
    assertNoFixtureKey('daemon logs and reports', [f.logs, f.reports]);
    for (const { path, bytes } of treeFiles(f.root)) {
      assertNoFixtureKey('a state path', path);
      assertNoFixtureKey('a state file or symlink', bytes);
    }
    assert.ok(packet?.path && packet.fullPath, 'both gate packet files must exist');
    for (const path of [packet.path, packet.fullPath]) assertNoFixtureKey('gate packet', readFileSync(path));
    assert.equal(f.addresses.length, 1, 'one eligible turn attempted the provider');
    assert.ok(f.keyReads.length > 0, 'the attempt used the synthetic key reader');
    if (scenario === 'network error') {
      assert.equal(f.requests.length, 0, 'connection failed before an HTTP response could be received');
      assert.ok(f.networkAuth[0] === `Bearer ${fixtureKey}`, 'the failing connection had fixture authentication');
    } else {
      assert.equal(f.requests.length, 1);
      const [attempt] = f.requests;
      assert.equal(attempt.status, scenario);
      assert.ok(attempt.headers.authorization === `Bearer ${fixtureKey}`, 'fake service received the fixture key');
      if (scenario !== 200) assert.ok(attempt.responseBody.includes(fixtureKey), 'provider error deliberately echoed authentication');
    }
  });
}

for (const format of ['openai', 'anthropic']) {
  test(`5e ${format}: mandatory redaction with redact:false and senior-turn isolation`, async t => {
    const f = fixture(t, { config: { format, redact: false } });
    const leader = await f.spawn('leader', 'leader-delivery <private>first-private-sentinel\nsecond-private-sentinel</private>\n' +
      'api_key=' + fixtureKey);
    const auditor = await f.spawn('auditor', 'auditor-delivery');
    const worker = await f.spawn('worker', 'worker-delivery', leader);
    const superAddr = await f.spawn('super', 'super-delivery');
    assert.equal(f.requests.length, 0, 'open turns must not be sent');
    await f.finish(worker, 'DONE FIXTURE worker-reply');
    await f.finish(superAddr, 'super-reply');
    assert.equal(f.requests.length, 0, 'Worker and Super turns must not be sent');
    await f.daemon.handle('notifications', { decision: 'decision-sentinel', kind: 'decision' }, leader);
    await f.daemon.handle('notifications', { gateComplete: 'GATE-SENTINEL' }, leader);
    await f.finish(leader, 'leader-reply <private>reply-private-sentinel</private> visible-after-close ' +
      '<private>unclosed-private-sentinel\ncontinuation-private-sentinel', { tools: true });
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
    for (const text of ['leader-delivery', 'leader-reply', 'visible-after-close', 'decision-sentinel', 'GATE-SENTINEL', 'read_file']) {
      assert.ok(first.includes(text), `missing current-turn signal: ${text}`);
    }
    assert.match(second, /auditor-delivery.*auditor-reply/s);
    assert.match(third, /fresh-delivery.*fresh-reply/s);
    assert.doesNotMatch(third, /leader-delivery|leader-reply|auditor-delivery|auditor-reply/);
    assert.equal(f.addresses.length, 3, 'no secondary requests or telemetry');
    assert.doesNotMatch(f.logs.join('\n'), /synthetic-test-key/);
  });
}

async function assertStop(f, limit) {
  for (const [command, result] of [['status', await f.status()], ['cost', f.cost()]]) {
    assert.equal(result.memoryExtractor?.stopReason, limit, `loom ${command} must report the hard limit`);
  }
}

test('5e maxInputBytes: rejects a multibyte turn and accepts a small turn on the same day', async t => {
  const f = fixture(t, { config: { limits: { maxInputBytes: 2048 } } });
  const leader = await f.spawn('leader', 'oversized-delivery ' + '界'.repeat(900));
  await f.finish(leader, 'oversized-reply');
  assert.equal(f.addresses.length, 0, 'an oversized turn must not reach HTTP');
  await assertStop(f, 'maxInputBytes');
  await f.send(leader, 'small-delivery');
  await f.finish(leader, 'small-reply');
  assert.equal(f.addresses.length, 1);
  assert.equal(f.requests.length, 1);
  assert.match(f.requests[0].raw, /small-reply/);
  assert.doesNotMatch(f.requests[0].raw, /oversized-delivery|oversized-reply/);
});

for (const [label, reply] of [
  ['NOREPLY', 'NOREPLY'],
  ['NOREPLY followed by 已收到', 'NOREPLY\n\n已收到。'],
  ['NOREPLY followed by 继续等待', 'NOREPLY\n\n继续等待门禁结果。'],
  ['HANDOVER-ACK', 'HANDOVER-ACK 515d0bf2-78b5-4d3f-8248-20231c82ee33'],
  ['收到', '收到'],
  ['确认', '确认'],
  ['OK', 'OK'],
  ['ACK', 'ACK'],
]) {
  test('8b per-turn extractor skips ' + label + ' without spending quota', async t => {
    const f = fixture(t);
    const leader = await f.spawn('leader', 'Acknowledge receipt of this status update.');
    await f.finish(leader, reply);
    const { calls, tokens, today } = f.cost().memoryExtractor;
    assert.deepEqual({ requests: f.requests.length, attempts: f.addresses.length, calls, tokens, today }, {
      requests: 0, attempts: 0, calls: 0, tokens: 0, today: { calls: 0, chargedTokens: 0 },
    });
  });
}

test('8b per-turn extractor still processes substantive Leader and Auditor replies', async t => {
  const f = fixture(t);
  const leader = await f.spawn('leader', 'Review the architecture and retry behavior.');
  const auditor = await f.spawn('auditor', 'Review the release gate.');
  const replies = [
    'Keep publication and cursor updates in one transaction so a retry can safely resume.',
    'The retry duplicated deliveries after a crash; reserve the delivery ID before publishing.',
    'APPROVE release gate. Retain signed manifests as evidence and withhold release if a signature is missing.',
  ];
  await f.finish(leader, replies[0]);
  await f.send(leader, 'Record the retry failure and its mitigation.');
  await f.finish(leader, replies[1]);
  await f.finish(auditor, replies[2]);
  assert.deepEqual(f.requests.map(request => extractorRequestInput(request).reply), replies);
  const { calls, tokens } = f.cost().memoryExtractor;
  assert.deepEqual({ calls, tokens }, { calls: 3, tokens: 60 });
});

for (const reply of [
  '收到。根因是崩溃后重试重复发布了投递。',
  '确认：重试要先占投递 ID，再发布消息。',
  'OK, the root cause is that publication and cursor updates are in separate transactions.',
]) {
  test('8b per-turn extractor processes substantive reply: ' + reply, async t => {
    const f = fixture(t);
    const leader = await f.spawn('leader', 'Review the retry failure.');
    await f.finish(leader, reply);
    assert.deepEqual(f.requests.map(request => extractorRequestInput(request).reply), [reply]);
  });
}

test('8b per-turn extractor honors a policy call cap above the old default of 40', async t => {
  const dailyCalls = 42;
  const f = fixture(t, { config: { limits: { dailyCalls, dailyTokens: 600_000 } } });
  const leader = await f.spawn('leader', 'Review the first release procedure.');
  for (let i = 1; i <= dailyCalls; i++) {
    if (i > 1) await f.send(leader, 'Review the next release procedure, number ' + i + '.');
    await f.finish(leader, 'Record release procedure ' + i + ' only after verifying the signed manifest.');
    assert.equal(f.requests.length, i, 'policy must allow request ' + i);
  }
  await assertStop(f, 'dailyCalls');
  await f.send(leader, 'Review the next procedure after the daily cap.');
  await f.finish(leader, 'Require a signed rollback plan before deploying the release.');
  assert.equal(f.addresses.length, dailyCalls);
  assert.equal(f.cost().memoryExtractor.today.calls, dailyCalls);
  await assertStop(f, 'dailyCalls');
});

test('8b per-turn extractor spends up to the policy token cap and reports dailyTokens', async t => {
  const dailyTokens = 600_000;
  const previouslyCharged = 596_000;
  const f = fixture(t, { config: { limits: { dailyCalls: 300, dailyTokens } },
    usage: { input: 2976, output: 1024 } });
  await f.tick();
  const state = readExtractorState(f.project);
  state.days['2026-11-26'] = { calls: 250, tokens: previouslyCharged, stageCalls: 0, stageTokens: 0,
    charged: previouslyCharged, stopReason: null };
  writeFileSync(extractorStatePath(f.project), JSON.stringify(state));
  await f.restart();

  const leader = await f.spawn('leader', 'Review the next release procedure.');
  await f.finish(leader, 'Require the release manifest to be signed before deployment.');
  assert.equal(f.requests.length, 1, 'policy allows spending above the old 100,000-token cap');
  assert.deepEqual(f.cost().memoryExtractor.today, { calls: 251, chargedTokens: dailyTokens });
  await assertStop(f, 'dailyTokens');
  await f.send(leader, 'Review another release procedure.');
  await f.finish(leader, 'Publish the rollback plan with the release announcement.');
  assert.equal(f.addresses.length, 1);
  assert.deepEqual(f.cost().memoryExtractor.today, { calls: 251, chargedTokens: dailyTokens });
  await assertStop(f, 'dailyTokens');
});

for (const [limit, value, usage] of [['dailyCalls', 1, turnUsage], ['dailyTokens', 4096, { input: 4089, output: 7 }]]) {
  test(`5e ${limit}: counters survive restart and block requests until the next day`, async t => {
    const f = fixture(t, { config: { limits: { [limit]: value } }, usage });
    const leader = await f.spawn('leader', 'first-delivery');
    await f.finish(leader, 'first-reply');
    assert.equal(f.requests.length, 1, 'the first turn consumed the budget');
    for (const phase of ['before', 'after']) {
      if (phase === 'after') await f.restart();
      const { calls, tokens } = f.cost().memoryExtractor ?? {};
      assert.deepEqual({ calls, tokens }, { calls: 1, tokens: usage.input + usage.output }, `${phase} restart`);
    }
    await f.send(leader, 'over-budget-delivery');
    await f.finish(leader, 'over-budget-reply');
    assert.equal(f.addresses.length, 1, 'neither restart nor an over-budget turn attempts HTTP');
    await assertStop(f, limit);
    f.advance();
    await f.send(leader, 'next-day-delivery');
    await f.finish(leader, 'next-day-reply');
    assert.equal(f.addresses.length, 2, 'a fresh eligible turn may run again');
    assert.equal(f.requests.length, 2);
    assert.match(f.requests.at(-1).raw, /next-day-reply/);
    assert.doesNotMatch(f.requests.at(-1).raw, /over-budget-reply|first-reply/);
  });
}

test('5e failed HTTP turn is never replayed on idle ticks, restart or a new day', async t => {
  const f = fixture(t, { statusFor: attempt => attempt === 1 ? 503 : 200 });
  const leader = await f.spawn('leader', 'failed-delivery');
  await f.finish(leader, 'failed-turn-reply');
  await f.tick();
  const beforeRestart = f.addresses.length;
  await f.restart();
  const afterRestart = f.addresses.length;
  await f.send(leader, 'same-day-delivery');
  await f.finish(leader, 'same-day-reply');
  assert.equal(beforeRestart, 1, 'only one attempt for a failed turn');
  assert.equal(afterRestart, 1, 'no replay while reopening the same session');
  assert.equal(f.addresses.length, 2);
  f.advance();
  await f.send(leader, 'successful-delivery');
  await f.finish(leader, 'successful-turn-reply');
  assert.equal(f.addresses.length, 3);
  assert.equal(f.requests.length, 3);
  assert.match(f.requests[1].raw, /same-day-reply/);
  assert.match(f.requests[2].raw, /successful-turn-reply/);
  for (const { raw } of f.requests.slice(1)) assert.doesNotMatch(raw, /failed-delivery|failed-turn-reply/);
});

const projectLibrary = project => treeFiles(join(project, '.project/memory'))
  .filter(({ path }) => path === 'INDEX.md' || path.startsWith('items/'));

test('5e nonempty turn proposals require scoped review before changing memory', async t => {
  let candidates = [];
  const f = fixture(t, { proposals: () => candidates });
  f.initGit();
  const leader = await f.spawn('leader', 'Use signed fixtures and standard labels. I prefer blue fixtures and compact reports. ' +
    'Merge merge-source into merge-target, invalidate obsolete-entry, and correct corrected-entry.');
  const auditor = await f.spawn('auditor', 'Review project memory.');
  const superAddr = await f.spawn('super', 'Review user memory.');
  const worker = await f.spawn('worker', 'Prepare fixture evidence.', leader);
  const source = { kind: 'delivery', id: deliveryId(f.prompts.find(prompt => prompt.addr === leader).input) };
  assert.ok(source.id, 'turn proposals cite the actual startup delivery');
  for (const id of ['merge-source', 'merge-target', 'obsolete-entry', 'corrected-entry']) {
    writeMemory(f.project, { id, scope: 'project', owner: 'leader', source: 'fixture.txt',
      verified: '2026-11-26', title: id, body: `Original ${id} content.` });
  }
  const proposal = (id, action, fields) => ({ id, action, scope: 'project', source, ...fields });
  candidates = [
    proposal('project-add', 'add', { title: 'signed-fixtures', body: 'Use signed fixtures.' }),
    proposal('project-merge', 'merge', { targets: ['merge-source'], target: 'merge-target', body: 'Consolidated fixture instructions.' }),
    proposal('project-invalidate', 'invalidate', { targets: ['obsolete-entry'] }),
    proposal('project-correct', 'correct', { target: 'corrected-entry', body: 'Corrected fixture instructions.' }),
    proposal('project-reject', 'add', { title: 'standard-labels', body: 'Use standard labels.' }),
    proposal('user-blue', 'add', { scope: 'user', title: 'color-preference', body: 'The user prefers blue fixtures.' }),
    proposal('user-compact', 'add', { scope: 'user', title: 'report-preference', body: 'The user prefers compact reports.' }),
  ];
  // Proposed daemon review and read commands. The caller comes from the bound session.
  const review = (caller, id, decision = 'approve') => f.daemon.handle('memory-review', { id, decision }, caller);
  const userIndex = () => f.daemon.handle('memory-index', { scope: 'user' }, superAddr);
  const show = id => f.daemon.handle('memory-show', { id }, superAddr);
  async function userLibrary() {
    const index = await userIndex();
    return { index, entries: await Promise.all(index.rows.map(({ id }) => show(id))) };
  }
  const before = projectLibrary(f.project);
  const [userBefore] = await Promise.allSettled([userLibrary()]);
  await f.finish(leader, 'Consolidated fixture instructions. Corrected fixture instructions.');
  assert.equal(f.requests.length, 1, 'fake service returned the nonempty proposal batch');
  assert.deepEqual(projectLibrary(f.project), before, 'extraction leaves the entire project library unchanged');
  if (userBefore.status === 'rejected') throw userBefore.reason;
  assert.deepEqual(await userLibrary(), userBefore.value, 'extraction leaves the entire user library unchanged');
  assert.doesNotMatch(JSON.stringify(userBefore.value), /color-preference|report-preference/);

  const packet = await f.daemon.handle('gate-pack', { gate: 'PROPOSAL-REVIEW' }, leader);
  await f.tick();
  const packetText = [packet.path, packet.fullPath].filter(Boolean).map(path => readFileSync(path, 'utf8')).join('\n');
  const { messages } = JSON.parse(f.read('.project/inbox/state.json'));
  assert.equal(messages.find(msg => msg.id === packet.deliveryId)?.target.addr, auditor);
  const userReview = JSON.stringify(messages.filter(msg => msg.target.addr === superAddr));
  for (const { id, scope } of candidates) {
    assert.ok((scope === 'project' ? packetText : userReview).includes(id), `${id} reaches its authorized reviewer`);
    assert.ok(!(scope === 'project' ? userReview : packetText).includes(id), `${id} stays out of the other review channel`);
  }
  assert.ok(packetText.includes(source.id) && userReview.includes(source.id), 'both review channels preserve provenance');
  for (const [caller, id] of [[worker, 'project-add'], [leader, 'project-merge'],
    [superAddr, 'project-invalidate'], [auditor, 'user-blue']]) {
    await assert.rejects(review(caller, id), { code: 'forbidden' });
  }
  assert.deepEqual(projectLibrary(f.project), before, 'routing and denied approvals leave every project file unchanged');
  assert.deepEqual(await userLibrary(), userBefore.value, 'routing and denied approvals leave the user library unchanged');

  for (const id of ['project-add', 'project-merge', 'project-invalidate', 'project-correct']) await review(auditor, id);
  await review(auditor, 'project-reject', 'reject');
  await review(superAddr, 'user-blue');
  await review(superAddr, 'user-compact', 'reject');
  await f.tick();
  const active = title => searchMemory(f.project, title).find(item => item.title === title);
  const body = title => f.read(active(title).path);
  assert.match(body('signed-fixtures'), /Use signed fixtures/);
  assert.equal(active('standard-labels'), undefined);
  assert.equal(active('merge-source'), undefined);
  assert.match(body('merge-target'), /Consolidated fixture instructions/);
  assert.equal(active('obsolete-entry'), undefined);
  assert.match(body('corrected-entry'), /Corrected fixture instructions/);
  assert.doesNotMatch(body('corrected-entry'), /Original corrected-entry content/);
  const approved = (await userIndex()).rows.find(row => row.line.includes('color-preference'));
  assert.ok(approved, 'the approved user preference is visible');
  assert.equal((await show(approved.id)).item?.body.trim(), 'The user prefers blue fixtures.');
  assert.doesNotMatch(JSON.stringify(await userIndex()), /report-preference|compact reports/);
});

test('5e OpenCode receives L1 only at gate and phase and routes valid staged proposals', async t => {
  const calls = [];
  const f = fixture(t, { runStage: async input => { calls.push(input); return candidates; } });
  f.initGit();
  const leader = await f.spawn('leader', 'stage-leader');
  const auditor = await f.spawn('auditor', 'stage-auditor');
  const superAddr = await f.spawn('super', 'stage-super');
  await f.finish(leader, 'Ready for stage input.');
  const receipt = await f.send(leader, 'The user prefers blue fixtures.');
  assert.match(f.prompts.at(-1).input, /The user prefers blue fixtures/);
  await f.finish(leader, 'Preference recorded for review.');
  const worker = await f.spawn('worker', 'stage-worker', leader, { task: 'STAGE-HISTORY' });
  await f.finish(worker, 'DONE FIXTURE stage-history', { tools: true });
  const source = { kind: 'delivery', id: receipt.id };
  const items = Array.from({ length: 10 }, (_, index) => 'item-' + index);
  for (const id of items) writeMemory(f.project, { id, scope: 'project', owner: 'leader',
    source: 'fixture.txt', verified: '2026-11-26', title: id, body: 'Existing project memory.' });
  const before = projectLibrary(f.project);
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
  assert.ok(calls[0].workerSummaries.some(({ addr, summary }) => addr === worker && summary.includes('STAGE-HISTORY')));
  assert.match(JSON.stringify(calls[0]), /Existing project memory/);
  assert.doesNotMatch(JSON.stringify(calls[0]), /tool-(?:output|argument)-sentinel|file-content-sentinel/);
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
  assert.deepEqual(projectLibrary(f.project), before, 'stage proposals leave the entire project library unchanged');
  await f.finish(auditor, 'phase-history', { tools: true });
  await f.daemon.handle('notifications', { complete: 'Phase complete', phase: 'P1' }, leader);
  await f.tick();
  assert.equal(calls.length, 2, 'phase completion also invokes stage cleanup');
  assert.match(JSON.stringify(calls[1]), /phase-history/);
  assert.ok(calls[1].workerSummaries.every(({ addr }) => addr !== worker), 'stage history advances after a boundary');
  assert.doesNotMatch(JSON.stringify(calls[1]), /tool-(?:output|argument)-sentinel|file-content-sentinel/);
});

function fakeOpenCode(t, root) {
  const bin = join(root, 'stage-bin');
  const executable = join(root, 'stage-opencode');
  const trace = join(root, 'opencode-path.log');
  const capture = join(root, 'stage-exchange.json');
  mkdirSync(bin);
  writeFileSync(join(bin, 'opencode'), `#!${process.execPath}
require('node:fs').appendFileSync(${JSON.stringify(trace)}, 'opencode resolved via PATH\\n');
process.exitCode = 73;
`, { mode: 0o700 });
  writeFileSync(executable, `#!${process.execPath}
const { readFileSync, writeFileSync } = require('node:fs');
const input = JSON.parse(process.argv.at(-1));
const wire = readFileSync(0, 'utf8');
const content = wire.split('\\n').filter(line => line.startsWith('data: {'))
  .map(line => JSON.parse(line.slice(6)).choices[0].delta.content ?? '').join('');
const stdout = JSON.stringify({ type: 'text', part: { text: content } });
writeFileSync(${JSON.stringify(capture)}, JSON.stringify({ input, wire, stdout }));
console.log(stdout);
`, { mode: 0o700 });
  for (const [name, value] of Object.entries({
    PATH: [bin, process.env.PATH].filter(Boolean).join(':'),
    OAR_OPENCODE_BIN: executable,
    LOOM_OPENCODE_BIN: executable,
  })) {
    const previous = process.env[name];
    process.env[name] = value;
    t.after(() => {
      if (previous === undefined) delete process.env[name];
      else process.env[name] = previous;
    });
  }
  // Drive the real loopback request handler without a socket, then give its response to the child.
  const bridges = new Map();
  t.mock.method(Server.prototype, 'listen', function (port, host, ready) {
    assert.equal(port, 0);
    assert.equal(host, '127.0.0.1');
    const fixturePort = 12345 + bridges.size;
    bridges.set(fixturePort, this);
    this.address = () => ({ port: fixturePort });
    queueMicrotask(ready);
    return this;
  });
  const spawn = ChildProcess.prototype.spawn;
  t.mock.method(ChildProcess.prototype, 'spawn', function (options) {
    if (!options.args.includes('loom-stage')) return spawn.call(this, options);
    // Pin stage launches to the stand-in before the OS can resolve a bare name.
    if (options.file !== executable && options.file !== 'opencode') throw new Error('Unexpected stage executable');
    const envPairs = [...options.envPairs.filter(pair => !pair.startsWith('PATH=')), `PATH=${bin}`];
    const configPath = envPairs.find(pair => pair.startsWith('OPENCODE_CONFIG=')).slice('OPENCODE_CONFIG='.length);
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    const url = new URL(config.providers.loom.settings.baseURL + '/chat/completions');
    assert.equal(url.hostname, '127.0.0.1');
    const bridge = bridges.get(Number(url.port));
    assert.ok(bridge, 'the child uses its own fixture bridge');
    const result = spawn.call(this, { ...options, file: executable, args: [executable, ...options.args.slice(1)], envPairs });
    const stdin = this.stdin;
    bridge.emit('request', { method: 'POST', url: url.pathname, resume() {} }, {
      writeHead() { return this; },
      end(wire) { stdin.end(wire); },
    });
    return result;
  });
  return { bin, trace, exchange: () => JSON.parse(readFileSync(capture, 'utf8')) };
}

function seedLegacyStageMemory(project) {
  writeMemory(project, { id: 'stage-existing', scope: 'project', owner: 'leader', source: 'fixture.txt',
    verified: '2026-11-26', title: 'Existing fixture memory', body: 'Keep fixture records.' });
}

async function completeStageGate(f, leader, gate) {
  const { notifications } = await f.daemon.handle('notifications', { gateComplete: gate, history: true }, leader);
  await f.tick();
  return notifications.find(event => event.gate === gate && event.type === 'gate-completed').id;
}

test('R23 stage child and upstream history exclude worker file contents', async t => {
  const f = fixture(t);
  f.initGit();
  const runner = fakeOpenCode(t, f.root);
  seedLegacyStageMemory(f.project);
  const leader = await f.spawn('leader', 'Prepare the R23 stage.');
  await f.finish(leader, 'Retain this senior stage context.');
  const worker = await f.spawn('worker', 'Check the fixture. '.repeat(10) + 'WORKER_FILE_BODY_SENTINEL_R23_RECEIVED', leader);
  // hist L1 clips the reply preview, so put the file body past that preview.
  await f.finish(worker, 'DONE FIXTURE ' + 'Fixture steps completed. '.repeat(6) + 'WORKER_FILE_BODY_SENTINEL_R23_REPLY');
  assert.equal(f.requests.length, 1, 'only the Leader turn was sent before the gate');
  await completeStageGate(f, leader, 'R23-HISTORY');
  assert.equal(f.requests.length, 2, 'the stage request reached the fixture provider');
  const outbound = { child: JSON.stringify(runner.exchange().input), upstream: f.requests.at(-1).raw };
  const leaked = {};
  for (const [channel, payload] of Object.entries(outbound)) {
    assert.match(payload, /Retain this senior stage context/);
    leaked[channel] = payload.match(/WORKER_FILE_BODY_SENTINEL_R23_(?:RECEIVED|REPLY)/g) ?? [];
  }
  assert.deepEqual(leaked, { child: [], upstream: [] });
});

test('stage with an empty library preserves a targetless user correction after a failed attempt', async t => {
  const calls = [];
  const f = fixture(t, { runStage: async input => { calls.push(input); return candidates; } });
  let candidates = { failure: 'stage-provider' };
  const leader = await f.spawn('leader', 'Prepare to record a correction.');
  await f.finish(leader, 'Ready.');
  const body = 'I prefer compact fixture reports.';
  const delivery = await f.send(leader, body);
  await f.finish(leader, 'Acknowledged the correction.');
  const first = await completeStageGate(f, leader, 'EMPTY-RETRY');
  const afterEmpty = readExtractorState(f.project);
  const attemptedBeforeProposal = calls.length > 0;
  f.advance(1000);
  const source = { kind: 'delivery', id: delivery.id };
  candidates = [{ id: 'empty-user-correction', action: 'correct', scope: 'user', source, body }];
  await completeStageGate(f, leader, 'EMPTY-PROPOSAL');
  const proposal = readExtractorState(f.project).proposals['empty-user-correction'];
  assert.deepEqual({ attemptedBeforeProposal, boundaryProcessed: Object.hasOwn(afterEmpty.boundaries, first),
    stagedTurns: Object.keys(afterEmpty.stageTurns ?? {}).length, status: proposal?.status, body: proposal?.body,
    source: proposal?.source, target: proposal?.target }, {
    attemptedBeforeProposal: true, boundaryProcessed: false, stagedTurns: 0,
    status: 'pending', body, source, target: undefined,
  });
});

test('stage runs with only v1 shared project memory', async t => {
  const calls = [];
  const f = fixture(t, { runStage: async input => { calls.push(input); return []; } });
  const leader = await f.spawn('leader', 'Prepare with shared memory.');
  const auditor = await f.spawn('auditor', 'Write the shared fixture rule.');
  const { item } = await f.daemon.handle('mem', { action: 'write', requestId: 'stage-shared-only', expectedRevision: null,
    entry: { layer: 'shared', kind: 'ruling', title: 'Shared fixture rule', body: 'Verify the fixture manifest.',
      checkedAt: '2026-11-26T12:00:00.000Z', source: { path: 'fixture.txt' } } }, auditor);
  await f.finish(leader, 'Shared memory is ready for stage.');
  await completeStageGate(f, leader, 'SHARED-ONLY');
  assert.deepEqual(calls.map(({ existing: { project, reference } }) => ({ project, reference })), [{ project: [],
    reference: [{ id: item.id, title: item.title, body: item.body }] }]);
});

test('stage fixture traps PATH lookups and pins the child to its stand-in', async t => {
  const f = fixture(t);
  const runner = fakeOpenCode(t, f.root);
  assert.throws(() => execFileSync('opencode', [], { env: { PATH: runner.bin }, stdio: 'pipe' }), { status: 73 });
  assert.equal(readFileSync(runner.trace, 'utf8'), 'opencode resolved via PATH\n');
  seedLegacyStageMemory(f.project);
  const leader = await f.spawn('leader', 'Prepare the stage launch.');
  await f.finish(leader, 'Stage launch ready.');
  await completeStageGate(f, leader, 'ISOLATED-STAGE');
  assert.match(JSON.stringify(runner.exchange().input), /Stage launch ready/);
  assert.equal(readFileSync(runner.trace, 'utf8'), 'opencode resolved via PATH\n', 'only the probe hit the PATH trap');
});

for (const stage of [false, true]) {
  test(`synthetic key echoed in a successful ${stage ? 'stage' : 'turn'} proposal is redacted`, async t => {
    let candidate;
    const f = fixture(t, { proposals: count => count === (stage ? 2 : 1) ? [candidate] : [] });
    f.initGit();
    const runner = stage ? fakeOpenCode(t, f.root) : undefined;
    if (stage) seedLegacyStageMemory(f.project);
    const leader = await f.spawn('leader', 'Retain the fixture procedure.');
    await f.spawn('auditor', 'Review the fixture procedure.');
    const source = { kind: 'delivery', id: deliveryId(f.prompts.find(prompt => prompt.addr === leader).input) };
    candidate = { id: 'echoed-fixture-key', scope: 'project', action: stage ? 'correct' : 'add', source,
      ...(stage ? { target: 'stage-existing' } : { title: 'Fixture procedure' }), body: `Fixture value was ${fixtureKey}.` };
    await f.finish(leader, 'Fixture procedure ready.');
    if (stage) await completeStageGate(f, leader, 'STAGE-KEY-ECHO');
    const { status, responseBody } = f.requests.at(-1);
    assert.equal(f.requests.length, stage ? 2 : 1);
    assert.equal(status, 200);
    assert.ok(responseBody.includes(fixtureKey), 'the fake upstream echoed its credential in the proposal');
    const stored = readExtractorState(f.project).proposals[candidate.id];
    assert.equal(stored?.status, 'pending');
    assertNoFixtureKey('persisted proposal', stored);
    assert.equal(stored.body, 'Fixture value was [REDACTED].');
    const packet = await f.daemon.handle('gate-pack', {
      gate: 'KEY-ECHO-REVIEW', question: 'Review the stored proposal and its provenance. '.repeat(10),
    }, leader);
    await f.tick();
    const review = [packet.path, packet.fullPath].map(path => readFileSync(path, 'utf8'));
    assert.match(review.join('\n'), /Fixture value was \[REDACTED\]/);
    assertNoFixtureKey('review and diagnostics', [packet, review, f.logs, f.reports, f.status(), f.cost()]);
    assertNoFixtureKey('upstream request bodies', f.requests.map(({ raw }) => raw));
    if (runner) {
      const exchange = runner.exchange();
      assert.match(exchange.wire, /Fixture value was \[REDACTED\]/);
      assert.match(exchange.stdout, /Fixture value was \[REDACTED\]/);
      assertNoFixtureKey('stage child input, loopback response and stdout', exchange);
    }
    for (const { bytes } of treeFiles(f.root)) assertNoFixtureKey('fixture files', bytes);
  });
}

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

function extractorRequestInput({ raw }) {
  const content = JSON.parse(raw).messages[0].content;
  return JSON.parse(content.slice(content.lastIndexOf('\n') + 1));
}

// Observation filtering and the empty response convention are informed by
// claude-mem v17's observer/skip guidance (Apache-2.0).
function assertExtractionGuidance(instructions) {
  assert.ok(typeof instructions === 'string' && instructions.trim(), 'the upstream request includes instructions');
  for (const [rule, pattern] of Object.entries({
    user: /\buser\b/iu,
    feedback: /\bfeedback\b/iu,
    project: /\bproject\b/iu,
    reference: /\breference\b/iu,
    'exclude Git history': /git history|git\s*历史/iu,
    'exclude code structure': /code(?:base)? (?:structure|layout)|代码结构/iu,
    'exclude existing repository content': /already (?:documented|in the (?:repo|repository))|(?:仓库|项目)(?:中|里)?(?:已有|已记录|已记载)/iu,
    'exclude ephemeral details': /ephemeral|temporary|one[- ]off|current (?:turn|conversation)|一次性|临时|当前(?:轮|对话)/iu,
    'return an empty proposal array': /\[\s*\]|empty (?:proposal|array)|空(?:数组|提案)/iu,
  })) assert.match(instructions, pattern, rule);
}

function assertDurableWritingRules(instructions) {
  const missing = Object.entries({
    'user preferences or roles': /\buser\b[^。\n]{0,160}(?:preferences?[^。\n]{0,45}roles?|roles?[^。\n]{0,45}preferences?|偏好[^。\n]{0,30}角色|角色[^。\n]{0,30}偏好)/iu,
    'user corrections and confirmed practices': /\bfeedback\b[^。\n]{0,160}(?:correct\w*[^。\n]{0,70}confirm\w*|confirm\w*[^。\n]{0,70}correct\w*|纠正[^。\n]{0,50}确认|确认[^。\n]{0,50}纠正)/iu,
    'project decisions': /\bproject\b[^。\n]{0,160}(?:decisions?|决定|决策|裁决)/iu,
    'project deadlines': /\bproject\b[^。\n]{0,160}(?:deadlines?|期限|截止)/iu,
    'project constraints': /\bproject\b[^。\n]{0,160}(?:constraints?|约束|限制)/iu,
    'facts not inferable from code': /(?:cannot|can't|not)[^。\n]{0,45}(?:infer|deduc|deriv|obvious)[^。\n]{0,45}(?:code|repo)|(?:不可|不能|无法)[^。\n]{0,20}(?:代码|仓库)[^。\n]{0,20}(?:推|得知)/iu,
    'where to look up external information': /\breference\b[^。\n]{0,160}(?:external|outside|外部)[^。\n]{0,75}|\breference\b[^。\n]{0,80}(?:where to|在哪|何处)[^。\n]{0,70}(?:verify|look|find|查)/iu,
    'skip material already in Git or code': /(?:skip|exclude|do not (?:save|store)|禁止保存|不该存|不要存)[^。\n]{0,160}(?:git\s*历史|git history)/iu,
    Why: /\bWhy\b/u,
    'How to apply': /\bHow to apply\b/u,
    'look for duplicates before writing': /search for duplicates|check for duplicates|deduplicat|查重/iu,
    'update an outdated entry': /update[^。\n]{0,70}(?:existing|outdated)|(?:更新|修订)[^。\n]{0,25}(?:原|已有|现有|过时)|(?:原\s*ID|过时条目)[^。\n]{0,25}(?:更新|修订)/iu,
  }).filter(([, pattern]) => !pattern.test(instructions)).map(([rule]) => rule);
  for (const type of ['user', 'feedback', 'project', 'reference']) {
    if (!new RegExp(`\\b${type}\\b`, 'iu').test(instructions)) missing.push(`type ${type}`);
  }
  if (/默认不写/u.test(instructions)) missing.push('remove the default-no-write instruction');
  if (/\bruling\s+记录[^。\n]*\bpreference\s+记录[^。\n]*\blesson\s+记录[^。\n]*\bcandidate\b/iu.test(instructions) ||
      /\bruling\s*[/|、,]\s*preference\s*[/|、,]\s*lesson\s*[/|、,]\s*candidate\b/iu.test(instructions)) {
    missing.push('remove the competing writing taxonomy');
  }
  assert.deepEqual(missing, [], 'durable memory writing rules');
}

for (const [surface, instructions] of [
  ['Leader startup', memoryStartupPrompt('leader', '')],
  ['Auditor startup', memoryStartupPrompt('auditor', '')],
  ['rendered writing prompt', renderMemoryPrompt({ binding: { role: 'leader' } })],
  ['exported observation rules', observationRules],
]) {
  test(`8f ${surface} teaches the unified durable memory writing rules`, () => {
    assertDurableWritingRules(instructions);
  });
}

const noiseFacts = [
  ['commit-log', 'Git history', 'Commit a1b2c3d renamed the manifest helper.'],
  ['source-tree', 'Code structure', 'The release helper lives in src/release/index.mjs, as documented in the repository.'],
  ['progress-note', 'Current progress', 'The current command is waiting for its output.'],
];

test('6e.2 per-turn DeepSeek request includes the four-type observation and empty-output rules', async t => {
  const f = fixture(t);
  const leader = await f.spawn('leader', 'Review release fixture observations.');
  await f.finish(leader, 'Verify the manifest because a stale signature delayed the last release.');
  assert.equal(f.requests.length, 1);
  const [message] = JSON.parse(f.requests[0].raw).messages;
  const boundary = message.content.lastIndexOf('\n');
  assert.match(message.content.slice(boundary), /stale signature/);
  assert.deepEqual(readExtractorState(f.project).proposals, {}, 'empty output leaves the proposal queue empty');
  assertExtractionGuidance(message.content.slice(0, boundary));
  assertDurableWritingRules(message.content.slice(0, boundary));
});

test('6e.2 per-turn extractor rejects supported noise and queues a durable observation', async t => {
  let proposals = [];
  const f = fixture(t, { proposals: () => proposals });
  mkdirSync(join(f.project, 'src', 'release'), { recursive: true });
  writeFileSync(join(f.project, 'src', 'release', 'index.mjs'), 'export {};\n');
  const leader = await f.spawn('leader', 'Assess what to retain from this turn.');
  const source = { kind: 'delivery', id: deliveryId(f.prompts.at(-1).input) };
  const durable = 'Why: A stale signature delayed release.\nHow to apply: Verify the manifest before publishing.';
  const recovery = 'Why: Manifest recovery can silently omit signatures.\n' +
    'How to apply: Require a signature check in src/release/index.mjs on every recovery.';
  const durableFacts = [
    ['manifest-policy', 'Verify manifest signatures', durable],
    ['recovery-policy', 'Verify recovered manifest signatures', recovery],
  ];
  proposals = [...noiseFacts, ...durableFacts].map(([id, title, body]) => ({
    id, action: 'add', scope: 'project', source, title, body,
  }));
  await f.finish(leader, proposals.map(({ body }) => body).join('\n'));
  assert.equal(f.requests.length, 1);
  const state = readExtractorState(f.project);
  for (const [id] of durableFacts) {
    assert.equal(state.proposals[id]?.status, 'pending', `${id} reaches review`);
  }
  assert.deepEqual(Object.keys(state.proposals).sort(), durableFacts.map(([id]) => id).sort(),
    'only durable observations reach review');
  proposals = [];
  await f.send(leader, 'Only a routine progress check.');
  await f.finish(leader, noiseFacts[2][2]);
  assert.equal(f.requests.length, 2);
  assert.deepEqual(readExtractorState(f.project).proposals, state.proposals, 'an empty result adds no proposal');
});

function releaseProposal(id, source, overrides = {}) {
  return { id, action: 'add', scope: 'project', source, title: 'Verify the release manifest',
    body: 'Why: A stale signature delayed release.\nHow to apply: Verify the manifest before publishing.',
    ...overrides };
}

test('8f empty and mixed extractor turns accumulate diagnostics in cost and status across restart', async t => {
  let proposals = [];
  const f = fixture(t, { proposals: () => proposals });
  async function snapshots() {
    const cost = JSON.parse(execFileSync(LOOM_BIN, ['cost', '--project', f.project], { encoding: 'utf8' }));
    const status = await f.status();
    return {
      cost: cost.memoryExtractor.diagnostics,
      costPilot: cost.memoryPilot.diagnostics,
      status: status.memoryExtractor.diagnostics,
      statusPilot: status.memoryPilot.diagnostics,
    };
  }
  const leader = await f.spawn('leader', 'Review whether this release introduced a new policy.');
  await f.finish(leader, 'The review identified no lasting guidance.');
  const afterEmpty = await snapshots();

  const delivery = await f.send(leader, 'Correction: verify the signed manifest before publishing each release.');
  const source = { kind: 'delivery', id: delivery.id };
  proposals = [releaseProposal('manifest-evidence', source), releaseProposal('invalid-manifest-evidence', source, { body: '' })];
  await f.finish(leader, 'Verify the signed manifest before every release because stale signatures can block publication.');
  assert.equal(f.requests.length, 2);
  assert.deepEqual(Object.values(readExtractorState(f.project).proposals).map(({ id, status }) => [id, status]),
    [['manifest-evidence', 'pending']]);
  const afterMixed = await snapshots();

  f.advance(1000);
  await f.restart();
  const afterRestart = await snapshots();
  assert.equal(f.requests.length, 2, 'restart does not replay either extractor turn');
  assert.equal(readExtractorState(f.project).proposals['manifest-evidence']?.status, 'pending');

  const empty = { emptyResults: 1, filteredCandidates: 0, queuedProposals: 0, filterReasons: {} };
  const mixed = { emptyResults: 1, filteredCandidates: 1, queuedProposals: 1, filterReasons: { validation: 1 } };
  const expected = summary => ({ cost: summary, costPilot: summary, status: summary, statusPilot: summary });
  assert.deepEqual({ afterEmpty, afterMixed, afterRestart }, {
    afterEmpty: expected(empty), afterMixed: expected(mixed), afterRestart: expected(mixed),
  });
});

test('8f extractor attributes duplicates, noise, and unauthorized candidates to distinct filter reasons', async t => {
  let proposals = [];
  const f = fixture(t, { proposals: () => proposals });
  const leader = await f.spawn('leader', 'Review the durable manifest procedure.');
  const source = { kind: 'delivery', id: deliveryId(f.prompts.at(-1).input) };
  const retained = releaseProposal('manifest-procedure', source);
  proposals = [
    retained, { ...retained },
    releaseProposal('progress-report', source, { title: 'Current progress', body: 'The current command is waiting.' }),
    releaseProposal('inferred-user-preference', source, { scope: 'user', body: 'The user prefers unsigned manifests.' }),
  ];
  await f.finish(leader, retained.body);
  assert.equal(f.requests.length, 1);
  assert.deepEqual(Object.values(readExtractorState(f.project).proposals).map(({ id, status }) => [id, status]),
    [[retained.id, 'pending']]);
  assert.deepEqual(f.cost().memoryExtractor.diagnostics, {
    emptyResults: 0, filteredCandidates: 3, queuedProposals: 1,
    filterReasons: { duplicate: 1, noise: 1, unauthorized: 1 },
  });
});

test('6e.5 memoryPilot counts readable index rows and computes reviewed proposal acceptance', async t => {
  let proposals = [];
  const f = fixture(t, { proposals: () => proposals });
  const auditor = await f.spawn('auditor', 'Review fixture memory.');
  const leader = await f.spawn('leader', 'Review durable release procedure.');
  const source = { kind: 'delivery', id: deliveryId(f.prompts.at(-1).input) };
  proposals = [
    ['approved-fixture', 'Verify signed releases', 'Why: Releases require traceability.\nHow to apply: Check the signed manifest.'],
    ['rejected-fixture', 'Record approval owner', 'Why: Approvals need an owner.\nHow to apply: Record the approver before release.'],
    ['pending-fixture', 'Archive approved manifests', 'Why: Audits need evidence.\nHow to apply: Archive the manifest after sign-off.'],
  ].map(([id, title, body]) => ({ id, action: 'add', scope: 'project', source, title, body }));
  await f.finish(leader, proposals.map(({ body }) => body).join('\n'));
  await f.daemon.handle('memory-review', { id: 'approved-fixture', decision: 'approve' }, auditor);
  await f.daemon.handle('memory-review', { id: 'rejected-fixture', decision: 'reject' }, auditor);
  const memoryPath = join(f.project, '.project', 'loomd', 'memory-v1.json');
  const at = '2026-11-26T12:00:00.000Z';
  const valid = {
    id: 'memory-240509da-af5b-4221-984d-0e40c41ef570', title: 'Release approval',
    body: 'Wait for manifest sign-off before publishing.', kind: 'ruling', layer: 'shared',
    project: f.project, role: 'auditor', author: 'auditor', revision: 1,
    status: 'active', checkedAt: at, updatedAt: at, effectiveAt: at, source: { path: 'fixture.txt' },
  };
  const seed = entries => writeFileSync(memoryPath, JSON.stringify({ entries, changes: [], seq: 0, files: {},
    receipts: [], grants: [], turns: [], nextId: 0 }));
  seed([valid]);
  const pilot = f.cost().memoryPilot;
  for (const field of ['extraMainRoleRequestsPerTurn', 'firstTurnTokens', 'factMiss', 'proposalPassRate']) {
    assert.ok(Object.hasOwn(pilot, field), `preserves ${field}`);
  }
  assert.equal(pilot.proposalPassRate, 0.5, 'one acceptance out of two reviewed proposals, with one pending');
  assert.equal(pilot.indexSubstantiveRatio, 1, 'a compliant summary gives a fully readable index');
  seed([valid, { ...valid, id: 'memory-a80c1dbb-5465-4a91-961f-db442622cafc', title: '' }]);
  const ratio = f.cost().memoryPilot.indexSubstantiveRatio;
  assert.ok(Number.isFinite(ratio) && ratio >= 0 && ratio < 1, 'an empty title lowers the readable fraction');
});

test('8a readable index metrics count titled short IDs with or without a hook', async t => {
  const f = fixture(t);
  const entry = (prefix, fields) => ({
    id: 'memory-event-' + prefix.repeat(64), status: 'active', kind: 'ruling',
    project: f.project, layer: 'shared', ...fields,
  });
  const examples = [
    [entry('1', { title: 'R1 测试先行。', body: '测试先行。' }), true],
    [entry('2', { title: 'R32 Approve project proposals', body: 'Review the proposal evidence before approval.' }), true],
    [entry('3', { title: '', body: 'Review the proposal evidence before approval.' }), false],
    [entry('4', { title: 'R34 Verify gate evidence', body: 'See the entry for details.' }), false],
    [entry('5', { id: '5'.repeat(64), title: '', body: '' }), false],
    [entry('6', { title: 'R7 验收须核对证据。', body: '验收须核对证据。' }), true],
  ];
  const runtime = join(f.project, '.project', 'loomd');
  mkdirSync(runtime, { recursive: true });
  writeFileSync(join(runtime, 'memory-v1.json'), JSON.stringify({ entries: examples.map(([row]) => row) }));

  assert.deepEqual({
    readable: examples.map(([row]) => substantiveIndexRow(row)),
    ratio: f.cost().memoryPilot.indexSubstantiveRatio,
  }, {
    readable: examples.map(([, readable]) => readable),
    ratio: 3 / examples.length,
  });
});

function r3bStageInputs(f, runner) {
  const { raw, status } = f.requests.at(-1);
  assert.equal(status, 200);
  return { child: runner.exchange().input, upstream: JSON.parse(JSON.parse(raw).messages[0].content) };
}

test('6e.2 stage upstream receives observation rules and queues nothing for an empty result', async t => {
  const f = fixture(t);
  const runner = fakeOpenCode(t, f.root);
  seedLegacyStageMemory(f.project);
  const leader = await f.spawn('leader', 'Observe only the fixture progress check.');
  await f.finish(leader, noiseFacts[2][2]);
  await completeStageGate(f, leader, 'G6E-STAGE-GUIDANCE');
  assert.equal(f.requests.length, 2);
  const { child, upstream } = r3bStageInputs(f, runner);
  assert.equal(upstream.instructions, child.instructions, 'the stage passes the same rules to the upstream model');
  assert.deepEqual(readExtractorState(f.project).proposals, {});
  assertExtractionGuidance(upstream.instructions);
  assertDurableWritingRules(upstream.instructions);
});

test('6e.2 stage organizer rejects supported noise even when it names an existing memory', async t => {
  let proposed = [];
  const f = fixture(t, { proposals: count => count === 2 ? proposed : [] });
  const runner = fakeOpenCode(t, f.root);
  seedLegacyStageMemory(f.project);
  const leader = await f.spawn('leader', 'Review the release notes for any lasting corrections.');
  const source = { kind: 'delivery', id: deliveryId(f.prompts.at(-1).input) };
  const durable = 'Why: The archive needs verifiable signatures.\nHow to apply: Save the signed manifest during each release.';
  proposed = [...noiseFacts, ['correct-fixture', 'Archive release manifests', durable]].map(([id, title, body]) => ({
    id, action: 'correct', scope: 'project', source, title, body, target: 'stage-existing',
  }));
  await f.finish(leader, [...noiseFacts.map(([, , body]) => body), durable].join('\n'));
  await completeStageGate(f, leader, 'G6E-STAGE-FILTER');
  assert.equal(f.requests.length, 2);
  const { upstream } = r3bStageInputs(f, runner);
  assert.ok(upstream.existing.project.some(({ id }) => id === 'stage-existing'));
  assert.deepEqual(Object.keys(readExtractorState(f.project).proposals), ['correct-fixture']);
});

test('6b R25: stored user preferences and rulings stay out of turn and stage requests', async t => {
  const f = fixture(t);
  const runner = fakeOpenCode(t, f.root);
  seedLegacyStageMemory(f.project);
  const leader = await f.spawn('leader', 'Review the fixture records.');
  const superAddr = await f.spawn('super', 'Record the user fixture entries.');
  for (const kind of ['preference', 'ruling']) {
    const body = `G6B_USER_${kind.toUpperCase()}_BODY`;
    const { item } = await f.daemon.handle('mem', { action: 'write', requestId: `g6b-user-${kind}`,
      expectedRevision: null, entry: { layer: 'user', project: null, kind, title: `Fixture ${kind}`, body,
        checkedAt: '2026-11-26T12:00:00.000Z', source: { path: 'fixture.txt' } } }, superAddr);
    const { item: stored } = await f.daemon.handle('mem', { action: 'show', target: item.id }, superAddr);
    assert.deepEqual({ layer: stored.layer, kind: stored.kind, body: stored.body }, { layer: 'user', kind, body });
  }
  await f.finish(leader, 'Review complete for the fixture records.');
  assert.equal(f.requests.length, 1, 'the ordinary turn reached upstream');
  const [turn] = f.requests;
  assert.equal(extractorRequestInput(turn).reply, 'Review complete for the fixture records.');
  await completeStageGate(f, leader, 'G6B-USER-SCOPE');
  assert.equal(f.requests.length, 2, 'the stage reached upstream');
  const { child, upstream } = r3bStageInputs(f, runner);
  for (const input of [child, upstream]) {
    assert.ok(input.existing.project.some(({ id, body }) => id === 'stage-existing' && body.trim() === 'Keep fixture records.'));
  }
  const stage = f.requests.at(-1);
  const hits = payload => JSON.stringify(payload).match(/G6B_USER_(?:PREFERENCE|RULING)_BODY/g) ?? [];
  const requestFields = ({ path, method, headers, raw }) => ({ path, method, headers, raw });
  assert.deepEqual({ turn: hits(requestFields(turn)), child: hits(child), upstream: hits(requestFields(stage)) },
    { turn: [], child: [], upstream: [] });
});

test('6e.3 R25 and R23: synced ledger ruling is indexed locally and never sent to organizers', async t => {
  const f = fixture(t);
  const runner = fakeOpenCode(t, f.root);
  seedLegacyStageMemory(f.project);
  const sentinel = 'SYNCED_LEDGER_RULING_BODY_SENTINEL';
  const body = `Require signed recovery manifests. ${sentinel}`;
  writeFileSync(join(f.project, '.project', 'rulings.md'), `# 裁决账本\nR42. ${body}\n`);
  const superAddr = await f.spawn('super', 'Record the user ruling.');
  await f.finish(superAddr, 'Recorded R42 in .project/rulings.md.');
  const leader = await f.spawn('leader', 'Review the fixture records.');
  const auditor = await f.spawn('auditor', 'Check the local ruling index.');
  for (const addr of [leader, auditor]) {
    const { rows } = await f.daemon.handle('mem', { action: 'search', target: sentinel }, addr);
    assert.equal(rows.length, 1);
    const { item } = await f.daemon.handle('mem', { action: 'show', target: rows[0].id }, addr);
    assert.equal(item.layer, 'user');
    assert.equal(item.kind, 'ruling');
    assert.ok(item.body.includes(body));
    assert.equal(item.source.path, '.project/rulings.md');
  }
  await f.finish(leader, 'Review complete for the fixture records.');
  assert.equal(f.requests.length, 1, 'the turn reached upstream');
  await completeStageGate(f, leader, 'SYNCED-LEDGER-SCOPE');
  assert.equal(f.requests.length, 2, 'the stage reached upstream');
  const [turn, stage] = f.requests;
  const requestFields = ({ path, method, headers, raw }) => ({ path, method, headers, raw });
  for (const [channel, payload] of Object.entries({
    turn: requestFields(turn), child: runner.exchange().input, stage: requestFields(stage),
  })) {
    assert.ok(!JSON.stringify(payload).includes(sentinel), `ruling source text leaked to ${channel}`);
  }
});

test('6b stage sends worker activity without any raw worker reply lines', async t => {
  const f = fixture(t);
  const runner = fakeOpenCode(t, f.root);
  seedLegacyStageMemory(f.project);
  const leader = await f.spawn('leader', 'Prepare the worker activity fixture.');
  await f.finish(leader, 'Ready to review the worker activity.');
  const worker = await f.spawn('worker', 'Read the fixture record.', leader, { task: 'G6B-WORKER-ACTIVITY' });
  const headSentinel = 'WORKER_HEAD_RAW_SENTINEL_G6B';
  const tailSentinel = 'WORKER_TAIL_RAW_SENTINEL_G6B';
  await f.finish(worker, `${headSentinel}\n${tailSentinel}\nDONE FIXTURE`, { tools: true });
  await completeStageGate(f, leader, 'G6B-WORKER-PRIVACY');
  assert.equal(f.requests.length, 2, 'the stage reached upstream after the Leader turn');
  const { child, upstream } = r3bStageInputs(f, runner);
  for (const [channel, input] of Object.entries({ child, upstream })) {
    const [activity] = input.workerSummaries.filter(({ addr }) => addr === worker);
    assert.ok(activity, `${channel} includes the worker turn`);
    assert.match(activity.summary, /G6B-WORKER-ACTIVITY/);
    assert.match(activity.summary, /工具 [1-9]\d*\b/, `${channel} preserves a positive tool count`);
  }
  const { path, method, headers, raw } = f.requests.at(-1);
  const rawReplyHits = payload => [headSentinel, tailSentinel].filter(sentinel => JSON.stringify(payload).includes(sentinel));
  assert.deepEqual({ child: rawReplyHits(child), upstream: rawReplyHits({ path, method, headers, raw }) },
    { child: [], upstream: [] });
});

test('6b reserves the provider input estimate and maximum output within the remaining daily tokens', async t => {
  const dailyTokens = 2100;
  // This provider adds a fixed chat template before tokenizing the messages.
  const inputTokens = ({ messages }) => estimateTokens(JSON.stringify(messages)) + 1000;
  const usage = (request, number) => ({ input: inputTokens(request), output: number === 1 ? 7 : request.max_tokens });
  const f = fixture(t, { config: { limits: { dailyTokens } }, usage });
  const leader = await f.spawn('leader', 'Prepare the budget fixture.');
  await f.finish(leader, 'First budgeted turn.');
  assert.equal(f.requests.length, 1);
  const first = usage(JSON.parse(f.requests[0].raw), 1);
  const remaining = dailyTokens - first.input - first.output;
  assert.ok(remaining > 0 && remaining < 1024, 'the first settlement leaves less than a full output allowance');
  await f.send(leader, 'Check the remaining token budget.');
  await f.finish(leader, 'Second budgeted turn.');

  const second = f.requests[1] && JSON.parse(f.requests[1].raw);
  const required = second ? inputTokens(second) + second.max_tokens : 0;
  const [day] = Object.values(readExtractorState(f.project).days);
  const violations = [];
  if (required > remaining) violations.push(`sent a request for ${required} tokens with ${remaining} remaining`);
  if (day.charged > dailyTokens) violations.push(`charged ${day.charged} tokens against a cap of ${dailyTokens}`);
  if (day.tokens > dailyTokens) violations.push(`settled ${day.tokens} tokens against a cap of ${dailyTokens}`);
  assert.deepEqual(violations, []);
});

test('6b competing stage requests keep outstanding and settled tokens within the daily limit', async t => {
  const dailyTokens = 2000;
  const inputTokens = ({ messages }) => estimateTokens(JSON.stringify(messages));
  const firstRequest = Promise.withResolvers();
  const release = Promise.withResolvers();
  let outstanding = 0;
  let peak = 0;
  const reservations = [];
  const f = fixture(t, { config: { limits: { dailyTokens } },
    usage: request => ({ input: inputTokens(request), output: request.max_tokens }),
    async beforeResponse(request) {
      const required = inputTokens(request) + request.max_tokens;
      outstanding += required;
      peak = Math.max(peak, outstanding);
      reservations.push(Object.values(readExtractorState(f.project).days)[0].charged);
      firstRequest.resolve(request);
      await release.promise;
      outstanding -= required;
    },
  });
  fakeOpenCode(t, f.root);
  seedLegacyStageMemory(f.project);
  const leader = await f.spawn('leader', 'Prepare the concurrent stage fixture.');
  const workers = [];
  for (const suffix of ['FIRST', 'SECOND']) {
    workers.push(await f.spawn('worker', 'Check the fixture.', leader, { task: `G6B-CONCURRENT-${suffix}` }));
  }
  for (const [index, gate] of ['G6B-CONCURRENT-FIRST', 'G6B-CONCURRENT-SECOND'].entries()) {
    f.advance(1000);
    f.finishTurn(workers[index], 'Fixture check complete.', { tools: true });
    await f.daemon.handle('notifications', { gateComplete: gate }, leader);
  }

  const firstTick = f.daemon.tick();
  let competingTick;
  try {
    const first = await Promise.race([firstRequest.promise, firstTick.then(() => assert.fail('no stage request reached the provider'))]);
    const fullRequest = inputTokens(first) + 1024;
    assert.ok(fullRequest <= dailyTokens && 2 * 1024 > dailyTokens,
      'the daily budget fits one full request and cannot fit two full output allowances');
    competingTick = f.daemon.tick();
    await new Promise(resolve => setImmediate(resolve));
  } finally {
    release.resolve();
    await Promise.all([firstTick, competingTick]);
  }
  const [day] = Object.values(readExtractorState(f.project).days);
  const settled = f.requests.reduce((total, { raw }) => {
    const request = JSON.parse(raw);
    return total + inputTokens(request) + request.max_tokens;
  }, 0);
  assert.equal(day.stageTokens, settled, 'the ledger accounts for every stage response');
  assert.ok(Math.max(peak, ...reservations, settled, day.charged) <= dailyTokens,
    `daily cap ${dailyTokens}; outstanding peak ${peak}, reservations ${reservations.join(', ')}, settled ${settled}, charged ${day.charged}`);
});

test('6b stage catches up a daily-cap window at the next boundary exactly once', async t => {
  const f = fixture(t, { config: { limits: { dailyCalls: 2 } } });
  const runner = fakeOpenCode(t, f.root);
  seedLegacyStageMemory(f.project);
  const leader = await f.spawn('leader', 'Prepare the daily-cap fixture.');
  const auditor = await f.spawn('auditor', 'Review the daily-cap fixture.');
  const skippedReplies = ['Leader history from the capped day.', 'Auditor history from the capped day.'];
  await f.finish(leader, skippedReplies[0]);
  f.advance(1000);
  await f.finish(auditor, skippedReplies[1]);
  assert.equal(f.addresses.length, 2, 'the ordinary turns exhaust the daily call allowance');
  await completeStageGate(f, leader, 'G6B-STAGE-DAILY-CAP');
  assert.equal(f.addresses.length, 2, 'the capped boundary sends no provider request');
  assert.throws(() => runner.exchange(), { code: 'ENOENT' }, 'the capped boundary launches no child');
  assert.equal(Object.values(readExtractorState(f.project).days)[0].stopReason, 'dailyCalls');

  f.advance();
  await f.tick();
  assert.equal(f.addresses.length, 2, 'rollover alone does not send the window');
  await completeStageGate(f, leader, 'G6B-STAGE-DAILY-RECOVERY');
  assert.equal(f.requests.length, 3, 'the first boundary after rollover reaches upstream');
  const stagedReplies = () => Object.values(r3bStageInputs(f, runner))
    .map(({ history }) => history.map(({ reply }) => reply));
  assert.deepEqual(stagedReplies(), [skippedReplies, skippedReplies], 'both targets receive the retained window');

  f.advance();
  await f.send(leader, 'Prepare new history after recovery.');
  const freshReply = 'Fresh history after the recovered window.';
  await f.finish(leader, freshReply);
  await completeStageGate(f, leader, 'G6B-STAGE-DAILY-NEXT');
  assert.equal(f.requests.length, 5, 'the next boundary also reaches upstream');
  assert.deepEqual(stagedReplies(), [[freshReply], [freshReply]], 'the recovered history is sent only once');
});

function stageRequestsSince(f, offset) {
  return f.requests.slice(offset).flatMap(({ raw, status }) => {
    const { messages: [{ content }] } = JSON.parse(raw);
    if (!content.startsWith('{')) return [];
    const { history } = JSON.parse(content);
    return [{ status, bytes: Buffer.byteLength(raw), replies: history.map(({ reply }) => reply) }];
  });
}

function assertStageBatches(requests, expectedReplies, maxInputBytes) {
  assert.deepEqual(requests.flatMap(({ replies }) => replies), expectedReplies,
    'stage requests deliver each expected reply in chronological order exactly once');
  for (const { status, bytes } of requests) {
    assert.equal(status, 200);
    assert.ok(bytes <= maxInputBytes, `stage request is ${bytes} bytes (limit ${maxInputBytes})`);
  }
}

test('6b stage splits a single boundary over maxInputBytes and continues at the next boundary', async t => {
  const maxInputBytes = 4200;
  const f = fixture(t, { config: { limits: { maxInputBytes } } });
  fakeOpenCode(t, f.root);
  seedLegacyStageMemory(f.project);
  const leader = await f.spawn('leader', 'Prepare the bounded stage fixture.');
  const replies = ['First', 'Second', 'Third'].map(order => `${order} stage reply. ${'界'.repeat(490)}`);
  assert.ok(Buffer.byteLength(replies.join('')) > maxInputBytes, 'the replies alone exceed the window limit');
  for (const [index, reply] of replies.entries()) {
    f.advance(1000);
    if (index) await f.send(leader, 'Add another turn to the same stage window.');
    await f.finish(leader, reply);
  }
  const { enrolledAt } = readExtractorState(f.project);
  const firstOffset = f.requests.length;
  await completeStageGate(f, leader, 'G6B-STAGE-BYTES');
  const batches = stageRequestsSince(f, firstOffset);
  assert.ok(batches.length > 1, 'the oversized window is split across multiple requests');
  assertStageBatches(batches, replies, maxInputBytes);
  assert.equal(readExtractorState(f.project).stageAt, enrolledAt + 3000);

  f.advance(1000);
  await f.send(leader, 'Add history for the following boundary.');
  const freshReply = 'Fresh reply after splitting the window.';
  await f.finish(leader, freshReply);
  const nextOffset = f.requests.length;
  await completeStageGate(f, leader, 'G6B-STAGE-BYTES-NEXT');
  assertStageBatches(stageRequestsSince(f, nextOffset), [freshReply], maxInputBytes);
  assert.equal(readExtractorState(f.project).stageAt, enrolledAt + 4000);
});

test('6b stage batches an accumulated window over maxInputBytes after consecutive upstream failures', async t => {
  const maxInputBytes = 4200;
  let status = 200;
  const f = fixture(t, { config: { limits: { maxInputBytes } }, statusFor: () => status });
  fakeOpenCode(t, f.root);
  seedLegacyStageMemory(f.project);
  const leader = await f.spawn('leader', 'Prepare the accumulated stage fixture.');
  const failedReplies = ['First', 'Second'].map(order => `${order} failed-stage reply. ${'界'.repeat(180)}`);
  for (const [index, reply] of failedReplies.entries()) {
    f.advance(1000);
    if (index) await f.send(leader, 'Add one turn to the pending stage window.');
    await f.finish(leader, reply);

    const offset = f.requests.length;
    status = 503;
    await completeStageGate(f, leader, `G6B-STAGE-BYTES-FAILURE-${index + 1}`);
    status = 200;
    const attempts = stageRequestsSince(f, offset);
    assert.deepEqual(attempts.map(({ status }) => status), [503], `boundary ${index + 1} fails at upstream`);
    assert.ok(attempts[0].replies.includes(reply), 'the failing request reaches upstream with the new turn');
    assert.equal(readExtractorState(f.project).stageAt, undefined, 'failures leave the stage cursor unadvanced');
  }
  const recoveryReplies = ['Third', 'Fourth', 'Fifth'].map(order => `${order} recovery reply. ${'界'.repeat(360)}`);
  for (const reply of recoveryReplies) {
    f.advance(1000);
    await f.send(leader, 'Add history before the first boundary after upstream recovery.');
    await f.finish(leader, reply);
  }
  const replies = [...failedReplies, ...recoveryReplies];
  assert.ok(Buffer.byteLength(replies.join('')) > maxInputBytes, 'the accumulated replies alone exceed the limit');
  const { enrolledAt } = readExtractorState(f.project);
  const recoveryOffset = f.requests.length;
  await completeStageGate(f, leader, 'G6B-STAGE-BYTES-RECOVERY');
  const batches = stageRequestsSince(f, recoveryOffset);
  assert.ok(batches.length > 1, 'recovery splits the accumulated window across multiple requests');
  assertStageBatches(batches, replies, maxInputBytes);
  assert.equal(readExtractorState(f.project).stageAt, enrolledAt + 5000);

  f.advance(1000);
  await f.send(leader, 'Add history after the recovered stage.');
  const freshReply = 'Fresh reply after recovery.';
  await f.finish(leader, freshReply);
  const nextOffset = f.requests.length;
  await completeStageGate(f, leader, 'G6B-STAGE-BYTES-AFTER-RECOVERY');
  assertStageBatches(stageRequestsSince(f, nextOffset), [freshReply], maxInputBytes);
  assert.equal(readExtractorState(f.project).stageAt, enrolledAt + 6000);
});

test('6b stage warns and skips a single turn over maxInputBytes while processing later history', async t => {
  const maxInputBytes = 4200;
  const f = fixture(t, { config: { limits: { maxInputBytes } } });
  fakeOpenCode(t, f.root);
  seedLegacyStageMemory(f.project);
  const leader = await f.spawn('leader', 'Prepare the oversized turn fixture.');
  const oversizedReply = `Oversized stage reply. ${'界'.repeat(1500)}`;
  assert.ok(Buffer.byteLength(JSON.stringify(oversizedReply)) > maxInputBytes, 'one reply alone exceeds the limit');
  await f.finish(leader, oversizedReply);
  f.advance(1000);
  await f.send(leader, 'Add a normal turn after the oversized one.');
  const normalReply = 'Normal reply after the oversized turn.';
  await f.finish(leader, normalReply);

  const { enrolledAt } = readExtractorState(f.project);
  const requestOffset = f.requests.length;
  const logOffset = f.logs.length;
  await completeStageGate(f, leader, 'G6B-STAGE-BYTES-SKIP');
  const requests = stageRequestsSince(f, requestOffset);
  assert.deepEqual({
    warned: f.logs.slice(logOffset).some(message => /maxInputBytes|oversize|byte limit/i.test(message)),
    replies: requests.flatMap(({ replies }) => replies),
    stageAt: readExtractorState(f.project).stageAt,
  }, { warned: true, replies: [normalReply], stageAt: enrolledAt + 1000 });
  assertStageBatches(requests, [normalReply], maxInputBytes);
});

for (const { name, itemCount, libraryExceedsLimit } of [
  { name: 'library alone exceeds maxInputBytes', itemCount: 9, libraryExceedsLimit: true },
  { name: 'library and one normal turn together exceed maxInputBytes', itemCount: 7, libraryExceedsLimit: false },
]) {
  test(`6b stage preserves a normal turn when the ${name}`, async t => {
    const maxInputBytes = 4200;
    const f = fixture(t, { config: { limits: { maxInputBytes } } });
    fakeOpenCode(t, f.root);
    for (let index = 1; index <= itemCount; index++) {
      writeMemory(f.project, { id: `budget-item-${index}`, scope: 'project', owner: 'leader', source: 'fixture.txt',
        verified: '2026-11-26', title: `Fixture procedure ${index}`,
        body: 'Review fixture records before closing the gate. '.repeat(10).trimEnd() });
    }
    const project = activeItems(f.project).map(({ meta, title, body }) => ({ id: meta.id, title, body }));
    assert.equal(project.length, itemCount, 'every seeded item is active');
    const existing = { project, reference: [] };
    const libraryBytes = Buffer.byteLength(JSON.stringify(existing));
    const reply = 'Normal stage turn. ' + 'Keep fixture history available. '.repeat(25).trimEnd();
    if (libraryExceedsLimit) {
      assert.ok(libraryBytes > maxInputBytes, 'the serialized library alone exceeds the request limit');
    } else {
      assert.ok(libraryBytes < maxInputBytes, 'the serialized library alone fits the request limit');
      assert.ok(libraryBytes + Buffer.byteLength(reply) > maxInputBytes,
        'the serialized library and the reply exceed the limit before request framing');
    }

    const leader = await f.spawn('leader', 'Prepare a normal turn with a populated project library.');
    f.advance(1000);
    await f.finish(leader, reply);
    assert.equal(f.requests.length, 1, 'the normal turn reaches the per-turn provider');
    assert.equal(extractorRequestInput(f.requests[0]).reply, reply);
    assert.ok(Buffer.byteLength(f.requests[0].raw) <= maxInputBytes, 'the normal per-turn request fits');

    const requestOffset = f.requests.length;
    const logOffset = f.logs.length;
    const boundary = await completeStageGate(f, leader, 'G6B-STAGE-LIBRARY-BYTES');
    const requests = stageRequestsSince(f, requestOffset);
    const { boundaries, turns, stageTurns } = readExtractorState(f.project);
    const [turnKey] = Object.keys(turns);
    assert.deepEqual({
      sentTurn: requests.some(({ replies }) => replies.includes(reply)),
      skipped: f.logs.slice(logOffset).some(message => /skipped oversized stage/i.test(message)),
      processedTurn: stageTurns?.[turnKey],
      processedBoundary: boundaries[boundary],
    }, { sentTurn: true, skipped: false, processedTurn: true, processedBoundary: true });
    assertStageBatches(requests, [reply], maxInputBytes);
  });
}

for (const failure of ['upstream HTTP error', 'unavailable credential']) {
  test(`6b stage recovers a failed history window at the next boundary after ${failure}`, async t => {
    let available = true;
    const f = fixture(t, { statusFor: () => !available && failure === 'upstream HTTP error' ? 503 : 200,
      fixtureCredential: () => !available && failure === 'unavailable credential' ? null : fixtureKey });
    const runner = fakeOpenCode(t, f.root);
    seedLegacyStageMemory(f.project);
    const leader = await f.spawn('leader', 'Prepare the retry fixture.');
    const priorReply = 'History from the first stage window.';
    await f.finish(leader, priorReply);
    assert.equal(f.requests.length, 1);

    available = false;
    await completeStageGate(f, leader, 'G6B-STAGE-FAILURE');
    if (failure === 'upstream HTTP error') {
      assert.equal(f.requests.length, 2);
      assert.equal(f.requests.at(-1).status, 503);
      assert.match(f.requests.at(-1).raw, /History from the first stage window/);
    } else {
      assert.equal(f.requests.length, 1);
      assert.ok(f.keyReads.length > 1, 'the boundary attempted to read the credential');
    }

    available = true;
    const count = f.requests.length;
    await f.restart();
    assert.equal(f.requests.length, count, 'restart without a new boundary does not resend the window');
    f.advance(1000);
    await f.send(leader, 'Prepare the next stage window.');
    const nextReply = 'History from the next stage window.';
    await f.finish(leader, nextReply);
    assert.equal(f.requests.length, count + 1, 'only the per-turn request runs before the next boundary');
    await completeStageGate(f, leader, 'G6B-STAGE-RECOVERY');
    assert.equal(f.requests.length, count + 2);
    const stagedReplies = Object.fromEntries(Object.entries(r3bStageInputs(f, runner))
      .map(([channel, { history }]) => [channel, history.map(({ reply }) => reply)]));
    assert.deepEqual(stagedReplies, { child: [priorReply, nextReply], upstream: [priorReply, nextReply] });
  });
}

for (const queued of [false, true]) {
  test(`6b stage never resends a successful window ${queued ? 'after queueing a correction' : 'with an empty library and no correction'}`, async t => {
    const stages = [];
    let proposals = [];
    const f = fixture(t, { runStage: async input => { stages.push(input); return proposals; } });
    const leader = await f.spawn('leader', 'Prepare the stage replay fixture.');
    await f.finish(leader, 'Ready for the first round.');
    const body = 'I prefer compact fixture reports.';
    const { id } = await f.send(leader, body);
    const oldReply = 'First stage window acknowledged.';
    await f.finish(leader, oldReply);
    if (queued) proposals = [{ id: 'g6b-replay-correction', action: 'correct', scope: 'user', body,
      source: { kind: 'delivery', id } }];
    await completeStageGate(f, leader, 'G6B-STAGE-ONCE');
    assert.equal(stages.length, 1);
    assert.ok(stages[0].history.some(({ reply }) => reply === oldReply));
    const items = Object.values(readExtractorState(f.project).proposals);
    assert.deepEqual(items.map(({ id, status }) => [id, status]), queued ? [['g6b-replay-correction', 'pending']] : []);

    proposals = [];
    await f.restart();
    assert.equal(stages.length, 1, 'restart alone does not resend completed history');
    f.advance(1000);
    await f.send(leader, 'I prefer fixture reports with dates.');
    const newReply = 'Second stage window acknowledged.';
    await f.finish(leader, newReply);
    await completeStageGate(f, leader, 'G6B-STAGE-NEXT');
    assert.deepEqual(stages.slice(1).map(({ history }) => history.map(({ reply }) => reply)), [[newReply]]);
  });
}

test('R3B extractor only forwards inbox bodies from allowlisted sources', async t => {
  const f = fixture(t);
  // Inbox attempts use wall time. Keep the synthetic native events after those attempts.
  f.advance(Math.max(0, Date.now() - Date.UTC(2026, 10, 26, 12)) + 60_000);
  f.initGit();
  const runner = fakeOpenCode(t, f.root);
  seedLegacyStageMemory(f.project);
  const leader = await f.spawn('leader', 'Prepare inbox review.');
  const auditor = await f.spawn('auditor', 'Prepare to request a worker receipt.');
  const superAddr = await f.spawn('super', 'Prepare user oversight.');
  await f.finish(leader, 'Leader ready.');
  await f.finish(auditor, 'Auditor ready.');
  const worker = await f.spawn('worker', 'Run the inbox fixture.', leader, { deliver: 'stream' });
  const reviewer = await f.spawn('reviewer', 'Review the inbox fixture.', auditor, { task: 'INBOX-REVIEW' });
  const inbox = () => JSON.parse(f.read('.project/inbox/state.json')).messages;
  const deliveries = [];

  async function finishDelivery(addr, id, sentinel, allowed = false) {
    const prompt = f.prompts.find(entry => entry.addr === addr && deliveryId(entry.input) === id);
    assert.ok(prompt?.input.includes(sentinel), `${sentinel} reached the native turn for ${id}`);
    const count = f.requests.length;
    const reply = `Inbox fixture turn ${deliveries.length + 1} complete.`;
    await f.finish(addr, reply);
    assert.equal(inbox().find(message => message.id === id)?.completion?.body, reply);
    assert.equal(f.requests.length, count + 1, 'completion reached the per-turn provider');
    const request = f.requests.at(-1);
    const input = extractorRequestInput(request);
    assert.equal(input.reply, reply);
    deliveries.push({ id, sentinel, allowed, input, reply, raw: request.raw });
  }

  async function sendToLeader(caller, sentinel, allowed) {
    const text = allowed ? `${sentinel} ${fixtureKey}` : sentinel;
    const { id } = await f.daemon.handle('send', { target: leader, mode: 'queue', text }, caller);
    await f.tick();
    await finishDelivery(leader, id, text, allowed);
  }

  await sendToLeader(worker, 'SHORT_WORKER_MSG_SENTINEL_R3B', false);
  await sendToLeader(reviewer, 'SHORT_REVIEWER_MSG_SENTINEL_R3B', false);

  const batchSentinel = 'SHORT_BATCH_SENTINEL_R3B';
  await f.finish(worker, `DONE FIXTURE\n${batchSentinel}`);
  const batch = inbox().find(message => message.waveBatch && message.target.addr === leader);
  assert.ok(batch?.text.includes(batchSentinel), 'wave batch keeps the short worker reply');
  await finishDelivery(leader, batch.id, batchSentinel);

  const { id: requestId } = await f.daemon.handle('send', {
    target: worker, mode: 'queue', text: 'Confirm the worker fixture.', expectReply: true,
  }, auditor);
  await f.tick();
  const receiptSentinel = 'SHORT_RECEIPT_SENTINEL_R3B';
  await f.finish(worker, `DONE FIXTURE\n${receiptSentinel}`);
  const receipt = inbox().find(message => message.replyTo === requestId && message.target.addr === auditor);
  assert.ok(receipt?.replyKey && receipt.text.includes(receiptSentinel), 'automatic receipt keeps the short reply');
  await finishDelivery(auditor, receipt.id, receiptSentinel);

  await sendToLeader(undefined, 'USER_MSG_SENTINEL_R3B', true);
  await sendToLeader(superAddr, 'SUPER_MSG_SENTINEL_R3B', true);
  await sendToLeader(auditor, 'AUDITOR_MSG_SENTINEL_R3B', true);
  await sendToLeader(leader, 'LEADER_MSG_SENTINEL_R3B', true);

  const count = f.requests.length;
  await completeStageGate(f, leader, 'INBOX-ALLOWLIST');
  assert.equal(f.requests.length, count + 1, 'stage reached the upstream provider');
  const stages = r3bStageInputs(f, runner);
  const texts = new Set();
  const leaks = {};
  const denied = deliveries.filter(({ allowed }) => !allowed).map(({ sentinel }) => sentinel);
  function checkReceived(received, delivery, channel) {
    const body = received.find(({ source }) => source.id === delivery.id)?.text;
    if (delivery.allowed) {
      assert.equal(body, delivery.sentinel.replace(fixtureKey, '[REDACTED]'), `${channel} preserves the allowlisted body`);
    } else {
      assert.ok(typeof body === 'string' && body.trim(), `${channel} retains a placeholder for ${delivery.id}`);
      texts.add(body);
    }
  }
  for (const delivery of deliveries) {
    checkReceived(delivery.input.received, delivery, 'per-turn');
    leaks[`per-turn received ${delivery.reply}`] = denied.filter(sentinel =>
      JSON.stringify(delivery.input.received).includes(sentinel));
    leaks[`per-turn request ${delivery.reply}`] = denied.filter(sentinel => delivery.raw.includes(sentinel));
  }
  const { path, method, headers, raw } = f.requests.at(-1);
  const stageRequests = { child: stages.child, upstream: { path, method, headers, raw } };
  for (const [channel, { workerSummaries, history }] of Object.entries(stages)) {
    for (const delivery of deliveries) {
      const turn = history.find(({ reply }) => reply === delivery.reply);
      assert.ok(turn, `${channel} stage contains the completed inbox turn`);
      checkReceived(turn.received, delivery, `${channel} stage`);
    }
    assert.equal(workerSummaries.filter(({ addr }) => addr === worker).length, 2,
      `${channel} stage retains both worker activity summaries`);
    leaks[`${channel} stage request`] = denied.filter(sentinel => JSON.stringify(stageRequests[channel]).includes(sentinel));
  }
  assert.deepEqual({ leaks: Object.fromEntries(Object.entries(leaks).filter(([, hits]) => hits.length)),
    placeholderCount: texts.size }, { leaks: {}, placeholderCount: 1 });
});

test('R3B extractor excludes raw red escalation evidence from outbound requests', async t => {
  const f = fixture(t);
  f.initGit();
  const runner = fakeOpenCode(t, f.root);
  seedLegacyStageMemory(f.project);
  const leader = await f.spawn('leader', 'Start the escalation fixture.');
  await f.spawn('auditor', 'Prepare to receive the escalation.');
  const evidence = 'RED_ESCALATION_EVIDENCE_SENTINEL_R3B';
  const escalation = await f.daemon.handle('escalate', { gate: 'RED-EVIDENCE', reason: 'confirmed-fact-miss', evidence }, leader);
  assert.equal(readFileSync(join(f.project, escalation.evidencePath), 'utf8'), evidence);
  const notices = JSON.parse(f.read('.project/loomd/notifications.json'));
  const red = notices.find(event => event.type === 'red-escalation' && event.addr === leader);
  assert.equal(red?.text, evidence, 'the escalation persisted the raw evidence during the open Leader turn');

  const reply = 'Escalation fixture complete.';
  await f.finish(leader, reply);
  assert.equal(f.requests.length, 1);
  const turnRequest = f.requests[0];
  const turn = extractorRequestInput(turnRequest);
  assert.equal(turn.reply, reply);
  await completeStageGate(f, leader, 'RED-EVIDENCE');
  assert.equal(f.requests.length, 2);
  const stages = r3bStageInputs(f, runner);
  for (const [channel, input] of Object.entries(stages)) {
    const history = input.history.find(entry => entry.reply === reply);
    assert.ok(history && history.startedAt <= red.at && red.at <= history.at,
      `${channel} stage contains the turn whose time window includes the escalation`);
  }
  const outbound = { 'per-turn events': JSON.stringify(turn.events), 'per-turn request': turnRequest.raw,
    'stage child events': JSON.stringify(stages.child.events), 'stage child input': JSON.stringify(stages.child),
    'stage upstream events': JSON.stringify(stages.upstream.events), 'stage upstream request': f.requests[1].raw };
  assert.deepEqual(Object.keys(outbound).filter(channel => outbound[channel].includes(evidence)), []);
});

test('T100 reference pointers are not misclassified as noise while repo source paths remain filtered', async t => {
  let proposals = [];
  const f = fixture(t, { proposals: () => proposals });
  mkdirSync(join(f.project, 'src'), { recursive: true });
  writeFileSync(join(f.project, 'src', 'auth.mjs'), 'export const auth = () => true;\n');
  const leader = await f.spawn('leader', 'Record external reference pointers from this turn.');
  const source = { kind: 'delivery', id: deliveryId(f.prompts.at(-1).input) };
  const references = [
    ['ref-linear', 'Architecture decisions pointer', 'Architecture decisions can be found in Linear project INGEST.'],
    ['ref-grafana', 'Ingest latency dashboard', 'Dashboard lives in grafana/prod-ingest，用于排查线上吞吐抖动。'],
    ['ref-runbook', 'On-call runbook location', 'The on-call escalation guide can be found in wiki/ops/oncall-runbook.'],
  ];
  const repoNoise = ['repo-source-noise', 'Auth handler location', 'The auth handler lives in src/auth.mjs:42.'];
  proposals = [...references, repoNoise].map(([id, title, body]) => ({
    id, action: 'add', scope: 'project', source, title, body,
  }));
  await f.finish(leader, proposals.map(({ body }) => body).join('\n'));
  assert.equal(f.requests.length, 1);
  const state = readExtractorState(f.project);
  assert.deepEqual(Object.keys(state.proposals).sort(), references.map(([id]) => id).sort(),
    'valid external/document reference pointers must reach review even without English Why/How to apply labels');
  for (const [id] of references) {
    assert.equal(state.proposals[id]?.status, 'pending', `${id} must be queued for review`);
  }
  assert.equal(state.proposals[repoNoise[0]], undefined, 'real repository source path noise must still be filtered');
  assert.deepEqual(f.cost().memoryExtractor.diagnostics.filterReasons, { noise: 1 });
});

test('T100 per-turn extractor runs on NOREPLY turns when received includes a Super or user message and skips worker-only NOREPLY', async t => {
  const f = fixture(t);
  const leader = await f.spawn('leader', 'Prepare Leader for correction turns.');
  const auditor = await f.spawn('auditor', 'Prepare Auditor for ruling turns.');
  const superAddr = await f.spawn('super', 'Prepare Super oversight.');
  await f.finish(leader, 'Leader initialized.');
  await f.finish(auditor, 'Auditor initialized.');
  const baseline = f.requests.length;

  const userCorrection = 'Correction: never push directly to main without explicit approval.';
  await f.send(leader, userCorrection);
  await f.finish(leader, 'NOREPLY');
  assert.equal(f.requests.length, baseline + 1, 'NOREPLY turn with direct user correction must invoke extractor');
  const userTurn = extractorRequestInput(f.requests.at(-1));
  assert.equal(userTurn.reply, 'NOREPLY');
  assert.ok(userTurn.received.some(item => item.text.includes(userCorrection)));

  const superRuling = 'Super 裁决：以后所有门禁必须附带隔离沙箱测试结果。';
  await f.daemon.handle('send', { target: auditor, mode: 'queue', text: superRuling }, superAddr);
  await f.tick();
  await f.finish(auditor, '收到');
  assert.equal(f.requests.length, baseline + 2, 'ack-only turn with Super ruling must invoke extractor');
  const superTurn = extractorRequestInput(f.requests.at(-1));
  assert.equal(superTurn.reply, '收到');
  assert.ok(superTurn.received.some(item => item.text.includes(superRuling)));

  const worker = await f.spawn('worker', 'Run routine worker task.', leader, { deliver: 'stream' });
  await f.daemon.handle('send', { target: leader, mode: 'queue', text: 'Routine worker ping.' }, worker);
  await f.tick();
  await f.finish(leader, 'NOREPLY');
  assert.equal(f.requests.length, baseline + 2, 'NOREPLY turn with only worker/non-user message must still be skipped');
});

test('T103 isNoise filters real repo directories without extensions and allows arbitrary non-repo external pointers without keyword allowlists', async t => {
  let proposals = [];
  const f = fixture(t, { proposals: () => proposals });
  mkdirSync(join(f.project, 'daemon', 'subpkg'), { recursive: true });
  mkdirSync(join(f.project, 'docs', 'architecture'), { recursive: true });
  writeFileSync(join(f.project, 'daemon', 'memory-extractor.mjs'), 'export const extractor = () => true;\n');
  const leader = await f.spawn('leader', 'Record external pointers and ignore repo layout details.');
  const source = { kind: 'delivery', id: deliveryId(f.prompts.at(-1).input) };
  const externalPointers = [
    ['ref-metabase', 'Release KPI dashboard', 'Release metrics dashboard lives in metabase/prod-release-kpi.'],
    ['ref-notion', 'Sev1 incident playbook', 'Incident playbooks can be found in notion/eng-ops/sev1-checklist.'],
  ];
  const repoNoise = [
    ['repo-dir-daemon', 'Scheduler module directory', 'The scheduler modules live in daemon/subpkg.'],
    ['repo-dir-docs', 'Architecture docs directory', 'Design notes are located in docs/architecture.'],
    ['repo-file-no-line', 'Extractor implementation file', 'Extractor logic is located in daemon/memory-extractor.mjs.'],
  ];
  proposals = [...externalPointers, ...repoNoise].map(([id, title, body]) => ({
    id, action: 'add', scope: 'project', source, title, body,
  }));
  await f.finish(leader, proposals.map(({ body }) => body).join('\n'));
  assert.equal(f.requests.length, 1);
  const state = readExtractorState(f.project);
  assert.deepEqual(Object.keys(state.proposals).sort(), externalPointers.map(([id]) => id).sort(),
    'arbitrary non-repo external pointers must pass without keyword allowlists while real repo directories/files are filtered');
  for (const [id] of externalPointers) {
    assert.equal(state.proposals[id]?.status, 'pending', `${id} must be queued for review`);
  }
  for (const [id] of repoNoise) {
    assert.equal(state.proposals[id], undefined, `${id} pointing to real repo path must be filtered as noise`);
  }
  assert.deepEqual(f.cost().memoryExtractor.diagnostics.filterReasons, { noise: 3 });
});
