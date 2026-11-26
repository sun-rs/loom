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
const desktopTypes = new Set(['needs-decision', 'project-completed', 'audit-escalation', 'leader-exited', 'consumption-pyramid']);
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
  await execute('/usr/bin/osascript', ['-e', appleScript, '--', `Loom · ${basename(project)}`,
    `${types.slice(0, 180)}. Open loom notifications for details.`], { timeout: 3000 });
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
        const route = await deliver(batch);
        if (route) mark(batch, route);
        else unrouted.push(...batch);
      }
      const ledgerOnly = unrouted.filter(event => !desktop || !desktopTypes.has(event.type));
      if (ledgerOnly.length) mark(ledgerOnly, 'log');
      if (!desktop) return;
      const eligible = unrouted.filter(event => desktopTypes.has(event.type));
      for (const [name, batch] of Map.groupBy(eligible, event => event.project)) {
        if (events.some(event => event.project === name && event.pushRoute === 'external' &&
            desktopTypes.has(event.type) && now() - event.pushedAt < desktopIntervalMs)) continue;
        // Reserve a banner durably before the desktop side effect, including across loomd restarts.
        mark(batch, 'external');
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
