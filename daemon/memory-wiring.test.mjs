import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { socketPath } from '../cli/project.mjs';
import { deliveryId } from '../inbox/message.mjs';
import { createAccess } from '../memory/access.mjs';
import { itemPath, renderEntry } from '../memory/format.mjs';
import { createMemoryStore } from '../memory/store.mjs';
import { createSupervisor } from './supervisor.mjs';

// Pin the client to the same checkout as the supervisor under test.
const LOOM_BIN = fileURLToPath(new URL('../bin/loom', import.meta.url));
const exec = promisify(execFile);
let isolatedHome;
const isolatedVariables = ['HOME', 'GIT_CONFIG_GLOBAL'];
const originalEnvironment = isolatedVariables.map(key => process.env[key]);

// The in-process supervisor also spawns Git, so isolate its inherited environment.
test.before(() => {
  isolatedHome = mkdtempSync(join(realpathSync(tmpdir()), 'lmw-home-'));
  process.env.HOME = isolatedHome;
  process.env.GIT_CONFIG_GLOBAL = join(isolatedHome, '.gitconfig');
});
test.after(() => {
  for (const [index, key] of isolatedVariables.entries()) {
    const original = originalEnvironment[index];
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
  if (isolatedHome) rmSync(isolatedHome, { recursive: true, force: true });
});

const initialTime = Date.parse('2026-11-26T12:00:00Z');
const draft = (title, fields = {}) => ({
  kind: 'ruling', layer: 'shared', title, body: 'Verify the signed release manifest.',
  checkedAt: new Date(initialTime).toISOString(), source: { path: 'proof.txt' }, ...fields,
});
const syntheticSecret = 'SYNTHETIC_MEMORY_SECRET';
const classifySensitive = text => ({
  reliable: true,
  spans: [...text.matchAll(new RegExp(syntheticSecret, 'g'))]
    .map(({ index }) => ({ start: index, end: index + syntheticSecret.length })),
});
async function fixture(t, { capture = false, ...memoryOptions } = {}) {
  const project = mkdtempSync(join(realpathSync(tmpdir()), 'lmw-'));
  const write = (path, body) => writeFileSync(join(project, path), body);
  const read = path => readFileSync(join(project, path), 'utf8');
  mkdirSync(join(project, '.project'));
  write('.project/policy.json', JSON.stringify({ preferred: [], deny: [], delivery: { coalesceMs: 0 } }));
  write('proof.txt', 'Signed manifest fixture\n');
  let state;
  const active = new Map();
  const prompts = [];
  const opens = [];
  async function open(row, _, resume) {
    opens.push(row.addr);
    const id = resume ?? randomUUID();
    const path = join(project, id + '.jsonl');
    writeFileSync(path, '', { flag: 'a' });
    let observer, turn, seq = 0;
    const emit = (kind, data = {}) => observer?.({
      kind, ...data, agentPath: [], sessionId: id, seq: seq++, receivedAt: Date.now(), spanId: turn?.id,
    });
    active.set(row.addr, (reply, commentary) => {
      assert.ok(turn, 'there is a business turn to complete for ' + row.addr);
      const { id: turn_id, inputId, input } = turn;
      const records = [{ type: 'task_started', turn_id },
        { type: 'user_message', message: input }, { type: 'task_complete', turn_id, last_agent_message: reply }];
      appendFileSync(path, records.map(payload => JSON.stringify({
        type: 'event_msg', timestamp: new Date().toISOString(), payload,
      }) + '\n').join(''));
      if (commentary) emit('text_delta', { phase: 'commentary', text: commentary });
      emit('text_delta', { phase: 'final_answer', text: reply });
      emit('turn_ended', { inputId, outcome: { kind: 'completed' } });
      turn = undefined;
      return turn_id;
    });
    return {
      id, records: () => [], nativeSessionFile: async () => path,
      status: () => ({ value: turn ? { kind: 'running', sinceSeq: turn.sinceSeq, lastEventAt: turn.at } : { kind: 'idle' } }),
      events: notify => { observer = notify; return () => { observer = undefined; }; },
      async dispose() { emit('exited'); },
      async prompt(input) {
        assert.equal(turn, undefined, 'unexpected additional native prompt');
        const requestId = randomUUID();
        turn = { id: randomUUID(), inputId: deliveryId(input), input, sinceSeq: seq, at: Date.now() };
        prompts.push({ addr: row.addr, input });
        emit('turn_started', { requestId, input });
        emit('turn_active', { inputId: turn.inputId });
        return { kind: 'accepted', requestId, seq: seq - 1 };
      },
    };
  }
  const start = () => createSupervisor(project, {
    report: () => {}, externalNotification: async () => {}, sessionOptions: { open },
    memoryOptions: { classifySensitive, ...memoryOptions, ...(capture && {
      readState: () => state, commitState: next => { state = structuredClone(next); },
    }) },
  });
  let daemon = start();
  const handle = (command, args, caller) => daemon.handle(command, args, caller);
  const server = createServer(socket => socket.once('data', async data => {
    const { command, args, caller } = JSON.parse(data);
    try { socket.end(JSON.stringify({ ok: true, ...await handle(command, args, caller) })); }
    catch (error) { socket.end(JSON.stringify({ ok: false, error: { code: error.code, message: error.message } })); }
  })).listen(socketPath(project));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await daemon.shutdown();
    rmSync(project, { recursive: true, force: true });
  });
  await once(server, 'listening');
  const cli = async (caller, ...args) => {
    const { stdout } = await exec(LOOM_BIN, [...args, '--project', project, '--json'], {
      cwd: project, timeout: 5000, env: { ...process.env, LOOM_ADDR: caller ?? '', HC_TERMINAL_ID: '' },
    });
    return JSON.parse(stdout);
  };
  return {
    project, handle, write, read, cli, prompts, opens, snapshot: () => state,
    spawn: async (role, fields = {}, caller) => (await handle('spawn', {
      role, task: role.toUpperCase(), wave: 'W', cli: 'codex', model: 'fixture', effort: 'high',
      cwd: project, project, mode: 'headless', prompt: 'Begin fixture work', ...fields,
    }, caller)).session.addr,
    finish: (addr, reply, commentary) => active.get(addr)(reply, commentary),
    tick: () => daemon.tick(),
    async restart() { await daemon.shutdown(); daemon = start(); },
  };
}
// The CLI and entry shapes follow memory/CONTRACT.md.
const search = (f, addr, query) => f.cli(addr, 'mem', 'search', query);
const show = (f, addr, id) => f.cli(addr, 'mem', 'show', id);
const put = (f, addr, entry, requestId = randomUUID()) =>
  f.cli(addr, 'mem', 'write', '--entry', JSON.stringify(entry), '--request-id', requestId, '--expected-revision', 'null');
