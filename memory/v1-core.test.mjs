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
    /未来的 agent.{0,30}做得更好/iu,
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
        const [reminder] = remind.mock.calls[count].arguments;
        assert.match(reminder, /\S/u);
        assert.doesNotMatch(reminder, /默认不写/u);
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

  await t.test('unchanged merge with a new request ID', async () => {
    const retryRequest = { ...request, requestId: 'merge-retry' };
    const retry = await store.write(leader, retryRequest);
    assert.deepEqual([saved(retry), retry.candidate], [accepted.item, accepted.candidate]);
    assert.equal(commits.length, replayCommits + 1);
    const afterRetry = readState();
    const { receipts: beforeReceipts, ...beforeData } = beforeReplay;
    const { receipts: afterReceipts, ...afterData } = afterRetry;
    assert.deepEqual(afterData, beforeData);
    assert.equal(afterReceipts.length, beforeReceipts.length + 1);
    assert.deepEqual(afterReceipts.filter(row => row.requestId !== retryRequest.requestId), beforeReceipts);
    assert.deepEqual(await store.write(leader, retryRequest), retry);
    assert.equal(commits.length, replayCommits + 1);
    assert.deepEqual(readState(), afterRetry);
  });

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

test('Goal 4a write receipts reject changed requests across all write operations', async t => {
  const { store, commits, readState } = await fixture();
  const { auditor, worker } = bindings;
  const entry = label => ({ ...fact, kind: 'ruling', title: label, body: `Verify the guidance for ${label}.` });
  const proposal = label => ({ ...entry(label), kind: 'candidate', layer: 'candidate', proposedKind: 'ruling' });
  const seedItem = label => store.write(auditor, put(`seed-${label}`, entry(label))).then(saved);
  const seedCandidate = label => store.write(worker, put(`seed-${label}`, proposal(label), { op: 'propose' })).then(saved);
  const target = await seedItem('target');
  const other = await seedItem('other target');
  const forgotten = await seedItem('forget target');
  const candidate = await seedCandidate('editable candidate');
  const alternate = await seedCandidate('alternate candidate');
  const cas = ({ id, revision }) => ({ id, expectedRevision: revision });
  const revised = entry('revised item');
  const revisedCandidate = proposal('revised candidate');
  const requests = [
    [auditor, put('replay-put', revised, cas(target)), {
      id: cas(other), body: { entry: { ...revised, body: correctedBody } },
      title: { entry: { ...revised, title: 'Updated item title' } },
    }],
    [worker, put('replay-propose', revisedCandidate, { op: 'propose', ...cas(candidate) }), {
      candidate: cas(alternate), body: { entry: { ...revisedCandidate, body: correctedBody } },
    }],
    [auditor, { op: 'forget', requestId: 'replay-forget', ...cas(forgotten) }, { id: cas(other) }],
    [auditor, { op: 'import_rulings', requestId: 'replay-import', entries: oldRulings }, {
      body: { entries: [{ ...oldRulings[0], body: correctedBody }, oldRulings[1]] },
    }],
  ];
  for (const op of ['promote', 'merge', 'return', 'reject']) {
    const source = await seedCandidate(`candidate for ${op}`);
    const request = { op, requestId: `replay-${op}`, cardId: worker.cardId, ...cas(source) };
    const variants = { candidate: cas(alternate) };
    if (op === 'merge') {
      Object.assign(request, {
        targetId: other.id, targetExpectedRevision: other.revision, body: 'Apply the combined guidance after review.',
      });
      Object.assign(variants, {
        op: { op: 'reject' },
        target: { targetId: target.id, targetExpectedRevision: target.revision + 1 },
        body: { body: correctedBody },
      });
    }
    requests.push([auditor, request, variants]);
  }

  for (const [actor, request, variants] of requests) {
    const accepted = await store.write(actor, request);
    assert.equal(accepted.ok, true, JSON.stringify(accepted));
    assert.equal(accepted.receipt.requestId, request.requestId);
    const before = readState();
    const count = commits.length;
    await t.test(`${request.op} exact replay`, async () => {
      assert.deepEqual(await store.write(actor, structuredClone(request)), accepted);
      assert.equal(commits.length, count);
      assert.deepEqual(readState(), before);
    });
    for (const [field, changes] of Object.entries(variants)) {
      await t.test(`${request.op} changed ${field}`, async () => {
        const result = await store.write(actor, { ...request, ...changes });
        assert.equal(commits.length, count);
        assert.deepEqual(readState(), before);
        const bodies = [accepted.item, accepted.candidate, ...(accepted.items ?? [])]
          .map(item => item?.body).filter(Boolean);
        assert.deepEqual([result.ok, result.code, result.receipt, bodies.some(body => JSON.stringify(result).includes(body))],
          [false, 'conflict', undefined, false]);
      });
    }
  }
});

