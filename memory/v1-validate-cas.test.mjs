import assert from 'node:assert/strict';
import { posix } from 'node:path';
import test from 'node:test';
import { estimateTokens } from '../lib/token-budget.mjs';

const project = 'fixture-project';
const root = '/fixture/repo';
const checkedAt = '2026-03-01T12:00:00.000Z';
const now = () => checkedAt;
const indexPath = 'memory/INDEX.md';
const itemPath = id => `memory/items/${id}.md`;
const binding = (sessionId, role) => ({ sessionId, role, project, card: 'fixture-card' });
const auditor = binding('audit-session', 'Auditor');
const worker = binding('worker-session', 'Worker');
const draft = {
  kind: 'ruling', layer: 'shared', title: 'Verify release evidence',
  body: 'Verify release evidence before approval.', source: { path: 'docs/release.md' },
  checkedAt,
};

function memoryIO() {
  const files = new Map();
  return {
    read: path => files.get(path),
    write: (path, text) => files.set(path, text),
    list: prefix => [...files.keys()].filter(path => path.startsWith(prefix)),
  };
}

test('U05 validates Markdown, deduplicates by layer and rebuilds the index', async () => {
  const { createMemoryFormat } = await import('./format.mjs');
  const sha = '22b96ccab9e766cd6a73162d5f9d8951128584a4';
  const fakeSha = 'f'.repeat(40);
  const paths = new Map([
    [`${root}/docs/release.md`, `${root}/docs/release.md`],
    ['/fixture/outside.md', '/fixture/outside.md'],
    [`${root}/linked.md`, '/fixture/outside.md'],
  ]);
  const io = memoryIO();
  const store = createMemoryFormat({
    now, io, estimateTokens, maxMetadataBytes: 4096,
    evidence: {
      root,
      realpath: path => {
        const resolved = paths.get(posix.normalize(path));
        if (resolved) return resolved;
        throw Object.assign(new Error('Path is missing'), { code: 'ENOENT' });
      },
      hasCommit: ref => ref === sha,
    },
  });
  const boundaryBody = '核'.repeat(200);
  const cases = [
    ['valid path', { body: boundaryBody }, 'accepted'],
    ['overlong body', { body: boundaryBody + '验' }, 'rejected'],
    ['malformed metadata', { kind: 'unknown-kind' }, 'rejected'],
    ['oversized metadata', { keywords: ['a'.repeat(8192)] }, 'rejected'],
    ['same-layer duplicate', { body: boundaryBody }, 'duplicate'],
    ['same fact in private layer', { body: boundaryBody, layer: 'private' }, 'accepted'],
    ['real commit', { title: 'Check the baseline', source: { sha } }, 'accepted'],
    ['fictional commit', { source: { sha: fakeSha } }, 'rejected'],
    ['missing path', { source: { path: 'docs/missing.md' } }, 'rejected'],
    ['parent traversal', { source: { path: '../outside.md' } }, 'rejected'],
    ['symlink escape', { source: { path: 'linked.md' } }, 'rejected'],
  ];
  const accepted = [];
  for (const [name, fields, status] of cases) {
    const entry = { ...draft, ...fields };
    const receipt = await store.submit(auditor, { requestId: name, expectedRevision: null, entry });
    assert.equal(receipt.status, status, name);
    if (status === 'accepted') {
      assert.ok(receipt.id, name);
      assert.ok(accepted.every(item => item.id !== receipt.id), name);
      const markdown = io.read(itemPath(receipt.id));
      assert.match(markdown, /^---\r?\n/);
      assert.ok(markdown.includes(`# ${entry.title}\n\n${entry.body}`), name);
      accepted.push({ id: receipt.id, title: entry.title });
    }
    if (status === 'duplicate') assert.equal(receipt.id, accepted[0].id, name);

    io.write(indexPath, 'stale index\n');
    await store.rebuildIndex(auditor);
    assert.deepEqual(io.list('memory/items/').sort(), accepted.map(({ id }) => itemPath(id)).sort(), name);
    const lines = io.read(indexPath).trimEnd().split(/\r?\n/);
    assert.equal(lines.length, accepted.length, name);
    for (const { id, title } of accepted) {
      assert.equal(lines.filter(line => line.includes(itemPath(id)) && line.includes(title)).length, 1, name);
    }
  }
});

