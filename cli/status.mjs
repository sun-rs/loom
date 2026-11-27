import { spawnSync } from 'node:child_process';
import { basename } from 'node:path';
import { readArtifacts } from './artifacts.mjs';
import { projectCost } from './cost.mjs';
import { request, daemonAbsent } from '../daemon/rpc.mjs';
import { activeOrgNotices, readOrg, workerCardFindings } from '../daemon/org.mjs';
import { summarizeAuditFindings } from '../daemon/audit-findings.mjs';
import { readNotifications } from '../daemon/notifications.mjs';
import { deliveryFailed, isBlockedReply } from '../inbox/message.mjs';
import { managedProject, projectIndex, projectSessions } from './project.mjs';
import { pendingWork, stalledDeliveries, stallText, suppressedReplies, suppressedReplyText } from '../inbox/engine.mjs';
import { isStartupBlocker } from '../tui/agent-status.mjs';
import { auditorWakeFiltered } from '../daemon/routing.mjs';
import { seniorToolSummary } from '../daemon/senior-tools.mjs';
import { readAccounts } from '../daemon/accounts.mjs';
import { accountSummaryLines } from './accounts.mjs';
import { readLayout } from '../daemon/herdr-layout.mjs';
import { storedWorkerTier } from '../lib/worker-tiers.mjs';
import { rotatingRoles } from '../index/index.mjs';
import { rootEvents, sessionContext } from '../lib/session-context.mjs';
import { historyReader } from './history.mjs';
import { readPolicy, workerReuseLimits, workerWarmMs } from './policy.mjs';
import { retainedState, retentionStatus, reuseStatus, workerCardId, workerContext, workerDetails, workerMetrics } from '../daemon/worker-retention.mjs';

export async function sessionMemory(project) {
  if (managedProject(project)) {
    try { return (await request(project, 'session-memory')).memory; }
    catch (error) { if (!daemonAbsent(error)) throw error; }
  }
  return null;
}

export function memoryLabel({ rssKiB, unavailableSessions }) {
  return `${rssKiB == null ? 'unavailable' : (rssKiB / 1024).toFixed(1) + ' MiB RSS'}` +
    (unavailableSessions ? ` · ${unavailableSessions} unmeasured` : '');
}

export const workerMetricsLabel = ({ gate, newSpawns, revives, coldRevives, coldRevivesMeasured, coldReviveTokens,
  reuses, crossCardReuses, workerHandoffs, firstReportMismatches, thresholdRetirements,
  averageRetirementContextPercent, leader, ttl, operator, closed, fixAfterReject }) =>
  [gate, `new ${newSpawns}`, `revived ${revives}`, `closed ${closed}`, `TTL offline ${ttl}`,
    reuses != null && `reused ${reuses}`, thresholdRetirements != null && `threshold retirements ${thresholdRetirements}`,
    crossCardReuses && `cross-card ${crossCardReuses}`, workerHandoffs && `handoffs ${workerHandoffs}`,
    firstReportMismatches && `first-report mismatches ${firstReportMismatches}`,
    averageRetirementContextPercent != null && `mean retirement context ${Math.round(averageRetirementContextPercent)}%`,
    leader && `Leader offline ${leader}`, operator && `operator offline ${operator}`,
    coldRevives && `cold ${coldRevivesMeasured ? coldReviveTokens + ' tokens' : 'usage unavailable'} (${coldRevivesMeasured}/${coldRevives} measured)`,
    fixAfterReject?.new.rounds + fixAfterReject?.revived.rounds > 0 &&
      `post-REJECT approved/decided · new ${fixAfterReject.new.approved}/${fixAfterReject.new.decided} · revived ${fixAfterReject.revived.approved}/${fixAfterReject.revived.decided}`]
    .filter(Boolean).join(' · ');