test('Goal 4a successful retries reserve their new request IDs across restarts', async t => {
  const { leader, worker } = bindings;
  const proposal = { ...fact, kind: 'candidate', layer: 'candidate', proposedKind: 'lesson' };
  const propose = requestId => put(requestId, proposal, { op: 'propose' });
  const cas = ({ id, revision }) => ({ id, expectedRevision: revision });

  const cases = [
    ...['merge', 'promote', 'return', 'reject'].map(op => [op, leader, async store => {
      const candidate = saved(await store.write(worker, propose('seed-candidate')));
      const request = { op, requestId: 'card-close', cardId: worker.cardId, ...cas(candidate) };
      if (op === 'merge') {
        const target = saved(await store.write(leader, put('seed-target')));
        Object.assign(request, { targetId: target.id, targetExpectedRevision: target.revision, body: correctedBody });
      }
      saved(await store.write(leader, request));
      return request;
    }]),
    ['forget', leader, async store => {
      const item = saved(await store.write(leader, put('seed-forget')));
      const forgotten = saved(await store.write(leader, { op: 'forget', requestId: 'forget', ...cas(item) }));
      assert.equal(forgotten.status, 'forgotten');
      return { op: 'forget', requestId: 'forget', ...cas(forgotten) };
    }],
    ['duplicate put', leader, async store => {
      const request = put('seed-duplicate');
      saved(await store.write(leader, request));
      return request;
    }],
    ['duplicate propose', worker, async store => {
      const request = propose('seed-duplicate');
      saved(await store.write(worker, request));
      return request;
    }],
  ];

  for (const [name, actor, prepareRetry] of cases) {
    await t.test(name, async () => {
      const { store, readState } = await fixture();
      const request = await prepareRetry(store);
      const requestId = `${request.requestId}-retry`;
      const retry = await store.write(actor, { ...request, requestId });
      saved(retry);
      assert.equal(retry.receipt.requestId, requestId);
      if (name.startsWith('duplicate ')) assert.equal(retry.receipt.status, 'duplicate');

      const snapshot = JSON.parse(JSON.stringify(readState()));
      const reopened = await fixture({ initialState: snapshot });
      const changed = put(requestId, { ...fact, title: 'Different retry guidance', body: 'Escalate after review.' });
      const result = await reopened.store.write(actor, changed);
      assert.deepEqual({ ok: result.ok, code: result.code, commits: reopened.commits.length },
        { ok: false, code: 'conflict', commits: 0 });
      assert.deepEqual(reopened.readState(), snapshot);
    });
  }
});

