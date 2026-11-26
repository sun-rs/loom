import assert from 'node:assert/strict';
import { posix } from 'node:path';
import test from 'node:test';
import { estimateTokens } from '../lib/token-budget.mjs';

const project = 'fixture-project';
const root = '/fixture/repo';
const checkedAt = '2026-03-01T12:00:00.000Z';
const now = () => Date.parse(checkedAt);
const indexPath = 'memory/INDEX.md';
const itemPath = id => `memory/items/${id}.md`;
const binding = (sessionId, role) => ({
  sessionId, principal: role, role, project, cardId: 'fixture-card', dependencies: [], attachments: [],
  authorizedIds: { memory: [], history: [] },
});
const auditor = binding('audit-session', 'auditor');
const worker = binding('worker-session', 'worker');
const draft = {
  kind: 'ruling', layer: 'shared', project, title: 'Verify release evidence',
  body: 'Verify release evidence before approval.', source: { path: 'docs/release.md' },
  checkedAt,
};
const draftEvidence = {
  root,
  realpath: path => path === `${root}/${draft.source.path}` ? path : undefined,
  hasCommit: () => false,
};

function memoryIO() {
  const files = new Map();
  return {
    read: path => files.get(path),
    write: (path, text) => files.set(path, text),
    list: prefix => [...files.keys()].filter(path => path.startsWith(prefix)),
  };
}

const put = (requestId, entry = draft, fields = {}) => ({
  op: 'put', requestId, expectedRevision: null, entry, ...fields,
});

async function fixture(options = {}) {
  const { createMemoryStore } = await import('./store.mjs');
  let state;
  const readState = () => structuredClone(state);
  const store = createMemoryStore({
    now, readState, commitState: next => { state = structuredClone(next); },
    classifySensitive: () => ({ reliable: true, spans: [] }),
    evidence: draftEvidence,
    ...options,
  });
  return { store, readState, corruptIndex: () => { state.files[indexPath] = 'stale index\n'; } };
}

