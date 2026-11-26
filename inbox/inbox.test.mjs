import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { relay as waveRelay } from '../relay/project.mjs';
import { inbox, receipt } from './engine.mjs';
import { conclusoryReply, deliveryId, payloadDigest, wireText } from './message.mjs';
import { lookup, publish } from './store.mjs';
import { inputPlan, nativeDelivery, tui } from './tui.mjs';

const exec = promisify(execFile);
const tuiSamples = file => readFileSync(new URL('../tasks/TUI-REL-0/fixtures/' + file + '.txt', import.meta.url), 'utf8');
const screens = {
  codex: { idle: tuiSamples('codex-idle'), busy: tuiSamples('codex-busy-local') },
  claude: { idle: tuiSamples('claude-idle'), busy: tuiSamples('claude-busy-early') },
  agy: { idle: tuiSamples('agy-idle-good'), busy: tuiSamples('agy-clean-busy') },
};

function fixture(t) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'loom-inbox-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const eventDir = join(root, '.project/relay/events');
  mkdirSync(eventDir, { recursive: true });
  const sends = [];
  const keys = [];
  const terminals = new Map();
  let refuse;
  const call = async (command, addr, ...args) => {
    if (command === 'get') return structuredClone(terminals.get(addr));
    if (command === 'read') {
      const term = terminals.get(addr);
      const mode = term.status.state === 'working' ? 'busy' : 'idle';
      return { text: term.frame ?? screens[term.argv[0]][mode], complete: term.complete !== false, how: 'screen' };
    }
    if (command === 'keys') return keys.push([addr, ...args]);
    if (command === 'send') {
      if (refuse === 'status_mismatch') throw Object.assign(new Error(refuse), { kind: refuse });
      sends.push([addr, ...args]);
      if (refuse) throw new Error(refuse);
      return;
    }
    assert.fail(command);
  };
  const transport = tui(root, call, (message, snapshot) => call('send', message.target.addr,
    wireText(message.id, message.text), ...(snapshot.terminal.status?.state === 'idle' ? ['--if', 'idle'] : [])));
  const reopen = () => inbox(root, transport, () => {});
  const terminal = (addr, provider = 'codex', state = 'working', startup = true) => {
    const cwd = join(root, addr);
    mkdirSync(cwd);
    const result = {
      address: addr, cwd, argv: [provider], created_ms: 1000, state: 'live', turn: 0,
      status_ms: 2000, status: { state },
    };
    terminals.set(addr, result);
    if (startup) event(result, 'SessionStart');
    return result;
  };
  const event = (term, name, turn_id, fields = {}) => {
    const provider = term.argv[0];
    const ids = provider === 'agy' ? { conversationId: term.address } : { session_id: term.address, turn_id };
    appendFileSync(join(eventDir, `${term.address}.jsonl`), JSON.stringify({
      cwd: term.cwd, receivedAt: Date.now(), hook_event_name: name, ...ids, ...fields,
    }) + '\n');
  };
  const submit = async (term, requestedMode = 'queue', from, fields) => {
    const { binding, observation } = await transport.resolve(term.address);
    const { mode } = inputPlan(binding.provider, requestedMode);
    const message = {
      id: randomUUID(), phase: 'queued', createdAt: Date.now(), text: 'identical input', target: binding,
      requestedMode, mode, active: observation.active, barrier: mode === 'queue' ? observation.active : undefined,
      from: from ? (await transport.resolve(from.address)).binding : undefined,
      ...fields,
    };
    publish(root, message);
    return message.id;
  };
  return {
    root, call, sends, keys, terminal, event, submit, reopen, lookup: id => lookup(root, id),
    refuse: kind => { refuse = kind; },
  };
}

test('a native submission still reconciles when the wrapper withheld Enter', () => {
  const id = randomUUID();
  const sessionId = randomUUID();
  const observation = {
    provider: 'claude', book: new Map([[id, { hostReceipt: { accepted: false } }]]),
    tui: { bookPath: 'fixture' },
    events: [{ hook_event_name: 'UserPromptSubmit', session_id: sessionId, receivedAt: 2000,
      prompt: wireText(id, 'manually submitted draft') }],
  };
  assert.equal(nativeDelivery({ id, attemptAt: 1000 }, observation).sessionId, sessionId);
});

