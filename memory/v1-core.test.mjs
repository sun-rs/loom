import assert from 'node:assert/strict';
import { test } from 'node:test';

const roles = ['super', 'auditor', 'leader', 'worker'];
const kinds = ['ruling', 'preference', 'lesson', 'candidate'];
const project = 'project-a';
const bindings = Object.fromEntries([...roles, 'reviewer'].map(role => [role, {
  sessionId: role, principal: `actor-${role}`, role, project, cardId: role === 'worker' ? 'card-1' : null,
  dependencies: [], attachments: [], authorizedIds: { memory: [], history: [] },
}]));
const source = { path: 'evidence/retry.txt' };
const correctedSource = { path: 'evidence/retry-correction.txt' };
const correctedBody = 'Retry twice after confirmation.';
const fact = {
  kind: 'lesson', layer: 'shared', project, title: 'Retry limits', body: 'Retry once after confirmation.',
  keywords: ['retry-limit'], source, checkedAt: '2026-01-05T12:00:00.000Z',
};
const oldRulings = [
  { id: 'old-a', title: 'Release window A', body: 'Release on Mondays.', original: 'rulings/a.md' },
  { id: 'old-b', title: 'Release window B', body: 'Release on Tuesdays.', original: 'rulings/b.md', supersedes: ['old-a'] },
];

const put = (requestId, entry = fact, fields = {}) => ({
  op: 'put', requestId, entry, expectedRevision: null, ...fields,
});

async function fixture({ initialState, ...options } = {}) {
  const { createMemoryStore } = await import('./store.mjs');
  const root = '/fixture/repo';
  const paths = new Set([source.path, correctedSource.path, ...oldRulings.map(row => row.original)]
    .map(path => `${root}/${path}`));
  const commits = [];
  const readState = () => structuredClone(commits.at(-1) ?? initialState);
  const store = createMemoryStore({
    now: () => Date.parse(fact.checkedAt),
    readState,
    commitState: next => { commits.push(structuredClone(next)); },
    classifySensitive: () => ({ reliable: true, spans: [] }),
    evidence: {
      root,
      realpath: path => paths.has(path) ? path : undefined,
      hasCommit: () => false,
    },
    ...options,
  });
  return { store, commits, readState };
}

function saved(result) {
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.ok(result.receipt.requestId);
  return result.item;
}

const ids = entries => entries.map(entry => entry.id);

test('U01 fixed role prompts and memory write decisions', async t => {
  const { renderMemoryPrompt, handleMemoryEvent } = await import('./prompts.mjs');
  const { store } = await fixture();
  const callModel = t.mock.fn();
  const remind = t.mock.fn();
  const write = t.mock.fn((binding, request) => store.write(binding, request));
  const examples = kinds.map(kind => ({ ...fact, kind, id: `example-${kind}`, title: `Example ${kind}` }));
  const rules = [
    /默认不写/u, /未来的 agent.{0,30}做得更好/iu,
    /一文件一事实|一事实一文件/u, /原\s*ID\s*修订/iu, /忘|forget/iu,
    /背景笔记，仅供参考，使用前核验/u,
  ];
  const forbidden = [
    /代码.{0,8}结构/u, /Git.{0,8}历史/iu, /已修复.{0,6}单个\s*bug/iu,
    /单轮对话.{0,4}细节/u, /实时状态/u, /当前\s*SHA/iu, /分支尖端/u, /在途任务/u,
  ];
  const triggers = ['card_close', 'handover', 'pre_compact'];
  const io = { callModel, remind, write };

  for (const role of roles) {
    const template = `Fixed instructions for ${role}`;
    const prompt = await renderMemoryPrompt({ binding: bindings[role], template, entries: examples });
    assert.ok(prompt.includes(template), role);
    for (const kind of kinds) assert.match(prompt, new RegExp(`\\b${kind}\\b`), role);
    for (const rule of rules) assert.match(prompt, rule, role);
    const prohibition = prompt.match(/(?:禁止保存|禁止写入|禁存)[^。]+/u)?.[0] ?? '';
    for (const rule of forbidden) assert.match(prohibition, rule, role);

    for (const type of [...triggers, 'normal_turn']) {
      const count = remind.mock.callCount();
      assert.equal(await handleMemoryEvent({ binding: bindings[role], type }, io), undefined);
      assert.equal(callModel.mock.callCount(), 0, `${role} ${type}`);
      assert.equal(write.mock.callCount(), 0, `${role} ${type}`);
      if (type === 'normal_turn') {
        assert.equal(remind.mock.callCount(), count);
      } else {
        assert.equal(remind.mock.callCount(), count + 1);
        assert.match(remind.mock.calls[count].arguments[0], /默认不写/u);
      }
    }
  }

  assert.deepEqual((await store.access.index(bindings.leader)).rows, []);
  const item = saved(await handleMemoryEvent({
    binding: bindings.leader, type: 'normal_turn', explicitWrite: put('normal-write'),
  }, io));
  assert.equal(item.body, fact.body);
  assert.equal(write.mock.callCount(), 1);
  assert.equal(remind.mock.callCount(), roles.length * triggers.length);
  assert.equal(callModel.mock.callCount(), 0);
  assert.deepEqual(ids((await store.access.index(bindings.leader)).rows), [item.id]);
});