const mutate = (f, addr, action, id, revision, entry) => f.cli(addr, 'mem', action, id,
  '--expected-revision', String(revision), '--request-id', randomUUID(), ...(entry ? ['--entry', JSON.stringify(entry)] : []));
const cliError = code => error => {
  const { code: actual, message } = JSON.parse(error.stdout).error;
  assert.equal(actual, code, message);
  return true;
};
test('subprocesses inherit temporary HOME and Git global config', async () => {
  const { stdout } = await exec(process.execPath, ['-p',
    'JSON.stringify([process.env.HOME, process.env.GIT_CONFIG_GLOBAL])']);
  assert.deepEqual(JSON.parse(stdout), [isolatedHome, join(isolatedHome, '.gitconfig')]);
});
test('5a · daemon restart preserves v1 item and receipt, with project-local reads and writes', async t => {
  const a = await fixture(t), b = await fixture(t);
  const alice = await a.spawn('auditor'), bob = await b.spawn('auditor');
  const entry = draft('perproject manifest');
  const requestId = randomUUID();
  const { item, receipt } = await put(a, alice, entry, requestId);
  assert.equal(item.revision, 1);
  assert.equal(receipt.requestId, requestId);
  await a.restart();
  assert.deepEqual((await show(a, alice, item.id)).item, item);
  assert.deepEqual((await put(a, alice, entry, requestId)).receipt, receipt);
  assert.deepEqual((await search(a, alice, 'perproject')).rows.map(row => row.id), [item.id]);
  assert.deepEqual((await search(b, bob, 'perproject')).rows, []);
  assert.equal((await show(b, bob, item.id)).item, null);
  await assert.rejects(put(b, bob, { ...entry, project: item.project }), cliError('forbidden'));
  const other = await put(b, bob, entry, requestId);
  assert.notEqual(other.item.project, item.project);
});
test('5a · CLI search is an index, show expands, concurrent updates use CAS, invalidate withdraws', async t => {
  const f = await fixture(t);
  const auditor = await f.spawn('auditor');
  const entry = draft('manifestlookup');
  const { item } = await put(f, auditor, entry);
  const { rows } = await search(f, auditor, entry.title);
  assert.deepEqual(rows.map(row => [row.id, row.revision]), [[item.id, 1]]);
  assert.ok(!JSON.stringify(rows).includes(entry.body));
  assert.equal((await show(f, auditor, item.id)).item.body, entry.body);
  const updates = ['Compare the signature.', 'Record the digest.'].map(body =>
    mutate(f, auditor, 'update', item.id, 1, { ...entry, body }));
  const settled = await Promise.allSettled(updates);
  const winner = settled.find(result => result.status === 'fulfilled');
  const loser = settled.find(result => result.status === 'rejected');
  assert.ok(winner && loser, 'exactly one writer owns revision 1');
  cliError('conflict')(loser.reason);
  const { item: revised } = await show(f, auditor, item.id);
  assert.deepEqual(revised, winner.value.item);
  assert.equal(revised.revision, 2);
  await assert.rejects(mutate(f, auditor, 'invalidate', item.id, 1), cliError('conflict'));
  const { item: tombstone } = await mutate(f, auditor, 'invalidate', item.id, 2);
  assert.equal(tombstone.revision, 3);
  assert.ok(!JSON.stringify(tombstone).includes(revised.body));
  assert.equal((await show(f, auditor, item.id)).item, null);
  assert.deepEqual((await search(f, auditor, entry.title)).rows, []);
});
for (const action of ['show', 'update', 'invalidate']) {
  const shortId = 'abc123ab';
  const firstId = 'memory-abc123ab-1234-4123-8123-123456789abc';
  const secondId = 'memory-abc123ab-5678-4123-8123-123456789def';
  const run = (f, auditor, id, entry) => action === 'show'
    ? show(f, auditor, id)
    : mutate(f, auditor, action, id, 1, action === 'update' ? entry : undefined);

  test(`6e.4 CLI mem ${action} accepts an eight-character ID prefix`, async t => {
    const f = await fixture(t, { allocateId: () => firstId });
    const auditor = await f.spawn('auditor');
    const entry = draft('Short ID manifest fixture');
    const { item } = await put(f, auditor, entry);
    assert.equal(item.id, firstId);
    const revision = { ...entry, body: 'Verify the digest as well as the signature.' };
    const { item: result } = await run(f, auditor, shortId, revision);
    assert.equal(result?.id, firstId);
    if (action === 'show') assert.deepEqual(result, item);
    if (action === 'update') {
      assert.equal(result.revision, 2);
      assert.equal((await show(f, auditor, firstId)).item.body, revision.body);
    }
    if (action === 'invalidate') assert.equal((await show(f, auditor, firstId)).item, null);
  });

  test(`6e.4 CLI mem ${action} reports an ambiguous eight-character ID prefix`, async t => {
    const ids = [firstId, secondId].values();
    const f = await fixture(t, { allocateId: () => ids.next().value });
    const auditor = await f.spawn('auditor');
    const entry = draft('Colliding ID manifest fixture');
    const { item: first } = await put(f, auditor, entry);
    const { item: second } = await put(f, auditor, draft('Colliding ID signature fixture'));
    assert.deepEqual([first.id, second.id], [firstId, secondId]);
    await assert.rejects(run(f, auditor, shortId, entry), error => {
      const { message } = JSON.parse(error.stdout).error;
      assert.match(message, /ambigu|multiple match|歧义|多个匹配/iu);
      return true;
    });
    for (const item of [first, second]) assert.deepEqual((await show(f, auditor, item.id)).item, item);
  });
}

