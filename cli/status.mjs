import { spawnSync } from 'node:child_process';
import { readArtifacts } from './artifacts.mjs';
import { projectCost } from './cost.mjs';
import { request, daemonAbsent } from '../daemon/rpc.mjs';
import { activeOrgNotices, readOrg } from '../daemon/org.mjs';
import { readNotifications } from '../daemon/notifications.mjs';
import { isBlockedReply } from '../inbox/message.mjs';
import { managedProject, projectIndex, projectSessions } from './project.mjs';
import { pendingWork } from '../inbox/engine.mjs';
import { isStartupBlocker } from '../tui/agent-status.mjs';
import { auditorWakeFiltered } from '../daemon/routing.mjs';

export async function projectStatus(project) {
  const rows = projectSessions(project);
  let live;
  if (managedProject(project)) {
    try { live = (await request(project, 'status')).sessions; }
    catch (error) { if (!daemonAbsent(error)) throw error; }
  }
  const states = new Map((live ?? []).map(row => [row.addr, row.state]));
  const lifecycle = row => states.get(row.addr) ?? (row.endedAt == null ? 'offline' : 'exited');
  const artifacts = readArtifacts(project);
  const messages = artifacts.messages();
  const notifications = readNotifications(project);
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
  const cards = latest.map(row => {
    const turn = messages.findLast(message => message.target.addr === row.addr && message.completion?.body);
    const key = row.task + '/' + row.addr;
    const status = relay.progress?.[key]?.result?.outcome?.toLowerCase();
    const state = turn ? isBlockedReply(turn.completion.body) ? 'blocked' :
      /^\**FAILED\b/i.test(turn.completion.body.trimStart()) ? 'failed' : 'done' : status ?? lifecycle(row);
    return { task: row.task, addr: row.addr, wave: row.wave, state, lifecycle: lifecycle(row),
      active: row.endedAt == null || selected.has(key) };
  });
  const blocked = [
    ...cards.filter(card => card.state === 'blocked' || card.lifecycle === 'stuck' || isStartupBlocker(card.lifecycle))
      .map(card => ({ task: card.task, addr: card.addr,
        ...(isStartupBlocker(card.lifecycle) && { reason: card.task + ' ' + card.lifecycle }) })),
    ...rows.filter(row => row.role !== 'worker' && (lifecycle(row) === 'stuck' || isStartupBlocker(lifecycle(row))))
      .map(row => ({ addr: row.addr, reason: row.role + ' ' + lifecycle(row) })),
    ...notifications.filter(event => event.type === 'needs-decision' && event.takenAt == null)
      .map(event => ({ addr: event.addr, reason: event.text })),
  ];
  const workers = new Set(rows.filter(row => row.role === 'worker').map(row => row.addr));
  const notices = [...activeOrgNotices(readOrg(project)).map(notice => ({ ...notice, audience: 'leader' })),
    ...notifications.flatMap(event =>
      event.type === 'auditor-budget-exceeded' || event.type === 'stuck' && workers.has(event.addr) ?
        [{ ...event, audience: 'leader' }] : event.type === 'red-escalation' ? [event] : []),
  ].sort((a, b) => b.at - a.at);
  const filtered = messages.filter(message => message.issue === auditorWakeFiltered).map(message => ({
    id: message.id, target: message.target.addr, from: message.from?.addr, at: message.refusedAt ?? message.createdAt,
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
  const { byRole, rawTokens, missing, pyramid } = projectCost(project, rows, { includeAcceptance: false });
  const rotations = projectIndex(project).rotations();
  const rotating = new Set(rotations.filter(item => item.boundAt != null && item.verifiedAt == null && item.failedAt == null)
    .map(item => item.successor));
  return { ok: true, running: Boolean(live),
    sessions: rows.filter(row => row.endedAt == null).map(row => {
      const authMode = row.cli === 'claude' ? artifacts.job(row.addr)?.authMode : undefined;
      return { role: row.role, addr: row.addr, cli: row.cli, task: row.task, state: lifecycle(row),
        ...(authMode && { authMode }),
        ...(rotating.has(row.addr) && { awaitingVerifiedReport: true }) };
    }),
    waves, pendingContinuations, cards: cards.filter(card => card.active || card.state === 'blocked'),
    blocked, notices, merges, rotations, routing: { filtered },
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
  console.log('Loom · ' + safe(result.project) + (result.running ? ' · online' : ' · offline'));
  section('Roles', result.sessions, row => [row.role ?? 'unassigned', row.cli, row.state,
    row.awaitingVerifiedReport ? 'awaiting report' : row.task ?? row.addr].join(' '), 6);
  section('Waves and cards', [...result.waves, ...result.pendingContinuations, ...result.cards], row => row.members ?
    [row.wave, row.state, row.members.length + ' cards'].join(' ') : row.batch ?
      ['continuation', row.batch, row.pending.length + ' pending'].join(' ') : [row.task, row.wave, row.state].join(' '), 6);
  section('Blocked', result.blocked, row => row.reason ?? row.task ?? row.addr, 2);
  section('Drift and fact checks', result.notices, row =>
    [row.type, row.task ?? row.addr, row.misses?.map(miss => miss.value).join(', ') ??
      row.command ?? row.file ?? row.failureClass ?? row.reason ?? row.text].join(' '), 3);
  if (result.routing.filtered.length) console.log(`Auditor routing · ${result.routing.filtered.length} filtered deliveries in --json`);
  section('Last merges', result.merges, row => [row.sha.slice(0, 12), row.subject].join(' '), 3);
  console.log('Cost · ' + result.cost.rawTokens.toLocaleString() + ' recorded tokens' +
    (result.cost.missingSessions ? ' · ' + result.cost.missingSessions + ' sessions with transcript gaps' : ''));
  for (const [role, usage] of Object.entries(result.cost.usageByRole)) {
    const share = result.cost.rawTokens ? (100 * usage.rawTokens / result.cost.rawTokens).toFixed(1) + '%' : '—';
    console.log(`  ${role} · ${usage.modelCalls} calls · ${usage.rawTokens} raw (${share}) · ${usage.freshInputTokens} fresh input · ${usage.outputTokens} output`);
  }
  const { state, inversions } = result.cost.pyramid;
  console.log('Pyramid (1h) · ' + state + inversions.map(item => ` · ${item.higher} > ${item.lower} (${item.metric})`).join(''));
}