test('a Claude background Stop leaves the delivery open until the original task notification concludes', async t => {
  const f = fixture(t);
  const target = f.terminal('t1', 'claude', 'idle');
  const from = f.terminal('t2', 'codex', 'idle');
  const at = Date.now() - 10_000;
  const id = await f.submit(target, 'queue', from, { phase: 'sending', attemptAt: at, expectReply: true });
  const path = join(target.cwd, 't1.jsonl');
  const append = (offset, type, fields) => appendFileSync(path, JSON.stringify({
    sessionId: 't1', cwd: target.cwd, timestamp: new Date(at + offset).toISOString(), type, ...fields,
  }) + '\n');
  const hook = (offset, name, turn, fields = {}) => f.event(target, name, turn,
    { ...fields, receivedAt: at + offset, transcript_path: path });
  const prompt = wireText(id, 'Run the checks');
  append(10, 'user', { uuid: 'original', message: { content: prompt } });
  append(20, 'assistant', { uuid: 'launch', message: { content: [
    { type: 'tool_use', id: 'tool-use-1', name: 'Bash', input: { run_in_background: true } },
  ] } });
  append(25, 'user', { toolUseResult: { backgroundTaskId: 'task-1' },
    message: { content: [{ type: 'tool_result', tool_use_id: 'tool-use-1', content: 'Background task' }] } });
  append(30, 'assistant', { uuid: 'waiting', message: { content: '收到，继续等待', stop_reason: 'end_turn' } });
  append(40, 'system', { subtype: 'turn_duration' });
  hook(11, 'UserPromptSubmit', 'first-hook', { prompt });
  hook(39, 'Stop', 'first-hook', { last_assistant_message: '收到，继续等待' });
  await f.reopen().step();
  assert.equal(f.lookup(id).phase, 'received');
  assert.equal(f.lookup(id).completion, undefined);
  const notification = '<task-notification><task-id>task-1</task-id><tool-use-id>tool-use-1</tool-use-id><status>completed</status></task-notification>';
  append(100, 'user', { uuid: 'notification', message: { content: notification } });
  append(110, 'assistant', { uuid: 'conclusion', message: { content: 'PASS checks complete', stop_reason: 'end_turn' } });
  append(120, 'system', { subtype: 'turn_duration' });
  hook(101, 'UserPromptSubmit', 'task-hook', { prompt: notification });
  hook(119, 'Stop', 'task-hook', { last_assistant_message: 'PASS checks complete' });
  await f.reopen().step();
  await f.reopen().step();
  assert.equal(f.lookup(id).received.turnId, 'first-hook');
  assert.equal(f.lookup(id).completion.nativeTurnId, 'notification');
  assert.deepEqual(f.reopen().messages.filter(message => message.replyTo === id)
    .map(message => message.text.split('\n').at(-1)), ['PASS checks complete']);
});

test('automatic replies require a conclusion and honour an explicit NOREPLY', () => {
  for (const text of ['收到，继续等待', '核对一致，无需回复本条', '报到内容一致，我不另发消息', 'NOREPLY\nPASS']) {
    assert.equal(conclusoryReply(text), false);
    assert.equal(conclusoryReply(text, true), false);
  }
  for (const tag of ['DONE', 'BLOCKED', 'FAILED', 'PASS', 'REJECT', 'APPROVE']) assert.equal(conclusoryReply(`**${tag}**`), true);
  assert.equal(conclusoryReply('合入批准，SHA 已核对'), false);
  assert.equal(conclusoryReply('合入批准，SHA 已核对', true), true);
  assert.equal(conclusoryReply('I am still gathering evidence.', true), false);
});

test('a native Claude v3 marker with incomplete user text corrects a prior delivered receipt', async t => {
  const f = fixture(t);
  const id = randomUUID();
  const target = { addr: 't9', backend: 'tui', provider: 'claude', tui: { transport: 'holder-v3' } };
  const transport = { nativeDelivery, inspect: async () => ({ state: 'idle', provider: 'claude', tui: target.tui,
    terminal: { address: target.addr }, events: [{ hook_event_name: 'UserPromptSubmit', session_id: 'native',
      receivedAt: 2000, prompt: wireText(id, 'first half\ufffd') }] }), send: () => assert.fail('Corrupted inputs are not resent') };
  const store = inbox(f.root, transport);
  const old = { id, target, text: 'first half and the complete suffix', createdAt: 900, attemptAt: 1000, phase: 'received',
    received: { at: 2000 }, completion: { body: 'stale response' }, mode: 'queue', requestedMode: 'queue' };
  store.enqueue(old);
  await store.step();
  let changed = f.lookup(id);
  assert.equal(changed.phase, 'corrupted');
  assert.equal(changed.received, undefined);
  assert.equal(changed.completion, undefined);
  assert.equal(receipt(changed).deliveryStatus, 'corrupted');
  assert.notEqual(changed.corruption.expected, changed.corruption.observed);
  await inbox(f.root, transport).step();
  assert.deepEqual(f.lookup(id), changed);
});