const eventShortId = 'abc123ab';
const firstEventId = `memory-event-${eventShortId}${'1'.repeat(56)}`;
const secondEventId = `memory-event-${eventShortId}${'2'.repeat(56)}`;

for (const action of ['show', 'update', 'invalidate']) {
  const run = (f, caller, entry) => action === 'show'
    ? show(f, caller, eventShortId)
    : mutate(f, caller, action, eventShortId, 1, action === 'update' ? entry : undefined);

  test(`6e.4 CLI mem ${action} accepts an eight-character event hash prefix`, async t => {
    const f = await fixture(t, { allocateId: () => firstEventId });
    const auditor = await f.spawn('auditor');
    const entry = draft('Short event ID manifest fixture');
    const { item } = await put(f, auditor, entry);
    assert.equal(item.id, firstEventId);
    const revision = { ...entry, body: 'Verify the event digest as well as the signature.' };
    const { item: result } = await run(f, auditor, revision);
    assert.equal(result?.id, firstEventId);
    if (action === 'show') assert.deepEqual(result, item);
    if (action === 'update') {
      assert.equal(result.revision, 2);
      assert.deepEqual((await show(f, auditor, firstEventId)).item, result);
      assert.equal(result.body, revision.body);
    }
    if (action === 'invalidate') assert.equal((await show(f, auditor, firstEventId)).item, null);
  });

  test(`6e.4 CLI mem ${action} reports ambiguity for two visible event hashes sharing a prefix`, async t => {
    const ids = [firstEventId, secondEventId].values();
    const f = await fixture(t, { allocateId: () => ids.next().value });
    const auditor = await f.spawn('auditor');
    const entry = draft('Colliding event ID manifest fixture');
    const { item: first } = await put(f, auditor, entry);
    const { item: second } = await put(f, auditor, draft('Colliding event ID signature fixture'));
    assert.deepEqual([first.id, second.id], [firstEventId, secondEventId]);
    await assert.rejects(run(f, auditor, entry), error => {
      const { message } = JSON.parse(error.stdout).error;
      assert.match(message, /ambigu|multiple match|歧义|多个匹配/iu);
      return true;
    });
    for (const item of [first, second]) assert.deepEqual((await show(f, auditor, item.id)).item, item);
  });

  test(`3a · CLI mem ${action} resolves a visible event hash despite a private collision`, async t => {
    const ids = [firstEventId, secondEventId].values();
    const f = await fixture(t, { allocateId: () => ids.next().value });
    const auditor = await f.spawn('auditor'), leader = await f.spawn('leader');
    const { item: hidden } = await put(f, auditor, draft('Private event fixture', { layer: 'private' }));
    const entry = draft('Shared event fixture', { kind: 'lesson' });
    const { item: visible } = await put(f, leader, entry);
    assert.deepEqual([hidden.id, visible.id], [firstEventId, secondEventId]);
    assert.deepEqual((await show(f, auditor, hidden.id)).item, hidden);
    assert.equal((await show(f, leader, hidden.id)).item, null);
    assert.deepEqual((await show(f, leader, visible.id)).item, visible);

    const revision = { ...entry, body: 'Record the verified event digest.' };
    const { item: result } = await run(f, leader, revision);
    assert.equal(result?.id, visible.id);
    if (action === 'show') assert.deepEqual(result, visible);
    if (action === 'update') {
      assert.equal(result.revision, 2);
      assert.deepEqual((await show(f, leader, visible.id)).item, result);
      assert.equal(result.body, revision.body);
    }
    if (action === 'invalidate') assert.equal((await show(f, leader, visible.id)).item, null);
    assert.deepEqual((await show(f, auditor, hidden.id)).item, hidden);
  });
}

