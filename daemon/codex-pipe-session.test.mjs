import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { events, u32 } from '../holder/protocol.mjs';
import { codexPipeSession } from './codex-pipe-session.mjs';
import { oarDelivery } from './oar.mjs';

const capture = JSON.parse(readFileSync(new URL('../tasks/ADOPT-1/codex-recording.json', import.meta.url)));
const threadId = capture.thread.result.thread.id;
const turnId = capture.start.result.turn.id;
const makeInput = text => ({ id: randomUUID(), text });

function fixture(t, handler, options = {}) {
  const project = mkdtempSync(join(tmpdir(), 'loom-pipe-replay-'));
  t.after(() => rmSync(project, { recursive: true, force: true }));
  mkdirSync(join(project, '.project', 'relay', 'events'), { recursive: true });
  const row = { addr: 'oar-' + randomUUID(), cwd: project, model: capture.thread.result.model,
    effort: capture.thread.result.reasoningEffort, ...options.row };
  const incarnation = randomUUID();
  const journal = [], wire = [], signals = [];
  let offset = 0n, clock = Date.now(), writes = new Map();
  function record(type, data) {
    journal.push({ type, seq: BigInt(journal.length + 1), offset, data });
    if (type === events.output) offset += BigInt(data.length);
  }
  function frames(...rows) {
    record(events.output, Buffer.from(rows.map(row => JSON.stringify(row) + '\n').join('')));
  }
  const reply = (request, sample) => frames({ ...sample, id: request.id });
  const exit = (code, signal = 0) => record(events.exit, Buffer.concat([u32(signal), u32(code)]));
  const client = {
    async snapshot() { return { pipes: true, eventSeq: BigInt(journal.length), outputOffset: offset, stderrOffset: 0n }; },
    async read(after) { return journal.filter(event => event.seq > after); },
    async write(_condition, body, id) {
      if (writes.has(id)) return writes.get(id);
      if (options.blocked?.(wire)) return { status: 'would-block', written: 0 };
      const request = JSON.parse(body);
      wire.push(request);
      const receipt = { status: 'applied', written: body.length };
      writes.set(id, receipt);
      record(events.write, Buffer.alloc(20));
      if (request.method === 'initialize') reply(request, capture.initialize);
      if (request.method === 'thread/start' || request.method === 'thread/resume' && !options.row) reply(request, capture.thread);
      handler?.(request, { reply, frames, exit });
      return receipt;
    },
    async signal(signal) {
      signals.push(signal);
      if (signal === 'SIGKILL') exit(137, 9);
    },
  };
  const open = () => codexPipeSession(project, row, project, incarnation, client, () => {}, () => false,
    { now: () => clock, stopGraceMs: 0, controlWaitMs: 0 });
  return { open, frames, wire, signals, advance: ms => { clock += ms; }, time: () => clock };
}

test('recorded initialize reply after a lost write acknowledgement prevents duplicate initialization', async t => {
  let disconnected = false;
  const f = fixture(t, request => {
    if (request.method === 'initialize' && !disconnected) {
      disconnected = true;
      throw new Error('holder transport disconnected after write');
    }
  });
  await assert.rejects(f.open().ready(), /disconnected after write/);
  const resumed = f.open();
  await resumed.ready();
  assert.equal(resumed.sessionId, threadId);
  assert.deepEqual(f.wire.map(frame => frame.method), ['initialize', 'initialized', 'thread/start']);
});

test('an unanswered recorded RPC expires after two minutes across restart and retires the process group', async t => {
  const f = fixture(t);
  const first = f.open();
  await first.ready();
  const input = makeInput('standalone high \ud800 / low \udfff / valid 🐙');
  const before = f.time();
  assert.deepEqual(await first.control('prompt', input), { kind: 'pending', deadlineAt: before + 120_000 });
  assert.equal(f.wire.at(-1).params.input[0].text, '[loom:' + input.id + ']\nstandalone high � / low � / valid 🐙');
  f.advance(119_999);
  const resumed = f.open();
  await resumed.pull();
  assert.deepEqual(f.signals, []);
  f.advance(1);
  await resumed.pull();
  assert.deepEqual(f.signals, ['SIGTERM', 'SIGKILL']);
  assert.equal(resumed.receipt('prompt', input.id).kind, 'request-timeout');
  assert.deepEqual(oarDelivery({ id: input.id, attemptAt: before, mode: 'queue' }, { events: resumed.rows }),
    { failed: 'request-timeout', at: f.time() });
  assert.equal(resumed.rows.find(row => row.type === 'exited').signal, 9);
  assert.equal(f.wire.filter(frame => frame.method === 'turn/start').length, 1);
  await f.open().ready();
  assert.deepEqual(f.signals, ['SIGTERM', 'SIGKILL']);
});

test('an early native exit during a pending prompt fails it without replay or more signals', async t => {
  const f = fixture(t, (request, { exit }) => { if (request.method === 'turn/start') exit(23); });
  const runtime = f.open();
  await runtime.ready();
  const input = makeInput('one native submission');
  await runtime.control('prompt', input);
  const resumed = f.open();
  await resumed.ready();
  assert.equal(resumed.receipt('prompt', input.id).kind, 'runtime-exited');
  assert.equal(resumed.rows.find(row => row.type === 'exited').code, 23);
  assert.equal(f.wire.filter(frame => frame.method === 'turn/start').length, 1);
  assert.deepEqual(f.signals, []);
});

