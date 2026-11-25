import test from 'node:test';
import assert from 'node:assert/strict';

const day = 86_400_000;
const start = Date.parse('2026-01-01T00:00:00Z');
const notice = '背景笔记，仅供参考，使用前核验';
const stamp = ms => new Date(ms).toISOString();
const tokens = text => text.match(/\S+/gu)?.length ?? 0;
const ids = rows => rows.map(row => row.id);
const session = (role, extra = {}) => ({
  sessionId: role, role, project: 'A', principal: role, cardId: null,
  dependencies: [], attachments: [], authorizedIds: { memory: [], history: [] }, ...extra,
});
const auditor = session('auditor');
const leader = session('leader');
const item = (id, extra = {}) => ({
  id, project: 'A', revision: 1, kind: 'lesson', layer: 'shared', status: 'active',
  importance: 1, title: `Topic ${id}`, keywords: ['probe'], body: `BODY(${id})`,
  effectiveAt: stamp(start), updatedAt: stamp(start), ...extra,
});
const change = (seq, entry, operation = 'add') => ({ seq, id: entry.id, operation, entry });
const absent = (result, ...strings) => {
  for (const value of strings) assert.ok(!JSON.stringify(result ?? null).includes(value), value);
};

test('U07 启动索引先授权再排序和截断，search 按标题和关键词匹配，show 返回正文', async () => {
  const { createAccess } = await import('./access.mjs');
  const { createIndexQuery } = await import('./index-query.mjs');
  const entries = [
    item('00-new', { importance: 0, updatedAt: stamp(start + day) }),
    item('c-unused', { usage: 0 }),
    item('b-used', { usage: 2 }),
    item('a-used', { usage: 2 }),
    item('z-kind', { kind: 'ruling' }),
    item('zz-important', { kind: 'ruling', importance: 2, updatedAt: stamp(start - day) }),
    item('a-private', { importance: 9, layer: 'private', owner: 'auditor', title: 'Private probe' }),
    ...Array.from({ length: 28 }, (_, i) => item(`tail-${i}`, {
      importance: 0, title: `Topic ${'word '.repeat(26)}${i}`,
    })),
  ];
  const access = createAccess({ entries, now: () => start + day });
  const query = createIndexQuery({ access, countTokens: tokens });
  const prefix = await query.index(leader);
  const expected = ['zz-important', 'z-kind', 'a-used', 'b-used', 'c-unused', '00-new'];
  const ruling = entries.find(entry => entry.id === expected[0]);
  const page = await query.search(leader, { query: 'probe', limit: 3 });
  const next = await query.search(leader, { query: 'probe', limit: 3, cursor: page.nextCursor });
  assert.deepEqual([...ids(page.rows), ...ids(next.rows)], expected);
  assert.deepEqual(ids((await query.search(leader, { query: expected[0] })).rows), [expected[0]]);
  assert.deepEqual(ids((await query.search(leader, { query: ruling.body })).rows), []);
  assert.ok(prefix.text.includes(notice));
  assert.match(prefix.text, /省略|截断|omitted|truncated/iu);
  assert.deepEqual(ids(prefix.rows).slice(0, expected.length), expected);
  const included = ids(prefix.rows);
  const all = (await query.search(leader, { query: 'probe', limit: entries.length })).rows;
  assert.equal(all.length, entries.length - 1);
  assert.deepEqual(included, ids(all).slice(0, included.length));
  assert.ok(included.length < all.length);
  assert.ok(tokens(all.map(row => row.line).join('\n')) > 400);
  assert.ok(tokens(prefix.indexText) <= 400);
  assert.ok(prefix.text.includes(prefix.indexText));
  assert.deepEqual(prefix.indexText.split('\n').filter(line => line.trim()), prefix.rows.map(row => row.line));
  assert.deepEqual(prefix.rows.map(row => row.line), all.slice(0, included.length).map(row => row.line));
  absent({ prefix, page, next, all }, 'a-private', 'Private probe', ...entries.map(entry => entry.body));
  const publicAccess = createAccess({ entries: entries.filter(entry => entry.id !== 'a-private'), now: () => start + day });
  const publicQuery = createIndexQuery({ access: publicAccess, countTokens: tokens });
  assert.deepEqual(await publicQuery.index(leader), prefix);
  assert.equal((await access.show(leader, ruling.id)).item.body, ruling.body);
});