test('3a · CLI mem show returns the same error for a private-only and an absent short ID', async t => {
  const f = await fixture(t, { allocateId: () => firstEventId });
  const auditor = await f.spawn('auditor'), leader = await f.spawn('leader');
  const { item: hidden } = await put(f, auditor, draft('Private-only event fixture', { layer: 'private' }));
  assert.equal(hidden.id, firstEventId);
  assert.deepEqual((await show(f, auditor, hidden.id)).item, hidden);
  assert.equal((await show(f, leader, hidden.id)).item, null);

  const [privateMatch, absentMatch] = await Promise.allSettled([
    show(f, leader, eventShortId), show(f, leader, 'def456cd'),
  ]);
  assert.equal(privateMatch.status, 'rejected', 'a private-only short ID must return an error');
  assert.equal(absentMatch.status, 'rejected', 'an absent short ID must return an error');
  const { code, message } = JSON.parse(absentMatch.reason.stdout).error;
  const { code: privateCode, message: privateMessage } = JSON.parse(privateMatch.reason.stdout).error;
  assert.ok(code && message, 'the absent short ID error must contain a code and message');
  assert.deepEqual([privateCode, privateMessage], [code, message]);
});

test('5a · R18 user rulings are read-only for Auditor and Leader; R22 denies Worker search and writes', async t => {
  const f = await fixture(t);
  const superAddr = await f.spawn('super'), auditor = await f.spawn('auditor'), leader = await f.spawn('leader');
  const worker = await f.spawn('worker', {}, leader);
  const entry = draft('userguidance', { project: null, layer: 'user' });
  const { item } = await put(f, superAddr, entry);
  for (const addr of [auditor, leader]) {
    assert.deepEqual((await search(f, addr, entry.title)).rows.map(row => row.id), [item.id]);
    assert.equal((await show(f, addr, item.id)).item.body, entry.body);
    await assert.rejects(put(f, addr, entry), cliError('forbidden'));
    await assert.rejects(mutate(f, addr, 'update', item.id, 1, entry), cliError('forbidden'));
    await assert.rejects(mutate(f, addr, 'invalidate', item.id, 1), cliError('forbidden'));
  }
  await assert.rejects(search(f, worker, entry.title), cliError('forbidden'));
  assert.equal((await show(f, worker, item.id)).item, null);
  await assert.rejects(put(f, worker, draft('forged', { role: 'auditor', author: auditor })), cliError('forbidden'));
});
for (const action of ['update', 'invalidate']) {
  test(`5a · CLI denies Worker ${action} of project memory`, async t => {
    const f = await fixture(t);
    const auditor = await f.spawn('auditor'), leader = await f.spawn('leader');
    const worker = await f.spawn('worker', {}, leader);
    const entry = draft('worker-mutation-target');
    const { item } = await put(f, auditor, entry);

    await assert.rejects(mutate(f, worker, action, item.id, item.revision,
      action === 'update' ? { ...entry, body: 'Unauthorized change.' } : undefined), cliError('forbidden'));
    assert.deepEqual((await show(f, auditor, item.id)).item, item);
  });
}
test('5a · CLI hides unattached project memory from Worker show', async t => {
  const f = await fixture(t);
  const auditor = await f.spawn('auditor'), leader = await f.spawn('leader');
  // Create the item after dispatch so it was never an attachment to this card.
  const worker = await f.spawn('worker', {}, leader);
  const { item } = await put(f, auditor, draft('unattached-manifest'));
  assert.deepEqual((await show(f, auditor, item.id)).item, item);

  const { item: hidden, seq } = await show(f, worker, item.id);
  assert.deepEqual({ item: hidden, seq }, { item: null, seq: null });
});
test('5a · CLI denies Auditor update of a known foreign ID and preserves foreign state', async t => {
  const local = await fixture(t), foreign = await fixture(t, { capture: true });
  const auditor = await local.spawn('auditor'), owner = await foreign.spawn('auditor');
  const entry = draft('foreign-mutation-target');
  const { item } = await put(foreign, owner, entry);
  const before = structuredClone(foreign.snapshot());
  assert.ok(before.entries.some(row => row.id === item.id));

  const proposed = { ...entry, project: item.project, body: 'Unauthorized cross-project change.' };
  await assert.rejects(mutate(local, auditor, 'update', item.id, item.revision, proposed), cliError('forbidden'));
  assert.deepEqual((await show(foreign, owner, item.id)).item, item);
  assert.deepEqual(foreign.snapshot(), before);
});
test('5a · missing classifier fails closed through CLI', async t => {
  const f = await fixture(t, { classifySensitive: null });
  const auditor = await f.spawn('auditor');
  await assert.rejects(put(f, auditor, draft('unclassified')), cliError('classifier-missing'));
  assert.deepEqual((await search(f, auditor, 'unclassified')).rows, []);
});
test('5a · redaction stays on and multiline private blocks never appear in entries or replay', async t => {
  const f = await fixture(t, { capture: true });
  const auditor = await f.spawn('auditor');
  const entry = draft('sanitized', { body: 'Visible before. ' + syntheticSecret +
    '\n<private>PRIVATE_BLOCK_A\nPRIVATE_BLOCK_B</private>\nVisible after.' });
  const requestId = randomUUID();
  const first = await put(f, auditor, entry, requestId);
  const bypass = await put(f, auditor, { ...entry, title: 'still sanitized', redact: false })
    .catch(error => { cliError('invalid')(error); return null; });
  await f.restart();
  const replay = await put(f, auditor, entry, requestId);
  assert.deepEqual(replay.item, first.item);
  assert.match(replay.item.body, /Visible before\.[\s\S]*Visible after\./);
  assert.ok(f.snapshot().files['memory/items/' + first.item.id + '.md']);
  assert.doesNotMatch(JSON.stringify([first, bypass, replay, await show(f, auditor, first.item.id), f.snapshot()]),
    /SYNTHETIC_MEMORY_SECRET|PRIVATE_BLOCK_[AB]|<\/?private>/);
});
async function expiredReceiptReplay() {
  let state, now = initialTime;
  const binding = { sessionId: 'S', principal: 'A', role: 'auditor', project: 'P', cardId: null };
  const open = () => createMemoryStore({
    now: () => now, readState: () => state, commitState: next => { state = structuredClone(next); },
    evidence: { root: '/fixture', realpath: path => path }, classifySensitive,
  });
  let store = open();
  const request = title => ({
    op: 'put', requestId: title, expectedRevision: null, entry: draft(title, { project: 'P' }),
  });
  const old = request('old'), fresh = request('fresh');
  const first = await store.write(binding, old);
  now += 750;
  const second = await store.write(binding, fresh);
  assert.ok(first.ok && second.ok);
  now = initialTime + 30 * 86_400_000 + 1;
  store = open();
  await store.maintain();
  assert.deepEqual(state.receipts.map(row => row.requestId), [fresh.requestId]);
  const retained = structuredClone(state);
  assert.deepEqual(await store.write(binding, fresh), second);
  assert.equal((await store.write(binding, { ...fresh, entry: { ...fresh.entry, body: 'Changed.' } })).code, 'conflict');
  assert.deepEqual(state, retained);
  assert.equal((await store.access.show(binding, first.item.id)).item.revision, 1);
  return { store, binding, request, old, first, retained, snapshot: () => state };
}

