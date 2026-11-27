import { isAbsolute, resolve } from 'node:path';
import { readArtifacts } from '../../cli/artifacts.mjs';
import { historyReader } from '../../cli/history.mjs';
import { projectIndex } from '../../cli/project.mjs';
import { timestamp } from '../../cli/turns.mjs';
import { rotationReason } from '../../daemon/role-budget.mjs';
import { readNotifications } from '../../daemon/notifications.mjs';
import { switchDensity } from '../../daemon/rotation-policy.mjs';
import { plannedCardPaths } from '../../evidence/facts.mjs';
import { rotatingRoles } from '../../index/index.mjs';
import { rotationSettings } from '../../lib/rotation-settings.mjs';
import { sessionContext } from '../../lib/session-context.mjs';

const [directory, start, end] = process.argv.slice(2);
const from = Date.parse(start);
const until = Date.parse(end);
if (!isAbsolute(directory ?? '') || !(from < until)) {
  throw new Error('Usage: node replay.mjs /absolute/project START_ISO END_ISO');
}

const project = resolve(directory);
const reader = historyReader(project);
const index = projectIndex(project);
const recorded = index.rotations();
const allRows = index.query();
const artifacts = readArtifacts(project);
const messages = artifacts.messages();
const notifications = readNotifications(project);
const settings = rotationSettings({ rotation: { mode: 'v2' } });
const byMail = new Map(messages.map(message => [message.id, message]));
const workerRecords = allRows.filter(row => row.role === 'worker' && row.task && row.startedAt < until).map(row => {
  const job = artifacts.job(row.addr);
  const first = byMail.get(job?.firstId);
  const paths = [...new Set([...plannedCardPaths(job?.prompt ?? ''), ...(first?.completion?.git?.files ?? []).map(item => item.path)])];
  return { parent: row.parent, at: row.startedAt, card: row.task, mainline: row.wave, paths,
    commit: first?.completion && { at: first.completion.at, paths } };
});
const gates = messages.filter(message => message.gateId && message.received && message.completion?.body &&
  !message.completion.unconfirmed && message.completion.at < until);
const gateRecords = gates.map(message => ({ parent: message.target.addr, at: message.completion.at, card: message.gateId,
  mainline: message.gateProject, paths: message.gatePaths ?? [] }));
const policy = {};
const rows = allRows.filter(row => rotatingRoles.includes(row.role) &&
  row.startedAt < until && (row.endedAt ?? Infinity) >= from);
const inWindow = time => time >= from && time < until;
const timeOf = row => timestamp(row.timestamp ?? row.created_at ?? row.receivedAt ?? row.at);
const sessions = rows.map(row => {
  const history = reader.sessionHistory(row);
  const raw = history.raw.map(entry => entry.row).filter(record => !(timeOf(record) >= until));
  let maxInputTokens = null;
  let maxPercent = null;
  let reason;
  let turns = 0;
  for (const [i, item] of history.items.entries()) {
    const at = timestamp(item.turn.endedAt);
    if (item.journalOnly || !inWindow(at)) continue;
    turns++;
    // Count every completed root turn as a candidate. The daemon also checks
    // for open cards and an idle transport before proposing a rotation.
    const reading = sessionContext(row, { raw: raw.filter(record => !(timeOf(record) > at)),
      items: history.items.slice(0, i + 1) });
    if (reading.inputTokens !== null) maxInputTokens = Math.max(maxInputTokens ?? 0, reading.inputTokens);
    if (reading.percent !== null) maxPercent = Math.max(maxPercent ?? 0, reading.percent);
    reason ??= rotationReason(policy, row.role, reading);
  }
  const context = sessionContext(row, { raw, items: history.items.filter(item => timestamp(item.turn.endedAt) < until) });
  const eligibleRecords = [...workerRecords, ...gateRecords].filter(item => item.parent === row.addr);
  const sessionEnd = Math.min(until, row.endedAt ?? until);
  const checkpoints = [...new Set([sessionEnd, ...eligibleRecords.map(item => item.at),
    ...context.afterCompaction.map(item => item.at)].filter(at => at >= Math.max(from, row.startedAt) && at <= sessionEnd))];
  const signals = checkpoints.map(at => {
    const work = eligibleRecords.map(item => item.commit?.at <= at ? { ...item, at: item.commit.at, paths: item.commit.paths } : item);
    return {
      and: switchDensity(work, context, { ...settings, densityRequiresCompaction: true }, row.cli, at),
      or: switchDensity(work, context, { ...settings, densityRequiresCompaction: false }, row.cli, at),
    };
  });
  return { addr: row.addr.slice(5, 13), role: row.role, cli: row.cli, model: row.model, turns, maxInputTokens, maxPercent,
    window: context.contextWindow, windowSource: context.windowSource, compactions: context.compactions,
    afterCompaction: context.afterCompaction,
    v2: { switchesAndCompaction: signals.some(value => value.and.hit), switchesOrCompaction: signals.some(value => value.or.hit),
      maxCards: Math.max(0, ...signals.map(value => value.and.cards)),
      maxSubsystems: Math.max(0, ...signals.map(value => value.and.subsystems)),
      maxNativeCompactions24h: context.compactions === null ? null : Math.max(0, ...signals.map(value => value.and.compact)),
      highWater: (context.tokens ?? maxInputTokens) >= settings.highWaterTokens[row.cli] ||
        maxInputTokens >= settings.highWaterTokens[row.cli] },
    boundRotation: recorded.some(item => item.successor === row.addr && inWindow(item.boundAt)), proposed: reason ?? null };
});
const byRole = Object.fromEntries(rotatingRoles.map(role => {
  const matching = sessions.filter(row => row.role === role);
  return [role, { turns: matching.reduce((sum, row) => sum + row.turns, 0),
    recordedRotations: matching.filter(row => row.boundRotation).length,
    proposedWithDefaultPolicy: matching.filter(row => row.proposed).length,
    v2HistoricalSessionCandidates: { densityAnd: matching.filter(row => row.v2.switchesAndCompaction).length,
      densityOr: matching.filter(row => row.v2.switchesOrCompaction).length, highWater: matching.filter(row => row.v2.highWater).length } }];
}));
const structured = { gates: notifications.filter(event => event.type === 'gate-completed' && inWindow(event.at)).length,
  phaseCompletions: notifications.filter(event => event.type === 'project-completed' && inWindow(event.at)).length,
  auditReturnStreaks: [...Map.groupBy(gates.filter(message => inWindow(message.completion.at)), message => message.gateId).values()]
    .map(group => group.reduce(({ trailing, max }, message) => {
      const next = /^\**REJECT\b/i.test(message.completion.body.trimStart()) ? trailing + 1 : 0;
      return { trailing: next, max: Math.max(max, next) };
    }, { trailing: 0, max: 0 }).max)
    .filter(count => count >= settings.auditReturns).length };
console.log(JSON.stringify({ start, end, byRole, structured, sessions }, null, 2));