const frozen = '固定前缀\r\n末尾空格 \n';

test('U08 ACK 丢失时复用批次，确认接管后推进游标', async () => {
  const { createAccess } = await import('./access.mjs');
  const { createDeltaDelivery } = await import('./delta.mjs');
  const changes = Array.from({ length: 31 }, (_, i) => change(i + 1,
    item(`m-${i}`, { revision: i < 2 ? 2 : 1 }), ['update', 'withdraw'][i] ?? 'add'));
  const sent = [];
  const access = createAccess({ readState: () => ({ changes }), now: () => start });
  const delta = createDeltaDelivery({
    access, binding: leader, prefix: frozen, initialCursor: 0,
    send: delivery => { sent.push(structuredClone(delivery)); },
  });
  const first = await delta.deliver({ deliveryId: 'd1', body: 'first task' });
  const original = structuredClone(first);
  changes[0] = change(1, { ...changes[0].entry, revision: 3, title: 'Changed since first send' }, 'update');
  const retry = await delta.deliver({ deliveryId: 'd1', body: 'first task' });
  assert.deepEqual(retry, original);
  assert.deepEqual(sent, [original, original]);
  assert.equal(first.deliveryId, 'd1');
  assert.equal(first.suffix.baseCursor, 0);
  assert.equal(first.suffix.endCursor, 30);
  assert.equal(first.suffix.truncated, true);
  assert.equal(first.suffix.rows[0].revision, 2);
  assert.match(first.suffix.text, /省略|截断|omitted|truncated/iu);
  assert.deepEqual(first.suffix.rows.map(({ seq, id, operation }) => ({ seq, id, operation })),
    Array.from({ length: 30 }, (_, i) => ({
      seq: i + 1, id: `m-${i}`, operation: ['update', 'withdraw'][i] ?? 'add',
    })));
  assert.equal(await delta.cursor(), 0);
  await delta.confirmNativeTakeover('d1');
  assert.equal(await delta.cursor(), 30);
  const next = await delta.deliver({ deliveryId: 'd2', body: 'next task' });
  assert.equal(next.suffix.baseCursor, 30);
  assert.equal(next.suffix.endCursor, 31);
  assert.deepEqual(ids(next.suffix.rows), ['m-30']);
  assert.equal(next.suffix.truncated, false);
  for (const delivery of [first, retry, next]) {
    assert.deepEqual(Buffer.from(delivery.prefix), Buffer.from(frozen));
    assert.equal(delivery.text, delivery.prefix + delivery.body + delivery.suffix.text);
  }
});

test('U08 重试前撤权，只有确认未接管才重新调度', async () => {
  const { createAccess } = await import('./access.mjs');
  const { createDeltaDelivery } = await import('./delta.mjs');
  const changes = [change(1, item('revoked-secret')), change(2, item('retained'))];
  const sent = [], reconciled = [], scheduled = [];
  let nativeStatus = 'unknown';
  const access = createAccess({ changes, now: () => start });
  const binding = session('reviewer', { authorizedIds: { memory: ids(changes), history: [] } });
  const delta = createDeltaDelivery({
    access, binding: () => binding, prefix: frozen, initialCursor: 0,
    send: delivery => { sent.push(structuredClone(delivery)); },
    reconcile: id => { reconciled.push(id); return nativeStatus; },
    reschedule: request => { scheduled.push(structuredClone(request)); return 'replacement'; },
  });
  const request = { deliveryId: 'original', body: 'business payload' };
  assert.deepEqual(ids((await delta.deliver(request)).suffix.rows), ['revoked-secret', 'retained']);
  binding.authorizedIds.memory = ['retained'];
  const pending = await delta.deliver(request);
  assert.deepEqual(reconciled, ['original']);
  assert.equal(sent.length, 1);
  assert.deepEqual(scheduled, []);
  assert.equal(await delta.cursor(), 0);
  absent(pending, 'revoked-secret', request.body);
  nativeStatus = 'not-taken';
  const replacement = await delta.deliver(request);
  assert.deepEqual(reconciled, ['original', 'original']);
  assert.deepEqual(scheduled, [{ originalDeliveryId: 'original', body: request.body }]);
  assert.deepEqual(sent.slice(1), [replacement]);
  assert.equal(replacement.deliveryId, 'replacement');
  assert.equal(replacement.originalDeliveryId, 'original');
  assert.equal(replacement.body, request.body);
  assert.deepEqual(Buffer.from(replacement.prefix), Buffer.from(frozen));
  assert.deepEqual(ids(replacement.suffix.rows), ['retained']);
  absent(replacement, 'revoked-secret');
});