test('U02 revises one fact in place and forget survives old request replay', async () => {
  const { store, commits, readState } = await fixture();
  const { leader, worker, reviewer } = bindings;
  const create = put('create');
  const original = saved(await store.write(leader, create));
  const update = put('update', { ...fact, body: correctedBody, source: correctedSource },
    { id: original.id, expectedRevision: original.revision });
  const revised = saved(await store.write(leader, update));
  assert.equal(revised.id, original.id);
  assert.equal(revised.revision, original.revision + 1);
  assert.equal((await store.access.show(leader, revised.id)).item.body, correctedBody);
  assert.deepEqual(ids((await store.access.index(leader)).rows), [original.id]);
  assert.deepEqual(ids((await store.access.search(leader, { query: 'retry-limit' })).rows), [original.id]);

  const forget = { op: 'forget', requestId: 'forget', id: revised.id, expectedRevision: revised.revision };
  const before = commits.length;
  for (const binding of [worker, reviewer]) {
    const denied = await store.write(binding, { ...forget, requestId: `forget-${binding.role}` });
    assert.deepEqual([denied.ok, denied.code], [false, 'forbidden']);
  }
  const conflict = await store.write(leader, { ...forget, requestId: 'stale-forget', expectedRevision: original.revision });
  assert.deepEqual([conflict.ok, conflict.code, conflict.currentRevision], [false, 'conflict', revised.revision]);
  assert.equal(commits.length, before);

  const forgotten = saved(await store.write(leader, forget));
  assert.equal(forgotten.id, original.id);
  assert.equal(forgotten.revision, revised.revision + 1);
  assert.equal(commits.length, before + 1);
  for (const replay of [null, create, update]) {
    const response = replay && await store.write(leader, replay);
    for (const body of [fact.body, correctedBody]) {
      assert.ok(!JSON.stringify(response).includes(body));
      assert.ok(!JSON.stringify(readState()).includes(body), 'persisted state retains forgotten body');
    }
    assert.equal((await store.access.show(leader, original.id)).item, null);
    assert.deepEqual((await store.access.search(leader, { query: 'retry-limit' })).rows, []);
    assert.deepEqual((await store.access.index(leader)).rows, []);
  }
});

test('U03 enforces the role and scope matrix using session identity', async t => {
  const { store } = await fixture();
  const scopes = {
    local: { layer: 'shared', project },
    foreign: { layer: 'shared', project: 'project-b' },
    user: { layer: 'user', project: null },
    cross: { layer: 'cross_project', project: null },
  };
  const allowed = {
    super: { user: ['preference', 'ruling'], cross: ['ruling', 'lesson'] },
    auditor: { local: ['ruling', 'preference'] },
    leader: { local: ['lesson'] },
    worker: {},
  };
  const forged = { author: 'forged-author', id: 'forged-id', revision: 9000 };
  const claimedRole = { ruling: 'auditor', preference: 'auditor', lesson: 'leader', candidate: 'worker' };
  const assignedIds = new Set();
  function checkIdentity(item, role, request) {
    assert.equal(item.author, bindings[role].principal);
    assert.equal(item.role, role);
    assert.equal(item.project, request.project);
    assert.equal(item.layer, request.layer);
    assert.equal(item.kind, request.kind);
    assert.ok(typeof item.id === 'string' && item.id.length > 0);
    assert.notEqual(item.id, request.id);
    assert.ok(!assignedIds.has(item.id), item.id);
    assignedIds.add(item.id);
    assert.ok(Number.isInteger(item.revision) && item.revision > 0);
    assert.notEqual(item.revision, request.revision);
  }

  for (const role of roles) {
    for (const kind of kinds) {
      for (const [area, requestedScope] of Object.entries(scopes)) {
        const requestId = `${role}-${kind}-${area}`;
        await t.test(requestId, async () => {
          const request = {
            ...fact, ...forged, kind, ...requestedScope, title: requestId,
            role: claimedRole[kind] === role ? 'super' : claimedRole[kind],
          };
          const result = await store.write(bindings[role], put(requestId, request, { project: 'forged-project' }));
          const permitted = allowed[role][area]?.includes(kind) ?? false;
          assert.equal(result.ok, permitted, JSON.stringify(result));
          if (permitted) checkIdentity(result.item, role, request);
          if (role === 'worker') {
            const proposal = { ...request, layer: area === 'local' ? 'candidate' : request.layer, proposedKind: 'lesson' };
            const proposed = await store.write(bindings[role], put(`propose-${requestId}`, proposal, { op: 'propose' }));
            const permittedProposal = kind === 'candidate' && area === 'local';
            assert.equal(proposed.ok, permittedProposal, JSON.stringify(proposed));
            if (permittedProposal) {
              checkIdentity(proposed.item, role, proposal);
              assert.equal(proposed.item.status, 'pending');
            }
          }
        });
      }
    }
  }
});

