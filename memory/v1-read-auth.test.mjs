import test from 'node:test';
import assert from 'node:assert/strict';

const day = 86_400_000;
const start = Date.parse('2026-01-01T00:00:00Z');
const notice = '背景笔记，仅供参考，使用前核验';
const stamp = ms => new Date(ms).toISOString();
const tokens = text => text.match(/\S+/gu)?.length ?? 0;
const ids = rows => rows.map(row => row.id);
const session = (role, extra = {}) => ({ role, project: 'A', principal: role, ...extra });
const auditor = session('Auditor');
const leader = session('Leader');
const item = (id, extra = {}) => ({
  id, project: 'A', revision: 1, kind: 'lesson', visibility: 'shared', status: 'active',
  importance: 1, title: `Topic ${id}`, keywords: ['probe'], body: `BODY(${id})`,
  effectiveAt: stamp(start), updatedAt: stamp(start), ...extra,
});
const change = (seq, entry, operation = 'add') => ({ seq, id: entry.id, operation, entry });
const absent = (result, ...strings) => {
  for (const value of strings) assert.ok(!JSON.stringify(result ?? null).includes(value), value);
};

test('U07 启动索引先授权再排序和截断，search 按标题和关键词匹配，show 返回正文', async () => {
  const { createIndexQuery } = await import('./index-query.mjs');
  const entries = [
    item('00-new', { importance: 0, updatedAt: stamp(start + day) }),
    item('c-unused', { usage: 0 }),
    item('b-used', { usage: 2 }),
    item('a-used', { usage: 2 }),
    item('z-kind', { kind: 'ruling' }),
    item('zz-important', { kind: 'ruling', importance: 2, updatedAt: stamp(start - day) }),
    item('a-private', { importance: 9, visibility: 'private', owner: 'Auditor', title: 'Private probe' }),
    ...Array.from({ length: 28 }, (_, i) => item(`tail-${i}`, {
      importance: 0, title: `Topic ${'word '.repeat(26)}${i}`,
    })),
  ];
  const query = createIndexQuery({ entries, now: () => start + day, countTokens: tokens });
  const prefix = await query.startup(leader);
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
  const publicQuery = createIndexQuery({ entries: entries.filter(entry => entry.id !== 'a-private'),
    now: () => start + day, countTokens: tokens });
  assert.deepEqual(await publicQuery.startup(leader), prefix);
  assert.equal((await query.show(leader, ruling.id)).body, ruling.body);
});

const frozen = '固定前缀\r\n末尾空格 \n';

