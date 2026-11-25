import { checkEvidence } from '../evidence/checks.mjs';
import { codexCommands } from '../evidence/transcript.mjs';
import { roles } from '../index/index.mjs';
import { historyReader } from './history.mjs';
import { timestamp, turnTools } from './turns.mjs';

const usageFields = ['inputTokens', 'cachedInputTokens', 'cacheWriteInputTokens', 'outputTokens', 'reasoningOutputTokens'];
const emptyRole = () => ({
  sessions: 0, turns: 0, turnsWithUsage: 0, modelCalls: 0,
  rawTokens: 0, inputTokens: 0, freshInputTokens: 0, cachedInputTokens: 0, cacheWriteInputTokens: 0,
  outputTokens: 0, reasoningOutputTokens: 0,
});
const eventTime = row => timestamp(row.timestamp ?? row.created_at ?? row.receivedAt ?? row.at);

function passingChecks(cli, turn, rows) {
  const tools = cli === 'codex' ? codexCommands(rows.map(({ row }) => row), turn).filter(tool =>
    tool.resultPosition != null || ['codex.exec_command_end', 'codex.item_completed'].includes(tool.source)) :
    turnTools(cli, turn, rows).filter(tool => tool.tool === 'shell');
  return new Set(tools.filter(tool => checkEvidence(tool)?.result === 'passed')
    .map(tool => tool.id ?? tool.position ?? tool.ordinal));
}

function afterAcceptance({ session, turn, rows, journalOnly }) {
  if (journalOnly || !rows.length) return { lastPassingAcceptanceAt: null, callsAfterAcceptance: null };
  const passes = passingChecks(session.cli, turn, rows);
  if (!passes.size) return { lastPassingAcceptanceAt: null, callsAfterAcceptance: null };

  // Locate the result row by replaying prefixes with the same tool pairing as history.
  // A call issued while the check was still running belongs before this boundary.
  let first = 0;
  let last = rows.length - 1;
  while (first < last) {
    const midway = Math.floor((first + last) / 2);
    const observed = passingChecks(session.cli, turn, rows.slice(0, midway + 1));
    if ([...passes].every(check => observed.has(check))) last = midway;
    else first = midway + 1;
  }
  const completed = new Date(eventTime(rows[first].row));
  const at = completed.valueOf();
  const callTimes = turn.calls?.map(call => timestamp(call.timestamp)) ?? [];
  return {
    lastPassingAcceptanceAt: Number.isFinite(at) ? completed.toISOString() : null,
    callsAfterAcceptance: Number.isFinite(at) && callTimes.length && callTimes.every(Number.isFinite) ?
      callTimes.filter(time => time > at).length : null,
  };
}

export function projectCost(directory, sessions, { includeAcceptance = true } = {}) {
  const reader = historyReader(directory);
  const byRole = Object.fromEntries([...roles, 'unassigned'].map(role => [role, emptyRole()]));
  const workerTurns = [];
  const missing = [];
  const seen = new Set();
  let leaderWakes = 0;

  for (const session of sessions) {
    const role = byRole[session.role ?? 'unassigned'];
    role.sessions++;
    let history;
    try { history = reader.sessionHistory(session); }
    catch (error) {
      missing.push({ addr: session.addr, code: error.code ?? 'unavailable' });
      continue;
    }
    const { path, items, missing: gap } = history;
    if (gap) missing.push({ addr: session.addr, code: gap.code ?? 'unavailable' });
    const key = path && `${session.cli}\0${path}`;
    const duplicate = key && seen.has(key);
    if (key) seen.add(key);
    // A shared native transcript accounts for its native turns once. A
    // journal-only turn is specific to this Loom address.
    const turns = duplicate ? items.filter(item => item.journalOnly) : items;
    role.turns += turns.length;
    if (session.role === 'leader') leaderWakes += Math.max(0, turns.length - 1);

    for (const item of turns) {
      const usage = item.turn.usage;
      if (usage?.calls > 0) {
        role.turnsWithUsage++;
        role.modelCalls += usage.calls;
        for (const field of usageFields) role[field] += usage[field] ?? 0;
      }
      if (includeAcceptance && session.role === 'worker') {
        workerTurns.push({ addr: session.addr, task: session.task, turn: item.index,
          modelCalls: usage?.calls > 0 ? usage.calls : null, ...afterAcceptance(item) });
      }
    }
  }

  for (const totals of Object.values(byRole)) {
    totals.rawTokens = totals.inputTokens + totals.outputTokens;
    totals.freshInputTokens = totals.inputTokens - totals.cachedInputTokens - totals.cacheWriteInputTokens;
  }
  const rawTokens = Object.values(byRole).reduce((sum, totals) => sum + totals.rawTokens, 0);
  return { byRole, rawTokens, workerShare: rawTokens ? byRole.worker.rawTokens / rawTokens : null,
    leaderWakes, workerTurns, missing };
}