test('U03 forbids a Leader from forgetting a ruling', async () => {
  const { store, commits, readState } = await fixture();
  const { auditor, leader } = bindings;
  const ruling = saved(await store.write(auditor, put('create-ruling', { ...fact, kind: 'ruling' })));
  const before = readState();
  const commitCount = commits.length;

  const denied = await store.write(leader, {
    op: 'forget', requestId: 'forget-ruling', id: ruling.id, expectedRevision: ruling.revision,
  });
  assert.deepEqual([denied.ok, denied.code], [false, 'forbidden']);
  assert.equal(commits.length, commitCount);
  assert.deepEqual(readState(), before);
});

test('U03 rejects another project’s Leader editing or forgetting a local entry by ID', async () => {
  const { store, commits, readState } = await fixture();
  const { leader } = bindings;
  const foreign = { ...leader, sessionId: 'foreign-leader', principal: 'actor-foreign-leader', project: 'project-b' };
  const item = saved(await store.write(leader, put('create-local-lesson')));
  const target = { id: item.id, expectedRevision: item.revision };
  const before = readState();
  const commitCount = commits.length;

  const update = put('foreign-update', { ...fact, body: correctedBody, source: correctedSource }, target);
  for (const request of [
    update,
    put('foreign-scope-update', { ...update.entry, project: foreign.project }, target),
    { op: 'forget', requestId: 'foreign-forget', ...target },
  ]) {
    const denied = await store.write(foreign, request);
    assert.equal(denied.ok, false, `${request.requestId}: ${JSON.stringify(denied)}`);
    assert.equal(commits.length, commitCount);
    assert.deepEqual(readState(), before);
  }
});

test('Goal 3f Auditor and Leader cannot create, revise, forget or supersede user entries', async t => {
  for (const role of ['auditor', 'leader']) {
    for (const kind of ['preference', 'ruling']) {
      await t.test(`${role} ${kind}`, async () => {
        const entry = { ...fact, layer: 'user', project: null, kind };
        const existing = { ...entry, id: `user-${kind}`, revision: 1, status: 'active',
          author: bindings.super.principal, role: 'super', effectiveAt: fact.checkedAt, updatedAt: fact.checkedAt };
        const { store, commits, readState } = await fixture({ initialState: { entries: [existing] } });
        const before = readState();
        const target = { id: existing.id, expectedRevision: existing.revision };
        const requests = [
          put('create-user', { ...entry, title: 'New user guidance' }),
          put('revise-user', { ...entry, body: correctedBody }, target),
          { op: 'forget', requestId: 'forget-user', ...target },
          put('supersede-user', {
            ...fact, kind: role === 'auditor' ? kind : 'lesson', supersedes: [existing.id],
          }, { supersedeExpectedRevisions: { [existing.id]: existing.revision } }),
        ];
        for (const request of requests) {
          const result = await store.write(bindings[role], request);
          assert.deepEqual([result.ok, result.code], [false, 'forbidden'], request.requestId);
          assert.equal(commits.length, 0, request.requestId);
          assert.deepEqual(readState(), before, request.requestId);
        }
      });
    }
  }
});

