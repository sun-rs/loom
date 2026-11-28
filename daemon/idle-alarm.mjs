import { createHash } from 'node:crypto';
import { lstatSync } from 'node:fs';
import { join } from 'node:path';
import { idleAlarmDefaults } from '../cli/policy.mjs';
import { runtimeDirectory } from '../cli/project.mjs';
import { deliveryFailed, replyConclusion } from '../inbox/message.mjs';
import { readText, writeState } from './io.mjs';
import { sameProcess } from './processes.mjs';

const storage = project => join(runtimeDirectory(project), 'idle-alarm.json');
const finite = values => values.filter(Number.isFinite);
const latest = (...values) => Math.max(...finite(values), -Infinity);

export function charterGoals(text) {
  let scope = false;
  let count = 0;
  let open = 0;
  for (const line of text.split(/\r?\n/)) {
    const heading = /^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) scope = /^(?:目标|goals?|objectives?)$/i.test(heading[1]);
    const goal = scope && /^\s*(?:[-*+]|\d+[.)])\s+(?:\[([ xX])\]\s*)?(\S.*)$/.exec(line);
    if (!goal) continue;
    count++;
    if (goal[1]?.toLowerCase() !== 'x') open++;
  }
  return { count, open };
}

export function watchCharter(project) {
  const path = join(project, '.project', 'charter.md');
  let signature;
  let current;
  return () => {
    try {
      const stat = lstatSync(path);
      if (!stat.isFile()) return;
      const next = [stat.ino, stat.size, stat.mtimeMs].join(':');
      if (next !== signature) {
        current = { ...charterGoals(readText(path)), at: Math.floor(stat.mtimeMs) };
        signature = next;
      }
      return current;
    } catch (error) {
      if (!['ENOENT', 'ENOTDIR', 'ELOOP', 'EACCES', 'EPERM'].includes(error.code)) throw error;
    }
  };
}

export const unresolvedDecisions = events => events.filter(event => event.type === 'needs-decision' &&
  !event.logOnly && !event.auditor && event.resolvedAt == null);

function decisionStatus(events, at, reminderMs) {
  const last = new Map();
  for (const event of events) {
    if (event.type === 'decision-reminder') last.set(event.decisionId, latest(last.get(event.decisionId), event.at));
  }
  return unresolvedDecisions(events).map(({ id, text, addr, at: since }) => ({
    id, text, addr, since, waitingMs: Math.max(0, at - since),
    remindAt: latest(since, last.get(id)) + reminderMs,
  })).sort((a, b) => a.since - b.since || a.id.localeCompare(b.id));
}

export function noticeReply(message, decisions, isSuper) {
  const done = message.completion;
  if (!message.received || deliveryFailed(message) || !isSuper(message.target.addr) || !message.projectEvents ||
      done?.outcome?.kind !== 'completed' || done.unconfirmed || !done.body?.trim()) return;
  const { reason, tag } = replyConclusion(done.body);
  if (['noreply', 'acknowledgement'].includes(reason) || ['BLOCKED', 'FAILED', 'FAIL'].includes(tag)) return;
  const ids = message.projectEvents.filter(id => decisions.some(decision => decision.id === id));
  if (ids.length === 1 && message.projectEvents.length === 1) return ids[0];
}