test('Claude wrapper from db8b48bc preserves the final payload newline and corrects the old verdict', async t => {
  const capture = JSON.parse(readFileSync(new URL('../tasks/UPGRADE-FAIL-1/claude-receipt.json', import.meta.url)));
  const { id, expected: text, observed: prompt, expectedDigest, legacyDigest } = capture;
  assert.equal(payloadDigest(text), expectedDigest);
  const target = { addr: 't9', backend: 'tui', provider: 'claude', tui: { transport: 'holder-v3' } };
  const at = 2000, sessionId = 'native', turnId = 'turn';
  const events = [{ hook_event_name: 'UserPromptSubmit', session_id: sessionId, turn_id: turnId, receivedAt: at, prompt }];
  const book = new Map([[id, { digest: expectedDigest, confirmation: { at, sessionId, turnId, count: 1, digests: [legacyDigest] } }]]);
  const observation = { state: 'idle', provider: 'claude', tui: target.tui, book, terminal: { address: target.addr }, events };
  const stored = { id, target, text, payloadDigest: expectedDigest, createdAt: 900, attemptAt: 1000,
    mode: 'queue', requestedMode: 'queue' };
  for (const phase of ['sending', 'corrupted']) {
    const f = fixture(t);
    const store = inbox(f.root, { nativeDelivery, inspect: async () => observation, send: () => assert.fail('No re-submission') });
    store.enqueue({ ...stored, phase, ...(phase === 'corrupted' && { issue: 'payload-mismatch',
      corruption: { at, sessionId, turnId, expected: expectedDigest, observed: legacyDigest } }) });
    await store.step();
    const verified = f.lookup(id);
    assert.equal(verified.phase, 'received');
    assert.equal(verified.payloadVerified, true);
    assert.equal(verified.corruption, undefined);
    assert.equal(verified.issue, undefined);
  }
});

test('one agy step can corrupt its first delivery and confirm its complete, independently reserved suffix', async t => {
  const f = fixture(t);
  const { parked } = JSON.parse(readFileSync(new URL('../tasks/PILOT2-FIX-2/agy-receipts.json', import.meta.url)));
  const first = parked.deliveryId;
  const second = parked.urgentId;
  const original = 'Complete first message with the missing suffix';
  const urgent = 'Complete urgent message with trailing whitespace \n';
  const book = new Map([[first, { digest: payloadDigest(original) }], [second, { digest: payloadDigest(urgent) }]]);
  const transcript = join(f.root, 'transcript_full.jsonl');
  writeFileSync(transcript, JSON.stringify({ source: 'USER_EXPLICIT', type: 'USER_INPUT', created_at: new Date(2000).toISOString(),
    step_index: parked.nativeStep, content: `<USER_REQUEST>\n${wireText(first, 'Complete first�')}${wireText(second, urgent)}\n</USER_REQUEST>\n` }) + '\n');
  const target = { addr: 't9', backend: 'tui', provider: 'agy', tui: { transport: 'holder-v3' } };
  const native = { provider: 'agy', tui: target.tui, book, terminal: { cwd: f.root }, state: 'idle',
    events: [{ hook_event_name: 'PreInvocation', invocationNum: 0, conversationId: 'native', receivedAt: 2300,
      deliveryId: first, transcriptPath: transcript }] };
  const store = inbox(f.root, { nativeDelivery, inspect: async () => native, send: () => assert.fail('No re-submission') });
  for (const [id, text] of [[first, original], [second, urgent]]) store.enqueue({ id, target, text, phase: id === first ? 'received' : 'sending',
    createdAt: 1000, attemptAt: 2100, mode: 'queue', requestedMode: 'queue',
    ...(id === first && { received: { at: 2300 }, completion: { body: 'stale reply' } }) });
  await store.step();
  assert.equal(f.lookup(first).phase, 'corrupted');
  assert.equal(f.lookup(first).received, undefined);
  assert.equal(f.lookup(second).phase, 'received');
  assert.equal(f.lookup(second).received.sessionId, 'native');
  assert.equal(f.lookup(second).payloadVerified, true);
});

test('repairs both pilot-2 agy batch receipts from the bound native step without resubmitting', async t => {
  const capture = JSON.parse(readFileSync(new URL('../tasks/PILOT2-TOOLS-1/agy-receipt.json', import.meta.url)));
  const { primary, peer, expected, observed, receivedAt } = capture;
  const sessionId = 'native';
  for (const changeBody of [false, true]) {
    const f = fixture(t);
    const transcript = join(f.root, 'transcript_full.jsonl');
    const record = structuredClone(capture.native);
    if (changeBody) record.content = record.content.replace('worker results', 'worker result');
    writeFileSync(transcript, JSON.stringify(record) + '\n');
    const target = { addr: 't9', provider: 'agy', tui: { transport: 'holder-v3' } };
    const observation = { state: 'idle', provider: 'agy', tui: target.tui, terminal: { cwd: f.root },
      events: [{ hook_event_name: 'PreInvocation', invocationNum: 0, conversationId: sessionId,
        receivedAt, deliveryId: primary.id, transcriptPath: transcript }] };
    const transport = { nativeDelivery, inspect: async () => observation, send: () => assert.fail('No resend') };
    const store = inbox(f.root, transport);
    const old = { target, createdAt: receivedAt - 100, mode: 'queue', requestedMode: 'queue', phase: 'corrupted',
      issue: 'payload-mismatch', corruption: { expected, observed, at: receivedAt, sessionId } };
    store.enqueue({ ...old, ...primary, attemptAt: receivedAt - 50, payloadDigest: expected, combinedWaves: [peer.id] });
    store.enqueue({ ...old, ...peer, combinedInto: primary.id });
    await inbox(f.root, transport).step();
    for (const { id } of [primary, peer]) {
      const receipt = f.lookup(id);
      assert.equal(receipt.phase, changeBody ? 'corrupted' : 'received');
      if (!changeBody) assert.equal(receipt.corruption, undefined);
    }
    if (!changeBody) assert.equal(f.lookup(primary.id).payloadVerified, true);
  }
});