test('6b L8 · store maintenance prunes full receipts and rejects changed expired replay', async () => {
  const { store, binding, request, old, retained, snapshot } = await expiredReceiptReplay();
  const replay = await store.write(binding, { ...request('new'), requestId: old.requestId });
  assert.equal(replay.code, 'conflict', 'changed replay of an expired request ID must conflict');
  assert.equal(replay.ok, false);
  assert.deepEqual(snapshot(), retained);
});

test('6b L8 · identical replay after 30 days never creates a second entry', async () => {
  const { store, binding, old, first, retained, snapshot } = await expiredReceiptReplay();
  const replay = await store.write(binding, old);
  const conflict = replay.ok === false && replay.code === 'conflict';
  const idempotent = replay.ok === true && replay.item?.id === first.item.id &&
    replay.receipt?.requestId === old.requestId;
  assert.deepEqual({ entriesAdded: snapshot().entries.length - retained.entries.length, conflictOrIdempotent: conflict || idempotent },
    { entriesAdded: 0, conflictOrIdempotent: true });
});
test('6b L8 · expired receipt conflicts persist across daemon tick and restart', async t => {
  const statePath = join(mkdtempSync(join(isolatedHome, 'receipts-')), 'state.json');
  let now = initialTime;
  const receiptTtlMs = 1000;
  const options = {
    now: () => now, receiptTtlMs,
    readState: () => JSON.parse(readFileSync(statePath, 'utf8')),
    commitState: state => writeFileSync(statePath, JSON.stringify(state)),
  };
  options.commitState(null);
  const open = () => createMemoryStore({ ...options, classifySensitive,
    evidence: { root: '/fixture', realpath: path => path },
  });
  const binding = { sessionId: 'S', principal: 'A', role: 'auditor', project: 'P', cardId: null };
  const request = (requestId, body) => ({ op: 'put', requestId, expectedRevision: null,
    entry: draft(requestId, { project: 'P', body }),
  });
  const old = request('old', 'Check the manifest signature.');
  const fresh = request('fresh', 'Check the artifact digest.');
  const seed = open();
  const first = await seed.write(binding, old);
  now += 500;
  const second = await seed.write(binding, fresh);
  assert.ok(first.ok && second.ok);
  const f = await fixture(t, options);
  await f.restart();

  now = initialTime + receiptTtlMs - 1;
  const before = options.readState();
  const retained = open();
  assert.deepEqual(await retained.write(binding, old), first);
  assert.equal((await retained.write(binding, request('old', 'Different content.'))).code, 'conflict');
  await f.tick();
  assert.deepEqual(options.readState(), before, 'both receipts survive before the cutoff');

  now += 1;
  await f.tick();
  const cleaned = options.readState();
  assert.deepEqual(cleaned.receipts, before.receipts.filter(row => row.requestId === fresh.requestId));
  for (const key of ['entries', 'changes', 'seq', 'files', 'grants', 'turns', 'nextId']) {
    assert.deepEqual(cleaned[key], before[key], `receipt cleanup preserves ${key}`);
  }
  await f.restart();
  assert.deepEqual(options.readState(), cleaned);
  const restarted = open();
  assert.deepEqual(await restarted.write(binding, fresh), second);
  assert.equal((await restarted.write(binding, request('fresh', 'Different content.'))).code, 'conflict');
  assert.deepEqual(options.readState(), cleaned);
  const replay = await restarted.write(binding, request('old', 'New content after cleanup.'));
  assert.equal(replay.code, 'conflict', 'changed replay of an expired request ID must conflict after restart');
  assert.equal(replay.ok, false);
  assert.deepEqual(options.readState(), cleaned);
});
function noModel(t, f) {
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('unexpected model request'); });
  return (opened, prompted) => {
    assert.equal(fetch.mock.callCount(), 0);
    assert.equal(f.opens.length, opened);
    assert.equal(f.prompts.length, prompted);
  };
}
async function generated(f, reader, query, addr, turnId, content) {
  const history = await f.cli(reader, 'hist', addr, '--level', 'L2');
  assert.ok(history.turns.some(turn => turn.id === turnId), 'the source turn is available through hist');
  const entries = (f.snapshot()?.entries ?? []).filter(item => [item.title, ...(item.keywords ?? [])].join(' ').includes(query));
  assert.equal(entries.length, 1, 'one memory entry for ' + query);
  const [item] = entries;
  assert.equal(item.source.hist.addr, addr);
  assert.equal(item.source.hist.turnId, turnId);
  assert.match(item.body, content);
  return item;
}
test('5a · REMEMBER extracts senior final lines only and never promotes Worker reply lines', async t => {
  const f = await fixture(t, { capture: true });
  const check = noModel(t, f);
  const auditor = await f.spawn('auditor'), leader = await f.spawn('leader'), superAddr = await f.spawn('super');
  const worker = await f.spawn('worker', {}, leader);
  await f.tick();
  const inputs = [[auditor, 'auditfact'], [leader, 'leadfact'], [superAddr, 'superfact'], [worker, 'workerfact']];
  const turns = inputs.map(([addr, word]) => f.finish(addr, 'Narration with inline REMEMBER: inlinefact\n' +
    'REMEMBER: ' + word + ' verified.' + (addr === worker ? '\nDONE WORKER' : ''), 'REMEMBER: commentaryfact'));
  await f.tick();
  check(4, 5);
  assert.match(f.prompts.at(-1).input, /波次 W[\s\S]*workerfact/);
  for (const [i, [addr, word]] of inputs.slice(0, 3).entries()) {
    await generated(f, superAddr, word, addr, turns[i], /verified/);
  }
  assert.doesNotMatch(JSON.stringify(f.snapshot().entries), /workerfact|inlinefact|commentaryfact/);
});

