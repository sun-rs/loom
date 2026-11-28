import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync } from '../fixtures/test-process.mjs';
import { charterGoals, idleAlarmStatus, idleNotices, noticeReply, sessionProcessActivity } from './idle-alarm.mjs';
import { projectHealth } from './project-health.mjs';
import { createSupervisor } from './supervisor.mjs';
import { authorizeSocketCommand } from './socket-auth.mjs';

const minute = 60_000;
const start = Date.UTC(2026, 10, 27, 13, 2);
const project = '/fixture/project';
const decision = { type: 'needs-decision', project, id: 'decision-1', addr: 'leader', at: start, text: 'Choose a rollout.' };
const work = [{ kind: 'card', addr: 'leader', at: start }];
const status = (minutes, input = {}, timing) => idleAlarmStatus({
  project, at: start + minutes * minute, activityAt: start, work, ...input,
}, timing);

test('mechanical project stall routes at 30 and 120 minutes and a later activity starts a new episode', () => {
  assert.equal(status(29).severity, null);
  const warn = status(30);
  assert.equal(warn.lastProgressAt, start);
  assert.equal(warn.stalledMs, 30 * minute);
  const warnings = idleNotices(warn);
  assert.deepEqual(warnings.map(event => [event.type, Boolean(event.auditor), event.logOnly]), [
    ['project-idle-warning', true, undefined], ['project-idle-warning', false, undefined],
  ]);
  assert.deepEqual(idleNotices(status(119), warnings), []);
  const urgent = idleNotices(status(120), warnings);
  assert.deepEqual(urgent.map(event => [event.type, event.desktopAlso]), [['project-idle-urgent', true]]);
  assert.deepEqual(idleNotices(status(121), [...warnings, ...urgent]), []);
  assert.equal(status(121, { activityAt: start + 120 * minute }).severity, null);
  assert.equal(status(151, { activityAt: start + 120 * minute }).severity, 'warning');
  assert.equal(status(5, {}, { warningMs: 5 * minute }).severity, 'warning');
});

test('parked projects show a reason and quota expiry releases the project alarm', () => {
  assert.equal(status(300, { work: [], completed: true }).reason, 'completed');
  assert.equal(status(300, { work: [] }).reason, 'no-open-work');
  const pause = { at: start, reason: 'Maintenance window' };
  assert.equal(status(300, { pause }).reason, 'paused');
  assert.deepEqual(idleNotices(status(300, { pause, events: [decision] })), []);
  const sessions = [{ addr: 'leader', health: { status: 'quota-wait', retryAt: start + 180 * minute } }];
  assert.equal(status(179, { sessions }).reason, 'quota-reset');
  assert.equal(status(180, { sessions }).severity, 'urgent');
  const mixed = [...work, { kind: 'delivery', addr: 'auditor', at: start }];
  assert.equal(status(60, { sessions, work: mixed }).severity, 'warning');
  assert.equal(status(60, { sessions: [{ addr: 'leader', health: { status: 'quota-wait' } }] }).severity, 'warning');
});

test('taking a decision leaves it pending; reminders repeat independently until the matched decision is resolved', () => {
  const taken = { ...decision, takenAt: start + minute, pushedAt: start, pushRoute: 'super' };
  const second = { ...decision, id: 'decision-2', at: start + 10 * minute };
  const input = { work: [], events: [taken, second] };
  assert.equal(status(29, input).pendingDecisions[0].waitingMs, 29 * minute);
  assert.deepEqual(idleNotices(status(29, input)).filter(x => x.decisionId), []);
  const [firstReminder] = idleNotices(status(30, input)).filter(x => x.decisionId);
  assert.equal(firstReminder.decisionId, taken.id);
  const events = [taken, second, firstReminder];
  assert.deepEqual(idleNotices(status(40, { work: [], events })).filter(x => x.decisionId).map(x => x.decisionId), [second.id]);
  assert.deepEqual(idleNotices(status(60, { work: [], events: [{ ...taken, resolvedAt: start + 50 * minute }, second, firstReminder] }))
    .filter(x => x.decisionId).map(x => x.decisionId), [second.id]);
  assert.equal(idleNotices(status(60, { work: [], events: [taken, firstReminder] })).filter(x => x.decisionId).length, 1);
});

test('only user waits actually reported to Super receive a reminder grace period', () => {
  const sessions = [{ addr: 'leader', waiting: true }, { addr: 'auditor', waiting: true }];
  const notified = { ...decision, pushedAt: start + 10 * minute, pushRoute: 'external' };
  const other = { ...notified, id: 'prompt-2', type: 'target-awaiting-user', addr: 'auditor' };
  assert.equal(status(31, { sessions, events: [notified, other] }).reason, 'waiting-user');
  assert.equal(status(31, { sessions, events: [notified, { ...other, pushRoute: 'log' }] }).severity, 'warning');
  assert.equal(status(40, { sessions, events: [notified, other] }).severity, 'warning');
});

test('an exact Super envelope reply can resolve one decision but NOREPLY and combined envelopes cannot', () => {
  const body = { body: 'Use the first option.', at: start + minute, outcome: { kind: 'completed' } };
  const envelope = { target: { addr: 'super' }, projectEvents: [decision.id], received: { at: start }, completion: body };
  const pending = [{ id: decision.id }, { id: 'decision-2' }];
  const superOnly = addr => addr === 'super';
  assert.equal(noticeReply(envelope, pending, superOnly), decision.id);
  assert.equal(noticeReply({ ...envelope, projectEvents: [decision.id, 'decision-2'] }, pending, superOnly), undefined);
  assert.equal(noticeReply({ ...envelope, completion: { ...body, body: 'NOREPLY' } }, pending, superOnly), undefined);
  assert.equal(noticeReply({ ...envelope, target: { addr: 'auditor' } }, pending, superOnly), undefined);
});