test('Claude root transcript completion of a human-submitted delivery releases its FIFO queue', async t => {
  const f = fixture(t);
  const target = f.terminal('t9', 'claude', 'idle', false);
  const sessionId = randomUUID();
  const promptId = randomUUID();
  const path = join(target.cwd, `${sessionId}.jsonl`);
  const hook = (name, fields) => f.event(target, name, undefined, {
    session_id: sessionId, transcript_path: path, ...fields,
  });
  hook('SessionStart');
  const first = await f.submit(target);
  const second = await f.submit(target);
  f.refuse('held draft');
  await f.reopen().step();
  assert.equal(f.lookup(first).issue, 'uncertain');
  f.refuse();
  const at = Date.now();
  const prompt = wireText(first, 'identical input');
  hook('UserPromptSubmit', { prompt_id: promptId, receivedAt: at, prompt });
  const transcript = (offset, row) => appendFileSync(path, JSON.stringify({
    sessionId, cwd: target.cwd, timestamp: new Date(at + offset).toISOString(), ...row,
  }) + '\n');
  transcript(0, { type: 'user', message: { content: prompt } });
  transcript(1, { type: 'assistant', message: { id: 'reply', content: 'correlated reply' } });
  transcript(2, { type: 'system', subtype: 'stop_hook_summary' });
  transcript(3, { type: 'system', subtype: 'turn_duration', isSidechain: true });
  transcript(4, { type: 'system', subtype: 'turn_duration', sessionId: randomUUID() });
  await f.reopen().step();
  assert.equal(f.lookup(first).received.turnId, promptId);
  assert.equal(f.lookup(first).completion, undefined);
  assert.deepEqual(f.sends.map(([, input]) => deliveryId(input)), [first]);

  transcript(5, { type: 'system', subtype: 'turn_duration' });
  await f.reopen().step();
  assert.deepEqual(f.lookup(first).completion, {
    at: at + 5, sessionId, turnId: promptId, body: 'correlated reply', source: 'claude transcript turn_duration',
  });
  assert.deepEqual(f.sends.map(([, input]) => deliveryId(input)), [first, second]);
});

test('an external agy turn settles an incomplete delivered turn and lets queued worker results through', async t => {
  const f = fixture(t);
  const target = f.terminal('t9', 'agy', 'idle');
  const started = Date.now();
  const first = await f.submit(target, 'queue', undefined, {
    startup: true, phase: 'received', attemptAt: started - 1,
    received: { at: started, sessionId: target.address },
  });
  const second = await f.submit(target, 'queue', undefined, { text: 'BLOCKED first worker', waveBatch: true });
  const third = await f.submit(target, 'queue', undefined, { text: 'BLOCKED second worker', waveBatch: true });
  f.event(target, 'PreInvocation', undefined, { receivedAt: started, invocationNum: 0, initialNumSteps: 1, deliveryId: first });
  f.event(target, 'PreInvocation', undefined, { receivedAt: started + 1, invocationNum: 1, initialNumSteps: 12 });
  await f.reopen().step();
  assert.equal(f.lookup(first).completion, undefined);
  assert.equal(f.sends.length, 0);

  f.event(target, 'PreInvocation', undefined, { receivedAt: started + 2, invocationNum: 0, initialNumSteps: 37 });
  f.event(target, 'Stop', undefined, {
    receivedAt: started + 3, fullyIdle: true, executionNum: 0, finalReply: 'external reply',
  });
  await f.reopen().step();
  assert.deepEqual(f.lookup(first).completion, {
    at: started + 2, sessionId: target.address, noReply: true, source: 'agy newer root PreInvocation',
  });
  assert.deepEqual(f.sends.map(([, input]) => deliveryId(input)), [second]);

  const end = Date.now() + 1;
  f.event(target, 'PreInvocation', undefined, { receivedAt: end, invocationNum: 0, initialNumSteps: 40, deliveryId: second });
  f.event(target, 'Stop', undefined, {
    receivedAt: end + 1, fullyIdle: true, executionNum: 1, deliveryId: second, finalReply: 'correlated reply',
  });
  await f.reopen().step();
  assert.equal(f.lookup(second).completion.body, 'correlated reply');
  assert.deepEqual(f.sends.map(([, input]) => deliveryId(input)), [second, third]);
});

