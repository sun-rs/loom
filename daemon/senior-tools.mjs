import { join } from 'node:path';
import { runtimeDirectory } from '../cli/project.mjs';
import { toolGuardEnabled } from '../cli/policy.mjs';
import { jsonRows, readText } from './io.mjs';
import { appendSeniorToolEvent, seniorCommandKey, seniorShellCategory } from '../lib/senior-tool-guard.mjs';
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

export function authorizeSeniorTool(project, row, { command, reason, workerUnavailable, since, at }) {
  const category = seniorShellCategory(command, row.cwd, project);
  if (!category) return { cwd: row.cwd };
  if (!workerUnavailable && !reason) throw new CommandError('senior-override-required', 'Provide --reason to retry the denied tool.');
  const key = seniorCommandKey(command);
  const events = seniorToolEvents(project, row.addr);
  const retry = events.findLast(event => event.type === 'senior-tool-denied' && event.at >= since &&
    (event.key === key || !event.key && event.category === category));
  if (!workerUnavailable && (!retry || events.some(event => event.type === 'senior-override' && event.denialAt === retry.at &&
      event.denialKey === retry.key && event.category === category))) {
    throw new CommandError('senior-override-needs-denial', 'An override must retry a recent denial of this tool.');
  }
  reason = workerUnavailable ? 'worker-unavailable' : reason;
  appendSeniorToolEvent(seniorToolLog(project, row.addr), { at, type: 'senior-override', category, reason,
    ...(retry && { denialAt: retry.at, denialKey: retry.key }) });
  return { cwd: row.cwd, category, reason };
}