test('U04 reviews candidates at card close and imports legacy rulings', async () => {
  const { store, commits, readState } = await fixture();
  const { worker, leader, auditor } = bindings;
  const decisions = { promote: 'promoted', merge: 'merged', return: 'returned', reject: 'rejected' };
  const proposal = (label, proposedKind) => ({
    ...fact, layer: 'candidate', kind: 'candidate', proposedKind,
    title: label, body: `Verified retry guidance for ${label}.`,
  });
  const propose = (label, proposedKind) => store.write(worker,
    put(`propose-${label}`, proposal(label, proposedKind), { op: 'propose' }));
  const ruling = saved(await propose('ruling', 'ruling'));
  const candidates = new Map();
  const priorRevisions = new Map();
  for (const action of Object.keys(decisions)) {
    const candidate = saved(await propose(action, 'lesson'));
    assert.equal(candidate.status, 'pending');
    const entry = proposal(action, 'lesson');
    const revised = saved(await store.write(worker, put(`revise-${action}`, {
      ...entry, body: `${entry.body} Applies after confirmation.`,
    }, { op: 'propose', id: candidate.id, expectedRevision: candidate.revision })));
    assert.equal(revised.revision, candidate.revision + 1);
    priorRevisions.set(action, candidate.revision);
    candidates.set(action, revised);
  }
  assert.deepEqual((await store.access.index(leader)).rows, []);
  assert.deepEqual((await store.access.index(auditor)).rows, []);

  const before = commits.length;
  for (const [binding, candidate] of [[worker, candidates.get('promote')], [leader, ruling]]) {
    const denied = await store.write(binding, { op: 'promote', requestId: `denied-${binding.role}`,
      cardId: worker.cardId, id: candidate.id, expectedRevision: candidate.revision });
    assert.deepEqual([denied.ok, denied.code], [false, 'forbidden']);
  }
  assert.equal(commits.length, before);

  const originalTarget = saved(await store.write(leader, put('merge-target')));
  const existing = saved(await store.write(leader, put('revise-merge-target', {
    ...fact, body: correctedBody, source: correctedSource,
  }, { id: originalTarget.id, expectedRevision: originalTarget.revision })));
  assert.equal(existing.id, originalTarget.id);
  assert.equal(existing.revision, originalTarget.revision + 1);
  const review = async event => {
    const result = await store.write(leader, event);
    assert.equal(result.ok, true, JSON.stringify(result));
    return result;
  };
  const activeIds = [existing.id];
  for (const [action, status] of Object.entries(decisions)) {
    const candidate = candidates.get(action);
    const event = {
      op: action, cardId: worker.cardId, requestId: `close-${action}`,
      id: candidate.id, expectedRevision: candidate.revision,
    };
    if (action === 'merge') {
      event.targetId = existing.id;
      event.targetExpectedRevision = existing.revision;
      event.body = `${existing.body} ${candidate.body}`;
      const before = commits.length;
      const conflict = await store.write(leader, {
        ...event, requestId: 'stale-merge-target', targetExpectedRevision: originalTarget.revision,
      });
      assert.deepEqual([conflict.ok, conflict.code, conflict.currentRevision], [false, 'conflict', existing.revision]);
      assert.equal(commits.length, before);
    }
    if (action === 'promote' || action === 'merge') {
      const before = commits.length;
      const conflict = await store.write(leader, {
        ...event, requestId: `stale-${action}`, expectedRevision: priorRevisions.get(action),
      });
      assert.deepEqual([conflict.ok, conflict.code, conflict.currentRevision], [false, 'conflict', candidate.revision]);
      assert.equal(commits.length, before);
    }
    const result = await review(event);
    assert.equal(result.candidate.id, candidate.id);
    assert.equal(result.candidate.status, status);
    if (action === 'promote') {
      const promoted = result.item;
      assert.equal(promoted.kind, 'lesson');
      assert.equal(promoted.body, candidate.body);
      assert.equal(promoted.proposer, worker.principal);
      assert.equal(promoted.reviewer, leader.principal);
      assert.deepEqual(promoted.source, source);
      activeIds.push(promoted.id);
      const replay = await review(event);
      assert.equal(replay.item.id, promoted.id);
      assert.equal(replay.item.revision, promoted.revision);
      const beforeSecondClose = readState();
      const secondClose = await review({ ...event, requestId: 'second-card-close' });
      assert.equal(secondClose.item.id, promoted.id);
      assert.equal(secondClose.item.revision, promoted.revision);
      assert.deepEqual(readState().entries, beforeSecondClose.entries);
      assert.equal(readState().seq, beforeSecondClose.seq);
    } else if (action === 'merge') {
      assert.equal(result.item.id, existing.id);
      assert.equal(result.item.revision, existing.revision + 1);
      assert.equal((await store.access.show(leader, existing.id)).item.body, event.body);
    }
    assert.deepEqual(ids((await store.access.index(bindings.leader)).rows).sort(), activeIds.toSorted());
  }

  const imported = await store.write(auditor, { op: 'import_rulings', requestId: 'import', entries: oldRulings });
  assert.equal(imported.ok, true);
  assert.equal(imported.items.length, 2);
  const first = imported.items.find(item => item.original === oldRulings[0].original);
  const second = imported.items.find(item => item.original === oldRulings[1].original);
  for (const [item, old] of [[first, oldRulings[0]], [second, oldRulings[1]]]) {
    assert.ok(item, old.original);
    assert.equal(item.kind, 'ruling');
    assert.equal(item.body, old.body);
  }
  assert.notEqual(first.id, second.id);
  assert.deepEqual(second.supersedes, [first.id]);
  const { item: stored } = await store.access.show(auditor, second.id);
  assert.equal(stored.original, second.original);
  assert.deepEqual(stored.supersedes, [first.id]);
  assert.deepEqual((await store.access.show(auditor, first.id)).item.supersededBy, [second.id]);
  const indexed = ids((await store.access.index(auditor)).rows);
  assert.ok(indexed.includes(second.id));
  assert.ok(!indexed.includes(first.id));
});