test('U08 ACK 丢失时复用批次，确认接管后推进游标', async () => {
  const { createDeltaDelivery } = await import('./delta.mjs');
  const changes = Array.from({ length: 31 }, (_, i) => change(i + 1,
    item(`m-${i}`, { revision: i < 2 ? 2 : 1 }), ['update', 'withdraw'][i] ?? 'add'));
  const sent = [];
  const delta = createDeltaDelivery({
    prefix: frozen, initialCursor: 0, readChanges: () => changes, canRead: () => true,
    send: delivery => { sent.push(structuredClone(delivery)); },
  });
  const first = await delta.deliver({ deliveryId: 'd1', body: 'first task' });
  const retry = await delta.deliver({ deliveryId: 'd1', body: 'first task' });
  assert.deepEqual(retry, first);
  assert.deepEqual(sent, [first, first]);
  assert.equal(first.deliveryId, 'd1');
  assert.equal(first.suffix.baseCursor, 0);
  assert.equal(first.suffix.endCursor, 30);
  assert.equal(first.suffix.truncated, true);
  assert.match(first.suffix.text, /省略|截断|omitted|truncated/iu);
  assert.deepEqual(first.suffix.rows.map(({ seq, id, operation }) => ({ seq, id, operation })),
    changes.slice(0, 30).map(({ seq, id, operation }) => ({ seq, id, operation })));
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
  const { createDeltaDelivery } = await import('./delta.mjs');
  const changes = [change(1, item('revoked-secret')), change(2, item('retained'))];
  const sent = [], reconciled = [], scheduled = [];
  let revoked = false, nativeStatus = 'unknown';
  const delta = createDeltaDelivery({
    prefix: frozen, initialCursor: 0, readChanges: () => changes,
    canRead: entry => !revoked || entry.id !== 'revoked-secret',
    send: delivery => { sent.push(structuredClone(delivery)); },
    reconcile: id => { reconciled.push(id); return nativeStatus; },
    reschedule: request => { scheduled.push(structuredClone(request)); return 'replacement'; },
  });
  const request = { deliveryId: 'original', body: 'business payload' };
  assert.deepEqual(ids((await delta.deliver(request)).suffix.rows), ['revoked-secret', 'retained']);
  revoked = true;
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
  const { createIndexQuery } = await import('./index-query.mjs');
  const { createDeltaDelivery } = await import('./delta.mjs');
  let now = start;
  const entries = [item('a-unused'), item('z-used'), item('m-once'),
    item('private', { visibility: 'private', owner: 'Auditor' })];
  const query = createIndexQuery({ entries, now: () => now, staleDays: 3, countTokens: tokens });
  const index = async () => (await query.startup(leader)).rows;
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
    await query.recordTurn(event);
  }
  assert.deepEqual(await usage(), { 'a-unused': 0, 'm-once': 1, 'z-used': 2, private: 0 });
  assert.deepEqual(ids(await index()), ['z-used', 'm-once', 'a-unused']);
  now = start + 4 * day - 1;
  await query.maintain();
  assert.deepEqual(ids(await index()), ['z-used', 'm-once']);
  assert.equal((await query.show(auditor, 'a-unused')).status, 'stale');
  assert.equal((await query.show(auditor, 'z-used')).status, 'active');
  now += 1;
  await query.maintain();
  assert.deepEqual(await index(), []);
  const stale = await query.show(auditor, 'z-used');
  assert.equal(stale.status, 'stale');
  assert.equal(stale.body, 'BODY(z-used)');
  const delta = createDeltaDelivery({
    prefix: frozen, initialCursor: await query.cursor(),
    readChanges: cursor => query.changesSince(cursor), canRead: () => true, send: () => {},
  });
  await query.forget(auditor, 'z-used', { expectedRevision: stale.revision });
  assert.deepEqual(await index(), []);
  absent(await query.show(auditor, 'z-used'), stale.body);
  const { suffix } = await delta.deliver({ deliveryId: 'forget', body: 'business payload' });
  assert.deepEqual(suffix.rows.map(({ id, operation }) => ({ id, operation })),
    [{ id: 'z-used', operation: 'withdraw' }]);
  absent(suffix, stale.body);
  const active = item('still-active', { effectiveAt: stamp(now), updatedAt: stamp(now) });
  const fresh = createIndexQuery({ entries: [active], now: () => now, staleDays: 3, countTokens: tokens });
  assert.deepEqual(ids((await fresh.startup(leader)).rows), [active.id]);
  await fresh.forget(auditor, active.id, { expectedRevision: active.revision });
  assert.deepEqual((await fresh.startup(leader)).rows, []);
});

