import assert from 'node:assert/strict';
import { test } from 'node:test';
const NOW = Date.parse('2026-01-15T12:00:00Z');
const DAY = 86_400_000;
const clock = () => NOW;
const sessionId = 'session-1';
const source = { sessionId, fileId: 'session.jsonl', generation: 1 };
const jsonl = record => Buffer.from(JSON.stringify(record) + '\n', 'utf8');
const range = (start, bytes) => ({ start, end: start + bytes.length });

test('U15 ships complete UTF-8 lines and checkpoints only contiguous ACKs per generation', async () => {
  const { createCellShipper, createHomeShipper } = await import('./shipper.mjs');
  const raw = [];
  const conflicts = [];
  const checkpoints = new Map();
  const sourceKey = ({ sessionId, fileId, generation }) => JSON.stringify([sessionId, fileId, generation]);
  const cell = createCellShipper({
    clock,
    readCheckpoint: identity => checkpoints.get(sourceKey(identity)) ?? 0,
    writeCheckpoint: (identity, offset) => checkpoints.set(sourceKey(identity), offset),
  });
  const home = createHomeShipper({
    clock,
    readRaw: identity => raw.filter(record => sourceKey(record) === sourceKey(identity)),
    appendRaw: records => {
      raw.push(...records.map(record => ({ ...record, bytes: Buffer.from(record.bytes) })));
    },
    recordConflict: conflict => conflicts.push(conflict),
  });
  const first = jsonl({ id: 1, text: 'one' });
  const second = jsonl({ id: 2, text: '雪' });
  const third = jsonl({ id: 3, text: 'three' });
  const split = second.indexOf(Buffer.from('雪')) + 1;
  const secondEnd = first.length + second.length;
  const end = secondEnd + third.length;
  const push = (identity, start, bytes) => cell.ingest({ ...identity, start, bytes });
  const send = async batch => {
    const ack = await home.receive(batch);
    await cell.acknowledge(ack);
    return ack.contiguousEnd;
  };
  const checkpoint = identity => checkpoints.get(sourceKey(identity)) ?? 0;
  const stored = () => raw.map(({ generation, start, bytes }) => [generation, start, bytes])
    .sort(([a, x], [b, y]) => a - b || x - y);

  const [head, ...extra] = await push(source, 0, Buffer.concat([first, second.subarray(0, split)]));
  assert.deepEqual(extra, []);
  assert.deepEqual(head.bytes, first);
  assert.deepEqual({ start: head.start, end: head.end }, range(0, first));
  assert.equal(await send(head), first.length);
  assert.equal(checkpoint(source), first.length);
  assert.deepEqual(stored(), [[1, 0, first]]);

  const [middle] = await push(source, first.length + split, second.subarray(split));
  const [tail] = await push(source, secondEnd, third);
  assert.deepEqual(middle.bytes, second);
  assert.deepEqual({ start: middle.start, end: middle.end }, range(first.length, second));
  assert.equal(await send(tail), first.length);
  assert.equal(checkpoint(source), first.length);
  assert.equal(await send(middle), end);
  assert.equal(checkpoint(source), end);
  assert.equal(await send(middle), end);
  assert.equal(await send(head), end);
  const expected = [[1, 0, first], [1, first.length, second], [1, secondEnd, third]];
  assert.deepEqual(stored(), expected);
  assert.deepEqual(conflicts, []);

  const replacement = jsonl({ id: 1, text: 'two' });
  assert.equal(replacement.length, first.length);
  await send({ ...head, bytes: replacement });
  assert.deepEqual(stored(), expected);
  assert.equal(checkpoint(source), end);
  assert.equal(conflicts.length, 1);
  assert.deepEqual(
    [conflicts[0].generation, conflicts[0].start, conflicts[0].end],
    [1, 0, first.length],
  );

  const next = { ...source, generation: 2 };
  assert.equal(checkpoint(next), 0);
  const [rotated] = await push(next, 0, replacement);
  assert.equal(await send(rotated), replacement.length);
  assert.equal(checkpoint(next), replacement.length);
  assert.equal(checkpoint(source), end);
  assert.deepEqual(stored(), [...expected, [2, 0, replacement]]);
  assert.equal(conflicts.length, 1);
});