test('Goal 3e replaying a merge is idempotent and changing its target or body conflicts', async t => {
  const { store, commits, readState } = await fixture();
  const { leader, worker } = bindings;
  const target = saved(await store.write(leader, put('merge-target')));
  const other = saved(await store.write(leader, put('other-target', {
    ...fact, title: 'Escalation threshold', body: 'Escalate after the second failure.',
  })));
  const candidate = saved(await store.write(worker, put('candidate', {
    ...fact, kind: 'candidate', layer: 'candidate', proposedKind: 'lesson',
  }, { op: 'propose' })));
  const request = {
    op: 'merge', requestId: 'merge', cardId: worker.cardId, id: candidate.id,
    expectedRevision: candidate.revision, targetId: target.id, targetExpectedRevision: target.revision,
    body: correctedBody,
  };
  const accepted = await store.write(leader, request);
  saved(accepted);
  assert.equal(accepted.candidate.status, 'merged');
  const beforeReplay = readState();
  const replayCommits = commits.length;
  assert.deepEqual(await store.write(leader, request), accepted);
  assert.equal(commits.length, replayCommits);
  assert.deepEqual(readState(), beforeReplay);

  const variants = {
    target: { targetId: other.id, targetExpectedRevision: other.revision },
    body: { body: 'Retry three times after confirmation.' },
  };
  for (const [field, changes] of Object.entries(variants)) {
    for (const requestId of [request.requestId, `merge-changed-${field}`]) {
      await t.test(`${field} with ${requestId === request.requestId ? 'same' : 'new'} request ID`, async () => {
        const before = readState();
        const commitCount = commits.length;
        const result = await store.write(leader, { ...request, ...changes, requestId });
        assert.deepEqual({ ok: result.ok, code: result.code, commits: commits.length - commitCount },
          { ok: false, code: 'conflict', commits: 0 });
        assert.deepEqual(readState(), before);
      });
    }
  }
});