export function idleAlarmStatus({ project, at, activityAt, work, completed, pause, sessions = [], events = [] }, options) {
  const timing = { ...idleAlarmDefaults, ...options };
  const pendingDecisions = decisionStatus(events, at, timing.reminderMs);
  const outstanding = [...work, ...pendingDecisions.map(item => ({ addr: item.addr, at: item.since }))];
  const times = finite(outstanding.map(item => item.at)).filter(time => time <= at);
  const lastProgressAt = Number.isFinite(activityAt) ? Math.min(at, activityAt) : null;
  const stalledSince = outstanding.length ? latest(lastProgressAt, times.length ? Math.min(...times) : at) : null;
  const stalledMs = stalledSince == null ? 0 : Math.max(0, at - stalledSince);
  const quota = new Map(sessions.filter(({ health }) => health?.status === 'quota-wait' && health.retryAt > at)
    .map(({ addr, health }) => [addr, health.retryAt]));
  const retryAt = outstanding.length && quota.size && outstanding.every(item => quota.has(item.addr)) ?
    Math.min(...quota.values()) : null;

  const pending = new Map(pendingDecisions.map(item => [item.id, item]));
  const lastSuperNotice = new Map();
  for (const event of events) {
    const addr = pending.get(event.decisionId ?? event.id)?.addr ?? (event.type === 'target-awaiting-user' ? event.addr : undefined);
    if (!addr) continue;
    const pushed = !event.auditor && event.pushRoute && event.pushRoute !== 'log' ? event.pushedAt : undefined;
    lastSuperNotice.set(addr, latest(lastSuperNotice.get(addr), pushed, event.desktopAt));
  }
  const waiting = sessions.length && sessions.every(session => {
    const notifiedAt = lastSuperNotice.get(session.addr);
    return session.waiting && notifiedAt >= (session.waitingSince ?? -Infinity) && notifiedAt + timing.reminderMs > at;
  });
  const reason = pause ? 'paused' : !outstanding.length ? (completed ? 'completed' : 'no-open-work') :
    retryAt != null ? 'quota-reset' : waiting ? 'waiting-user' : null;
  return { project, at, lastProgressAt, stalledSince, stalledMs, reason, retryAt, pause: pause ?? null, pendingDecisions,
    severity: reason ? null : stalledMs >= timing.urgentMs ? 'urgent' : stalledMs >= timing.warningMs ? 'warning' : null };
}

export function idleNotices(status, history = []) {
  const { project, at, severity, stalledSince, stalledMs, pause, pendingDecisions } = status;
  if (pause) return [];
  const key = createHash('sha256').update(project).digest('hex').slice(0, 24);
  const interval = Math.floor(stalledMs / 60_000) + ' 分钟';
  const base = { project, at, retryRoute: true };
  const warnings = !severity ? [] : [
    { ...base, id: 'idle:' + key + ':' + stalledSince + ':auditor', type: 'project-idle-warning', idleSince: stalledSince,
      auditor: true, batch: 'idle-auditor', text: '项目已有 ' + interval + ' 无进展。请核对在途工作与阻塞事项。' },
    { ...base, id: 'idle:' + key + ':' + stalledSince + ':super', type: 'project-idle-warning', idleSince: stalledSince,
      batch: 'idle-super', text: '项目已有 ' + interval + ' 无进展。请查看项目状态与待决事项。' },
    ...(severity === 'urgent' ? [
      { ...base, id: 'idle:' + key + ':' + stalledSince + ':urgent', type: 'project-idle-urgent', idleSince: stalledSince,
        batch: 'idle-super', desktopAlso: true, text: '紧急：项目已有 ' + interval + ' 无进展，请接管处理。' },
    ] : []),
  ];
  const reminders = pendingDecisions.filter(item => at >= item.remindAt).map(item => ({
    ...base, id: 'idle-decision:' + item.id + ':' + item.remindAt, type: 'decision-reminder', decisionId: item.id,
    batch: 'idle-decision:' + item.id, text: '待 Super 决定 · ' + item.id + ' · 已等待 ' + Math.floor(item.waitingMs / 60_000) + ' 分钟\n' + item.text,
  }));
  const ids = new Set(history.map(event => event.id));
  return [...warnings, ...reminders].filter(event => !ids.has(event.id));
}

const readRecords = project => JSON.parse(readText(storage(project), '[]'));
function currentStatus(record, events, at, timing) {
  return { ...record, at, stalledMs: record.stalledSince == null ? 0 : Math.max(0, at - record.stalledSince),
    pendingDecisions: decisionStatus(events, at, timing.reminderMs) };
}