test('U09 只统计当轮授权的真实根轮引用，按最后有效使用过期，显式遗忘发布撤回', async () => {
  const { createMemoryStore } = await import('./store.mjs');
  const { createIndexQuery } = await import('./index-query.mjs');
  const { createDeltaDelivery } = await import('./delta.mjs');
  let now = start;
  const createStore = entries => {
    let state = { entries, changes: [], seq: 0, files: {} };
    return createMemoryStore({
      now: () => now, staleDays: 3, readState: () => structuredClone(state),
      commitState: next => { state = structuredClone(next); },
      classifySensitive: () => ({ reliable: true, spans: [] }),
    });
  };
  const store = createStore([item('a-unused'), item('z-used'), item('m-once'),
    item('private', { layer: 'private', owner: 'auditor' })]);
  const { access } = store;
  const query = createIndexQuery({ access, countTokens: tokens });
  const index = async () => (await query.index(leader)).rows;
  const usage = async () => Object.fromEntries((await query.search(auditor, { query: 'probe' }))
    .rows.map(row => [row.id, row.usage]));
  assert.deepEqual(ids(await index()), ['a-unused', 'm-once', 'z-used']);
  await query.search(leader, { query: 'probe' });
  assert.deepEqual(await usage(), { 'a-unused': 0, 'm-once': 0, 'z-used': 0, private: 0 });
  now += day;
  const root = { binding: leader, turnId: 't1', isRoot: true,
    text: '[memory:z-used] [memory:z-used] [memory:m-once] [memory:private] a-unused' };
  for (const event of [root, root, { ...root, turnId: 't2', text: '[memory:z-used]' },
    { ...root, turnId: 'child', isRoot: false, text: '[memory:a-unused]' },
    { ...root, turnId: 'replay', replay: true, text: '[memory:a-unused]' }]) {
    await store.recordTurn(event);
  }
  assert.deepEqual(await usage(), { 'a-unused': 0, 'm-once': 1, 'z-used': 2, private: 0 });
  assert.deepEqual(ids(await index()), ['z-used', 'm-once', 'a-unused']);
  now = start + 4 * day - 1;
  await store.maintain();
  assert.deepEqual(ids(await index()), ['z-used', 'm-once']);
  assert.equal((await access.show(auditor, 'a-unused')).item.status, 'stale');
  assert.equal((await access.show(auditor, 'z-used')).item.status, 'active');
  now += 1;
  await store.maintain();
  assert.deepEqual(await index(), []);
  const { item: stale, seq } = await access.show(auditor, 'z-used');
  assert.equal(stale.status, 'stale');
  assert.equal(stale.body, 'BODY(z-used)');
  const delta = createDeltaDelivery({
    access, binding: leader, prefix: frozen, initialCursor: seq, send: () => {},
  });
  const forget = { op: 'forget', requestId: 'forget', id: 'z-used', expectedRevision: stale.revision };
  assert.equal((await store.write(auditor, forget)).ok, true);
  assert.deepEqual(await index(), []);
  absent(await access.show(auditor, 'z-used'), stale.body);
  const { suffix } = await delta.deliver({ deliveryId: 'forget', body: 'business payload' });
  assert.deepEqual(suffix.rows.map(({ id, operation }) => ({ id, operation })),
    [{ id: 'z-used', operation: 'withdraw' }]);
  absent(suffix, stale.body);
  const active = item('still-active', { effectiveAt: stamp(now), updatedAt: stamp(now) });
  const fresh = createStore([{ ...active, kind: 'ruling' }]);
  assert.deepEqual(ids((await fresh.access.index(leader)).rows), [active.id]);
  assert.equal((await fresh.write(auditor, { ...forget, id: active.id, expectedRevision: active.revision })).ok, true);
  assert.deepEqual((await fresh.access.index(leader)).rows, []);
});