test('queued Super messages and interrupts bypass uncertain writes and preserve late reconciliation', async t => {
  const f = fixture(t);
  const target = f.terminal('t9', 'codex', 'idle');
  const previous = await f.submit(target);
  const queued = await f.submit(target);
  f.refuse('transport lost after write');
  await f.reopen().step();
  assert.equal(f.lookup(previous).issue, 'uncertain');
  f.refuse(undefined);

  const urgent = await f.submit(target, 'queue', undefined, { superPriority: true });
  await f.reopen().step();
  assert.deepEqual(f.sends.map(([, input]) => deliveryId(input)), [previous, urgent]);
  assert.equal(f.lookup(queued).phase, 'queued');
  assert.ok(f.lookup(previous).bypassedAt);

  const at = Date.now();
  target.status.state = 'working';
  f.event(target, 'UserPromptSubmit', 'urgent', { deliveryId: urgent, receivedAt: at });
  const interrupt = await f.submit(target, 'interrupt');
  const mail = f.reopen();
  // This test peer has no guarded PTY socket. Observe dispatch through the
  // engine's injected transport and check the original turn binding.
  let stopped;
  const transport = {
    inspect: async () => ({ state: 'busy', active: { turnId: 'urgent' }, terminal: { turn: 1 } }),
    nativeDelivery: message => message.id === urgent ? { at, turnId: 'urgent' } : undefined,
    sameTurn: (a, b) => a.turnId === b.turnId,
    plan: () => ({ stop: ['esc'] }),
    interrupt: async message => { stopped = message.id; },
  };
  assert.equal(mail.messages.find(message => message.id === previous).phase, 'sending');
  await inbox(f.root, transport, () => {}).step();
  assert.equal(stopped, interrupt);
  f.event(target, 'UserPromptSubmit', 'prior', { deliveryId: previous });
  await f.reopen().step();
  assert.equal(receipt(f.lookup(previous)).deliveryStatus, 'delivered');
});

test('durably queues duplicate texts in FIFO order and waits for the matching native end', async t => {
  const f = fixture(t);
  const target = f.terminal('t1');
  f.event(target, 'UserPromptSubmit', 'busy');
  const first = await f.submit(target);
  const second = await f.submit(target);
  const relay = f.reopen();
  await relay.step();
  target.status.state = 'idle';
  target.turn += 1;
  f.event(target, 'Stop', 'stale');
  await relay.step();
  assert.equal(f.sends.length, 0);
  f.event(target, 'Stop', 'busy');
  await f.reopen().step();
  assert.deepEqual(f.sends, [['t1', wireText(first, 'identical input'), '--if', 'idle']]);
  f.event(target, 'UserPromptSubmit', 'first', { deliveryId: first });
  await f.reopen().step();
  assert.equal(receipt(f.lookup(first)).status, 'delivered');
  assert.equal(f.sends.length, 1);
  f.event(target, 'Stop', 'first', { last_assistant_message: 'first reply' });
  await f.reopen().step();
  f.event(target, 'UserPromptSubmit', 'second', { deliveryId: second });
  f.event(target, 'Stop', 'second', { last_assistant_message: 'second reply' });
  await f.reopen().step();
  assert.deepEqual(f.sends.map(([, text]) => deliveryId(text)), [first, second]);
  assert.equal(receipt(f.lookup(second)).status, 'delivered');
});

test('reconciles a lost send acknowledgement from the native marker across restarts', async t => {
  const f = fixture(t);
  const target = f.terminal('t1', 'codex', 'idle');
  const id = await f.submit(target);
  f.refuse('acknowledgement lost');
  await f.reopen().step();
  assert.equal(receipt(f.lookup(id)).issue, 'uncertain');
  f.refuse();
  await f.reopen().step();
  assert.equal(f.sends.length, 1);
  f.event(target, 'UserPromptSubmit', 'accepted', { deliveryId: id });
  f.event(target, 'Stop', 'accepted', { last_assistant_message: 'recovered reply' });
  await f.reopen().step();
  await f.reopen().step();
  assert.equal(f.sends.length, 1);
  assert.equal(receipt(f.lookup(id)).status, 'delivered');
  assert.equal(f.lookup(id).completion.body, 'recovered reply');
});

test('reconciles one native acknowledgement for a streamed cohort after restart', async t => {
  const f = fixture(t);
  const target = f.terminal('t1', 'codex', 'idle');
  const streamAt = Date.now();
  const first = await f.submit(target, 'queue', undefined, { streamAt, waveBatch: 'A', text: 'DONE worker A' });
  const second = await f.submit(target, 'queue', undefined, { streamAt, waveBatch: 'B', text: 'FAILED worker B' });
  f.refuse('acknowledgement lost');
  await f.reopen().step();
  assert.equal(f.sends.length, 1);
  assert.match(f.sends[0][1], /DONE worker A.*FAILED worker B/s);
  assert.equal(f.lookup(second).combinedInto, first);
  f.refuse(undefined);
  f.event(target, 'UserPromptSubmit', 'combined', { deliveryId: first });
  f.event(target, 'Stop', 'combined', { last_assistant_message: 'acknowledged both workers' });
  await f.reopen().step();
  assert.equal(f.sends.length, 1);
  assert.equal(f.lookup(first).phase, 'received');
  assert.equal(f.lookup(second).completion.body, 'acknowledged both workers');
});