export async function projectStatus(project, { now = Date.now() } = {}) {
  let live;
  let exits;
  let rotationPolicy;
  let memory;
  let metrics;
  if (managedProject(project)) {
    try { ({ sessions: live, exits, rotationPolicy, memory, workerMetrics: metrics } = await request(project, 'status')); }
    catch (error) { if (!daemonAbsent(error)) throw error; }
  }
  const rotations = projectIndex(project).rotations();
  const rows = projectSessions(project);
  const states = new Map((live ?? []).map(row => [row.addr, row]));
  const artifacts = readArtifacts(project);
  const jobs = new Map(rows.map(row => [row.addr, artifacts.job(row.addr)]));
  let policy = {};
  try { policy = readPolicy(project, { optional: true }); } catch {}
  const retentionFor = row => states.get(row.addr)?.retention ?? retentionStatus(jobs.get(row.addr), now, workerWarmMs(policy, row.cli));
  const lifecycle = row => {
    const retention = retentionFor(row);
    return states.get(row.addr)?.state ?? (retention ? retainedState(retention, false, row.endedAt != null) :
      row.endedAt != null ? 'exited' : 'offline');
  };
  const runtimeState = row => states.get(row.addr)?.runtimeState ?? lifecycle(row);
  const messages = artifacts.messages();
  const incoming = Map.groupBy(messages, message => message.target.addr);
  const org = readOrg(project);
  const details = row => {
    const observed = states.get(row.addr);
    if (observed?.retention) {
      const { contextPercent, contextAfterCompactionPercent, lastResultTag, compactions, reuse, retirementReason, handoff, firstReportCheck } = observed;
      return { contextPercent, contextAfterCompactionPercent, lastResultTag, compactions, reuse, retirementReason, handoff, firstReportCheck };
    }
    const context = jobs.get(row.addr)?.retention?.lastContext ?? workerContext(artifacts.journal(row.addr));
    const job = jobs.get(row.addr);
    const inputs = incoming.get(row.addr) ?? [];
    const cardId = workerCardId(inputs, job?.firstId);
    const findings = workerCardFindings(org, cardId);
    const incident = findings.findLast(finding => finding.kind === 'overreach' || finding.kind === 'fabrication');
    const draft = job?.workerHandoff;
    const handoff = draft?.ready || draft?.reason !== 'no-progress' && (draft?.cardId == null || draft.cardId === cardId) ?
      draft : undefined;
    return { ...(job?.firstReportCheck?.status === 'mismatch' ? { lastResultTag: 'BLOCKED' } :
      workerDetails(inputs)), ...context,
      ...(row.role === 'worker' && reuseStatus(job, row.endedAt != null, context, workerReuseLimits(policy), findings)),
      ...((handoff || incident && row.endedAt == null) && { handoff: handoff ?? { reason: incident.kind, ready: false } }),
      ...(job?.firstReportCheck && { firstReportCheck: job.firstReportCheck }) };
  };
  const notifications = readNotifications(project);
  const auditFindings = [...Map.groupBy(notifications, event => event.project)].flatMap(([name, events]) =>
    [...new Set(events.filter(event => event.type === 'audit-finding').map(event => event.phase))]
      .map(phase => ({ project: name, ...summarizeAuditFindings(events, phase) })));
  const relay = artifacts.relay();
  const pendingWaves = new Set(messages.filter(message => message.waveKey &&
    ['queued', 'sending', 'stopped', 'stopping'].includes(message.phase)).map(message => message.waveKey));
  const waves = Object.entries(relay.waves ?? {}).filter(([key, wave]) => !wave.closed || pendingWaves.has(key)).map(([key, wave]) => ({
    key, wave: wave.id, parent: wave.parent, members: wave.members, deliver: wave.deliver ?? 'barrier',
    state: wave.closed ? 'queued' : wave.deliver === 'stream' ? 'streaming' : wave.deadline == null ? 'dispatching' : 'pending',
  }));
  const ended = new Set(rows.filter(row => row.endedAt != null).map(row => row.addr));
  const { pendingContinuations } = pendingWork(messages, undefined, undefined, addr => ended.has(addr));
  const latest = [...new Map(rows.filter(row => row.role === 'worker')
    .map(row => [JSON.stringify([row.project, row.task]), row])).values()];
  const selected = new Set(waves.flatMap(wave => wave.members ?? []));
  const leaders = new Set(rows.filter(row => row.role === 'leader').map(row => row.addr));
  const byId = new Map(messages.map(message => [message.id, message]));
  const undelivered = new Set(messages.filter(message =>
    !message.received &&
    leaders.has(message.target.addr) && message.issue !== 'superseded').flatMap(message => [
    ...(message.resultWorkers ?? []),
    ...(message.continuationMembers ?? []).map(id => byId.get(id)?.target.addr),
    ...(message.replyTo ? [message.from?.addr ?? byId.get(message.replyTo)?.target.addr] : []),
    // Old relay records contain the worker address in the result heading.
    ...(message.waveBatch && !message.resultWorkers ? [...message.text.matchAll(/^\S+ ((?:loom|oar)-[0-9a-f-]+) (?:DONE|FAILED|BLOCKED|UNCONFIRMED)\b/gm)]
      .map(match => match[1]) : []),
  ]));
  const cards = latest.map(row => {
    const turn = messages.findLast(message => message.target.addr === row.addr && message.completion?.body);
    const key = row.task + '/' + row.addr;
    const status = relay.progress?.[key]?.result?.outcome?.toLowerCase();
    const mismatch = jobs.get(row.addr)?.firstReportCheck?.status === 'mismatch';
    const state = undelivered.has(row.addr) ? 'result-undelivered' : mismatch ? 'blocked' : turn ? isBlockedReply(turn.completion.body) ? 'blocked' :
      /^\**FAILED\b/i.test(turn.completion.body.trimStart()) ? 'failed' : 'done' : status ?? lifecycle(row);
    return { task: row.task, addr: row.addr, wave: row.wave, state, lifecycle: lifecycle(row), runtimeState: runtimeState(row),
      ...(retentionFor(row) && { retention: retentionFor(row), ...details(row) }),
      active: row.endedAt == null || selected.has(key) };
  });
  const blocked = [
    ...cards.filter(card => card.state === 'blocked' || card.runtimeState === 'stuck' || isStartupBlocker(card.runtimeState))
      .map(card => ({ task: card.task, addr: card.addr,
        ...(isStartupBlocker(card.runtimeState) && { reason: card.task + ' ' + card.runtimeState }) })),
    ...rows.filter(row => row.role !== 'worker' && (runtimeState(row) === 'stuck' || isStartupBlocker(runtimeState(row))))
      .map(row => ({ addr: row.addr, reason: row.role + ' ' + runtimeState(row) })),
    ...notifications.filter(event => event.type === 'needs-decision' && event.takenAt == null)
      .map(event => ({ addr: event.addr, reason: event.text })),
  ];
  const workers = new Set(rows.filter(row => row.role === 'worker').map(row => row.addr));
  const seniorTools = seniorToolSummary(project, rows);
  const notices = [...activeOrgNotices(org).map(notice => ({ ...notice, audience: 'leader' })),
    ...notifications.flatMap(event =>
      event.type === 'auditor-budget-exceeded' ? [{ ...event, audience: 'super' }] :
        event.type === 'stuck' && workers.has(event.addr) ? [{ ...event, audience: 'leader' }] :
          ['red-escalation', 'senior-override-budget', 'senior-tool-output-share'].includes(event.type) ? [event] : []),
  ].sort((a, b) => b.at - a.at);
  const digestReceived = new Set(messages.filter(message => message.received && !deliveryFailed(message))
    .flatMap(message => message.auditorDigestIds ?? []));
  const filtered = messages.filter(message => message.issue === auditorWakeFiltered).map(message => ({
    id: message.id, target: message.target.addr, from: message.from?.addr, at: message.refusedAt ?? message.createdAt,
    ...(message.from && { digest: digestReceived.has(message.id) ? 'received' : 'next-wake' }),
  }));
  const git = spawnSync('git', ['--no-pager', 'log', '--first-parent', '--merges', '-5', '--format=%H%x09%ct%x09%s'],
    { cwd: project, encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });
  const history = (git.stdout ?? '').trim().split('\n').filter(Boolean).map(line => {
    const [, sha, seconds, subject] = /^(\S+)\t(\d+)\t(.*)$/.exec(line) ?? [];
    return { sha, at: Number(seconds) * 1000, subject };
  });
  const verified = rows.flatMap(row => artifacts.cards(row.addr)).filter(({ data }) => data.git?.merge?.integrated)
    .sort((a, b) => b.data.endedAt - a.data.endedAt).map(({ data }) => ({
      sha: data.git.head, at: data.endedAt, subject: data.task, ref: data.git.merge.ref,
    }));
  const merges = [...new Map([...history, ...verified].filter(merge => merge.sha).map(merge => [merge.sha, merge])).values()]
    .sort((a, b) => b.at - a.at).slice(0, 5);
  const reader = historyReader(project);
  const { byRole, rawTokens, missing, pyramid, memoryExtractor, memoryPilot } =
    projectCost(project, rows, { includeAcceptance: false, now, reader });
  const activeAddresses = new Set(rows.filter(row => row.endedAt === null).map(row => row.addr));
  const rotationNotices = notifications.filter(event => event.type === 'leader-handover-failed' ||
    ['leader-rotation-proposed', 'auditor-rotation-proposed'].includes(event.type) && activeAddresses.has(event.addr)).slice(-6).reverse();
  const startOfDay = new Date(now).setHours(0, 0, 0, 0);
  const rotationDetails = rotations.map(rotation => ({ ...rotation,
    reason: artifacts.job(rotation.successor)?.rotationReason ??
      notifications.findLast(event => event.addr === rotation.predecessor && event.at <= rotation.startedAt &&
        event.type === `${rotation.role}-rotation-proposed`)?.reason ?? null,
  }));
  const rotationsToday = Object.fromEntries(rotatingRoles.map(role => [role, rotationDetails.filter(rotation =>
    rotation.role === role && rotation.boundAt >= startOfDay && rotation.boundAt <= now)]));
  const seniorSessions = rows.filter(row => rotatingRoles.includes(row.role)).map(row => {
    const { items, raw, transcriptBytes } = reader.sessionHistory(row);
    const events = rootEvents(row, artifacts.journal(row.addr));
    return { addr: row.addr, role: row.role, cli: row.cli, model: row.model, endedAt: row.endedAt,
      turns: items.length, runtimeMs: row.startedAt == null ? null : Math.max(0, (row.endedAt ?? now) - row.startedAt), transcriptBytes,
      context: sessionContext(row, { items, raw: raw.map(item => item.row) }, { events, statusline: artifacts.context(row.addr) }) };
  });
  const seniorByAddress = new Map(seniorSessions.map(metric => [metric.addr, metric]));
  const awaitingAck = new Set(rotations.filter(item => item.boundAt == null && item.failedAt == null)
    .map(item => item.successor));
  const rotating = new Set(rotations.filter(item => item.boundAt != null && item.verifiedAt == null && item.failedAt == null)
    .map(item => item.successor));
  const awaitingUser = rows.flatMap(row => {
    const prompt = states.get(row.addr)?.userPrompt;
    return prompt && row.endedAt === null ? [{ addr: row.addr, role: row.role, ...prompt }] : [];
  });
  const sessionHealth = rows.flatMap(row => {
    const health = states.get(row.addr)?.liveness ?? (!live && row.endedAt == null && jobs.get(row.addr)?.liveness?.health);
    return health ? [{ addr: row.addr, role: row.role, ...health,
      ...(health.status === 'waiting-poll' && { zeroProgressMs: health.zeroProgressMs ?? Math.max(0, now - health.since) }) }] : [];
  });
  const crashed = exits ?? rows.flatMap(row => {
    const exit = row.endedAt != null && jobs.get(row.addr)?.exit;
    return exit && !rotations.some(item => item.predecessor === row.addr && item.boundAt != null && item.failedAt == null) ?
      [{ addr: row.addr, role: row.role, ...exit }] : [];
  });
  const byAddress = new Map(rows.map(row => [row.addr, row]));
  const incidents = new Map(crashed.map(exit => [exit.addr, exit]));
  for (const rotation of rotations) {
    if (rotation.failedAt != null) {
      incidents.set(rotation.successor, { ...incidents.get(rotation.successor), addr: rotation.successor, role: rotation.role,
        status: 'handover-failed', since: rotation.failedAt, reason: rotation.failure });
    }
  }
  const deliveryAlerts = stalledDeliveries(messages).map(item =>
    ({ ...item, role: byAddress.get(item.target)?.role, since: item.stalledAt }));
  const { accounts, diagnostics, snapshotUnavailable } = readAccounts(project);
  return { ok: true, accounts, ...(diagnostics.length && { accountDiagnostics: diagnostics }),
    ...(snapshotUnavailable && { accountSnapshotUnavailable: true }), running: Boolean(live), layout: readLayout(project), stalledDeliveries: deliveryAlerts, awaitingUser, sessionHealth, exits: [...incidents.values()],
    suppressedReplies: suppressedReplies(messages).sort((a, b) => b.at - a.at),
    sessions: rows.filter(row => row.endedAt == null || retentionFor(row)).map(row => {
      const authMode = row.cli === 'claude' ? jobs.get(row.addr)?.authMode : undefined;
      return { role: row.role, addr: row.addr, cli: row.cli, task: row.task, state: lifecycle(row),
        ...(seniorByAddress.has(row.addr) && { metrics: seniorByAddress.get(row.addr),
          rotationsToday: rotationsToday[row.role].length }),
        ...(retentionFor(row) && { retention: retentionFor(row), runtimeState: runtimeState(row), ...details(row) }),
        ...(states.get(row.addr)?.rotationDue && { rotationDue: true }),
        ...(states.get(row.addr)?.compactions != null && { compactions: states.get(row.addr).compactions }),
        ...(row.role === 'worker' && { workerTier: states.get(row.addr)?.workerTier ?? storedWorkerTier(artifacts.job(row.addr)) }),
        ...(authMode && { authMode }),
        ...(states.get(row.addr)?.userPrompt && { userPrompt: states.get(row.addr).userPrompt }),
        ...(states.get(row.addr)?.lastProgressAt != null && { lastProgressAt: states.get(row.addr).lastProgressAt }),
        ...(states.get(row.addr)?.pathWarnings && { pathWarnings: states.get(row.addr).pathWarnings }),
        ...(states.get(row.addr)?.memoryIsolation && { memoryIsolation: states.get(row.addr).memoryIsolation }),
        ...(states.get(row.addr)?.hookGap && { hookGap: states.get(row.addr).hookGap }),
        ...(rotating.has(row.addr) && { awaitingVerifiedReport: true }),
        ...(awaitingAck.has(row.addr) && { awaitingHandoverAck: true }) };
    }),
    waves, pendingContinuations, cards: cards.filter(card => card.active || ['blocked', 'result-undelivered'].includes(card.state)),
    blocked, notices, auditFindings, merges, ...(rotationPolicy && { rotationPolicy }), rotations: rotationDetails, rotationsToday, seniorSessions, rotationNotices, seniorTools, memoryExtractor, memoryPilot, routing: { filtered },
    memory: memory ?? null, workerMetrics: metrics ?? workerMetrics(rows, addr => jobs.get(addr), artifacts.journal, messages),
    cost: { rawTokens, byRole: Object.fromEntries(Object.entries(byRole).map(([role, value]) => [role, value.rawTokens])),
      usageByRole: byRole, pyramid, missingSessions: missing.length },
  };
}