test('Goal 3c store.write refuses every body-writing operation without a sensitivity classifier', async t => {
  const { createMemoryStore } = await import('./store.mjs');
  const { store: seedStore, readState } = await fixture();
  const candidateDraft = {
    ...draft, kind: 'candidate', layer: 'candidate', proposedKind: 'ruling',
    body: 'Confirm the checks before approving the release.',
  };
  const target = await seedStore.write(auditor, put('seed-target'));
  const candidate = await seedStore.write(worker, put('seed-candidate', candidateDraft, { op: 'propose' }));
  assert.equal(target.ok, true);
  assert.equal(candidate.ok, true);
  const review = { cardId: worker.cardId, id: candidate.item.id, expectedRevision: candidate.item.revision };
  const requests = [
    [auditor, put('no-classifier-put', { ...draft, body: 'Record the evidence review before release.' })],
    [worker, put('no-classifier-propose', { ...candidateDraft, body: 'Recheck the release evidence on Mondays.' },
      { op: 'propose' })],
    [auditor, { op: 'promote', requestId: 'no-classifier-promote', ...review }],
    [auditor, {
      op: 'merge', requestId: 'no-classifier-merge', ...review,
      targetId: target.item.id, targetExpectedRevision: target.item.revision, body: candidateDraft.body,
    }],
    [auditor, {
      op: 'import_rulings', requestId: 'no-classifier-import', entries: [{
        id: 'legacy-ruling', original: draft.source.path, title: 'Legacy release ruling',
        body: 'Review the original release evidence before approval.',
      }],
    }],
  ];
  const before = readState();
  const reopenWithoutClassifier = () => {
    const commits = [];
    const readState = () => structuredClone(commits.at(-1) ?? before);
    const store = createMemoryStore({
      now, readState, commitState: next => { commits.push(structuredClone(next)); }, evidence: draftEvidence,
    });
    return { store, commits, readState };
  };
  for (const [actor, request] of requests) {
    await t.test(`${request.op} authorization failure with a classifier`, async () => {
      const reviewer = binding('review-session', 'reviewer');
      const result = await seedStore.write(reviewer, request);
      assert.deepEqual([result.ok, result.code], [false, 'forbidden']);
      assert.deepEqual(readState(), before);
    });
    await t.test(request.op, async () => {
      const { store, commits, readState } = reopenWithoutClassifier();
      const result = await store.write(actor, request);
      assert.deepEqual(readState(), before);
      assert.deepEqual([result.ok, result.code, commits.length], [false, 'classifier-missing', 0]);
    });
  }

  await t.test('forget still deletes content', async () => {
    const { store, commits, readState } = reopenWithoutClassifier();
    const { id, revision } = target.item;
    assert.equal((await store.access.show(auditor, id)).item.body, draft.body);
    const result = await store.write(auditor, {
      op: 'forget', requestId: 'no-classifier-forget', id, expectedRevision: revision,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.item.status, 'forgotten');
    assert.equal(commits.length, 1);
    assert.equal((await store.access.show(auditor, id)).item, null);
    const state = readState();
    assert.ok(!Object.hasOwn(state.files, itemPath(id)));
    assert.ok(!JSON.stringify(state).includes(draft.body));
  });
});

test('Goal 4b/d store history requires a classifier for raw and persisted records', async t => {
  const row = { id: 'history-id', project, sessionId: worker.sessionId, layer: 'shared', body: 'Original history body.' };
  const sources = {
    readRaw: { readRaw: async () => [row] },
    snapshot: { readState: async () => ({ history: [row] }) },
  };
  const { id, sessionId } = row;
  const filters = {
    id: { id }, project: { project }, sessionId: { sessionId }, all: undefined,
    'id and sessionId': { id, sessionId }, 'id and project': { id, project },
    'project and sessionId': { project, sessionId }, 'id, project and sessionId': { id, project, sessionId },
  };
  for (const [source, options] of Object.entries(sources)) {
    const { store } = await fixture({ ...options, classifySensitive: undefined });
    const { store: control } = await fixture(options);
    for (const [filter, args] of Object.entries(filters)) {
      await t.test(`${source} by ${filter}`, async () => {
        assert.deepEqual((await control.access.hist(auditor, args)).rows.map(record => record.id), [row.id]);
        const result = await store.access.hist(auditor, args);
        assert.deepEqual([result.ok, result.code, result.rows, JSON.stringify(result).includes(row.body)],
          [false, 'classifier-missing', [], false]);
      });
    }
  }
});

test('U05 validates Markdown, deduplicates by layer and rebuilds the index', async () => {
  const sha = '22b96ccab9e766cd6a73162d5f9d8951128584a4';
  const fakeSha = 'f'.repeat(40);
  const paths = new Map([
    [`${root}/docs/release.md`, `${root}/docs/release.md`],
    ['/fixture/outside.md', '/fixture/outside.md'],
    [`${root}/linked.md`, '/fixture/outside.md'],
  ]);
  const { store, readState, corruptIndex } = await fixture({
    estimateTokens, maxMetadataBytes: 4096,
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
    const result = await store.write(auditor, put(name, entry));
    assert.equal(result.ok, status !== 'rejected', name);
    if (result.ok) assert.equal(result.receipt.status, status, name);
    const id = result.item?.id;
    if (status === 'accepted') {
      assert.ok(id, name);
      assert.ok(accepted.every(item => item.id !== id), name);
      const markdown = readState().files[itemPath(id)];
      assert.match(markdown, /^---\r?\n/);
      assert.ok(markdown.includes(`# ${entry.title}\n\n${entry.body}`), name);
      accepted.push({ id, title: entry.title });
    }
    if (status === 'duplicate') assert.equal(id, accepted[0].id, name);

    corruptIndex();
    await store.rebuildIndex();
    const { files } = readState();
    assert.deepEqual(Object.keys(files).filter(path => path.startsWith('memory/items/')).sort(),
      accepted.map(({ id }) => itemPath(id)).sort(), name);
    const lines = files[indexPath].trimEnd().split(/\r?\n/);
    assert.equal(lines.length, accepted.length, name);
    for (const { id, title } of accepted) {
      assert.equal(lines.filter(line => line.includes(itemPath(id)) && line.includes(title)).length, 1, name);
    }
  }
});

test('U06 uses observed provenance and redacts writes, promotions and history', async () => {
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
  const { store, readState } = await fixture({
    getObservations: sessionId => sessionId === worker.sessionId ? observed : [],
    readRaw: sessionId => sessionId === worker.sessionId ? [{
      id: 'raw-1', project, layer: 'shared', role: 'worker', cardId: worker.cardId, title, body: title,
    }] : [],
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
  const unobserved = await store.write(auditor, put('unobserved', { ...draft, externalSource: [forged] }));
  assert.equal(unobserved.ok, true);
  const { item: unobservedItem } = await store.access.show(auditor, unobserved.item.id);
  assert.deepEqual(unobservedItem.externalSource ?? [], []);

  const candidate = await store.write(worker, put('candidate', {
    ...draft, layer: 'candidate', kind: 'candidate', proposedKind: 'ruling', title, body: title,
    externalSource: [forged],
  }, { op: 'propose' }));
  assert.equal(candidate.ok, true);
  assert.equal(candidate.receipt.status, 'candidate');
  const { item: proposed } = await store.access.show(auditor, candidate.item.id);
  assert.equal(proposed.title, `${safeTitle} ${replacement}`);
  assert.equal(proposed.body, proposed.title);
  assert.deepEqual(proposed.externalSource, observed);
  for (const markdown of Object.values(readState().files)) assert.ok(!markdown.includes(secret));

  const approved = await store.write(auditor, {
    op: 'promote', requestId: 'promotion', id: proposed.id, cardId: worker.cardId, expectedRevision: proposed.revision,
  });
  assert.equal(approved.ok, true);
  const { item: promoted } = await store.access.show(auditor, approved.item.id);
  assert.equal(promoted.title, proposed.title);
  assert.equal(promoted.body, proposed.body);
  assert.deepEqual(promoted.externalSource, observed);

  const rejected = await store.write(auditor, put('unredactable', {
    ...draft, title: 'Unredactable fixture', body: opaque, externalSource: [forged],
  }));
  assert.equal(rejected.ok, false);
  assert.ok(rejected.error?.trim());

  const history = await store.access.hist(auditor, { sessionId: worker.sessionId });
  const delta = await store.access.delta(auditor, { cursor: 0 });
  const { files } = readState();
  const surfaces = {
    'memory files': Object.entries(files).filter(([path]) => path.startsWith('memory/items/')),
    index: files[indexPath], delta, 'derived history': history,
    rejected, unobservedItem, proposed, promoted,
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
  const { createCellMemory } = await import('./cas-cache.mjs');
  const secondAuditor = binding('audit-session-2', 'auditor');
  const { store: home } = await fixture();
  const initial = await home.write(auditor, put('initial'));
  assert.equal(initial.ok, true);
  const { id, revision: r } = initial.item;
  let online = true;
  let cellTime = checkedAt;
  const cell = createCellMemory({ now: () => Date.parse(cellTime), io: memoryIO(), home, isOnline: () => online });
  const snapshot = await cell.show(auditor, id);
  assert.ok(Number.isInteger(snapshot.seq));
  assert.equal(snapshot.item.revision, r);
  const first = { op: 'put', requestId: 'first', id, expectedRevision: r, entry: { ...draft, body: 'First correction.' } };
  const second = { op: 'put', requestId: 'second', id, expectedRevision: r, entry: { ...draft, body: 'Other correction.' } };
  const accepted = await home.write(auditor, first);
  assert.equal(accepted.ok, true);
  assert.equal(accepted.item.revision, r + 1);
  const authoritative = await home.access.show(auditor, id);
  assert.equal(authoritative.item.revision, r + 1);
  assert.equal(authoritative.item.body, first.entry.body);
  assert.ok(authoritative.seq > snapshot.seq);
  const conflict = await home.write(secondAuditor, second);
  assert.deepEqual([conflict.ok, conflict.code], [false, 'conflict']);
  assert.equal(conflict.currentRevision, r + 1);
  assert.deepEqual(await home.access.show(auditor, id), authoritative);
  assert.deepEqual(await home.write(auditor, first), accepted);
  assert.deepEqual(await home.access.show(auditor, id), authoritative);

  online = false;
  cellTime = '2026-03-01T12:00:01.000Z';
  const cached = await cell.show(auditor, id);
  assert.deepEqual(cached.item, snapshot.item);
  assert.equal(cached.seq, snapshot.seq);
  assert.equal(cached.cachedAt, checkedAt);
  assert.deepEqual(await cell.readOutbox(), []);
  const offline = {
    op: 'put', requestId: 'offline', id, expectedRevision: r + 1, entry: { ...draft, body: 'Offline proposal.' },
  };
  const pending = await cell.write(auditor, offline);
  assert.equal(pending.ok, true);
  assert.equal(pending.receipt.status, 'candidate');
  assert.equal(pending.receipt.requestId, offline.requestId);
  const outbox = await cell.readOutbox();
  assert.equal(outbox.length, 1);
  assert.deepEqual(outbox[0].request, offline);
  assert.deepEqual(await cell.show(auditor, id), cached);
  assert.deepEqual(await home.access.show(auditor, id), authoritative);
});

for (const [name, replacement] of [
  ['invalidated', null],
  ['switched to an unauthorized role', { ...auditor, role: 'worker' }],
]) {
  test(`M7 offline show hides a cached body when the local binding is ${name}`, async () => {
    const { createCellMemory } = await import('./cas-cache.mjs');
    const { store: home } = await fixture();
    const created = await home.write(auditor, put('cache-entry'));
    assert.equal(created.ok, true);
    const { id } = created.item;
    let current = auditor;
    let online = true;
    const cell = createCellMemory({
      now, io: memoryIO(), home, isOnline: () => online,
      getBinding: sessionId => sessionId === auditor.sessionId ? current : null,
    });
    assert.equal((await cell.show(auditor, id)).item.body, draft.body);
    online = false;
    assert.equal((await cell.show(auditor, id)).item.body, draft.body);

    current = replacement;
    assert.deepEqual(await cell.show(auditor, id), { item: null, seq: null });
  });
}

test('M9 merging a candidate records web and MCP observations from the reviewer session', async () => {
  const reviewer = binding('merge-review-session', 'auditor');
  const observations = [
    { kind: 'web', location: 'https://example.test/merge-review', observedAt: checkedAt },
    { kind: 'mcp', location: 'mcp://fixture/merge-review', observedAt: checkedAt },
  ];
  const { store } = await fixture({
    getObservations: sessionId => sessionId === reviewer.sessionId ? observations : [],
  });
  const target = await store.write(auditor, put('merge-target'));
  const candidate = await store.write(worker, put('merge-candidate', {
    ...draft, kind: 'candidate', layer: 'candidate', proposedKind: 'ruling',
    body: 'Confirm the checks before approving the release.',
  }, { op: 'propose' }));
  assert.equal(target.ok, true);
  assert.equal(candidate.ok, true);
  const merged = await store.write(reviewer, {
    op: 'merge', requestId: 'merge', cardId: worker.cardId,
    id: candidate.item.id, expectedRevision: candidate.item.revision,
    targetId: target.item.id, targetExpectedRevision: target.item.revision, body: candidate.item.body,
  });
  assert.equal(merged.ok, true, JSON.stringify(merged));
  assert.equal(merged.item.id, target.item.id);
  const { item: saved } = await store.access.show(reviewer, target.item.id);
  assert.deepEqual([merged.item.externalSource, saved.externalSource], [observations, observations]);
});