test('retries after an explicit no-input refusal with the original delivery ID', async t => {
  const f = fixture(t);
  const target = f.terminal('t1', 'codex', 'idle');
  const id = await f.submit(target);
  f.refuse('status_mismatch');
  await f.reopen().step();
  assert.equal(f.lookup(id).phase, 'queued');
  assert.equal(f.sends.length, 0);
  f.refuse();
  await f.reopen().step();
  assert.deepEqual(f.sends.map(([, text]) => deliveryId(text)), [id]);
});

test('queues TUI steering and routes only the final from the new prompt turn', async t => {
  const f = fixture(t);
  const target = f.terminal('t1');
  const sender = f.terminal('t2', 'agy', 'idle');
  f.event(target, 'UserPromptSubmit', 'original');
  const id = await f.submit(target, 'steer', sender, { expectReply: true });
  await f.reopen().step();
  assert.deepEqual(f.sends, []);
  target.status.state = 'idle';
  f.event(target, 'Stop', 'original', { last_assistant_message: 'prior' });
  await f.reopen().step();
  assert.deepEqual(f.sends, [['t1', wireText(id, 'identical input'), '--if', 'idle']]);
  f.event(target, 'UserPromptSubmit', 'new', { deliveryId: id });
  f.event(target, 'Stop', 'other', { last_assistant_message: 'wrong reply' });
  await f.reopen().step();
  assert.equal(receipt(f.lookup(id)).status, 'delivered');
  assert.equal(receipt(f.lookup(id)).downgraded, true);
  assert.equal(f.sends.length, 1);
  f.event(target, 'Stop', 'new', { last_assistant_message: 'DONE right reply' });
  const relay = f.reopen();
  await relay.step();
  assert.deepEqual(relay.routesForTurn('t1', f.lookup(id).completion), ['t2']);
  await f.reopen().step();
  assert.equal(f.sends.length, 2);
  const [addr, text] = f.sends[1];
  const replyId = deliveryId(text);
  assert.equal(addr, 't2');
  assert.ok(text.endsWith('right reply'));
  f.event(sender, 'PreInvocation', undefined, { deliveryId: replyId, invocationNum: 0 });
  f.event(sender, 'Stop', undefined, { deliveryId: replyId, executionNum: 0, fullyIdle: true });
  sender.status = { state: 'done', msg: 'RECEIVED' };
  sender.status_ms = Date.now();
  await f.reopen().step();
  assert.equal(f.lookup(replyId).completion.body, 'RECEIVED');
  assert.equal(f.sends.length, 2);
});

test('an automatic reply cannot produce another reply even if old metadata requests one', async t => {
  const f = fixture(t);
  const target = f.terminal('t1', 'codex', 'idle');
  const sender = f.terminal('t2', 'codex', 'idle');
  const id = await f.submit(target, 'queue', sender, { expectReply: true, replyTo: randomUUID() });
  const mail = f.reopen();
  await mail.step();
  f.event(target, 'UserPromptSubmit', 'received', { deliveryId: id });
  f.event(target, 'Stop', 'received', { last_assistant_message: 'confirmation' });
  await mail.step();
  assert.equal(f.lookup(id).completion.body, 'confirmation');
  assert.equal(mail.messages.filter(message => message.replyTo === id).length, 0);
  assert.deepEqual(mail.routesForTurn('t1', f.lookup(id).completion), []);
});

test('downgrades stale steering rather than typing into the new working turn', async t => {
  const f = fixture(t);
  const target = f.terminal('t1');
  f.event(target, 'UserPromptSubmit', 'old');
  const id = await f.submit(target, 'steer');
  f.event(target, 'Stop', 'old', { last_assistant_message: 'previous' });
  target.turn += 1;
  f.event(target, 'UserPromptSubmit', 'new');
  await f.reopen().step();
  assert.equal(receipt(f.lookup(id)).downgraded, true);
  assert.equal(f.sends.length, 0);
  await f.reopen().step(); // Captures the new busy turn as the queued barrier.
  target.status.state = 'idle';
  await f.reopen().step();
  assert.equal(f.sends.length, 0);
  f.event(target, 'Stop', 'new', { last_assistant_message: 'next' });
  await f.reopen().step();
  assert.equal(f.sends.length, 1);
});