test('U10 各读取入口使用同一角色授权，猜测未授权 ID 与未知 ID 同响应', async () => {
  const { createAccess } = await import('./access.mjs');
  const entries = [item('shared'), item('attached'), item('unmatched', { keywords: ['other'] }),
    item('stale', { status: 'stale' }),
    item('auditor-note', { layer: 'private', owner: 'auditor' }),
    item('super-note', { layer: 'private', owner: 'super' }),
    item('candidate', { kind: 'candidate', status: 'pending', layer: 'candidate', owner: 'worker' })];
  const history = [
    { id: 'own', cardId: 'card', layer: 'shared', role: 'worker', owner: 'worker' },
    { id: 'lineage', cardId: 'parent', layer: 'shared', role: 'worker', owner: 'worker' },
    { id: 'dependency', cardId: 'dep', layer: 'shared', role: 'worker', owner: 'worker' },
    { id: 'same-group', cardId: 'peer', layer: 'shared', role: 'worker', owner: 'worker' },
    { id: 'other-card', cardId: 'other', layer: 'shared', role: 'worker', owner: 'worker' },
    { id: 'auditor-hist', layer: 'private', owner: 'auditor' },
    { id: 'super-hist', layer: 'private', owner: 'super' },
    { id: 'shared-hist', layer: 'shared' },
  ].map(row => ({ project: 'A', group: row.id === 'other-card' ? 'other' : 'team',
    body: `HISTORY(${row.id})`, ...row }));
  const access = createAccess({ entries, history, changes: entries.filter(entry => entry.status !== 'stale').map((entry, i) => change(i + 1, entry)),
    now: () => start });
  const shared = ['shared', 'attached', 'unmatched'];
  const matching = ['shared', 'attached'];
  const auditorIndex = [...shared, 'auditor-note'];
  const superIndex = [...auditorIndex, 'super-note'];
  const workerHistory = ['own', 'lineage', 'dependency', 'same-group', 'other-card', 'shared-hist'];
  const matrix = [
    [session('super'), superIndex, [...superIndex, 'candidate', 'stale'], [...matching, 'auditor-note', 'super-note'],
      matching, ids(history)],
    [auditor, auditorIndex, [...auditorIndex, 'candidate', 'stale'], [...matching, 'auditor-note'],
      matching, ids(history).filter(id => id !== 'super-hist')],
    [leader, shared, [...shared, 'candidate', 'stale'], matching, matching, workerHistory],
    [session('worker', { cardId: 'card', group: 'team', ancestors: ['parent'],
      dependencies: [{ project: 'A', cardId: 'dep' }], attachments: ['attached', 'auditor-note', 'unmatched'] }),
    [], ['attached', 'unmatched'], [], ['attached'], ['own', 'lineage', 'dependency']],
    [session('reviewer', { cardId: 'review', authorizedIds: { memory: ['shared'], history: ['dependency'] } }),
      ['shared'], ['shared'], ['shared'], ['shared'], ['dependency']],
  ];
  const expectRows = ({ rows }, expected, context) =>
    assert.deepEqual(ids(rows).sort(), [...expected].sort(), context);
  for (const [binding, indexed, shown, searched, attached, histories] of matrix) {
    const label = binding.role;
    expectRows(await access.index(binding), indexed, `${label} index`);
    expectRows(await access.delta(binding, { cursor: 0 }), indexed, `${label} delta`);
    expectRows(await access.search(binding, { query: 'probe' }), searched, `${label} search`);
    expectRows(await access.attachments(binding, { keywords: ['probe'] }), attached, `${label} attachments`);
    expectRows(await access.hist(binding), histories, `${label} hist`);
    const unknown = await access.show(binding, 'unknown-item');
    for (const entry of entries) {
      const result = await access.show(binding, entry.id);
      if (shown.includes(entry.id)) assert.equal(result.item.body, entry.body, label);
      else assert.deepEqual(result, unknown, `${label} show ${entry.id}`);
      if (!shown.includes(entry.id) || binding.role === 'worker') {
        assert.deepEqual((await access.search(binding, { query: entry.title })).rows, [], label);
      }
    }
    const unknownHist = await access.hist(binding, { id: 'unknown-hist' });
    for (const row of history) {
      const result = await access.hist(binding, { id: row.id });
      if (histories.includes(row.id)) expectRows(result, [row.id], label);
      else assert.deepEqual(result, unknownHist, `${label} hist ${row.id}`);
    }
  }
});

