import assert from 'node:assert/strict';
import { test } from 'node:test';

const roles = ['super', 'auditor', 'leader', 'worker'];
const kinds = ['ruling', 'preference', 'lesson', 'candidate'];
const project = 'project-a';
const scope = { layer: 'shared', project };
const bindings = Object.fromEntries(roles.map(role => [role, {
  author: `actor-${role}`, role, project, cardId: role === 'worker' ? 'card-1' : null,
}]));
const source = { path: 'evidence/retry.txt' };
const correctedSource = { path: 'evidence/retry-correction.txt' };
const correctedBody = 'Retry twice after confirmation.';
const fact = {
  kind: 'lesson', scope, title: 'Retry limits', body: 'Retry once after confirmation.',
  keywords: ['retry-limit'], source, expectedRevision: null,
};
const oldRulings = [
  { id: 'old-a', title: 'Release window A', body: 'Release on Mondays.', original: 'rulings/a.md' },
  { id: 'old-b', title: 'Release window B', body: 'Release on Tuesdays.', original: 'rulings/b.md', supersedes: ['old-a'] },
];

async function fixture() {
  const { createMemoryStore } = await import('./store.mjs');
  const files = new Map([
    [source.path, fact.body],
    [correctedSource.path, correctedBody],
    ...oldRulings.map(({ original, body }) => [original, body]),
  ]);
  let state;
  return createMemoryStore({
    now: () => new Date('2026-01-05T12:00:00.000Z'),
    getBinding: sessionId => bindings[sessionId],
    readState: () => structuredClone(state),
    commitState: next => { state = structuredClone(next); },
    readEvidence: (sourceProject, path) => sourceProject === project ? files.get(path) : undefined,
  });
}

function saved(result) {
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.item;
}

const ids = entries => entries.map(entry => entry.id);