test('chapter goals use checked items and ignore non-goals', () => {
  assert.deepEqual(charterGoals('## 目标\n- [x] A\n- [ ] B\n- C\n## 非目标\n- D'), { count: 3, open: 2 });
  assert.deepEqual(charterGoals('## Goals\n1. [X] Shipped'), { count: 1, open: 0 });
});

test('owned process samples count new descendants and CPU advancement without refreshing static workers', () => {
  const uid = process.getuid();
  const clock = { at: start };
  const root = { pid: 999, uid, started: 'root', ppid: 1, pgid: 999, cpuTime: '0:01' };
  const child = { pid: 1000, uid, started: 'child', ppid: root.pid, pgid: 999, cpuTime: '0:01' };
  const sampler = sessionProcessActivity(() => clock.at);
  const rows = [{ addr: 'leader', root: { pid: root.pid, identity: root } }];
  const table = values => new Map(values.map(row => [row.pid, row]));
  assert.deepEqual([...sampler.sample(rows, table([root]))], []);
  clock.at += minute;
  assert.deepEqual([...sampler.sample(rows, table([root, child]))], [['leader', clock.at]]);
  clock.at += minute;
  assert.deepEqual([...sampler.sample(rows, table([root, child]))], []);
  assert.deepEqual([...sampler.sample(rows, table([root, { ...child, cpuTime: '0:02' }]))], [['leader', clock.at]]);
});

test('the health snapshot gives displays normalized role states and actionable alerts in severity order', () => {
  const scopes = [status(120, { events: [decision] })];
  const health = projectHealth(scopes, {
    roles: [
      { project, addr: 's', role: 'super', state: 'busy' },
      { project, addr: 'leader', role: 'leader', health: { status: 'waiting-poll' } },
      { project, addr: 'a', role: 'auditor', health: { status: 'quota-wait', retryAt: start + 240 * minute } },
      { project, addr: 'w', role: 'worker', state: 'idle', lastResultTag: 'BLOCKED', task: 'T1' },
      { project, addr: 'idle', role: 'worker', state: 'idle' },
      { project, addr: 'out', role: 'leader', endedAt: start },
    ],
    events: [{ project, id: 'guard', type: 'needs-decision', reason: 'ccp-required', text: 'CCP required' }],
  });
  assert.deepEqual(health.roles.map(row => [row.addr, row.state]), [
    ['s', 'working'], ['leader', 'waiting-super'], ['a', 'quota-wait'], ['w', 'blocked'], ['out', 'exited'],
  ]);
  assert.equal(health.roles[2].retryAt, start + 240 * minute);
  assert.equal(health.projects[0].pendingCount, 1);
  assert.equal(health.alerts[0].kind, 'project-idle-urgent');
  assert.ok(health.alerts.find(row => row.kind === 'ccp-guard')?.action);
  assert.ok(health.alerts.find(row => row.kind === 'decision-overdue')?.action);
});

test('loomd persists pause, routes notices and shares its fake-clock snapshot with board and status', async t => {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), 'idle-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(join(directory, '.project', 'loomd'), { recursive: true });
  let clock = start;
  const desktop = [];
  const supervisor = createSupervisor(directory, { now: () => clock, report() {},
    externalNotification: async (_project, batch) => { desktop.push(...batch); } });
  t.after(() => supervisor.shutdown());
  await supervisor.handle('notifications', { decision: decision.text });
  await supervisor.tick();
  const [original] = (await supervisor.handle('notifications', {})).notifications;
  assert.equal(original.type, 'needs-decision');
  await supervisor.handle('notifications', { take: true }, undefined, { external: true });
  assert.throws(() => authorizeSocketCommand('pause', {}, { role: 'leader' }), { code: 'forbidden' });
  assert.throws(() => authorizeSocketCommand('notifications', { resolveDecision: original.id }, { role: 'leader' }), { code: 'forbidden' });
  await supervisor.handle('pause', { reason: 'maintenance' }, undefined, { external: true });
  clock += 31 * minute;
  await supervisor.tick();
  const paused = (await supervisor.handle('board', {})).health.projects[0];
  assert.equal(paused.reason, 'paused');
  assert.equal(paused.pendingDecisions[0].waitingMs, 31 * minute);
  assert.ok(!desktop.some(event => event.decisionId));
  await supervisor.handle('pause', { clear: true }, undefined, { external: true });
  await supervisor.tick();
  const snapshot = (await supervisor.handle('board', {})).health;
  assert.deepEqual((await supervisor.handle('status', {})).health, snapshot);
  assert.equal(snapshot.projects[0].severity, 'warning');
  assert.ok(desktop.some(event => event.decisionId === original.id));
  clock = start + 120 * minute;
  await supervisor.tick();
  assert.ok(desktop.some(event => event.type === 'project-idle-urgent'));
  await supervisor.handle('notifications', { resolveDecision: original.id, reason: 'Selected option A' }, undefined, { external: true });
  clock += 31 * minute;
  await supervisor.tick();
  assert.equal((await supervisor.handle('board', {})).health.projects[0].pendingCount, 0);
  assert.equal(desktop.filter(event => event.decisionId === original.id).length, 2);
});