test('rejects an unguarded TUI interrupt without sending keys', async t => {
  const f = fixture(t);
  const target = f.terminal('t1', 'agy');
  f.event(target, 'PreInvocation', undefined, { invocationNum: 0 });
  const id = await f.submit(target, 'interrupt');
  await f.reopen().step();
  assert.equal(f.lookup(id).phase, 'refused');
  assert.equal(f.lookup(id).issue, 'unsupported-interrupt');
  assert.deepEqual(f.keys, []);
  await f.reopen().step();
  assert.equal(f.keys.length, 0);
  assert.equal(f.sends.length, 0);
});

test('downgrades TUI steering to a queue and parses only native input markers', () => {
  assert.equal(inputPlan('claude', 'steer').mode, 'queue');
  assert.equal(inputPlan('agy', 'steer').mode, 'queue');
  const id = randomUUID();
  assert.equal(deliveryId(`<USER_REQUEST>\n<hc from="t1">${wireText(id, 'test')}</hc>\n</USER_REQUEST>`), id);
  assert.equal(deliveryId(`unrelated quote\n${wireText(id, 'test')}`), undefined);
});

test('reconciles a previous Claude TUI steer only in the transcript turn containing its marker', async t => {
  const f = fixture(t);
  const target = f.terminal('t1', 'claude');
  const from = f.terminal('t2', 'codex', 'idle');
  f.event(target, 'UserPromptSubmit');
  const id = await f.submit(target, 'steer', from, { mode: 'steer', phase: 'sending', attemptAt: Date.now(), expectReply: true });
  await f.reopen().step();
  const when = f.lookup(id).attemptAt;
  const file = join(target.cwd, 'claude-session.jsonl');
  const row = (type, timestamp, content, name) => JSON.stringify({
    type, uuid: name, timestamp: new Date(when + timestamp).toISOString(),
    message: { id: name, role: type, content, stop_reason: type === 'assistant' ? 'end_turn' : null },
  });
  writeFileSync(file, [
    row('user', -5, 'original prompt', 'p0'),
    row('assistant', 3, 'original reply', 'a0'),
    row('user', 12, wireText(id, 'identical input'), 'p1'),
    row('assistant', 15, 'DONE associated reply', 'a1'),
  ].join('\n') + '\n');
  f.event(target, 'UserPromptSubmit', undefined, { deliveryId: id, receivedAt: when + 1 });
  f.event(target, 'Stop', undefined, { transcript_path: file, receivedAt: when + 5 });
  await f.reopen().step();
  assert.equal(receipt(f.lookup(id)).status, 'steered');
  assert.equal(f.lookup(id).completion, undefined);
  f.event(target, 'Stop', undefined, { transcript_path: file, receivedAt: when + 20 });
  await f.reopen().step();
  await f.reopen().step();
  assert.ok(f.sends.find(([addr]) => addr === from.address)?.[1].endsWith('associated reply'));
});

test('rejects a stale interrupt and preserves the later active turn', async t => {
  const f = fixture(t);
  const target = f.terminal('t1');
  f.event(target, 'UserPromptSubmit', 'old');
  const id = await f.submit(target, 'interrupt');
  f.event(target, 'Stop', 'old', { last_assistant_message: 'finished naturally' });
  target.turn += 1;
  f.event(target, 'UserPromptSubmit', 'new');
  await f.reopen().step();
  await f.reopen().step();
  assert.equal(f.lookup(id).phase, 'refused');
  assert.equal(f.lookup(id).issue, 'target-turn-ended');
  assert.deepEqual([f.keys, f.sends], [[], []]);
});

test('keeps a queued worker in its wave and avoids a duplicate copy to from', async t => {
  const f = fixture(t);
  const target = f.terminal('t1');
  const from = f.terminal('t2', 'codex', 'idle');
  const other = f.terminal('t3', 'codex', 'idle');
  f.event(target, 'UserPromptSubmit', 'original');
  const id = await f.submit(target, 'steer', from, { expectReply: true });
  const mail = f.reopen();
  await mail.step();
  target.status.state = 'idle';
  f.event(target, 'Stop', 'original');
  await mail.step();
  f.event(target, 'UserPromptSubmit', 'new', { deliveryId: id });
  f.event(target, 'Stop', 'new', { last_assistant_message: 'DONE directed body' });
  f.event(other, 'Stop', 'other', { last_assistant_message: 'other result' });
  const registry = join(f.root, '.project/workers.md');
  writeFileSync(registry, 'A | t1 | codex | dispatched | | wave=W1\nB | t3 | codex | dispatched | | wave=W1\n');
  await mail.step();
  const step = waveRelay(f.root, ['t2'], 900_000, f.call, () => {}, mail.routesForTurn);
  await step();
  await mail.step();
  await step();
  const copies = f.sends.filter(([addr]) => addr === 't2').map(([, text]) => text);
  assert.equal(copies.length, 2);
  assert.equal(copies.filter(text => text.includes('directed body')).length, 1);
  assert.match(copies.find(text => text.startsWith('波次')), /B t3 DONE\nother result/);
});

