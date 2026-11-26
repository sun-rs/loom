import { checkEvidence } from '../evidence/checks.mjs';
import { codexCommands } from '../evidence/transcript.mjs';
import { roles } from '../index/index.mjs';
import { historyReader } from './history.mjs';
import { readPolicy } from './policy.mjs';
import { timestamp, turnTools } from './turns.mjs';
import { readArtifacts } from './artifacts.mjs';
import { projectIndex } from './project.mjs';
import { deliveryId } from '../inbox/message.mjs';
import { agyTurnPrompt } from '../adapters/agy/lib/parse-agy.mjs';

const usageFields = ['inputTokens', 'cachedInputTokens', 'cacheWriteInputTokens', 'outputTokens', 'reasoningOutputTokens'];
const referencePrices = {
  codex: { freshInput: 2.5, cacheWrite: 2.5, cacheRead: 0.25, output: 15 },
  agy: { freshInput: 2, cacheWrite: 2, cacheRead: 0.2, output: 12 },
  claude: { freshInput: 3, cacheWrite: 3.75, cacheRead: 0.3, output: 15 },
  opencode: { freshInput: 0.3, cacheWrite: 0.3, cacheRead: 0.006, output: 1.2 },
};
const emptyUsage = () => ({
  modelCalls: 0,
  rawTokens: 0, inputTokens: 0, freshInputTokens: 0, cachedInputTokens: 0, cacheWriteInputTokens: 0,
  outputTokens: 0, reasoningOutputTokens: 0,
});
const emptyRole = () => ({ sessions: 0, turns: 0, turnsWithUsage: 0, ...emptyUsage(), estimatedCostUsd: 0 });
export const pyramidWindowMs = 60 * 60_000;
const minimumPyramidCalls = 3;
export const pyramidSampleReady = sample => ['auditor', 'leader', 'worker']
  .every(role => sample?.byRole?.[role]?.modelCalls >= minimumPyramidCalls);
const eventTime = row => timestamp(row.timestamp ?? row.created_at ?? row.receivedAt ?? row.at);

function addUsage(totals, usage, cli, price) {
  totals.modelCalls += usage.calls;
  for (const field of usageFields) totals[field] += usage[field] ?? 0;
  const write = usage.cacheWriteInputTokens ?? 0;
  const fresh = Math.max(0, (usage.inputTokens ?? 0) - (usage.cachedInputTokens ?? 0) - write);
  totals.freshInputTokens += fresh + (cli === 'claude' ? write : 0);
  totals.rawTokens = totals.inputTokens + totals.outputTokens;
  if (price) totals.estimatedCostUsd += (fresh * price.freshInput + write * price.cacheWrite +
    (usage.cachedInputTokens ?? 0) * price.cacheRead + (usage.outputTokens ?? 0) * price.output) / 1_000_000;
}

function inWindow(turn, since, until) {
  const turnTime = timestamp(turn.endedAt ?? turn.startedAt);
  const within = at => at >= since && at <= until;
  if (turn.calls?.length === turn.usage.calls) {
    return turn.calls.filter(call => {
      const at = timestamp(call.timestamp);
      return within(Number.isFinite(at) ? at : turnTime);
    }).map(call => ({ ...call, calls: 1 }));
  }
  return within(turnTime) ? [turn.usage] : [];
}

function pyramid(byRole, since, until) {
  const inversions = [];
  for (const metric of ['modelCalls', 'rawTokens']) {
    for (const [higher, lower] of [['auditor', 'leader'], ['leader', 'worker']]) {
      if (byRole[higher][metric] > byRole[lower][metric]) {
        inversions.push({ metric, higher, lower, actual: byRole[higher][metric], comparedTo: byRole[lower][metric] });
      }
    }
  }
  const observed = ['auditor', 'leader', 'worker'].some(role => byRole[role].modelCalls > 0);
  return { since, until, windowMs: until - since, byRole, inversions,
    state: inversions.length ? 'inverted' : observed ? 'balanced' : 'unobserved' };
}

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