test('U04 integrated write applies authorization, validation, redaction, dedup and CAS across reads', async () => {
  const { createIndexQuery } = await import('./index-query.mjs');
  const { createDeltaDelivery } = await import('./delta.mjs');
  const token = 'SYNTH_WRITE_SECRET';
  const replacement = '[REDACTED]';
  const { store, commits, readState } = await fixture({
    replacement,
    classifySensitive: text => ({
      reliable: true,
      spans: [...text.matchAll(/SYNTH_WRITE_SECRET/g)].map(({ index }) => ({ start: index, end: index + token.length })),
    }),
  });
  const { leader, worker } = bindings;
  const { access } = store;
  const query = createIndexQuery({ access, countTokens: text => text.split(/\s+/u).length });
  const original = saved(await store.write(leader, put('seed')));
  const current = saved(await store.write(leader, put('seed-revision', { ...fact, title: 'Seed revision' },
    { id: original.id, expectedRevision: original.revision })));
  const entry = { ...fact, body: `${correctedBody} ${token}`, source: correctedSource };
  const request = put('integrated', entry, { id: current.id, expectedRevision: current.revision });
  const before = readState();
  const commitCount = commits.length;
  const denied = await store.write(worker, { ...request, requestId: 'worker-denied' });
  assert.deepEqual([denied.ok, denied.code], [false, 'forbidden']);
  for (const [name, fields] of [['format', { title: 'Two\nlines' }], ['evidence', { source: { path: 'missing.md' } }]]) {
    const invalid = await store.write(leader, { ...request, requestId: name, entry: { ...entry, ...fields } });
    assert.equal(invalid.ok, false, name);
  }
  const conflict = await store.write(leader, { ...request, requestId: 'stale', expectedRevision: original.revision });
  assert.deepEqual([conflict.ok, conflict.code, conflict.currentRevision], [false, 'conflict', current.revision]);
  assert.equal(commits.length, commitCount);
  assert.deepEqual(readState(), before);

  const result = await store.write(leader, request);
  const updated = saved(result);
  assert.equal(updated.id, current.id);
  assert.equal(updated.revision, current.revision + 1);
  assert.equal(updated.body, `${correctedBody} ${replacement}`);
  assert.equal(commits.length, commitCount + 1);
  assert.equal(readState().seq, before.seq + 1);
  assert.deepEqual(await store.write(leader, request), result);
  assert.equal(commits.length, commitCount + 1);
  const duplicate = await store.write(leader, put('duplicate', { ...entry, body: updated.body }));
  assert.equal(duplicate.receipt.status, 'duplicate');
  assert.equal(saved(duplicate).id, updated.id);
  assert.equal(readState().seq, before.seq + 1);
  assert.ok(!JSON.stringify(readState()).includes(token));

  const createDelivery = binding => createDeltaDelivery({
    access, binding, prefix: '', initialCursor: before.seq, send: () => {},
  }).deliver({ deliveryId: 'integrated-delivery', body: '' });
  const index = await query.index(leader);
  const shown = await access.show(leader, updated.id);
  const { suffix } = await createDelivery(leader);
  const delta = await access.delta(leader, { cursor: before.seq });
  const versions = rows => rows.map(({ id, revision }) => [id, revision]);
  assert.deepEqual(versions(index.rows), [[updated.id, updated.revision]]);
  assert.deepEqual((await access.index(leader)).rows, index.rows);
  assert.deepEqual(shown.item, updated);
  assert.deepEqual([suffix.baseCursor, suffix.endCursor], [before.seq, shown.seq]);
  assert.deepEqual(suffix.rows, delta.rows);
  assert.deepEqual(versions(delta.rows), versions(index.rows));
  assert.equal(delta.rows[0].operation, 'update');
  assert.ok(!JSON.stringify({ index, shown, suffix }).includes(token));

  const foreign = { ...leader, sessionId: 'other-project', project: 'project-b' };
  assert.deepEqual((await query.index(foreign)).rows, []);
  assert.deepEqual((await createDelivery(foreign)).suffix.rows, []);
  assert.deepEqual(await access.show(foreign, updated.id), await access.show(foreign, 'unknown-id'));
});

function proposeForReview(proposedKind) {
  return put('propose-for-review', {
    ...fact, kind: 'candidate', layer: 'candidate', proposedKind,
    body: 'Candidate guidance unique to the source proposal.',
  }, { op: 'propose' });
}

test('M1 forgetting a merge target purges the source candidate and its old receipts', async () => {
  const { store, readState } = await fixture();
  const { leader, worker } = bindings;
  const create = put('create-target');
  const target = saved(await store.write(leader, create));
  const propose = proposeForReview('lesson');
  const candidate = saved(await store.write(worker, propose));
  const merge = {
    op: 'merge', requestId: 'merge-candidate', id: candidate.id, cardId: worker.cardId,
    expectedRevision: candidate.revision, targetId: target.id, targetExpectedRevision: target.revision,
    body: `${target.body} ${candidate.body}`,
  };
  const merged = await store.write(leader, merge);
  const item = saved(merged);
  assert.equal(merged.candidate.status, 'merged');
  assert.equal((await store.access.show(leader, candidate.id)).item.body, candidate.body);
  saved(await store.write(leader, {
    op: 'forget', requestId: 'forget-target', id: target.id, expectedRevision: item.revision,
  }));

  const snapshot = JSON.stringify(readState());
  const replay = JSON.stringify([
    await store.write(worker, propose), await store.write(leader, merge), await store.write(leader, create),
  ]);
  assert.deepEqual({
    candidateVisible: (await store.access.show(leader, candidate.id)).item !== null,
    targetVisible: (await store.access.show(leader, target.id)).item !== null,
    persistedBodies: [target.body, candidate.body].filter(body => snapshot.includes(body)),
    replayedBodies: [target.body, candidate.body].filter(body => replay.includes(body)),
  }, { candidateVisible: false, targetVisible: false, persistedBodies: [], replayedBodies: [] });
});