test('U16 projects paged OpenCode records once per native ID and version without SQLite reads', async t => {
  const { createOpenCodeAdapter } = await import('./shipper.mjs');
  const pending = { id: 'tool-1', version: 1, status: 'running' };
  const prompt = { id: 'prompt-1', version: 1, text: 'check history' };
  const completed = { ...pending, version: 2, status: 'completed' };
  const reply = { id: 'reply-1', version: 1, text: 'checked' };
  const snapshots = [
    [[prompt], [pending]],
    [[prompt], [pending]],
    [[prompt, completed], [reply]],
  ];
  const appended = [];
  const readFile = t.mock.fn(() => { throw new Error('Unexpected OpenCode file read'); });
  let pages;
  const readPage = t.mock.fn(({ sessionId: requested, cursor }) => {
    assert.equal(requested, sessionId);
    const page = cursor === 'next' ? 1 : 0;
    return { records: structuredClone(pages[page]), nextCursor: page === 0 ? 'next' : null };
  });
  const io = {
    clock, readPage, readFile,
    readAppended: requested => structuredClone(appended.filter(row => row.sessionId === requested)),
    append: records => { appended.push(...structuredClone(records)); },
  };
  let adapter = createOpenCodeAdapter(io);
  const project = async index => {
    pages = snapshots[index];
    await adapter.project(sessionId);
  };
  const projected = () => appended.map(row => [row.sessionId, row.nativeId, row.version, row.record]);

  await project(0);
  assert.deepEqual(projected(), [[sessionId, prompt.id, 1, prompt], [sessionId, pending.id, 1, pending]]);
  const initial = structuredClone(appended);
  await project(1);
  assert.deepEqual(appended, initial);
  await project(2);
  assert.deepEqual(appended.slice(0, initial.length), initial);
  assert.deepEqual(projected().slice(2), [[sessionId, pending.id, 2, completed], [sessionId, reply.id, 1, reply]]);
  const stable = structuredClone(appended);
  const ids = stable.map(row => row.id);
  assert.ok(ids.every(id => typeof id === 'string' && id.length > 0));
  assert.equal(new Set(ids).size, 4);

  adapter = createOpenCodeAdapter(io);
  for (const index of snapshots.keys()) await project(index);
  assert.deepEqual(appended, stable);
  assert.deepEqual(readPage.mock.calls.map(call => call.arguments[0].cursor),
    Array.from({ length: 6 }, () => [null, 'next']).flat());
  assert.equal(readFile.mock.callCount(), 0);
});

test('U17 publishes and schedules retryable cleanup once after the final raw ACK', async () => {
  const { createHistoryPublisher } = await import('./shipper.mjs');
  const evidence = [];
  const done = [];
  const cleanup = [];
  let failCleanup = true;
  const publisher = createHistoryPublisher({
    clock,
    publishEvidence: card => evidence.push(card),
    deliverDone: message => done.push(message),
    performCleanup: action => {
      cleanup.push(action);
      if (failCleanup) throw new Error('temporary cleanup failure');
    },
  });
  const turnId = 'turn-1';
  const deliveryId = 'delivery-1';
  const acknowledge = contiguousEnd => publisher.acknowledge({ ...source, contiguousEnd });
  await publisher.completeTurn({ ...source, turnId, deliveryId, start: 10, end: 60 });
  await publisher.requestCleanup({ turnId, paths: ['worker.log', 'worktree'] });
  await publisher.acknowledge({ ...source, generation: 2, contiguousEnd: 60 });
  assert.deepEqual([evidence, done, await publisher.pendingCleanup(), cleanup], [[], [], [], []]);
  await acknowledge(59);
  assert.deepEqual([evidence, done, await publisher.pendingCleanup(), cleanup], [[], [], [], []]);

  await acknowledge(60);
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].turnId, turnId);
  const { publicationId } = evidence[0];
  assert.ok(typeof publicationId === 'string' && publicationId.length > 0);
  assert.deepEqual(done.map(message => [message.deliveryId, message.publicationId]), [[deliveryId, publicationId]]);
  const actions = structuredClone(await publisher.pendingCleanup());
  assert.equal(actions.length, 1);
  const [action] = actions;
  assert.ok(action.id);
  assert.deepEqual(action.paths, ['worker.log', 'worktree']);
  assert.deepEqual(cleanup, []);

  await acknowledge(60);
  assert.deepEqual(await publisher.pendingCleanup(), actions);
  await assert.rejects(async () => publisher.runCleanup(action.id), /temporary cleanup failure/);
  await acknowledge(60);
  assert.deepEqual(await publisher.pendingCleanup(), actions);
  failCleanup = false;
  await publisher.runCleanup(action.id);
  await acknowledge(60);
  assert.deepEqual(await publisher.pendingCleanup(), []);
  assert.deepEqual(cleanup.map(attempt => attempt.id), [action.id, action.id]);
  assert.deepEqual(evidence.map(card => card.publicationId), [publicationId]);
  assert.deepEqual(done.map(message => [message.deliveryId, message.publicationId]), [[deliveryId, publicationId]]);
});

