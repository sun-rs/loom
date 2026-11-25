import { spawnSync } from 'node:child_process';
import { readArtifacts } from './artifacts.mjs';
import { projectCost } from './cost.mjs';
import { request, daemonAbsent } from '../daemon/rpc.mjs';
import { readOrg } from '../daemon/org.mjs';
import { readNotifications } from '../daemon/notifications.mjs';
import { isBlockedReply } from '../inbox/message.mjs';
import { managedProject, projectIndex, projectSessions } from './project.mjs';
import { pendingWork } from '../inbox/engine.mjs';
import { isStartupBlocker } from '../tui/agent-status.mjs';

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
  const relay = artifacts.relay();
  const pendingWaves = new Set(messages.filter(message => message.waveKey &&
    ['queued', 'sending', 'stopped', 'stopping'].includes(message.phase)).map(message => message.waveKey));
  const waves = Object.entries(relay.waves ?? {}).filter(([key, wave]) => !wave.closed || pendingWaves.has(key)).map(([key, wave]) => ({
    key, wave: wave.id, parent: wave.parent, members: wave.members, deliver: wave.deliver ?? 'barrier',
    state: wave.closed ? 'queued' : wave.deliver === 'stream' ? 'streaming' : wave.deadline == null ? 'dispatching' : 'pending',
  }));
  const { pendingContinuations } = pendingWork(messages);
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
    ...readNotifications(project).filter(event => event.type === 'needs-decision' && event.takenAt == null)
      .map(event => ({ addr: event.addr, reason: event.text })),
  ];
  const notices = Object.values(readOrg(project).notices).sort((a, b) => b.at - a.at);
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
  const { byRole, rawTokens, missing } = projectCost(project, rows, { includeAcceptance: false });
  const rotations = projectIndex(project).rotations();
  const rotating = new Set(rotations.filter(item => item.boundAt != null && item.verifiedAt == null && item.failedAt == null)
    .map(item => item.successor));
  return { ok: true, running: Boolean(live),
    sessions: rows.filter(row => row.endedAt == null).map(row => ({
      role: row.role, addr: row.addr, cli: row.cli, task: row.task, state: lifecycle(row),
      ...(rotating.has(row.addr) && { awaitingVerifiedReport: true }),
    })),
    waves, pendingContinuations, cards: cards.filter(card => card.active || card.state === 'blocked'),
    blocked, notices, merges, rotations,
    cost: { rawTokens, byRole: Object.fromEntries(Object.entries(byRole).map(([role, value]) => [role, value.rawTokens])),
      missingSessions: missing.length },
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
    [row.type, row.task ?? row.addr, row.value ?? row.command ?? row.file ?? row.failureClass].join(' '), 3);
  section('Last merges', result.merges, row => [row.sha.slice(0, 12), row.subject].join(' '), 3);
  const shares = Object.entries(result.cost.byRole).map(([role, count]) =>
    role + ' ' + (result.cost.rawTokens ? (100 * count / result.cost.rawTokens).toFixed(1) + '%' : '—'));
  console.log('Cost · ' + result.cost.rawTokens.toLocaleString() + ' recorded tokens · ' + shares.join(' · ') +
    (result.cost.missingSessions ? ' · ' + result.cost.missingSessions + ' sessions with transcript gaps' : ''));
}