test('Goal 3f user preferences and rulings are visible to Auditor and Leader only among project roles', async t => {
  const { createAccess } = await import('./access.mjs');
  const userEntries = ['preference', 'ruling', 'lesson'].map(kind =>
    item(`user-${kind}`, { project: null, layer: 'user', kind }));
  const entries = [
    ...userEntries,
    item('super-note', { layer: 'private', owner: 'super' }),
    item('cross-project', { project: null, layer: 'cross_project', kind: 'ruling' }),
  ];
  const access = createAccess({ entries, now: () => start });
  const readable = userEntries.filter(entry => entry.kind !== 'lesson');
  const matrix = [
    [auditor, readable],
    [leader, readable],
    [session('worker', { cardId: 'card', attachments: ids(userEntries) }), []],
    [session('reviewer', { authorizedIds: { memory: ids(userEntries), history: [] } }), []],
  ];
  for (const [binding, expected] of matrix) {
    await t.test(binding.role, async () => {
      const index = await access.index(binding);
      const search = await access.search(binding, { query: 'probe' });
      const unknown = await access.show(binding, 'unknown-user-entry');
      const shown = await Promise.all(entries.map(entry => access.show(binding, entry.id)));
      assert.deepEqual({
        index: ids(index.rows).sort(),
        search: ids(search.rows).sort(),
        bodies: shown.flatMap(({ item }) => item ? [item.body] : []),
      }, {
        index: ids(expected).sort(), search: ids(expected).sort(), bodies: expected.map(entry => entry.body),
      });
      for (const [index, entry] of entries.entries()) {
        if (!expected.includes(entry)) assert.deepEqual(shown[index], unknown, entry.id);
      }
    });
  }
});

