import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { runtimeDirectory, projectDirectory } from '../cli/project.mjs';
import { readText, writeState } from './io.mjs';
import { request } from './rpc.mjs';

const logPath = project => resolve(runtimeDirectory(project), 'notifications.json');
export const readNotifications = project => JSON.parse(readText(logPath(project), '[]'));
const exec = promisify(execFile);
const desktopTypes = new Set(['needs-decision', 'project-completed', 'audit-escalation', 'leader-exited', 'session-exited',
  'session-liveness', 'consumption-pyramid', 'delivery-stalled', 'target-awaiting-user', 'senior-override-budget', 'senior-tool-output-share']);
export const desktopIntervalMs = 5 * 60_000;
export const desktopEnabled = () => process.platform === 'darwin' &&
  process.env.LOOM_DESKTOP_NOTIFY !== '0' && process.env.NODE_TEST_CONTEXT === undefined;
const appleScript = `on run argv
  display notification (item 2 of argv) with title (item 1 of argv)
end run`;

export async function notifyExternal(project, events, execute = exec) {
  if (!desktopEnabled()) return;
  const types = [...new Set(events.map(event => event.type).filter(type => desktopTypes.has(type)))].join(', ');
  if (!types) return;
  const incidents = events.filter(event => ['target-awaiting-user', 'session-liveness', 'session-exited', 'leader-exited'].includes(event.type));
  const body = incidents.length ? incidents.map(event => `${event.role ?? 'leader'} · ${event.reason ?? event.type} · ${event.summary ?? event.text ?? event.addr}`)
    .join('\n').slice(0, 500) : `${types.slice(0, 180)}. Open loom notifications for details.`;
  await execute('/usr/bin/osascript', ['-e', appleScript, '--', `Loom · ${basename(project)}`,
    body], { timeout: 3000 });
}

export function projectNotifications(project, now = Date.now) {
  const path = logPath(project);
  const events = readNotifications(project);
  const ids = new Set(events.map(event => event.id));
  function save() { writeState(path, JSON.stringify(events) + '\n'); }
  function mark(batch, route) {
    for (const event of batch) { event.pushedAt = now(); event.pushRoute = route; }
    try { save(); } catch (error) {
      for (const event of batch) { delete event.pushedAt; delete event.pushRoute; }
      throw error;
    }
  }
  return {
    add(...incoming) {
      const fresh = incoming.filter(event => !ids.has(event.id));
      if (!fresh.length) return;
      events.push(...fresh);
      try { save(); } catch (error) { events.length -= fresh.length; throw error; }
      for (const event of fresh) ids.add(event.id);
    },
    list(project, take = false, history = false) {
      const pending = events.filter(event => (history || event.takenAt == null) && (!project || project === event.project));
      const result = pending.map(event => ({ ...event }));
      if (take && pending.length) {
        const at = now();
        for (const event of pending) event.takenAt = at;
        try { save(); } catch (error) {
          for (const event of pending) delete event.takenAt;
          throw error;
        }
      }
      return result;
    },
    async push(deliver, desktop) {
      const pending = events.filter(event => event.pushedAt == null && !event.logOnly);
      const unassigned = pending.filter(event => !event.pushBatch);
      for (const group of Map.groupBy(unassigned, event => event.project).values()) {
        for (const batch of Map.groupBy(group, event => event.batch ?? null).values()) {
          const id = randomUUID();
          for (const event of batch) event.pushBatch = id;
        }
      }
      if (unassigned.length) {
        try { save(); } catch (error) {
          for (const event of unassigned) delete event.pushBatch;
          throw error;
        }
      }
      const unrouted = [];
      for (const batch of Map.groupBy(pending, event => event.pushBatch).values()) {
        if (batch[0].auditor && events.some(event => event.project === batch[0].project && event.auditor &&
            event.pushRoute !== 'external' && event.pushRoute !== 'log' &&
            event.pushedAt != null && now() - event.pushedAt < desktopIntervalMs)) continue;
        const route = await deliver(batch);
        if (route) mark(batch, route);
        else unrouted.push(...batch);
      }
      const ledgerOnly = unrouted.filter(event => !desktop || !desktopTypes.has(event.type));
      if (ledgerOnly.length) mark(ledgerOnly, 'log');
      if (!desktop) return;
      const eligible = [...unrouted.filter(event => desktopTypes.has(event.type)), ...events.filter(event =>
        event.desktopAlso && event.pushedAt != null && event.pushRoute !== 'external' && event.desktopAt == null)];
      for (const [name, batch] of Map.groupBy(eligible, event => event.project)) {
        if (events.some(event => event.project === name &&
            now() - (event.desktopAt ?? (event.pushRoute === 'external' ? event.pushedAt : -Infinity)) < desktopIntervalMs)) continue;
        // Keep one durable notice when both the Auditor and desktop receive it.
        const routed = batch.filter(event => event.pushedAt != null);
        for (const event of routed) event.desktopAt = now();
        try { mark(batch.filter(event => event.pushedAt == null), 'external'); }
        catch (error) {
          for (const event of routed) delete event.desktopAt;
          throw error;
        }
        await desktop(name, batch);
      }
    },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { project: { type: 'string' }, name: { type: 'string' },
      take: { type: 'boolean' }, complete: { type: 'string' }, phase: { type: 'string' } } });
    if (values.take && values.complete || values.complete !== undefined && !values.complete.trim()) {
      throw new Error('Use --take or --complete <summary>');
    }
    const directory = projectDirectory(values.project);
    const response = await request(directory, 'notifications', { project: values.name, take: values.take,
      complete: values.complete, phase: values.phase });
    console.log(JSON.stringify(response));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
