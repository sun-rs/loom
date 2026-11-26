import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, readlinkSync,
  rmSync, writeFileSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Duplex } from 'node:stream';
import { test } from 'node:test';
import { inspect } from 'node:util';
import { projectCost } from '../cli/cost.mjs';
import { projectSessions } from '../cli/project.mjs';
import { projectStatus } from '../cli/status.mjs';
import { deliveryId } from '../inbox/message.mjs';
import { searchMemory, writeMemory } from '../memory/project.mjs';
import { createSupervisor } from './supervisor.mjs';

const keyRef = 'loom-memory-extractor-deepseek';
const fixtureKey = 'synthetic-test-key';
const baseURL = 'http://127.0.0.1/fixture/v1';
const model = 'fixture-extractor';
const turnUsage = { input: 13, output: 7 };

function fakeProvider(t, { statusFor = () => 200, usage = turnUsage, proposals = () => [], networkError } = {}) {
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
    const content = JSON.stringify({ proposals: proposals(requests.length) });
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

function fixture(t, { config = {}, runStage, ...providerOptions } = {}) {
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
      return fixtureKey;
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
  async function finish(addr, reply, options) {
    const turnId = sessions.get(addr).finish(reply, options);
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
    tick, restart, spawn, finish, send, read, initGit,
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
  const worker = await f.spawn('worker', 'stage-worker', leader);
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
  assert.match(JSON.stringify(calls[0]), /stage-history/);
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
  assert.doesNotMatch(JSON.stringify(calls[1]), /stage-history/, 'stage history advances after a boundary');
  assert.doesNotMatch(JSON.stringify(calls[1]), /tool-(?:output|argument)-sentinel|file-content-sentinel/);
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