test('U10 各读取入口使用同一角色授权，猜测未授权 ID 与未知 ID 同响应', async () => {
  const { createAccess } = await import('./access.mjs');
  const entries = [item('shared'), item('attached'),
    item('auditor-note', { visibility: 'private', owner: 'Auditor' }),
    item('candidate', { kind: 'candidate', status: 'pending', visibility: 'worker', owner: 'Worker' })];
  const history = [
    { id: 'own', cardId: 'card', visibility: 'worker', owner: 'Worker' },
    { id: 'lineage', cardId: 'parent', visibility: 'worker', owner: 'Worker' },
    { id: 'dependency', cardId: 'dep', visibility: 'worker', owner: 'Worker' },
    { id: 'same-group', cardId: 'peer', visibility: 'worker', owner: 'Worker' },
    { id: 'other-card', cardId: 'other', visibility: 'worker', owner: 'Worker' },
    { id: 'auditor-hist', visibility: 'private', owner: 'Auditor' },
    { id: 'shared-hist', visibility: 'shared' },
  ].map(row => ({ project: 'A', group: row.id === 'other-card' ? 'other' : 'team',
    body: `HISTORY(${row.id})`, ...row }));
  const access = createAccess({ entries, history, changes: entries.map((entry, i) => change(i + 1, entry)),
    now: () => start });
  const shared = ['shared', 'attached'];
  const active = [...shared, 'auditor-note'];
  const workerHistory = ['own', 'lineage', 'dependency', 'same-group', 'other-card', 'shared-hist'];
  const matrix = [
    [session('Super'), active, [...active, 'candidate'], active, active, ids(history)],
    [auditor, active, [...active, 'candidate'], active, active, ids(history)],
    [leader, shared, [...shared, 'candidate'], shared, shared, workerHistory],
    [session('Worker', { cardId: 'card', group: 'team', ancestors: ['parent'],
      dependencies: ['dep'], attachments: ['attached'] }), [], ['attached'], [], ['attached'],
    ['own', 'lineage', 'dependency']],
    [session('Reviewer', { cardId: 'review', grants: { memory: ['shared'], history: ['dependency'] } }),
      ['shared'], ['shared'], ['shared'], ['shared'], ['dependency']],
  ];
  const expectRows = (actual, expected, context) =>
    assert.deepEqual(ids(actual).sort(), [...expected].sort(), context);
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
      if (shown.includes(entry.id)) assert.equal(result.body, entry.body, label);
      else assert.deepEqual(result, unknown, `${label} show ${entry.id}`);
      if (!searched.includes(entry.id)) {
        assert.deepEqual(await access.search(binding, { query: entry.title }), [], label);
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

test('U11 跨项目共享只读授权受角色、期限、撤销和卡片权限约束', async () => {
  const { createAccess } = await import('./access.mjs');
  const superBinding = session('Super');
  const worker = session('Worker', { cardId: 'card', attachments: ['b-note', 'b-private'],
    dependencies: [{ project: 'B', cardId: 'dep' }] });
  const otherCard = { ...worker, cardId: 'other', attachments: [], dependencies: [] };
  const entries = [item('a-note'), item('b-note', { project: 'B', asOf: stamp(start) }),
    item('b-private', { project: 'B', visibility: 'private', owner: 'Auditor' })];
  const history = [{ id: 'b-hist', project: 'B', cardId: 'dep', visibility: 'shared', asOf: stamp(start) },
    { id: 'b-private-hist', project: 'B', cardId: 'dep', visibility: 'private', owner: 'Auditor' }];
  let now = start;
  const access = createAccess({ entries, history, now: () => now });
  const request = { sourceProject: 'B', recipient: worker.principal, reason: 'Declared dependency',
    expiresAt: stamp(start + day) };
  const check = async (binding, enabled, phase) => {
    const unknown = await access.show(binding, 'unknown-item', { project: 'B' });
    const shown = await access.show(binding, 'b-note', { project: 'B' });
    const attached = await access.attachments(binding, { project: 'B', keywords: ['probe'] });
    const hist = await access.hist(binding, { project: 'B' });
    assert.deepEqual(ids(attached), enabled ? ['b-note'] : [], phase);
    assert.deepEqual(ids(hist), enabled ? ['b-hist'] : [], phase);
    if (enabled) {
      assert.equal(shown.id, 'b-note', phase);
      for (const result of [shown, ...attached, ...hist]) {
        assert.equal(result.sourceProject, 'B', phase);
        assert.equal(result.asOf, stamp(start), phase);
      }
    } else assert.deepEqual(shown, unknown, phase);
    assert.deepEqual(await access.show(binding, 'b-private', { project: 'B' }), unknown, phase);
    absent({ shown, attached, hist }, 'b-private');
    assert.equal(await access.canWrite(binding, entries[1]), false, phase);
    assert.equal(await access.canWrite(binding, entries[2]), false, phase);
  };
  await check(worker, false, '无授权');
  for (const binding of [auditor, leader, worker, session('Reviewer')]) {
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