test('U11 跨项目共享只读授权受角色、期限、撤销和卡片权限约束', async () => {
  const { createAccess } = await import('./access.mjs');
  const superBinding = session('super');
  const worker = session('worker', { cardId: 'card', attachments: ['b-note', 'b-private'],
    dependencies: [{ project: 'B', cardId: 'dep' }] });
  const otherCard = { ...worker, cardId: 'other', attachments: [], dependencies: [] };
  const entries = [item('a-note'), item('b-note', { project: 'B', asOf: stamp(start) }),
    item('b-private', { project: 'B', layer: 'private', owner: 'auditor' })];
  const history = [{ id: 'b-hist', project: 'B', cardId: 'dep', layer: 'shared', asOf: stamp(start) },
    { id: 'b-private-hist', project: 'B', cardId: 'dep', layer: 'private', owner: 'auditor' }];
  let now = start;
  const access = createAccess({ entries, history, now: () => now });
  const request = { sourceProject: 'B', recipient: worker.principal, reason: 'Declared dependency',
    expiresAt: stamp(start + day) };
  const check = async (binding, enabled, phase) => {
    const unknown = await access.show(binding, 'unknown-item', { project: 'B' });
    const show = await access.show(binding, 'b-note', { project: 'B' });
    const shown = show.item;
    const { rows: attached } = await access.attachments(binding, { project: 'B', keywords: ['probe'] });
    const { rows: hist } = await access.hist(binding, { project: 'B' });
    assert.deepEqual(ids(attached), enabled ? ['b-note'] : [], phase);
    assert.deepEqual(ids(hist), enabled ? ['b-hist'] : [], phase);
    if (enabled) {
      assert.equal(shown.id, 'b-note', phase);
      for (const result of [shown, ...attached, ...hist]) {
        assert.equal(result.sourceProject, 'B', phase);
        assert.equal(result.asOf, stamp(start), phase);
      }
    } else assert.deepEqual(show, unknown, phase);
    assert.deepEqual(await access.show(binding, 'b-private', { project: 'B' }), unknown, phase);
    absent({ shown, attached, hist }, 'b-private');
    assert.equal(await access.canWrite(binding, entries[1]), false, phase);
    assert.equal(await access.canWrite(binding, entries[2]), false, phase);
  };
  await check(worker, false, '无授权');
  for (const binding of [auditor, leader, worker, session('reviewer')]) {
    assert.equal((await access.grant(binding, request)).ok, false, binding.role);
  }
  assert.equal((await access.grant(superBinding, { ...request, reason: undefined })).ok, false);
  assert.equal((await access.grant(superBinding, { ...request, expiresAt: undefined })).ok, false);
  await check(worker, false, '授予被拒绝');
  const granted = await access.grant(superBinding, request);
  assert.equal(granted.ok, true);
  assert.equal(granted.grant.reason, request.reason);
  assert.equal(granted.grant.expiresAt, request.expiresAt);
  await check(worker, true, '生效');
  await check({ ...worker, sessionId: 'other-worker', principal: 'other-worker' }, false, '非接收方');
  await check(otherCard, false, '缺少卡片授权');
  const leaderGrant = await access.grant(superBinding, { ...request, recipient: leader.principal });
  assert.equal(leaderGrant.ok, true);
  await check(leader, true, 'Leader 共享授权');
  assert.equal(await access.canWrite(leader, entries[0]), true);
  now = start + day - 1;
  await check(worker, true, '到期前');
  now += 1;
  await check(worker, false, '已到期');
  await check(leader, false, 'Leader 授权已到期');
  const renewed = await access.grant(superBinding, { ...request, expiresAt: stamp(now + day) });
  assert.equal(renewed.ok, true);
  await check(worker, true, '新授权生效');
  assert.equal((await access.revoke(superBinding, renewed.grant.id)).ok, true);
  await check(worker, false, '已撤销');
});

for (const [name, superProject, targetProject] of [
  ['no session or target project is denied', null, undefined],
  ['an explicit target works without a session project', null, 'A'],
  ['an explicit target works from the source project', 'B', 'A'],
]) {
  test(`M2 cross-project grant: ${name}`, async () => {
    const { createAccess } = await import('./access.mjs');
    const entry = item('foreign-note', { project: 'B' });
    const access = createAccess({ entries: [entry], now: () => start });
    const options = {
      sourceProject: 'B', recipient: leader.principal, reason: 'Approved reference',
      expiresAt: stamp(start + day),
    };
    if (targetProject !== undefined) options.targetProject = targetProject;
    const result = await access.grant(session('super', { project: superProject }), options);
    const shown = await access.show(leader, entry.id, { project: 'B' });
    if (targetProject === undefined) {
      assert.deepEqual([result.ok, shown.item], [false, null]);
    } else {
      assert.deepEqual([result.ok, shown.item?.id, shown.item?.body], [true, entry.id, entry.body]);
    }
  });
}

function timedStore(createMemoryStore, now) {
  let state;
  return createMemoryStore({
    now, staleDays: 1, readState: () => structuredClone(state),
    commitState: next => { state = structuredClone(next); },
    classifySensitive: () => ({ reliable: true, spans: [] }),
    evidence: { root: '/fixture', realpath: path => path },
  });
}

const lesson = {
  kind: 'lesson', layer: 'shared', project: 'A', title: 'Check the release notes',
  body: 'Review the notes before release.', source: { path: 'release.md' }, checkedAt: stamp(start),
};