test('U18 rebuilds derived history and reports Git gaps and age or size retention boundaries', async t => {
  const { createHistoryStore } = await import('./shipper.mjs');
  for (const limit of ['age', 'size']) {
    await t.test(`prunes by ${limit} while preserving pending raw and independent memory`, async () => {
      const availableSha = 'a'.repeat(40);
      const missingSha = 'b'.repeat(40);
      const memory = new Map([['memory-1', { id: 'memory-1', revision: 1, body: 'Retain this fact.' }]]);
      const originalMemory = structuredClone(memory);
      let offset = 0;
      const record = (turnId, at, gitSha, confirmed = true, text = turnId) => {
        const bytes = jsonl({ type: 'turn.completed', turnId, at, gitSha, text });
        const row = { ...source, ...range(offset, bytes), bytes, confirmed };
        offset = row.end;
        return row;
      };
      const oldAt = NOW - (limit === 'age' ? 8 : 2) * DAY;
      const pending = record('pending', NOW - 9 * DAY, availableSha, false);
      const old = record('old', oldAt, availableSha, true, 'x'.repeat(512));
      const current = record('current', NOW - DAY, availableSha);
      const missing = record('missing', NOW, missingSha);
      let raw = [pending, old, current, missing];
      const originalRaw = structuredClone(raw);
      const derived = new Map();
      const git = new Map([[availableSha, { diff: '+ retained line\n' }]]);
      const keptBytes = current.bytes.length + missing.bytes.length + pending.bytes.length;
      const history = createHistoryStore({
        clock,
        retention: { maxAgeMs: 7 * DAY, maxBytes: keptBytes + (limit === 'age' ? old.bytes.length : 0) },
        readRaw: () => raw.slice(),
        deleteRaw: records => { raw = raw.filter(row => !records.some(record => record.start === row.start)); },
        readGit: sha => git.get(sha) ?? null,
        memory,
        derived,
      });
      const rebuild = () => history.rebuild(sessionId);
      const query = () => history.query(sessionId);
      await rebuild();
      const before = structuredClone(await query());
      assert.deepEqual(before.turns.map(turn => turn.turnId), ['old', 'current', 'missing']);
      assert.equal(before.turns[1].diff, git.get(availableSha).diff);
      const missingGap = { turnId: 'missing', kind: 'missing-git-object', sha: missingSha };
      assert.deepEqual(before.turns[2].gap, missingGap);

      assert.ok(derived.size > 0);
      derived.clear();
      await rebuild();
      assert.deepEqual(await query(), before);
      assert.deepEqual(structuredClone(raw), originalRaw);

      await history.scanRetention();
      assert.deepEqual(structuredClone(raw), originalRaw.filter(row => row.start !== old.start));
      assert.deepEqual(memory, originalMemory);
      const retained = await query();
      assert.deepEqual(retained.turns, before.turns.slice(1));
      assert.equal(retained.retentionBoundary.start, old.end);
      assert.ok(retained.gaps.some(gap => gap.turnId === missingGap.turnId &&
        gap.kind === missingGap.kind && gap.sha === missingGap.sha));
    });
  }
});