for (const [role, kind, otherRole] of [['leader', 'lesson', 'auditor'], ['auditor', 'ruling', 'leader']]) {
  for (const [op, status] of [[null, 'pending'], ['return', 'returned'], ['reject', 'rejected'], ['merge', 'merged']]) {
    test(`M1 ${role} can forget a ${status} ${kind} candidate`, async () => {
      const { store, commits, readState } = await fixture();
      const reviewer = bindings[role];
      const { worker } = bindings;
      let candidate = saved(await store.write(worker, proposeForReview(kind)));
      if (op) {
        const decision = {
          op, requestId: 'review-candidate', id: candidate.id, cardId: worker.cardId,
          expectedRevision: candidate.revision,
        };
        if (op === 'merge') {
          const target = saved(await store.write(reviewer, put('create-target', { ...fact, kind })));
          Object.assign(decision, {
            targetId: target.id, targetExpectedRevision: target.revision, body: target.body,
          });
        }
        const result = await store.write(reviewer, decision);
        saved(result);
        candidate = result.candidate;
      }
      assert.equal(candidate.status, status);
      const before = readState();
      const commitCount = commits.length;
      const forget = { op: 'forget', id: candidate.id, expectedRevision: candidate.revision };
      for (const denied of [worker, bindings[otherRole]]) {
        const result = await store.write(denied, { ...forget, requestId: `deny-${denied.role}` });
        assert.deepEqual([result.ok, result.code], [false, 'forbidden']);
      }
      assert.deepEqual(readState(), before);
      assert.equal(commits.length, commitCount);
      const forgotten = saved(await store.write(reviewer, { ...forget, requestId: 'forget-candidate' }));
      assert.equal(forgotten.status, 'forgotten');
      assert.equal((await store.access.show(reviewer, candidate.id)).item, null);
    });
  }
}

test('M3 a Leader cannot commit a private lesson', async () => {
  const { store, commits } = await fixture();
  const result = await store.write(bindings.leader, put('private-lesson', { ...fact, layer: 'private' }));
  assert.deepEqual([result.ok, result.code, commits.length], [false, 'forbidden', 0]);
});

test('M5 put atomically supersedes an old ruling and removes it from the index', async () => {
  const { store, commits, readState } = await fixture();
  const { auditor } = bindings;
  const ruling = { ...fact, kind: 'ruling' };
  const old = saved(await store.write(auditor, put('old-ruling', ruling)));
  assert.deepEqual(ids((await store.access.index(auditor)).rows), [old.id]);
  const before = commits.length;
  const replacement = saved(await store.write(auditor, put('replacement', {
    ...ruling, body: correctedBody, supersedes: [old.id],
  }, { supersedeExpectedRevisions: { [old.id]: old.revision } })));
  const { entries, files } = readState();
  const oldEntry = entries.find(entry => entry.id === old.id);
  const newEntry = entries.find(entry => entry.id === replacement.id);
  const persistedIndex = files['memory/INDEX.md'];
  assert.deepEqual({
    commits: commits.length - before,
    returnedSupersedes: replacement.supersedes,
    persistedSupersedes: newEntry.supersedes,
    oldStatus: oldEntry.status,
    oldRevision: oldEntry.revision,
    supersededBy: oldEntry.supersededBy,
    indexed: ids((await store.access.index(auditor)).rows),
    persistedIndexIds: [old.id, replacement.id].filter(id => persistedIndex.includes(`memory/items/${id}.md`)),
  }, {
    commits: 1, returnedSupersedes: [old.id], persistedSupersedes: [old.id],
    oldStatus: 'superseded', oldRevision: old.revision + 1,
    supersededBy: [replacement.id], indexed: [replacement.id],
    persistedIndexIds: [replacement.id],
  });
});