const safe = value => String(value ?? '').replace(/[\x00-\x1f\x7f-\x9f]+/g, ' ').slice(0, 180);
export function printStatus(result) {
  function section(label, rows, format, limit) {
    const shown = rows.slice(0, limit).map(row => safe(format(row)));
    if (rows.length > limit) shown.push('… ' + (rows.length - limit) + ' more in --json');
    console.log(label + ' · ' + (shown.join('  |  ') || 'none'));
  }
  const stamp = value => Number.isFinite(value) ? new Date(value).toISOString() : 'unknown time';
  const incident = row => [row.role ?? 'unassigned', row.addr, row.status ?? row.kind, stamp(row.since),
    row.reason ?? row.summary, ...(row.retryAt != null ? [`retry ${stamp(row.retryAt)}`] : [])].join(' · ');
  console.log('Loom · ' + safe(result.project) + (result.running ? ' · online' : ' · offline'));
  if (result.layout) {
    const { space, tabs } = result.layout;
    console.log('Herdr space · ' + safe(space.name) + ' · ' + safe(space.id));
    for (const tab of Object.values(tabs)) console.log('  ' + [tab.name, tab.id, tab.terminal ?? 'vacant', tab.hcName, tab.addr]
      .filter(Boolean).map(safe).join(' · '));
  }
  section('Stalled deliveries', result.stalledDeliveries, row =>
    [row.role ?? 'unassigned', stamp(row.since), stallText(row)].join(' · '), Infinity);
  section('Awaiting user', result.awaitingUser, incident, Infinity);
  console.log('Accounts · ' + accountSummaryLines({ accounts: result.accounts, diagnostics: result.accountDiagnostics,
    snapshotUnavailable: result.accountSnapshotUnavailable }, {
    color: Boolean(process.stdout.isTTY && !Object.hasOwn(process.env, 'NO_COLOR')),
  }).join('  |  '));
  section('Quota and authentication', result.sessionHealth.filter(row => ['quota-wait', 'auth-expired'].includes(row.status)), incident, Infinity);
  section('Silent hangs', result.sessionHealth.filter(row => row.status === 'silent-hang'), incident, Infinity);
  section('Exited', result.exits, incident, Infinity);
  section('Suppressed replies', result.suppressedReplies, suppressedReplyText, 6);
  section('Waiting polls', result.sessionHealth.filter(row => row.status === 'waiting-poll'), row =>
    `${incident(row)} · ${Math.floor(row.zeroProgressMs / 1000)}s zero progress`, Infinity);
  section('Release paths', result.sessions.flatMap(row => (row.pathWarnings ?? []).map(warning => ({ ...row, ...warning }))),
    row => [row.role, row.addr, row.reason, row.path].filter(Boolean).join(' · '), Infinity);
  for (const [role, label] of [['leader', 'Leader'], ['auditor', 'Auditor']]) {
    section(`${label} rotation`, result.rotationNotices.filter(row => row.type.startsWith(`${role}-`)),
      row => [row.addr, row.text].join(' · '), 6);
  }
  section('Senior context', result.sessions.filter(row => row.metrics).map(row => row.metrics), row => {
    const { context, role, turns, runtimeMs, transcriptBytes } = row;
    const percentage = value => Number.isFinite(value) ? `${value.toFixed(1)}%` : '—';
    return [role, `${percentage(context.percent)} of ${context.contextWindow ?? '—'} (${context.windowSource ?? 'unknown source'})`,
      `${context.compactions ?? '—'} compactions`, `${turns} turns`, `${runtimeMs == null ? '—' : Math.floor(runtimeMs / 1000)}s`,
      `${transcriptBytes ?? '—'} transcript bytes`,
      ...(context.afterCompaction.length ? [`after compact ${context.afterCompaction.map(sample => percentage(sample.percent)).join(', ')}`] : [])].join(' · ');
  }, Infinity);
  section('Senior rotations today', Object.entries(result.rotationsToday), ([role, rotations]) =>
    `${role} ${rotations.length}${rotations.length ? ` (${rotations.map(item => item.reason ?? 'unrecorded').join(', ')})` : ''}`, Infinity);
  section('Senior tools', result.seniorTools, row => [row.type, row.role, row.count,
    ...(row.reasons?.slice(-2).toReversed().map(item => item.reason) ?? [])].join(' · '), 8);
  const elevated = result.sessions.filter(row => row.workerTier && row.workerTier !== 'sandbox');
  if (elevated.length) section('Elevated workers', elevated, row => [row.workerTier, row.task, row.addr, row.state].join(' · '), Infinity);
  section('Roles', result.sessions, row => [row.role ?? 'unassigned', row.cli, row.state,
    row.awaitingHandoverAck ? 'awaiting handover acknowledgement' :
      row.awaitingVerifiedReport ? 'awaiting report' : row.task ?? row.addr, row.rotationDue ? 'rotate at card boundary' : ''].join(' '), 6);
  section('Workers', result.sessions.filter(row => row.retention), ({ task, addr, state, retention, contextPercent, lastResultTag,
    compactions, reuse, retirementReason, handoff, firstReportCheck }) =>
    [task ?? addr, state, retention.keep || retention.keepWarm ? 'kept warm' :
      retention.remainingMs != null ? `warm for ${Math.ceil(retention.remainingMs / 1000)}s` : undefined,
    contextPercent == null ? 'context unknown' : `context ${Math.round(contextPercent)}%`, lastResultTag,
    `${compactions ?? 0} compactions`, reuse === 'same-card-only' ? `same card only (${retirementReason})` : reuse,
    firstReportCheck && `baseline ${firstReportCheck.status}`,
    handoff && `handoff ${handoff.reason}${handoff.path ? ' · ' + handoff.path : ''}`].filter(Boolean).join(' · '), 12);
  section('Worker metrics by gate', result.workerMetrics, workerMetricsLabel, 8);
  section('Hook gaps', result.sessions.filter(row => row.hookGap),
    row => [row.role, row.addr, 'hook-gap', row.hookGap.source].join(' '), Infinity);
  section('Native memory isolation', result.sessions.filter(row => row.memoryIsolation && row.memoryIsolation !== 'covered'),
    row => [row.role, row.cli, row.addr, row.memoryIsolation].join(' · '), Infinity);
  section('Waves and cards', [...result.waves, ...result.pendingContinuations, ...result.cards], row => row.members ?
    [row.wave, row.state, row.members.length + ' cards'].join(' ') : row.batch ?
      ['continuation', row.batch, row.pending.length + ' pending'].join(' ') : [row.task, row.wave, row.state].join(' '), 6);
  section('Blocked', result.blocked, row => row.reason ?? row.task ?? row.addr, 2);
  section('Drift and fact checks', result.notices, row =>
    [row.type, row.task ?? row.addr, row.misses?.map(miss => miss.value).join(', ') ??
      row.command ?? row.file ?? row.failureClass ?? row.reason ?? row.text].join(' '), 3);
  if (result.auditFindings?.length) section('Audit-only findings', result.auditFindings, row =>
    row.phase + ' · ' + Object.entries(row.byCategory).map(([category, counts]) =>
      `${category} ${counts.reviewOnly} (${counts.open} open)`).join(' · '), 6);
  if (result.routing.filtered.length) console.log(`Auditor routing · ${result.routing.filtered.length} filtered deliveries in --json`);
  section('Last merges', result.merges, row => [row.sha.slice(0, 12), row.subject].join(' '), 3);
  const extractor = result.memoryExtractor;
  if (extractor) console.log('Memory extractor · ' + extractor.calls + ' turn calls · ' + extractor.tokens + ' tokens · ' +
    extractor.stageCalls + ' stage calls · ' + extractor.stageTokens + ' stage tokens' +
    (extractor.stopReason ? ' · stopped at ' + extractor.stopReason : ''));
  if (extractor?.diagnostics) {
    const { emptyResults, filteredCandidates, queuedProposals, filterReasons } = extractor.diagnostics;
    const reasons = Object.entries(filterReasons).map(([reason, count]) => `${reason} ${count}`).join(', ');
    console.log(`  ${emptyResults} empty results · ${filteredCandidates} filtered candidates` +
      (reasons ? ` (${reasons})` : '') + ` · ${queuedProposals} queued proposals`);
  }
  console.log('Cost · ' + result.cost.rawTokens.toLocaleString() + ' recorded tokens' +
    (result.cost.missingSessions ? ' · ' + result.cost.missingSessions + ' sessions with transcript gaps' : ''));
  section('Session memory', result.memory ?? [], row => `${basename(row.project)} · ${memoryLabel(row)}`, Infinity);
  for (const [role, usage] of Object.entries(result.cost.usageByRole)) {
    const share = result.cost.rawTokens ? (100 * usage.rawTokens / result.cost.rawTokens).toFixed(1) + '%' : '—';
    console.log(`  ${role} · ${usage.modelCalls} calls · ${usage.rawTokens} raw (${share}) · ${usage.freshInputTokens} fresh input · ${usage.outputTokens} output`);
  }
  const { state, inversions } = result.cost.pyramid;
  console.log('Pyramid (1h) · ' + state + inversions.map(item => ` · ${item.higher} > ${item.lower} (${item.metric})`).join(''));
}
