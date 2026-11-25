import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { relay as waveRelay } from '../relay/project.mjs';
import { inbox, receipt } from './engine.mjs';
import { deliveryId, wireText } from './message.mjs';
import { lookup, publish } from './store.mjs';
import { inputPlan, tui } from './tui.mjs';

const exec = promisify(execFile);
const tuiSamples = file => readFileSync(new URL('../tasks/TUI-REL-0/fixtures/' + file + '.txt', import.meta.url), 'utf8');
const screens = {
  codex: { idle: tuiSamples('codex-idle'), busy: tuiSamples('codex-busy-local') },
  claude: { idle: tuiSamples('claude-idle'), busy: tuiSamples('claude-busy-early') },
  agy: { idle: tuiSamples('agy-idle-good'), busy: tuiSamples('agy-clean-busy') },
};

function fixture(t) {
  const root = mkdtempSync(join(import.meta.dirname, '.inbox-test-'));
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
  const id = await f.submit(target, 'steer', sender);
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
  f.event(target, 'Stop', 'new', { last_assistant_message: 'right reply' });
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
  const id = await f.submit(target, 'steer', from, { mode: 'steer', phase: 'sending', attemptAt: Date.now() });
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
    row('assistant', 15, 'associated reply', 'a1'),
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
  const id = await f.submit(target, 'steer', from);
  const mail = f.reopen();
  await mail.step();
  target.status.state = 'idle';
  f.event(target, 'Stop', 'original');
  await mail.step();
  f.event(target, 'UserPromptSubmit', 'new', { deliveryId: id });
  f.event(target, 'Stop', 'new', { last_assistant_message: 'directed body' });
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