test('replays all four native TUI drafts through inbox with zero attempts', async t => {
  const { root } = fixture(t);
  const script = fileURLToPath(new URL('../tasks/TUI-REL-0/replay-inbox.mjs', import.meta.url));
  const { stdout } = await exec(process.execPath, [script, root]);
  const results = stdout.trim().split('\n').map(JSON.parse);
  assert.equal(results.length, 4);
  assert.ok(results.every(row => row.sends === 0 && row.inbox === 'unknown'));
});

test('records missing or conflicting readiness and sends only after both signals are idle', async t => {
  const f = fixture(t);
  const target = f.terminal('t1', 'codex', 'idle', false);
  const id = await f.submit(target);
  await f.reopen().step();
  assert.equal(f.lookup(id).phase, 'queued');
  assert.deepEqual(f.lookup(id).waitingForWritable, { screen: 'idle', native: 'unknown', hc: 'idle', complete: true });
  f.event(target, 'UserPromptSubmit', 'previous');
  await f.reopen().step();
  assert.equal(f.lookup(id).waitingForWritable.native, 'busy');
  f.event(target, 'Stop', 'unrelated');
  await f.reopen().step();
  assert.equal(f.lookup(id).waitingForWritable.native, 'busy');
  f.event(target, 'Stop', 'previous');
  target.frame = tuiSamples('codex-draft');
  await f.reopen().step();
  assert.equal(f.lookup(id).waitingForWritable.screen, 'unknown');
  assert.equal(f.lookup(id).waitingForWritable.native, 'idle');
  assert.deepEqual([f.keys, f.sends], [[], []]);
  delete target.frame;
  target.complete = false;
  await f.reopen().step();
  assert.equal(f.lookup(id).waitingForWritable.complete, false);
  assert.equal(f.sends.length, 0);
  target.complete = true;
  await f.reopen().step();
  assert.deepEqual(f.sends.map(([, text]) => deliveryId(text)), [id]);
  assert.equal(f.lookup(id).waitingForWritable, undefined);
});

test('delivery SLA rechecks native evidence before one guarded same-ID retry and survives reopen', async t => {
  const { root } = fixture(t);
  const target = { addr: 'leader', provider: 'claude', backend: 'tui' };
  const id = randomUUID();
  const at = Date.now();
  let time = at;
  let native;
  let retryCount = 0;
  let inspectCount = 0;
  const transport = {
    inspect: async () => ({ state: 'idle', terminal: { turn: 1 }, writeEvidence: {
      submittedDeliveryId: id, retryableDeliveryId: id, inspectCount: ++inspectCount,
    } }),
    nativeDelivery: () => native,
    send() { throw Object.assign(new Error('No native turn'), { kind: 'no-native-turn' }); },
    retryMissingTurn(message, frame) {
      assert.equal(message.id, id);
      assert.equal(message.text, 'body');
      assert.equal(frame.writeEvidence.inspectCount, inspectCount);
      retryCount++;
    },
  };
  const reopen = () => inbox(root, transport, () => {});
  let mail = reopen();
  mail.enqueue({ id, target, phase: 'queued', mode: 'queue', requestedMode: 'queue', createdAt: at, text: 'body' });
  const tick = () => mail.step(undefined, { now: () => time, stallMs: 120_000 });
  await tick();
  assert.equal(receipt(lookup(root, id)).deliveryStatus, 'accepted');
  time += 119_999;
  await tick();
  assert.equal(receipt(lookup(root, id), time).reason, 'no-native-turn');
  assert.equal(retryCount, 0);
  time++;
  await tick();
  assert.equal(receipt(lookup(root, id), time).deliveryStatus, 'stalled');
  assert.equal(retryCount, 1);
  mail = reopen();
  time += 120_000;
  await tick();
  assert.equal(retryCount, 1);
  native = { at: time, turnId: 'native' };
  await tick();
  assert.equal(receipt(lookup(root, id), time).deliveryStatus, 'delivered');
});

test('a busy target gets a longer fixed SLA and still stalls without hook changes', async t => {
  const { root } = fixture(t);
  const target = { addr: 'worker', provider: 'codex' };
  const id = randomUUID();
  const at = Date.now();
  let time = at;
  const transport = {
    inspect: async () => ({ state: 'busy', active: { turnId: 'unchanged' }, terminal: { turn: 1 } }),
    sameTurn: (left, right) => left.turnId === right.turnId,
    send: () => assert.fail('Never write a queued input into this busy target'),
  };
  const mail = inbox(root, transport);
  mail.enqueue({ id, target, phase: 'queued', mode: 'queue', requestedMode: 'queue', createdAt: at, text: 'body' });
  const tick = () => mail.step(undefined, { now: () => time });
  time += 359_999;
  await tick();
  assert.equal(receipt(lookup(root, id), time).deliveryStatus, 'accepted');
  time++;
  await tick();
  const pending = receipt(lookup(root, id), time);
  assert.equal(pending.deliveryStatus, 'stalled');
  assert.equal(pending.ageMs, 360_000);
  assert.equal(pending.reason, 'waiting-writable');
});