test('5b · Super-recorded user ruling produces one sourced ruling across ticks', async t => {
  const f = await fixture(t, { capture: true });
  const check = noModel(t, f);
  const superAddr = await f.spawn('super');
  const text = 'rulingfact Require a signed release manifest.';
  await f.tick();
  f.finish(superAddr, 'Recorded R42 in .project/rulings.md.');
  f.write('.project/rulings.md', '# 裁决账本\nR42. ' + text + '\n');
  await f.tick();
  await f.tick();
  check(1, 1);
  const entries = f.snapshot().entries.filter(item => item.kind === 'ruling' && item.body.includes(text));
  assert.equal(entries.length, 1);
  assert.equal(entries[0].source.path, '.project/rulings.md');
});

test('6e.3 rulings ledger sync preserves the dated quotes and supersession chain across restarts', async t => {
  const f = await fixture(t, { capture: true });
  const decisions = [
    ['R21', '2026-11-20', '“Use the nightly release window.”'],
    ['R27', '2026-11-24', '“Use the morning window.” 整条取代 R21。'],
    ['R28', '2026-11-26', '“Wait for manifest sign-off before release.” 整条取代 R27。'],
  ].map(([number, date, quote]) => [number, `（${date}）${quote}`]);
  f.write('.project/rulings.md', '# 裁决账本\n' + decisions.map(([number, body]) => `${number}. ${body}\n`).join(''));
  await f.tick();
  const entries = f.snapshot()?.entries ?? [];
  assert.equal(entries.length, decisions.length, 'sync the ledger without a Super turn citing it');
  const [original, revised, current] = decisions.map(([number, body]) => {
    const entry = entries.find(item => item.body.includes(body));
    assert.ok(entry, `${number} preserves its date and verbatim user quote`);
    assert.equal(entry.kind, 'ruling');
    assert.equal(entry.layer, 'user');
    assert.equal(entry.source.path, '.project/rulings.md');
    return entry;
  });
  assert.deepEqual(revised.supersedes, [original.id]);
  assert.deepEqual(current.supersedes, [revised.id]);
  assert.equal(current.status, 'active');
  await assertRulingIndex(f, [current]);
  const before = structuredClone(f.snapshot());
  await f.tick();
  await f.restart();
  await f.tick();
  assert.deepEqual(f.snapshot(), before);
});

async function assertRulingIndex(f, expected) {
  const access = createAccess({ readState: f.snapshot });
  for (const role of ['leader', 'auditor']) {
    const { rows } = await access.index({ role, principal: role, project: f.project });
    assert.deepEqual(rows.map(row => row.id).sort(), expected.map(entry => entry.id).sort(), role);
  }
}