test('M4 an Auditor can revise and restore a stale lesson and cannot edit an active lesson', async () => {
  const { createMemoryStore } = await import('./store.mjs');
  let time = start;
  const store = timedStore(createMemoryStore, () => time);
  const created = await store.write(leader, {
    op: 'put', requestId: 'create', expectedRevision: null, entry: lesson,
  });
  assert.equal(created.ok, true);
  const { id, revision } = created.item;
  const update = { op: 'put', id, entry: { ...lesson, body: 'Review the notes and the rollback plan.' } };
  const denied = await store.write(auditor, { ...update, requestId: 'active', expectedRevision: revision });
  assert.deepEqual([denied.ok, denied.code], [false, 'forbidden']);

  time += 2 * day;
  await store.maintain();
  const { item: stale } = await store.access.show(leader, id);
  assert.equal(stale.status, 'stale');
  const restored = await store.write(auditor, {
    ...update, requestId: 'restore', expectedRevision: stale.revision,
    entry: { ...update.entry, checkedAt: stamp(time) },
  });
  assert.equal(restored.ok, true, JSON.stringify(restored));
  const { item: active } = await store.access.show(leader, id);
  assert.deepEqual([active.id, active.status, active.revision, active.body],
    [id, 'active', stale.revision + 1, update.entry.body]);
  assert.deepEqual(ids((await store.access.index(leader)).rows), [id]);

  const deniedAgain = await store.write(auditor, {
    ...update, requestId: 'active-again', expectedRevision: active.revision,
  });
  assert.deepEqual([deniedAgain.ok, deniedAgain.code], [false, 'forbidden']);
});

test('M6 a cross-project Worker attachment uses the receiving card permissions', async () => {
  const { createAccess } = await import('./access.mjs');
  const entry = item('authored-abroad', { project: 'B', cardId: 'author-card-99' });
  const worker = session('worker', {
    cardId: 'receiving-card', attachments: [entry.id], dependencies: [{ project: 'B', cardId: 'dependency-card' }],
  });
  const access = createAccess({ entries: [entry], now: () => start });
  const granted = await access.grant(session('super'), {
    sourceProject: 'B', recipient: worker.principal, reason: 'Declared dependency', expiresAt: stamp(start + day),
  });
  assert.equal(granted.ok, true);
  for (const binding of [{ ...worker, attachments: [] }, { ...worker, dependencies: [] }]) {
    assert.equal((await access.show(binding, entry.id, { project: 'B' })).item, null);
  }
  const shown = await access.show(worker, entry.id, { project: 'B' });
  const attached = await access.attachments(worker, { project: 'B', keywords: ['probe'] });
  assert.deepEqual([shown.item?.body, ids(attached.rows)], [entry.body, [entry.id]]);
});

test('M8 delta retry reuses the original batch after an entry ages to stale', async () => {
  const { createMemoryStore } = await import('./store.mjs');
  const { createDeltaDelivery } = await import('./delta.mjs');
  let time = start;
  const store = timedStore(createMemoryStore, () => time);
  const create = (requestId, entry) => store.write(leader, {
    op: 'put', requestId, expectedRevision: null, entry,
  });
  const first = await create('older', lesson);
  time += day / 2;
  const second = await create('newer', { ...lesson, title: 'Confirm the release window' });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  const sent = [];
  const delta = createDeltaDelivery({
    access: store.access, binding: leader, prefix: frozen, initialCursor: 0,
    send: delivery => { sent.push(delivery); },
  });
  const task = { deliveryId: 'retry-stale', body: 'Check release readiness.' };
  const original = await delta.deliver(task);
  assert.deepEqual(ids(original.suffix.rows), [first.item.id, second.item.id]);

  time = start + day;
  await store.maintain();
  assert.equal((await store.access.show(leader, first.item.id)).item.status, 'stale');
  assert.equal((await store.access.show(leader, second.item.id)).item.status, 'active');
  const retry = await delta.deliver(task);
  assert.deepEqual([retry, sent, await delta.cursor()], [original, [original, original], 0]);
});