test('U01 fixed role prompts and memory write decisions', async t => {
  const { renderMemoryPrompt, handleMemoryEvent } = await import('./prompts.mjs');
  const store = await fixture();
  const callModel = t.mock.fn();
  const remind = t.mock.fn();
  const write = t.mock.fn(request => store.write('leader', request));
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
    const prompt = await renderMemoryPrompt({ role, template, entries: examples });
    assert.ok(prompt.includes(template), role);
    for (const kind of kinds) assert.match(prompt, new RegExp(`\\b${kind}\\b`), role);
    for (const rule of rules) assert.match(prompt, rule, role);
    const prohibition = prompt.match(/(?:禁止保存|禁止写入|禁存)[^。]+/u)?.[0] ?? '';
    for (const rule of forbidden) assert.match(prohibition, rule, role);

    for (const type of [...triggers, 'normal_turn']) {
      const count = remind.mock.callCount();
      assert.equal(await handleMemoryEvent({ role, type }, io), undefined);
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

  assert.deepEqual(await store.index('leader'), []);
  const item = saved(await handleMemoryEvent({
    role: 'leader', type: 'normal_turn', explicitWrite: { ...fact, requestId: 'normal-write' },
  }, io));
  assert.equal(item.body, fact.body);
  assert.equal(write.mock.callCount(), 1);
  assert.equal(remind.mock.callCount(), roles.length * triggers.length);
  assert.equal(callModel.mock.callCount(), 0);
  assert.deepEqual(ids(await store.index('leader')), [item.id]);
});

test('U02 revises one fact in place and forget survives old request replay', async () => {
  const store = await fixture();
  const create = { ...fact, requestId: 'create' };
  const original = saved(await store.write('leader', create));
  const update = {
    ...fact, requestId: 'update', targetId: original.id, expectedRevision: original.revision,
    body: correctedBody, source: correctedSource,
  };
  const revised = saved(await store.write('leader', update));
  assert.equal(revised.id, original.id);
  assert.equal(revised.revision, original.revision + 1);
  assert.equal((await store.show('leader', revised.id)).body, update.body);
  assert.deepEqual(ids(await store.index('leader')), [original.id]);
  assert.deepEqual(ids(await store.search('leader', 'retry-limit')), [original.id]);

  const forgotten = await store.forget('leader', {
    requestId: 'forget', targetId: revised.id, expectedRevision: revised.revision,
  });
  assert.equal(forgotten.ok, true);
  assert.equal(forgotten.id, original.id);
  assert.equal(forgotten.revision, revised.revision + 1);
  for (const replay of [null, create, update]) {
    if (replay) {
      const response = JSON.stringify(await store.write('leader', replay));
      assert.ok(!response.includes(create.body) && !response.includes(update.body));
    }
    assert.equal(await store.show('leader', original.id), null);
    assert.deepEqual(await store.search('leader', 'retry-limit'), []);
    assert.deepEqual(await store.index('leader'), []);
  }
});

test('U03 enforces the role and scope matrix using session identity', async t => {
  const store = await fixture();
  const scopes = {
    local: scope,
    foreign: { layer: 'shared', project: 'project-b' },
    user: { layer: 'user' },
    cross: { layer: 'cross-project' },
  };
  const allowed = {
    super: { user: ['preference'], cross: ['ruling', 'lesson'] },
    auditor: { local: ['ruling', 'preference'] },
    leader: { local: ['lesson'] },
    worker: {},
  };
  const forged = { author: 'forged-author', project: 'forged-project', id: 'forged-id', revision: 9000 };
  const claimedRole = { ruling: 'auditor', preference: 'auditor', lesson: 'leader', candidate: 'worker' };
  const assignedIds = new Set();
  function checkIdentity(item, role, request) {
    for (const key of ['author', 'role', 'project']) assert.equal(item[key], bindings[role][key]);
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
            ...fact, ...forged, kind, scope: requestedScope, requestId, title: requestId,
            project: area === 'foreign' ? project : forged.project,
            role: claimedRole[kind] === role ? 'super' : claimedRole[kind],
          };
          const result = await store.write(role, request);
          const permitted = allowed[role][area]?.includes(kind) ?? false;
          assert.equal(result.ok, permitted, JSON.stringify(result));
          if (permitted) checkIdentity(result.item, role, request);
          if (role === 'worker') {
            const proposal = { ...request, requestId: `propose-${requestId}`, proposedKind: 'lesson' };
            const proposed = await store.propose(role, proposal);
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

test('U04 reviews candidates at card close and imports legacy rulings', async () => {
  const store = await fixture();
  const decisions = { promote: 'promoted', merge: 'merged', return: 'returned', reject: 'rejected' };
  const candidates = new Map();
  for (const action of Object.keys(decisions)) {
    const candidate = saved(await store.propose('worker', {
      ...fact, kind: 'candidate', proposedKind: 'lesson', requestId: `propose-${action}`,
      title: action, body: `Verified retry guidance for ${action}.`,
    }));
    assert.equal(candidate.status, 'pending');
    candidates.set(action, candidate);
  }
  assert.deepEqual(await store.index('leader'), []);
  assert.deepEqual(await store.index('auditor'), []);

  const existing = saved(await store.write('leader', { ...fact, requestId: 'merge-target' }));
  const review = async event => {
    const result = await store.reviewAtCardClose('leader', event);
    assert.equal(result.ok, true, JSON.stringify(result));
    return result;
  };
  const activeIds = [existing.id];
  for (const [action, status] of Object.entries(decisions)) {
    const candidate = candidates.get(action);
    const event = {
      type: 'card_close', cardId: bindings.worker.cardId, requestId: `close-${action}`,
      candidateId: candidate.id, expectedRevision: candidate.revision, action,
    };
    if (action === 'merge') {
      event.targetId = existing.id;
      event.targetExpectedRevision = existing.revision;
      event.body = `${existing.body} ${candidate.body}`;
    }
    const result = await review(event);
    assert.equal(result.candidate.id, candidate.id);
    assert.equal(result.candidate.status, status);
    if (action === 'promote') {
      const promoted = result.item;
      assert.equal(promoted.kind, 'lesson');
      assert.equal(promoted.body, candidate.body);
      assert.equal(promoted.proposer, bindings.worker.author);
      assert.equal(promoted.reviewer, bindings.leader.author);
      assert.deepEqual(promoted.source, source);
      activeIds.push(promoted.id);
      const replay = await review(event);
      assert.equal(replay.item.id, promoted.id);
      assert.equal(replay.item.revision, promoted.revision);
    } else if (action === 'merge') {
      assert.equal(result.item.id, existing.id);
      assert.equal(result.item.revision, existing.revision + 1);
      assert.equal((await store.show('leader', existing.id)).body, event.body);
    }
    assert.deepEqual(ids(await store.index('leader')).sort(), activeIds.toSorted());
  }

  const imported = await store.importRulings('auditor', { requestId: 'import', entries: oldRulings });
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
  const stored = await store.show('auditor', second.id);
  assert.equal(stored.original, second.original);
  assert.deepEqual(stored.supersedes, [first.id]);
});