test('aborted turns terminate each captured process once before the next prompt, including across restart', async t => {
  let starts = 0;
  const f = fixture(t, (request, { reply }) => {
    if (request.method === 'turn/start') {
      const sample = structuredClone(capture.start);
      if (++starts > 1) sample.result.turn.id = 'turn-next';
      reply(request, sample);
    } else if (request.method === 'thread/backgroundTerminals/terminate') reply(request, { result: {} });
  });
  const first = f.open();
  await first.ready();
  await first.control('prompt', makeInput('initial input'));
  const started = processId => ({
    method: 'item/started', params: { threadId, turnId, item: { type: 'commandExecution', id: processId, processId } },
  });
  const aborted = structuredClone(capture.completed);
  aborted.params.turn.status = 'interrupted';
  f.frames(capture.started, started('pty-one'), started('pty-one'), started('pty-two'), aborted, aborted);
  await first.pull();
  const resumed = f.open();
  await resumed.ready();
  const next = makeInput('new turn');
  await resumed.control('prompt', next);
  await resumed.pull();
  assert.deepEqual(f.wire.filter(frame => frame.method === 'turn/start' || frame.method === 'thread/backgroundTerminals/terminate')
    .map(frame => frame.params.processId ?? frame.params.clientUserMessageId).slice(1), ['pty-one', 'pty-two', next.id]);
  for (const frame of f.wire.filter(frame => frame.params?.processId)) assert.equal(frame.params.threadId, threadId);
  f.frames({ ...started('keep-alive'), params: { ...started('keep-alive').params, turnId: 'turn-next' } },
    { ...capture.completed, params: { threadId, turn: { id: 'turn-next', status: 'completed' } } });
  await resumed.pull();
  assert.equal(f.wire.filter(frame => frame.params?.processId).length, 2);
});

test('structured provider overload allows five retries of the same delivery and then refuses it', async t => {
  const f = fixture(t, (request, { reply }) => {
    if (request.method === 'turn/start') reply(request, { error: { code: -32001, message: 'serverOverloaded' } });
  });
  const runtime = f.open();
  await runtime.ready();
  const input = makeInput('count every rejected attempt');
  await runtime.control('prompt', input);
  for (let step = 0; step < 12; step++) {
    f.advance(2500);
    await runtime.pull();
  }
  const requests = f.wire.filter(frame => frame.method === 'turn/start');
  assert.equal(requests.length, 6);
  assert.equal(new Set(requests.map(frame => frame.id)).size, 6);
  assert(requests.every(frame => frame.params.clientUserMessageId === input.id));
  assert.equal(runtime.receipt('prompt', input.id).kind, 'provider-overloaded');
  await assert.rejects(runtime.control('prompt', input), { kind: 'provider-overloaded' });
});

test('native structured turn failure takes precedence over incidental words in the diagnostic', async t => {
  const f = fixture(t, (request, { reply }) => {
    if (request.method === 'turn/start') reply(request, capture.start);
  });
  const runtime = f.open();
  await runtime.ready();
  await runtime.control('prompt', makeInput('check the outcome class'));
  const failed = structuredClone(capture.completed);
  Object.assign(failed.params.turn, { status: 'failed',
    error: { codexErrorInfo: 'contextWindowExceeded', message: 'request mentioned a rate limit' } });
  f.frames(failed);
  await runtime.pull();
  assert.equal(runtime.rows.find(row => row.type === 'turn-end').outcome.failure, 'input_too_large');
  assert.equal(runtime.rows.some(row => row.type === 'stuck'), false);
});

test('an active writer is classified as in_use and the rejected native process is retired', async t => {
  const f = fixture(t, (request, { reply }) => {
    if (request.method === 'thread/resume') reply(request, { error: { code: -32600,
      message: 'thread thread-recorded already has an active writer' } });
  }, { row: { sessionId: threadId } });
  await assert.rejects(f.open().ready(), { kind: 'in_use' });
  assert.equal(f.wire.filter(frame => frame.method === 'thread/resume').length, 1);
  assert.deepEqual(f.signals, ['SIGTERM', 'SIGKILL']);
});

test('the zero-byte resend budget persists and retires a session without sending input', async t => {
  const f = fixture(t, null, { blocked: wire => wire.some(frame => frame.method === 'thread/start') });
  const runtime = f.open();
  await runtime.ready();
  const input = makeInput('the holder will not write this');
  await runtime.control('prompt', input);
  for (let attempt = 0; attempt < 40; attempt++) await runtime.pull();
  const resumed = f.open();
  for (let attempt = 0; attempt < 30; attempt++) await resumed.pull();
  assert.equal(resumed.receipt('prompt', input.id).kind, 'retry-exhausted');
  assert.equal(f.wire.filter(frame => frame.method === 'turn/start').length, 0);
  assert.deepEqual(f.signals, ['SIGTERM', 'SIGKILL']);
});