function rotationBriefings(directory, sessions, reader) {
  const rows = new Map(sessions.map(row => [row.addr, row]));
  const artifacts = readArtifacts(directory);
  const entries = projectIndex(directory).rotations().flatMap(rotation => {
    const row = rows.get(rotation.successor);
    if (!row) return [];
    const job = artifacts.job(row.addr);
    const id = job?.handoverReportId ?? job?.firstId;
    const done = id && artifacts.messages().find(message => message.id === id)?.completion;
    const item = id && reader.sessionHistory(row).items.find(({ turn, hook, observation, completion }) =>
      hook?.deliveryId === id || observation?.end?.inputIds?.includes(id) ||
      (turn.prompts ?? [agyTurnPrompt.get(turn)]).some(prompt => deliveryId(prompt) === id) ||
      done && completion && completion.turnId === done.turnId && completion.streamId === done.streamId && completion.at === done.at);
    const usage = item?.turn.usage;
    const measured = usage?.calls > 0 && Number.isFinite(usage.inputTokens) && Number.isFinite(usage.outputTokens);
    return [{ role: row.role, predecessor: rotation.predecessor, successor: row.addr, reason: job?.rotationReason ?? null,
      inputTokens: measured ? usage.inputTokens : null, outputTokens: measured ? usage.outputTokens : null,
      rawTokens: measured ? usage.inputTokens + usage.outputTokens : null }];
  });
  return { entries, measured: entries.filter(entry => entry.rawTokens !== null).length,
    rawTokens: entries.reduce((sum, entry) => sum + (entry.rawTokens ?? 0), 0) };
}

export function projectCost(directory, sessions, { includeAcceptance = true, now = Date.now(),
  reader = historyReader(directory), policy = readPolicy(directory, { optional: true }) } = {}) {
  const overrides = policy.cost?.prices ?? {};
  const prices = Object.fromEntries(Object.entries(referencePrices)
    .map(([cli, defaults]) => [cli, { ...defaults, ...overrides[cli] }]));
  const byRole = Object.fromEntries([...roles, 'unassigned'].map(role => [role, emptyRole()]));
  const rolling = Object.fromEntries(Object.keys(byRole).map(role => [role, emptyUsage()]));
  const since = now - pyramidWindowMs;
  const workerTurns = [];
  const missing = [];
  const seen = new Set();
  let leaderWakes = 0;

  for (const session of sessions) {
    const name = session.role ?? 'unassigned';
    const role = byRole[name];
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
        addUsage(role, usage, session.cli, prices[session.cli]);
        for (const call of inWindow(item.turn, since, now)) addUsage(rolling[name], call, session.cli);
      }
      if (includeAcceptance && session.role === 'worker') {
        workerTurns.push({ addr: session.addr, task: session.task, turn: item.index,
          modelCalls: usage?.calls > 0 ? usage.calls : null, ...afterAcceptance(item) });
      }
    }
  }

  const rawTokens = Object.values(byRole).reduce((sum, totals) => sum + totals.rawTokens, 0);
  const estimatedCostUsd = Object.values(byRole).reduce((sum, totals) => sum + totals.estimatedCostUsd, 0);
  for (const totals of Object.values(byRole)) {
    totals.estimatedCostShare = estimatedCostUsd ? totals.estimatedCostUsd / estimatedCostUsd : null;
  }
  return { byRole, rawTokens, workerShare: rawTokens ? byRole.worker.rawTokens / rawTokens : null,
    estimatedCostUsd, estimatedWorkerShare: byRole.worker.estimatedCostShare,
    pricing: { estimate: true, unit: 'USD per million tokens', prices },
    leaderWakes, workerTurns, missing, pyramid: pyramid(rolling, since, now),
    ...(includeAcceptance && { rotationBriefings: rotationBriefings(directory, sessions, reader) }) };
}
