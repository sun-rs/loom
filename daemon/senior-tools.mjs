import { realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { inDirectory, runtimeDirectory } from '../cli/project.mjs';
import { toolGuardEnabled } from '../cli/policy.mjs';
import { jsonRows, readText } from './io.mjs';
import { appendSeniorToolEvent, rotationToolDenial, seniorShellCategory } from '../lib/senior-tool-guard.mjs';
import { legacySeniorCommandKey, seniorCommandKey, seniorOverrideReason } from '../lib/senior-command.mjs';
import { CommandError } from '../cli/sessions.mjs';

export const seniorToolLog = (project, addr) => join(runtimeDirectory(project), 'sessions', `${addr}.tool-guard.jsonl`);
export const seniorToolEvents = (project, addr) => project ? jsonRows(readText(seniorToolLog(project, addr))) : [];

export function seniorToolEnvironment(project, row) {
  return toolGuardEnabled(project, row.role) ? {
    LOOM_SENIOR_TOOL_LOG: seniorToolLog(project, row.addr), LOOM_SENIOR_TOOL_PROJECT: project,
  } : {};
}

export function seniorToolSummary(project, rows) {
  return rows.filter(row => ['leader', 'auditor'].includes(row.role)).flatMap(row => {
    const events = seniorToolEvents(project, row.addr);
    if (!events.length) return [];
    return Object.entries(Object.groupBy(events, event => event.type)).map(([type, items]) => ({
      type, role: row.role, addr: row.addr, count: items.length, at: items.at(-1).at,
      categories: Object.fromEntries(Object.entries(Object.groupBy(items, event => event.category))
        .map(([category, entries]) => [category, entries.length])),
      ...(type === 'senior-override' && { reasons: items.slice(-6).map(({ reason, category, at }) => ({ reason, category, at })) }),
    }));
  });
}

export function authorizeSeniorTool(project, row, { command, retryId, reason, workerUnavailable, since, at }) {
  const reasonText = seniorOverrideReason(reason);
  if (reason !== undefined && !reasonText) {
    throw new CommandError('senior-override-required', 'Explain why you need this command in a short sentence.');
  }
  const log = seniorToolLog(project, row.addr);
  const events = seniorToolEvents(project, row.addr);
  const consumed = new Set(events.filter(event => event.type === 'senior-override').map(event =>
    event.denyId ?? JSON.stringify([event.denialAt, event.denialKey, event.category])));
  const available = event => !consumed.has(event.denyId ?? JSON.stringify([event.at, event.key, event.category]));
  const denials = events.filter(event => event.type === 'senior-tool-denied' && event.at >= since);
  const key = seniorCommandKey(command);
  const oldKey = command === undefined ? undefined : legacySeniorCommandKey(command);
  const previous = retryId ? denials.find(event => event.denyId === retryId && event.command) :
    denials.findLast(event => event.key && (event.key === key || event.key === oldKey));
  if (retryId && (!previous || !available(previous))) {
    throw new CommandError('senior-override-needs-denial', 'Use an unused denial ID from this session and gate.');
  }
  command = previous?.command ?? command;
  let cwd = row.cwd;
  if (previous?.cwd) {
    try {
      const original = realpathSync(previous.cwd);
      if (original !== previous.cwd || !inDirectory(project, original) || !statSync(original).isDirectory()) throw new Error();
      cwd = original;
    } catch {
      throw new CommandError('senior-override-needs-denial', 'The denial work directory changed. Retry the original tool to get a fresh receipt.');
    }
  }
  const rotation = rotationToolDenial(log, project, cwd, 'Bash', { command });
  if (rotation) throw new CommandError('permission-denied', rotation);
  const category = seniorShellCategory(command, cwd, project);
  if (!category && !retryId) return { cwd, command };
  if (category !== previous?.category && retryId) {
    throw new CommandError('senior-override-needs-denial', 'The denial no longer matches this command. Get a fresh denial to retry it.');
  }
  if (!workerUnavailable && !reasonText) {
    throw new CommandError('senior-override-required', 'Provide a short sentence with --reason to retry the denied tool.');
  }
  if (previous ? !available(previous) : !workerUnavailable) {
    throw new CommandError('senior-override-needs-denial', 'An override must retry an unused recent denial of this tool.');
  }
  const writtenReason = workerUnavailable && !reasonText ? 'worker-unavailable' : reasonText;
  appendSeniorToolEvent(log, { at, type: 'senior-override', category, reason: writtenReason,
    ...(previous && { denyId: previous.denyId, denialAt: previous.at, denialKey: previous.key }) });
  return { cwd, command, category, reason: writtenReason };
}