test('U06 uses observed provenance and redacts writes, promotions and history', async () => {
  const { createSanitizedMemory } = await import('./sanitize.mjs');
  const secret = 'SYNTH_SECRET_TOKEN_001';
  const opaque = 'SYNTH_SECRET_TOKEN_002';
  const replacement = '[REDACTED]';
  const safeTitle = 'Confirm endpoint';
  const title = `${safeTitle} ${secret}`;
  const observed = [
    { kind: 'web', location: 'https://example.test/release', observedAt: checkedAt },
    { kind: 'mcp', location: 'mcp://fixture/release', observedAt: checkedAt },
  ];
  const forged = { kind: 'web', location: 'https://forged.example.test', observedAt: checkedAt };
  const io = memoryIO();
  const store = createSanitizedMemory({
    now, io,
    getObservations: sessionId => sessionId === worker.sessionId ? observed : [],
    readRaw: sessionId => sessionId === worker.sessionId ? [{ title, body: title }] : [],
    classifySensitive: text => {
      if (text.includes(opaque)) return { reliable: false };
      const spans = [];
      for (const match of text.matchAll(/SYNTH_SECRET_TOKEN_001/g)) {
        spans.push({ start: match.index, end: match.index + secret.length });
      }
      return { reliable: true, spans };
    },
    replacement,
  });
  const unobserved = await store.submit(auditor, {
    requestId: 'unobserved', expectedRevision: null, entry: { ...draft, externalSources: [forged] },
  });
  assert.equal(unobserved.status, 'accepted');
  const unobservedItem = await store.show(auditor, unobserved.id);
  assert.deepEqual(unobservedItem.externalSources ?? [], []);

  const candidate = await store.submit(worker, {
    requestId: 'candidate', expectedRevision: null,
    entry: { ...draft, kind: 'candidate', proposedKind: 'ruling', title, body: title, externalSources: [forged] },
  });
  assert.equal(candidate.status, 'candidate');
  assert.ok(candidate.id);
  const proposed = await store.show(auditor, candidate.id);
  assert.equal(proposed.title, `${safeTitle} ${replacement}`);
  assert.equal(proposed.body, proposed.title);
  assert.deepEqual(proposed.externalSources, observed);
  for (const path of io.list('memory/')) assert.ok(!io.read(path).includes(secret), path);

  const approved = await store.promote(auditor, {
    requestId: 'promotion', id: candidate.id, expectedRevision: candidate.revision,
  });
  assert.equal(approved.status, 'accepted');
  const promoted = await store.show(auditor, approved.id);
  assert.equal(promoted.title, proposed.title);
  assert.equal(promoted.body, proposed.body);
  assert.deepEqual(promoted.externalSources, observed);

  const rejected = await store.submit(auditor, {
    requestId: 'unredactable', expectedRevision: null,
    entry: { ...draft, title: 'Unredactable fixture', body: opaque, externalSources: [forged] },
  });
  assert.equal(rejected.status, 'rejected');
  const error = rejected.error?.message;
  assert.ok(error?.trim());

  const history = await store.queryDerivedHistory(auditor, worker.sessionId);
  const delta = await store.readDelta(auditor, { afterSeq: 0 });
  const surfaces = {
    'memory files': io.list('memory/items/').map(path => io.read(path)),
    index: io.read(indexPath), delta, 'derived history': history,
    error, rejected, unobservedItem, proposed, promoted,
  };
  for (const [name, surface] of Object.entries(surfaces)) {
    assert.ok(surface, name);
    const serialized = JSON.stringify(surface);
    for (const value of [secret, opaque, forged.location]) assert.ok(!serialized.includes(value), name);
  }
  for (const name of ['memory files', 'index', 'delta', 'derived history']) {
    const serialized = JSON.stringify(surfaces[name]);
    assert.ok(serialized.includes(`${safeTitle} ${replacement}`), name);
    assert.ok(!serialized.includes('Unredactable fixture'), name);
  }
});

test('U14 preserves CAS and replay receipts while disconnected writes stay in the outbox', async () => {
  const { createHomeMemory, createCellMemory } = await import('./cas-cache.mjs');
  const secondAuditor = binding('audit-session-2', 'Auditor');
  const home = createHomeMemory({ now, io: memoryIO() });
  const initial = await home.submit(auditor, {
    requestId: 'initial', expectedRevision: null, entry: draft,
  });
  assert.equal(initial.status, 'accepted');
  const { id, revision: r } = initial;
  let online = true;
  let cellTime = checkedAt;
  const cell = createCellMemory({ now: () => cellTime, io: memoryIO(), home, isOnline: () => online });
  const snapshot = await cell.read(auditor, id);
  assert.ok(Number.isInteger(snapshot.seq));
  assert.equal(snapshot.entry.revision, r);
  const first = { requestId: 'first', id, expectedRevision: r, entry: { ...draft, body: 'First correction.' } };
  const second = { requestId: 'second', id, expectedRevision: r, entry: { ...draft, body: 'Other correction.' } };
  const accepted = await home.submit(auditor, first);
  assert.equal(accepted.status, 'accepted');
  assert.equal(accepted.revision, r + 1);
  const authoritative = await home.read(auditor, id);
  assert.equal(authoritative.entry.revision, r + 1);
  assert.equal(authoritative.entry.body, first.entry.body);
  assert.ok(authoritative.seq > snapshot.seq);
  const conflict = await home.submit(secondAuditor, second);
  assert.equal(conflict.status, 'conflict');
  assert.equal(conflict.currentRevision, r + 1);
  assert.deepEqual(await home.read(auditor, id), authoritative);
  assert.deepEqual(await home.submit(auditor, first), accepted);
  assert.deepEqual(await home.read(auditor, id), authoritative);

  online = false;
  cellTime = '2026-03-01T12:00:01.000Z';
  const cached = await cell.read(auditor, id);
  assert.deepEqual(cached.entry, snapshot.entry);
  assert.equal(cached.seq, snapshot.seq);
  assert.equal(cached.cachedAt, checkedAt);
  assert.deepEqual(await cell.readOutbox(), []);
  const offline = {
    requestId: 'offline', id, expectedRevision: r + 1, entry: { ...draft, body: 'Offline proposal.' },
  };
  const pending = await cell.submit(auditor, offline);
  assert.equal(pending.status, 'candidate');
  assert.equal(pending.requestId, offline.requestId);
  const outbox = await cell.readOutbox();
  assert.equal(outbox.length, 1);
  assert.deepEqual(outbox[0].request, offline);
  assert.deepEqual(await cell.read(auditor, id), cached);
  assert.deepEqual(await home.read(auditor, id), authoritative);
});