function statuses(project, records, events, at, options) {
  const known = new Set(records.map(record => record.project));
  const names = new Set(unresolvedDecisions(events).map(event => event.project));
  if (!names.size && !known.size) names.add(project);
  for (const name of names) {
    if (!known.has(name)) records.push({ project: name, lastProgressAt: null, stalledSince: null, reason: null, severity: null, pause: null });
  }
  return records.map(record => currentStatus(record, events.filter(event => event.project === record.project), at,
    { ...idleAlarmDefaults, ...options }));
}

export function readIdleAlarm(project, events, at = Date.now(), options) {
  return statuses(project, readRecords(project), events, at, options);
}

export function projectIdleAlarm(project) {
  const records = new Map(readRecords(project).map(record => [record.project, record]));
  function save(next) {
    if (JSON.stringify([...next.values()]) === JSON.stringify([...records.values()])) return;
    writeState(storage(project), JSON.stringify([...next.values()]) + '\n');
    for (const [name, record] of next) records.set(name, record);
  }
  return {
    step(scopes, events, at, options) {
      const grouped = Map.groupBy(events, event => event.project);
      const next = new Map(records);
      const notices = [];
      for (const input of scopes) {
        const old = records.get(input.project);
        const history = grouped.get(input.project) ?? [];
        const status = idleAlarmStatus({ ...input, at, events: history, pause: old?.pause,
          activityAt: latest(input.activityAt, old?.lastProgressAt) }, options);
        const { at: _, stalledMs, pendingDecisions, ...record } = status;
        next.set(record.project, record);
        notices.push(...idleNotices(status, history));
      }
      save(next);
      return notices;
    },
    pause(name, pause) {
      const prior = records.get(name);
      save(new Map(records).set(name, { project: name, lastProgressAt: null, stalledSince: null, retryAt: null, ...prior, pause,
        severity: null, reason: pause ? 'paused' : prior?.reason === 'paused' ? null : prior?.reason ?? null }));
    },
    scopeNames: () => [...records.keys()],
    status(events, at, options) {
      return statuses(project, [...records.values()], events, at, options);
    },
    routeFilter(events) {
      const pending = new Set(unresolvedDecisions(events).map(event => event.id));
      const latestReminder = new Map(events.filter(event => event.type === 'decision-reminder').map(event => [event.decisionId, event.id]));
      return event => {
        const scope = records.get(event.project);
        if (event.type === 'needs-decision' && event.resolvedAt != null) return false;
        if (event.type === 'decision-reminder') return !scope?.pause && pending.has(event.decisionId) &&
          latestReminder.get(event.decisionId) === event.id;
        if (event.idleSince == null) return true;
        return scope?.severity && scope.stalledSince === event.idleSince &&
          (event.type !== 'project-idle-urgent' || scope.severity === 'urgent');
      };
    },
  };
}

export function sessionProcessActivity(now) {
  const previous = new Map();
  return {
    sample(entries, table) {
      const children = Map.groupBy(table.values(), row => row.ppid);
      const groups = Map.groupBy(table.values(), row => row.pgid);
      const activity = new Map();
      for (const { addr, root } of entries) {
        const live = table.get(root?.pid);
        if (!live || live.uid !== process.getuid() || root.identity && (root.identity.executable ?
          !sameProcess(root.identity, live) : root.identity.started !== live.started)) continue;
        const prior = previous.get(addr);
        const current = new Map();
        const queue = root.detached && live.pgid === live.pid ? [...groups.get(live.pgid)] : [live];
        for (const row of queue) {
          const identity = row.pid + ':' + row.started;
          if (row.uid !== live.uid || current.has(identity)) continue;
          current.set(identity, row.cpuTime);
          if (row.pid !== live.pid && prior && (!prior.has(identity) || row.cpuTime != null && prior.get(identity) != null &&
            row.cpuTime !== prior.get(identity))) activity.set(addr, now());
          queue.push(...children.get(row.pid) ?? []);
        }
        previous.set(addr, current);
      }
      const active = new Set(entries.map(item => item.addr));
      for (const addr of previous.keys()) if (!active.has(addr)) previous.delete(addr);
      return activity;
    },
  };
}
