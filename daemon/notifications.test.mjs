import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { desktopIntervalMs, notifyExternal, projectNotifications } from './notifications.mjs';

test('the native desktop route never invokes osascript under node --test', async () => {
  await notifyExternal('/fixture/lh-project', [{ type: 'leader-exited' }], () => assert.fail('osascript was invoked'));
});

test('desktop banners coalesce decision events per project across restarts and keep noise in the ledger', async t => {
  const root = mkdtempSync(join(tmpdir(), 'loom-notices-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, '.project', 'loomd'), { recursive: true });
  let at = 100;
  const opened = () => projectNotifications(root, () => at);
  let notices = opened();
  const add = (id, type, project = 'P') => notices.add({ id, type, project, at, batch: id });
  const calls = [];
  const push = () => notices.push(async () => undefined,
    async (project, events) => calls.push([project, ...events.map(event => event.type)]));
  add('1', 'leader-exited');
  add('2', 'needs-decision');
  add('3', 'wave-timeout');
  await push();
  assert.deepEqual(calls, [['P', 'leader-exited', 'needs-decision']]);
  assert.equal(notices.list('P').find(event => event.id === '3').pushRoute, 'log');

  notices = opened();
  at += desktopIntervalMs - 1;
  add('4', 'project-completed');
  add('5', 'audit-escalation', 'Q');
  await push();
  assert.deepEqual(calls.slice(1), [['Q', 'audit-escalation']]);
  assert.equal(notices.list('P').find(event => event.id === '4').pushedAt, undefined);
  at++;
  await push();
  assert.deepEqual(calls.slice(2), [['P', 'project-completed']]);
});

test('a failed desktop completion stays pending until a delivery route succeeds', async t => {
  const root = mkdtempSync(join(tmpdir(), 'loom-notices-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, '.project', 'loomd'), { recursive: true });
  const notices = projectNotifications(root, () => 1000);
  notices.add({ id: 'complete', type: 'project-completed', project: 'P', at: 1000 });
  await notices.push(async () => undefined, async () => false);
  assert.equal(notices.list('P')[0].pushRoute, undefined);
  await notices.push(async () => 'managed-super');
  assert.equal(notices.list('P')[0].pushRoute, 'managed-super');
});

test('worker-release-timeout pushes explicitly to external desktop route when no managed Super exists', async t => {
  const root = mkdtempSync(join(tmpdir(), 'loom-notices-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, '.project', 'loomd'), { recursive: true });
  const notices = projectNotifications(root, () => 1000);
  const calls = [];
  notices.add({ id: 'timeout-1', type: 'worker-release-timeout', project: 'P', at: 1000, batch: 'timeout-1',
    text: 'Worker T1 oar-1 exceeded 2x TTL' });
  await notices.push(async () => undefined, async (project, events) => { calls.push([project, ...events.map(event => event.type)]); });
  assert.deepEqual(calls, [['P', 'worker-release-timeout']]);
  assert.equal(notices.list('P')[0].pushRoute, 'external');
});
