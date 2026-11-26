import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
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
  const turnId = f.finish(superAddr, 'Recorded R42 in .project/rulings.md.');
  f.write('.project/rulings.md', '# 裁决账本\nR42. ' + text + '\n');
  await f.tick();
  await f.tick();
  check(1, 1);
  const item = await generated(f, superAddr, 'rulingfact', superAddr, turnId, /Require a signed release manifest/);
  assert.equal(item.kind, 'ruling');
});

for (const [action, gate, reply, expected] of [
  ['gate-pack', 'gatefact', 'APPROVE gatefact\nCondition: Preserve the signed manifest.', /APPROVE[\s\S]*Preserve the signed manifest/],
  ['escalate', 'redfact', 'RESOLVED redfact\nConfirm the protected file was restored.', /RESOLVED[\s\S]*protected file was restored/],
]) {
  test('5b · ' + action + ' captures the Auditor conclusion with its hist source', async t => {
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
    const turnId = f.finish(auditor, reply);
    await f.tick();
    await f.handle('notifications', { gateComplete: gate }, leader);
    await f.tick();
    check(2, 3);
    await generated(f, auditor, gate, auditor, turnId, expected);
  });
}

test('5b · completed card yields one structured result tied to the Worker hist turn', async t => {
  const f = await fixture(t, { capture: true });
  const check = noModel(t, f);
  const leader = await f.spawn('leader'), auditor = await f.spawn('auditor');
  const worker = await f.spawn('worker', { task: 'cardfact' }, leader);
  await f.tick();
  const turnId = f.finish(worker, 'DONE cardfact\nManifest verification passed.\nLeftovers & deviations: none');
  await f.tick();
  await f.tick();
  check(3, 3);
  await generated(f, auditor, 'cardfact', worker, turnId, /DONE[\s\S]*Manifest verification passed/);
});

test('5b · acknowledged handover records the transition and the successor hist turn', async t => {
  const f = await fixture(t, { capture: true });
  const check = noModel(t, f);
  const leader = await f.spawn('leader'), auditor = await f.spawn('auditor');
  await f.tick();
  const successor = await f.spawn('leader', { task: 'NEXT', 'handover-from': leader, prompt: 'handoverfact' });
  await f.tick();
  const input = f.prompts.find(prompt => prompt.addr === successor).input;
  const [, path] = /Read (\.project\/replies\/[a-f0-9]{64}\.txt)/.exec(input);
  const ack = f.read(path).trimEnd().split('\n').at(-1);
  assert.match(ack, /^HANDOVER-ACK /);
  await f.tick();
  f.finish(leader, 'Ready to retire.');
  const turnId = f.finish(successor, ack);
  await f.tick();
  assert.equal((await f.handle('state', { target: leader })).state, 'exited');
  check(3, 3);
  const { body } = await generated(f, auditor, 'handoverfact', successor, turnId, /handoverfact/);
  assert.ok(body.includes(leader) && body.includes(successor));
});