test('6e.3 partial ledger replacements keep the original rulings active and indexed', async t => {
  const f = await fixture(t, { capture: true });
  const original21 = 'Require signed releases and allow an occasional reviewer.';
  const original24 = '① Keep the sandbox. ② Check provenance. ③ Allow a temporary reviewer.';
  const replacement = '审计员负责复核。取代 R21 中的临时 reviewer 口子与 R24③。';
  f.write('.project/rulings.md', `# 裁决账本\nR21. ${original21}\nR24. ${original24}\nR26. ${replacement}\n`);
  await f.tick();
  const entries = f.snapshot()?.entries ?? [];
  assert.equal(entries.length, 3, 'sync both original rulings and the partial replacement');
  for (const body of [original21, original24, replacement]) {
    const entry = entries.find(item => item.body.includes(body));
    assert.ok(entry, `preserve ledger text: ${body}`);
    assert.equal(entry.status, 'active');
    assert.equal(entry.layer, 'user');
  }
  await assertRulingIndex(f, entries);
});

test('6e.3 ledger sync keeps R27 and R28 continuations verbatim alongside the originals', async t => {
  const f = await fixture(t, { capture: true });
  const lines = [
    ['R27', '. ', 'Reuse a worker for closely related work.'],
    ['R27', ' ', '修正（用户）：Finish the current card before applying the reuse threshold.'],
    ['R28', '. ', 'Keep the same worker through a card where possible.'],
    ['R28', ' ', '更正（用户指出悖论）：Consider both remaining context and prior compaction.'],
    ['R28', ' ', '补充（试点经验）：Allow reuse only within the same worktree.'],
  ];
  f.write('.project/rulings.md', ['# 裁决账本', ...lines.map(fields => fields.join('')), ''].join('\n'));
  await f.tick();
  const entries = f.snapshot()?.entries ?? [];
  assert.equal(entries.length, lines.length, 'sync each continuation as its own ruling');
  for (const [number, , body] of lines) {
    const entry = entries.find(item => item.body.includes(body));
    assert.ok(entry, `preserve the text of ${number} ${body}`);
    assert.match(`${entry.title}\n${entry.body}`, new RegExp(`\\b${number}\\b`, 'u'));
    assert.equal(entry.status, 'active');
    assert.equal(entry.kind, 'ruling');
    assert.equal(entry.layer, 'user');
    assert.equal(entry.source.path, '.project/rulings.md');
  }
  await assertRulingIndex(f, entries);
});

async function staysInHistory(f, reader, addr, turnId, reply, before) {
  const history = await f.cli(reader, 'hist', addr, '--level', 'L2');
  const turn = history.turns.find(row => row.id === turnId);
  assert.ok(turn, 'the source turn remains available in hist');
  assert.match(JSON.stringify(turn), reply);
  assert.deepEqual(f.snapshot()?.entries ?? [], before, 'completed event leaves the memory entries unchanged');
}

for (const [action, gate, reply, expected] of [
  ['gate-pack', 'gatefact', 'APPROVE gatefact\nCondition: Preserve the signed manifest.', /APPROVE[\s\S]*Preserve the signed manifest/],
  ['escalate', 'redfact', 'RESOLVED redfact\nConfirm the protected file was restored.', /RESOLVED[\s\S]*protected file was restored/],
]) {
  test(`6e.3 ${action} keeps the Auditor conclusion in hist without creating memory`, async t => {
    const f = await fixture(t, { capture: true });
    await exec('/usr/bin/git', ['init', '-q'], { cwd: f.project });
    await exec('/usr/bin/git', ['-c', 'user.name=Loom', '-c', 'user.email=loom@example.invalid',
      'commit', '--allow-empty', '-qm', 'Gate candidate'], { cwd: f.project });
    const check = noModel(t, f);
    const leader = await f.spawn('leader'), auditor = await f.spawn('auditor');
    await f.tick();
    f.finish(auditor, 'Ready for review.');
    const packet = await f.handle(action, { gate, ...(action === 'escalate' &&
      { reason: 'protected-file', evidence: 'The protected file was touched.' }) }, leader);
    await f.tick();
    assert.equal(deliveryId(f.prompts.at(-1).input), packet.deliveryId);
    const before = f.snapshot()?.entries ?? [];
    const turnId = f.finish(auditor, reply);
    await f.tick();
    await f.handle('notifications', { gateComplete: gate }, leader);
    await f.tick();
    check(2, 3);
    await staysInHistory(f, auditor, auditor, turnId, expected, before);
  });
}

test('6e.3 completed card result stays in hist without creating memory', async t => {
  const f = await fixture(t, { capture: true });
  const check = noModel(t, f);
  const leader = await f.spawn('leader'), auditor = await f.spawn('auditor');
  const worker = await f.spawn('worker', { task: 'cardfact' }, leader);
  await f.tick();
  const before = f.snapshot()?.entries ?? [];
  const turnId = f.finish(worker, 'DONE cardfact\nManifest verification passed.\nLeftovers & deviations: none');
  await f.tick();
  await f.tick();
  check(3, 3);
  await staysInHistory(f, auditor, worker, turnId, /DONE[\s\S]*Manifest verification passed/, before);
});