test('Goal 4a request matching survives reopening from a JSON snapshot', async t => {
  const { store, readState } = await fixture();
  const { auditor } = bindings;
  const ruling = { ...fact, kind: 'ruling' };
  const alternate = saved(await store.write(auditor, put('alternate', { ...ruling, body: correctedBody })));
  const request = put('persistent-receipt', ruling);
  const accepted = await store.write(auditor, request);
  saved(accepted);
  const snapshot = JSON.stringify(readState());
  const reopen = () => fixture({ initialState: JSON.parse(snapshot) });

  await t.test('identical request returns the original receipt after restart', async () => {
    const { store, commits, readState } = await reopen();
    assert.deepEqual(await store.write(auditor, structuredClone(request)), accepted);
    assert.equal(commits.length, 0);
    assert.deepEqual(readState(), JSON.parse(snapshot));
  });
  const variants = {
    body: put(request.requestId, { ...ruling, body: 'Verify the guidance after the third retry.' }),
    target: put(request.requestId, ruling, { id: alternate.id, expectedRevision: alternate.revision }),
    operation: { op: 'import_rulings', requestId: request.requestId, entries: oldRulings },
  };
  for (const [field, variant] of Object.entries(variants)) {
    await t.test(`changed ${field} conflicts after restart`, async () => {
      const control = await reopen();
      const fresh = await control.store.write(auditor, { ...variant, requestId: `fresh-${field}` });
      assert.equal(fresh.ok, true, JSON.stringify(fresh));
      assert.equal(control.commits.length, 1);

      const { store, commits, readState } = await reopen();
      const result = await store.write(auditor, variant);
      assert.equal(commits.length, 0);
      assert.deepEqual(readState(), JSON.parse(snapshot));
      assert.deepEqual([result.ok, result.code, result.receipt], [false, 'conflict', undefined]);
    });
  }
});

test('Goal 4a changing a put replay after forget conflicts without leaking the old body', async t => {
  const { store, commits, readState } = await fixture();
  const { leader } = bindings;
  const seed = saved(await store.write(leader, put('create-before-forget')));
  const request = put('revise-before-forget', { ...fact, body: correctedBody },
    { id: seed.id, expectedRevision: seed.revision });
  const original = saved(await store.write(leader, request));
  const other = saved(await store.write(leader, put('other-before-forget', {
    ...fact, title: 'Alternate entry', body: 'Verify the alternative guidance.',
  })));
  saved(await store.write(leader, {
    op: 'forget', requestId: 'forget-before-replay', id: original.id, expectedRevision: original.revision,
  }));
  const before = readState();
  const count = commits.length;
  const hasOldBody = value => [seed.body, original.body].some(body => JSON.stringify(value).includes(body));
  assert.ok(!hasOldBody(before));
  const variants = {
    op: { op: 'forget' },
    id: { id: other.id, expectedRevision: other.revision },
    body: { entry: { ...fact, body: 'Retry three times after confirmation.' } },
  };
  for (const [field, changes] of Object.entries(variants)) {
    await t.test(`changed ${field}`, async () => {
      const result = await store.write(leader, { ...request, ...changes });
      assert.equal(commits.length, count);
      assert.deepEqual(readState(), before);
      assert.deepEqual([result.ok, result.code, result.receipt, hasOldBody(result)],
        [false, 'conflict', undefined, false]);
    });
  }
  await t.test('changed put target conflicts after restart', async () => {
    const snapshot = JSON.parse(JSON.stringify(before));
    const reopened = await fixture({ initialState: snapshot });
    const result = await reopened.store.write(leader, { ...request, ...variants.id });
    assert.equal(reopened.commits.length, 0);
    assert.deepEqual(reopened.readState(), snapshot);
    assert.deepEqual([result.ok, result.code, result.receipt, hasOldBody(result)],
      [false, 'conflict', undefined, false]);
  });
});