for (const invalidTarget of ['missing', 'out of scope']) {
  test(`M5 put rolls back when a supersedes target is ${invalidTarget}`, async () => {
    const { store, commits, readState } = await fixture();
    const { auditor } = bindings;
    const ruling = { ...fact, kind: 'ruling' };
    const old = saved(await store.write(auditor, put('local-ruling', ruling)));
    let invalidId = 'unknown-ruling';
    const targetRevisions = { [old.id]: old.revision };
    if (invalidTarget === 'out of scope') {
      const foreign = { ...auditor, sessionId: 'foreign-auditor', project: 'project-b' };
      const entry = { ...ruling, project: foreign.project };
      const foreignRuling = saved(await store.write(foreign, put('foreign-ruling', entry)));
      invalidId = foreignRuling.id;
      targetRevisions[invalidId] = foreignRuling.revision;
    }
    const before = readState();
    const commitCount = commits.length;
    const result = await store.write(auditor, put('invalid-replacement', {
      ...ruling, body: correctedBody, supersedes: [old.id, invalidId],
    }, { supersedeExpectedRevisions: targetRevisions }));
    assert.deepEqual({ ok: result.ok, commits: commits.length, state: readState() },
      { ok: false, commits: commitCount, state: before });
  });
}

test('Goal 3a put returns identical errors for foreign and unknown supersedes targets', async t => {
  const { store, commits, readState } = await fixture();
  const { auditor } = bindings;
  const foreign = { ...auditor, sessionId: 'foreign-auditor', project: 'project-b' };
  const ruling = { ...fact, kind: 'ruling' };
  const existing = saved(await store.write(foreign, put('foreign-ruling', { ...ruling, project: foreign.project })));
  const before = readState();
  const commitCount = commits.length;
  const revisions = { current: existing.revision, wrong: existing.revision + 99, missing: undefined };
  for (const [name, revision] of Object.entries(revisions)) {
    await t.test(`${name} target revision`, async () => {
      const reject = async id => {
        const fields = revision === undefined ? {} : { supersedeExpectedRevisions: { [id]: revision } };
        const result = await store.write(auditor,
          put(`replace-${name}-${id}`, { ...ruling, supersedes: [id] }, fields));
        assert.equal(result.ok, false);
        assert.equal(commits.length, commitCount);
        assert.deepEqual(readState(), before);
        return result;
      };
      const unknown = await reject('unknown-ruling');
      assert.equal(typeof unknown.code, 'string');
      assert.equal(typeof unknown.error, 'string');
      assert.deepEqual(await reject(existing.id), unknown);
      assert.notEqual(unknown.code, 'conflict');
    });
  }
});

test('Goal 3b a private ruling cannot supersede a shared ruling', async () => {
  const { store, commits, readState } = await fixture();
  const { auditor } = bindings;
  const ruling = { ...fact, kind: 'ruling' };
  const old = saved(await store.write(auditor, put('shared-ruling', ruling)));
  const before = readState();
  const commitCount = commits.length;
  const result = await store.write(auditor, put('private-replacement', {
    ...ruling, layer: 'private', body: correctedBody, supersedes: [old.id],
  }, { supersedeExpectedRevisions: { [old.id]: old.revision } }));
  assert.deepEqual({ ok: result.ok, commits: commits.length - commitCount, indexed: ids((await store.access.index(auditor)).rows) },
    { ok: false, commits: 0, indexed: [old.id] });
  assert.deepEqual(readState(), before);
});

for (const version of ['missing', 'stale']) {
  test(`Goal 3d put rejects a ${version} supersedes target revision`, async () => {
    const { store, commits, readState } = await fixture();
    const { auditor } = bindings;
    const ruling = { ...fact, kind: 'ruling' };
    const original = saved(await store.write(auditor, put('original', ruling)));
    const revised = saved(await store.write(auditor, put('revise', { ...ruling, body: correctedBody }, {
      id: original.id, expectedRevision: original.revision,
    })));
    assert.equal(revised.revision, original.revision + 1);
    const before = readState();
    const commitCount = commits.length;
    const targetCAS = version === 'missing' ? {} : { supersedeExpectedRevisions: { [original.id]: original.revision } };
    const result = await store.write(auditor, put('replace', {
      ...ruling, title: 'New release ruling', supersedes: [original.id],
    }, targetCAS));
    assert.deepEqual({ ok: result.ok, code: result.code, commits: commits.length - commitCount },
      { ok: false, code: 'conflict', commits: 0 });
    assert.deepEqual(readState(), before);
  });
}

test('M10 fixed role prompts explain citation syntax and show for reading on demand', async () => {
  const { renderMemoryPrompt } = await import('./prompts.mjs');
  const missing = [];
  for (const role of roles) {
    const prompt = await renderMemoryPrompt({ binding: bindings[role] });
    if (!prompt.includes('[memory:<id>]')) missing.push(`${role}: [memory:<id>]`);
    if (!/\bshow\b\s+`?<id>/u.test(prompt)) missing.push(`${role}: show <id>`);
  }
  assert.deepEqual(missing, []);
});