test('6e.3 acknowledged handover stays in the briefing and hist without creating memory', async t => {
  const f = await fixture(t, { capture: true });
  const check = noModel(t, f);
  const leader = await f.spawn('leader'), auditor = await f.spawn('auditor');
  await f.tick();
  const successor = await f.spawn('leader', { task: 'NEXT', 'handover-from': leader, prompt: 'handoverfact' });
  await f.tick();
  const input = f.prompts.find(prompt => prompt.addr === successor).input;
  const [, path] = /Read (\.project\/replies\/[a-f0-9]{64}\.txt)/.exec(input);
  const briefing = f.read(path);
  assert.match(briefing, /handoverfact/);
  const ack = briefing.trimEnd().split('\n').at(-1);
  assert.match(ack, /^HANDOVER-ACK /);
  await f.tick();
  f.finish(leader, 'Ready to retire.');
  const before = f.snapshot()?.entries ?? [];
  const turnId = f.finish(successor, ack);
  await f.tick();
  assert.equal((await f.handle('state', { target: leader })).state, 'exited');
  check(3, 3);
  await staysInHistory(f, auditor, successor, turnId, /HANDOVER-ACK/, before);
});

test('6e.3 migration withdraws legacy escalations, cards, gates and handovers once and preserves legitimate memory', async t => {
  const f = await fixture(t, { now: () => initialTime });
  const at = new Date(initialTime).toISOString();
  // Seed the persisted 6b entry shape, including the original category-dependent ID.
  const legacy = (category, index, title, role, kind, sourcePath) => {
    const addr = role + '-legacy';
    const turnId = 'legacy-turn-' + index;
    const key = category === 'gate' ? 'legacy-delivery-' + index : category === 'ruling' ? '42' : turnId;
    const hash = createHash('sha256').update(JSON.stringify([
      f.project, f.project, category, category === 'ruling' ? null : addr, key,
    ])).digest('hex');
    return {
      ...draft(title), id: 'memory-event-' + hash, revision: 1, status: 'active',
      role, author: role === 'worker' ? addr : role, kind, project: f.project,
      cardId: role === 'worker' ? 'FIXTURE-' + index : null, effectiveAt: at, updatedAt: at, usage: 0,
      source: { hist: { addr, turnId }, ...(sourcePath && { path: sourcePath }) },
    };
  };
  const noise = Array.from({ length: 25 }, (_, i) => [
    legacy('card', i, 'Card FIXTURE-' + i, 'worker', 'lesson'),
    legacy('gate', i, `Gate G${i} round 2`, 'auditor', 'ruling', `.project/gates/G${i}.r2.legacy-delivery-${i}.md`),
    i % 2 ? legacy('handover', i, 'auditor handover', 'auditor', 'ruling')
      : legacy('handover', i, 'leader handover', 'leader', 'lesson'),
  ]).flat();
  // Escalation verdicts used the same persisted category and identity as ordinary gate verdicts.
  noise.unshift(legacy('gate', 25, 'Escalation RELEASE-RED round 1', 'auditor', 'ruling',
    '.project/gates/RELEASE-RED.r1.legacy-delivery-25.md'));
  const ledger = { ...legacy('ruling', 0, 'R42 Verify release signatures', 'super', 'ruling', '.project/rulings.md'),
    project: null, layer: 'user' };
  const manual = { ...draft('Card evidence retention rule'), id: 'manual-lesson', revision: 1, kind: 'lesson',
    role: 'leader', author: 'leader', project: f.project, status: 'active', effectiveAt: at, updatedAt: at, usage: 0 };
  const reviewed = { ...manual, title: 'Capture release approvals', id: 'reviewed-lesson', original: 'reviewed-candidate',
    proposer: 'worker-legacy', reviewer: 'auditor' };
  const preserved = [ledger, manual, reviewed];
  const entries = [...noise, ...preserved];
  const files = Object.fromEntries(entries.map(entry => [itemPath(entry.id), renderEntry(entry)]));
  files['memory/INDEX.md'] = entries.map(entry => `- ${itemPath(entry.id)} — ${entry.title}\n`).join('');
  const changes = entries.map(({ body, source, ...entry }, i) =>
    ({ seq: i + 1, id: entry.id, revision: entry.revision, operation: 'add', entry }));
  const path = '.project/loomd/memory-v1.json';
  mkdirSync(join(f.project, '.project', 'loomd'), { recursive: true });
  f.write(path, JSON.stringify({ entries, files, changes, seq: changes.length, receipts: [], grants: [], turns: [], nextId: 0 }));
  await f.restart();
  await f.tick();
  const migrated = JSON.parse(f.read(path));
  const byId = new Map(migrated.entries.map(entry => [entry.id, entry]));
  const withdrawn = new Set(migrated.changes.filter(change => change.operation === 'withdraw').map(change => change.id));
  for (const entry of noise) {
    assert.ok(byId.has(entry.id) && byId.get(entry.id).status !== 'active', `retired with a marker: ${entry.title}`);
    assert.ok(withdrawn.has(entry.id), `withdrawal is recorded: ${entry.title}`);
  }
  for (const entry of preserved) assert.deepEqual(byId.get(entry.id), entry);
  const access = createAccess({ readState: () => JSON.parse(f.read(path)), now: () => initialTime });
  for (const role of ['leader', 'auditor']) {
    const { rows } = await access.index({ role, principal: role, project: f.project });
    assert.deepEqual(rows.map(row => row.id).sort(), preserved.map(entry => entry.id).sort());
  }
  await f.tick();
  await f.restart();
  await f.tick();
  assert.deepEqual(JSON.parse(f.read(path)), migrated, 'migration is reentrant and does not duplicate withdrawals');
});