test('Goal 3e merge redacts the body in the receipt and throughout persisted state', async () => {
  const marker = 'SYNTHETIC_MERGE_SECRET';
  const replacement = '[REDACTED]';
  const { store, readState } = await fixture({
    replacement,
    classifySensitive: text => ({
      reliable: true,
      spans: [...text.matchAll(/SYNTHETIC_MERGE_SECRET/g)]
        .map(({ index }) => ({ start: index, end: index + marker.length })),
    }),
  });
  const { leader, worker } = bindings;
  const target = saved(await store.write(leader, put('merge-target')));
  const candidate = saved(await store.write(worker, put('merge-candidate', {
    ...fact, kind: 'candidate', layer: 'candidate', proposedKind: 'lesson',
  }, { op: 'propose' })));
  const merged = await store.write(leader, {
    op: 'merge', requestId: 'redacted-merge', cardId: worker.cardId,
    id: candidate.id, expectedRevision: candidate.revision,
    targetId: target.id, targetExpectedRevision: target.revision, body: `${correctedBody} ${marker}`,
  });
  const redacted = `${correctedBody} ${replacement}`;
  assert.equal(saved(merged).body, redacted);
  const state = readState();
  assert.equal(state.entries.find(entry => entry.id === target.id)?.body, redacted);
  assert.ok(state.files[`memory/items/${target.id}.md`].includes(redacted));
  assert.ok(!JSON.stringify(merged).includes(marker));
  assert.ok(!JSON.stringify(state).includes(marker), 'persisted merge data contains the original sensitive text');
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

test('Goal 4a changed proposal and merge replays conflict after forgetting merged entries', async t => {
  for (const forgottenEntry of ['candidate', 'target']) {
    const { store, commits, readState } = await fixture();
    const { leader, worker } = bindings;
    const target = saved(await store.write(leader, put('merge-target')));
    const other = saved(await store.write(leader, put('other-target', {
      ...fact, title: 'Alternate merge target', body: 'Escalate after the second failure.',
    })));
    const proposal = proposeForReview('lesson');
    const candidate = saved(await store.write(worker, proposal));
    const merge = {
      op: 'merge', requestId: 'merge-candidate', id: candidate.id, cardId: worker.cardId,
      expectedRevision: candidate.revision, targetId: target.id, targetExpectedRevision: target.revision,
      body: `${target.body} ${candidate.body}`,
    };
    const merged = await store.write(leader, merge);
    const mergedTarget = saved(merged);
    assert.equal(merged.candidate.status, 'merged');
    const forgotten = forgottenEntry === 'candidate' ? merged.candidate : mergedTarget;
    assert.equal(saved(await store.write(leader, {
      op: 'forget', requestId: 'forget', id: forgotten.id, expectedRevision: forgotten.revision,
    })).status, 'forgotten');
    const before = readState();
    assert.equal(before.entries.find(entry => entry.id === candidate.id)?.status, 'forgotten');
    const count = commits.length;
    const oldBodies = [target.body, other.body, candidate.body, mergedTarget.body];
    const variants = [
      ['merge with a different target', leader, { ...merge, targetId: other.id, targetExpectedRevision: other.revision }],
      ['merge with a different body', leader, { ...merge, body: correctedBody }],
    ];
    if (forgottenEntry === 'target') {
      variants.push(['propose with a different body', worker, {
        ...proposal, entry: { ...proposal.entry, body: correctedBody },
      }]);
    }
    for (const [name, binding, request] of variants) {
      await t.test(`forgotten ${forgottenEntry}: ${name}`, async () => {
        const result = await store.write(binding, request);
        assert.equal(commits.length, count);
        assert.deepEqual(readState(), before);
        const exposedBodies = oldBodies.filter(body => JSON.stringify(result).includes(body));
        assert.deepEqual([result.ok, result.code, result.receipt, exposedBodies], [false, 'conflict', undefined, []]);
      });
    }
    await t.test(`forgotten ${forgottenEntry}: changed merge request conflicts after restart`, async () => {
      const nextProposal = proposeForReview('lesson');
      const pending = saved(await store.write(worker, {
        ...nextProposal, requestId: 'propose-after-forget',
        entry: { ...nextProposal.entry, body: 'Follow the new verification steps.' },
      }));
      const snapshot = JSON.parse(JSON.stringify(readState()));
      const reopened = await fixture({ initialState: snapshot });
      const result = await reopened.store.write(leader, {
        ...merge, id: pending.id, expectedRevision: pending.revision,
        targetId: other.id, targetExpectedRevision: other.revision, body: 'Apply the updated review guidance.',
      });
      assert.equal(reopened.commits.length, 0);
      assert.deepEqual(reopened.readState(), snapshot);
      const exposedBodies = oldBodies.filter(body => JSON.stringify(result).includes(body));
      assert.deepEqual([result.ok, result.code, result.receipt, exposedBodies], [false, 'conflict', undefined, []]);
    });
  }
});

for (const forgottenEntry of ['candidate', 'target']) {
  for (const targetChoice of ['same', 'other']) {
    for (const requestIdChoice of ['original', 'new']) {
      test(`M1 merge after forgetting the ${forgottenEntry} rejects the ${targetChoice} target with the ${requestIdChoice} request ID`, async () => {
        const { store, readState, commits } = await fixture();
        const { leader, worker } = bindings;
        const foreignLeader = { ...leader, project: 'project-b' };
        const target = saved(await store.write(leader, put('merge-target')));
        const otherTarget = saved(await store.write(leader, put('other-target', {
          ...fact, title: 'Escalation threshold', body: 'Escalate after the second failure.',
        })));
        const candidate = saved(await store.write(worker, proposeForReview('lesson')));
        const merge = {
          op: 'merge', requestId: 'merge-candidate', id: candidate.id, cardId: worker.cardId,
          expectedRevision: candidate.revision, targetId: target.id, targetExpectedRevision: target.revision,
          body: `${target.body} ${candidate.body}`,
        };
        const merged = await store.write(leader, merge);
        const mergedTarget = saved(merged);
        assert.equal(merged.candidate.status, 'merged');
        const toForget = forgottenEntry === 'candidate' ? merged.candidate : mergedTarget;
        const forgotten = saved(await store.write(leader, {
          op: 'forget', requestId: 'forget', id: toForget.id, expectedRevision: toForget.revision,
        }));
        assert.equal(forgotten.status, 'forgotten');
        const before = readState();
        assert.equal(before.entries.find(entry => entry.id === candidate.id)?.status, 'forgotten');
        const commitCount = commits.length;

        const retry = { ...merge };
        if (requestIdChoice === 'new') retry.requestId = 'merge-retry';
        if (targetChoice === 'other') {
          retry.targetId = otherTarget.id;
          retry.targetExpectedRevision = otherTarget.revision;
        }
        const oldBodies = {
          candidate: candidate.body, target: target.body, mergedTarget: mergedTarget.body, otherTarget: otherTarget.body,
        };
        for (const binding of [worker, foreignLeader, leader]) {
          const result = await store.write(binding, retry);
          const serialized = JSON.stringify(result);
          const exposedBodies = Object.keys(oldBodies).filter(name => serialized.includes(oldBodies[name]));
          assert.deepEqual(readState(), before, `${binding.role} changed state`);
          assert.deepEqual({ ok: result.ok, commits: commits.length - commitCount, exposedBodies },
            { ok: false, commits: 0, exposedBodies: [] }, `${binding.role} merge after forget`);
          if (binding !== leader) assert.equal(result.code, 'forbidden');
        }
      });
    }
  }
}

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
  const targets = [];
  for (const layer of ['shared', 'private']) {
    targets.push(saved(await store.write(foreign, put(`foreign-${layer}`, { ...ruling, project: foreign.project, layer }))));
  }
  const before = readState();
  const commitCount = commits.length;
  for (const existing of targets) {
    const revisions = { current: existing.revision, wrong: existing.revision + 99, missing: undefined };
    for (const [name, revision] of Object.entries(revisions)) {
      await t.test(`${existing.layer} with ${name} target revision`, async () => {
        const reject = async id => {
          const fields = revision === undefined ? {} : { supersedeExpectedRevisions: { [id]: revision } };
          const result = await store.write(auditor,
            put(`replace-${existing.layer}-${name}-${id}`, { ...ruling, supersedes: [id] }, fields));
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
  }
});

for (const kind of ['ruling', 'preference']) {
  test(`Goal 3b a private ${kind} cannot supersede a shared ruling`, async () => {
    const { store, commits, readState } = await fixture();
    const { auditor, leader } = bindings;
    const ruling = { ...fact, kind: 'ruling' };
    const old = saved(await store.write(auditor, put('shared-ruling', ruling)));
    const before = readState();
    const commitCount = commits.length;
    const result = await store.write(auditor, put('private-replacement', {
      ...ruling, kind, layer: 'private', body: correctedBody, supersedes: [old.id],
    }, { supersedeExpectedRevisions: { [old.id]: old.revision } }));
    const indexed = ids((await store.access.index(leader)).rows);
    assert.deepEqual({ ok: result.ok, commits: commits.length - commitCount, indexed },
      { ok: false, commits: 0, indexed: [old.id] });
    assert.deepEqual(readState(), before);
  });
}

test('Goal 4c a stale supersedes revision conflicts after replacement without exposing foreign targets', async t => {
  const { store, commits, readState } = await fixture();
  const { auditor } = bindings;
  const foreign = { ...auditor, sessionId: 'foreign-auditor', project: 'project-b' };
  const ruling = { ...fact, kind: 'ruling' };
  const replacement = (id, revision, scope = project) => put(`replace-${id}`, {
    ...ruling, project: scope, body: correctedBody, supersedes: [id],
  }, { supersedeExpectedRevisions: { [id]: revision } });
  const local = saved(await store.write(auditor, put('local-original', ruling)));
  const remote = saved(await store.write(foreign, put('remote-original', { ...ruling, project: foreign.project })));
  saved(await store.write(auditor, replacement(local.id, local.revision)));
  const activeRemote = saved(await store.write(foreign, replacement(remote.id, remote.revision, foreign.project)));
  const editable = saved(await store.write(auditor, put('editable-ruling', {
    ...ruling, title: 'Editable ruling', body: 'Review the alternate schedule.',
  })));
  const before = readState();
  const count = commits.length;
  const retry = async (id, revision) => {
    const request = { ...replacement(id, revision), requestId: `retry-${id}-${revision}` };
    if (revision === undefined) delete request.supersedeExpectedRevisions;
    const result = await store.write(auditor, request);
    assert.equal(commits.length, count);
    assert.deepEqual(readState(), before);
    return result;
  };
  assert.equal(before.entries.find(entry => entry.id === local.id).status, 'superseded');
  assert.equal(before.entries.find(entry => entry.id === remote.id).status, 'superseded');
  assert.equal(activeRemote.status, 'active');
  await t.test('local superseded target with its original revision', async () => {
    const result = await retry(local.id, local.revision);
    assert.deepEqual([result.ok, result.code], [false, 'conflict']);
  });
  await t.test('revision adds a local superseded target with its original revision', async () => {
    const result = await store.write(auditor, put('edit-with-stale-supersedes', {
      ...ruling, title: editable.title, body: 'Review the revised schedule.', supersedes: [local.id],
    }, { id: editable.id, expectedRevision: editable.revision, supersedeExpectedRevisions: { [local.id]: local.revision } }));
    assert.equal(commits.length, count);
    assert.deepEqual(readState(), before);
    assert.deepEqual([result.ok, result.code], [false, 'conflict']);
  });
  await t.test('foreign superseded and active targets match an unknown ID', async () => {
    const unknown = await retry('unknown-ruling', remote.revision);
    assert.deepEqual([unknown.ok, unknown.code], [false, 'forbidden']);
    assert.deepEqual(await retry(remote.id, remote.revision), unknown);
    assert.deepEqual(await retry(activeRemote.id, activeRemote.revision), unknown);
  });
  const current = before.entries.find(entry => entry.id === remote.id).revision;
  for (const [name, revision] of [['current', current], ['missing', undefined]]) {
    await t.test(`foreign superseded target with ${name} revision matches an unknown ID`, async () => {
      const unknown = await retry('unknown-ruling', revision);
      assert.deepEqual([unknown.ok, unknown.code], [false, 'forbidden']);
      assert.deepEqual(await retry(remote.id, revision), unknown);
    });
  }
});

test('Goal 3b a private ruling can supersede another private ruling', async () => {
  const { store, commits, readState } = await fixture();
  const { auditor, leader } = bindings;
  const ruling = { ...fact, kind: 'ruling', layer: 'private' };
  const old = saved(await store.write(auditor, put('private-ruling', ruling)));
  const commitCount = commits.length;
  const replacement = saved(await store.write(auditor, put('private-replacement', {
    ...ruling, body: correctedBody, supersedes: [old.id],
  }, { supersedeExpectedRevisions: { [old.id]: old.revision } })));
  assert.equal(commits.length, commitCount + 1);
  const replaced = readState().entries.find(entry => entry.id === old.id);
  assert.deepEqual([replaced.status, replaced.supersededBy], ['superseded', [replacement.id]]);
  assert.deepEqual(ids((await store.access.index(auditor)).rows), [replacement.id]);
  assert.deepEqual(ids((await store.access.index(leader)).rows), []);
});

for (const version of ['missing', 'stale', 'future']) {
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
    const revision = version === 'future' ? revised.revision + 1 : original.revision;
    const targetCAS = version === 'missing' ? {} : { supersedeExpectedRevisions: { [original.id]: revision } };
    const result = await store.write(auditor, put('replace', {
      ...ruling, title: 'New release ruling', supersedes: [original.id],
    }, targetCAS));
    assert.deepEqual({ ok: result.ok, code: result.code, commits: commits.length - commitCount },
      { ok: false, code: 'conflict', commits: 0 });
    assert.deepEqual(readState(), before);
  });
}

test('Goal 3d put rejects the whole replacement when only the second target revision is stale', async () => {
  const { store, commits, readState } = await fixture();
  const { auditor } = bindings;
  const ruling = { ...fact, kind: 'ruling' };
  const first = saved(await store.write(auditor, put('first-ruling', ruling)));
  const secondDraft = { ...ruling, title: 'Second ruling' };
  const second = saved(await store.write(auditor, put('second-ruling', secondDraft)));
  const revised = saved(await store.write(auditor, put('revise-second', { ...secondDraft, body: correctedBody }, {
    id: second.id, expectedRevision: second.revision,
  })));
  assert.equal(revised.revision, second.revision + 1);
  const before = readState();
  const commitCount = commits.length;
  const result = await store.write(auditor, put('replace-both', {
    ...ruling, title: 'Combined ruling', supersedes: [first.id, second.id],
  }, { supersedeExpectedRevisions: { [first.id]: first.revision, [second.id]: second.revision } }));
  assert.deepEqual([result.ok, result.code, commits.length], [false, 'conflict', commitCount]);
  assert.deepEqual(readState(), before);
});

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

test('T100 syncLedger automatically retires rulings removed from rulings.md', async () => {
  const { ledgerRulings, rulingPath } = await import('./ledger.mjs');
  const root = '/fixture/repo';
  const { store, readState } = await fixture({
    eventProject: project,
    evidence: {
      root,
      realpath: path => path === `${root}/${rulingPath}` ? path : undefined,
      hasCommit: () => false,
    },
  });
  const initialText = 'R1. Keep release manifests signed.\nR2. Temporary rule to be retired.\n';
  const [r1Meta, r2Meta] = ledgerRulings(project, initialText);
  assert.equal((await store.syncLedger(initialText)).ok, true);
  assert.deepEqual(readState().entries.map(entry => [entry.id, entry.status]), [
    [r1Meta.id, 'active'],
    [r2Meta.id, 'active'],
  ]);
  assert.deepEqual(ids((await store.access.index(bindings.super)).rows).sort(), [r1Meta.id, r2Meta.id].sort());

  const updatedText = 'R1. Keep release manifests signed.\n';
  assert.equal((await store.syncLedger(updatedText)).ok, true);
  const after = readState();
  const r1 = after.entries.find(entry => entry.id === r1Meta.id);
  const r2 = after.entries.find(entry => entry.id === r2Meta.id);
  assert.equal(r1?.status, 'active', 'retained ruling must stay active');
  assert.notEqual(r2?.status, 'active', 'deleted ruling must be retired automatically');
  const activeIndex = ids((await store.access.index(bindings.super)).rows);
  assert.ok(activeIndex.includes(r1Meta.id), 'retained ruling stays in active index');
  assert.ok(!activeIndex.includes(r2Meta.id), 'retired ruling is removed from active index');
  assert.ok(!after.files['memory/INDEX.md'].includes(r2Meta.id), 'retired ruling is removed from startup INDEX.md');
});
