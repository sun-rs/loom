import { statSync } from 'node:fs';
import { basename, isAbsolute, resolve } from 'node:path';
import { readArtifacts } from '../cli/artifacts.mjs';
import { projectIndex, projectSessions } from '../cli/project.mjs';
import { CommandError } from '../cli/sessions.mjs';
import { deliveryFailed, isBlockedReply, replyConclusion } from '../inbox/message.mjs';
import { storedWorkerTier } from '../lib/worker-tiers.mjs';
import { createClaudeCcpBridge } from './claude-ccp.mjs';
import { listGlobalProjects, readGlobalRegistry, resolveAccountDir } from './global-registry.mjs';
import { herdrProjects } from './herdr-layout.mjs';
import { readNotifications } from './notifications.mjs';
import { nativeResumeCapability } from './resume-capabilities.mjs';
import { daemonAbsent, request } from './rpc.mjs';

const roleOrder = { auditor: 0, leader: 1, worker: 2 };
const exists = path => statSync(path, { throwIfNoEntry: false });

export function requireSuperCaller(env = process.env, project) {
  const addr = env.LOOM_ADDR;
  const capability = env.LOOM_CAPABILITY;
  if (addr || capability !== undefined) {
    if (typeof capability === 'string' && capability.startsWith('external-super.')) return { role: 'super', external: true };
    const scope = env.LOOM_PROJECT || project;
    if (addr && scope && isAbsolute(scope) && exists(scope)?.isDirectory()) {
      const row = projectSessions(scope).find(item => item.addr === addr && item.endedAt === null);
      if (row?.role === 'super') return { role: 'super', addr: row.addr, external: false };
    }
    throw new CommandError('forbidden', 'loom recover is Super-only');
  }
  if (env.LOOM_EXTERNAL_SUPER === '1') return { role: 'super', external: true };
  if (env.HC_TERMINAL_ID) {
    try {
      const registered = readGlobalRegistry(env).super?.hcAddress;
      if (registered && registered === env.HC_TERMINAL_ID) return { role: 'super', external: true, hcAddress: registered };
    } catch { /* Fall through to forbidden. */ }
  }
  throw new CommandError('forbidden', 'loom recover is Super-only; run from Super or set LOOM_EXTERNAL_SUPER=1');
}

function workerSettled(row, job, messages) {
  if (job?.closed) return true;
  if (row.endedAt == null || job?.exit) return false;
  const incoming = messages.filter(message => message.target?.addr === row.addr);
  const final = incoming.findLast(message => message.completion?.body && !message.completion.unconfirmed);
  if (!final) return false;
  const { tag } = replyConclusion(final.completion.body);
  if (isBlockedReply(final.completion.body) || tag === 'FAILED' || tag !== 'DONE') return false;
  return messages.some(message => message.received && !deliveryFailed(message) &&
    ((message.resultWorkers ?? []).includes(row.addr) || message.from?.addr === row.addr ||
      message.replyTo === final.id || (message.continuationMembers ?? []).includes(final.id)));
}

function lastActivity(row, journal, incoming) {
  let latest = row.startedAt ?? 0;
  for (const event of journal) {
    const at = event.at ?? event.receivedAt ?? 0;
    if (Number.isFinite(at) && at > latest) latest = at;
  }
  for (const message of incoming) {
    for (const at of [message.createdAt, message.received?.at, message.completion?.at]) {
      if (Number.isFinite(at) && at > latest) latest = at;
    }
  }
  if (Number.isFinite(row.endedAt) && row.endedAt > latest) latest = row.endedAt;
  return latest || null;
}

function pendingCount(row, job, incoming, journal) {
  const hadTurns = journal.some(event => ['turn-start', 'turn-end', 'input-received'].includes(event.type) ||
    ['UserPromptSubmit', 'Stop', 'PreInvocation'].includes(event.hook_event_name));
  return incoming.filter(message => {
    if (message.received) return false;
    if (message.id === job?.firstId && hadTurns) return false;
    if (['queued', 'sending', 'stopping', 'stopped', 'target-ended'].includes(message.phase)) return true;
    return message.phase === 'refused' && message.issue === 'target-exited';
  }).length;
}

function exitReasonFor(row, job, daemonRunning) {
  if (!daemonRunning && row.endedAt === null) return 'daemon-offline';
  if (job?.exit?.reason) return job.exit.reason;
  if (job?.retention?.releasedAt != null) return `released (${job.retention.releasedBy ?? 'idle'})`;
  if (job?.stopping) return 'stopped';
  if (row.endedAt !== null) return 'exited';
  return 'offline';
}

export async function recoverProject(project, { env = process.env, checkDaemon, liveStatus, ccpBridge = createClaudeCcpBridge() } = {}) {
  const directory = resolve(project);
  if (!exists(directory)?.isDirectory()) {
    return { project: directory, missing: true, daemonRunning: false, sessions: [] };
  }
  let daemonRunning = false;
  let live = liveStatus;
  if (live !== undefined) {
    daemonRunning = true;
  } else if (checkDaemon) {
    const probed = await checkDaemon(directory);
    daemonRunning = Boolean(probed);
    live = typeof probed === 'object' && probed !== null ? probed : undefined;
  } else {
    try {
      live = await request(directory, 'status', {}, { timeout: 2_000 });
      daemonRunning = true;
    } catch (error) {
      if (!daemonAbsent(error)) throw error;
    }
  }

  const rows = projectSessions(directory);
  const rotations = projectIndex(directory).rotations();
  const artifacts = readArtifacts(directory);
  const messages = artifacts.messages();
  const notifications = readNotifications(directory);
  const incomingByAddr = Map.groupBy(messages, message => message.target?.addr);
  const liveStates = new Map((live?.sessions ?? []).map(item => [item.addr, item]));
  const isLive = row => {
    if (!daemonRunning || row.endedAt !== null) return false;
    const observed = liveStates.get(row.addr);
    if (!observed) return false;
    return !['exited', 'offline', 'closed'].includes(observed.state);
  };
  const replaced = new Set(rotations.filter(item => item.boundAt != null && item.failedAt == null).map(item => item.predecessor));
  const fullCompletions = notifications.filter(event => event.type === 'project-completed' && event.phase === undefined);

  const candidates = [];

  for (const role of ['auditor', 'leader']) {
    const roleRows = rows.filter(row => row.role === role);
    if (!roleRows.length) continue;
    const byProject = Map.groupBy(roleRows, row => row.project);
    for (const [name, list] of byProject) {
      if (list.some(isLive)) continue;
      const eligible = list.filter(row => !replaced.has(row.addr) && !artifacts.job(row.addr)?.handoverFailure);
      const latest = eligible.at(-1);
      if (!latest) continue;
      const job = artifacts.job(latest.addr);
      const incoming = incomingByAddr.get(latest.addr) ?? [];
      const journal = artifacts.journal(latest.addr);
      const pending = pendingCount(latest, job, incoming, journal);
      const completedAfter = fullCompletions.some(event => event.project === name && event.at >= (latest.startedAt ?? 0));
      if (completedAfter && latest.endedAt !== null && !job?.exit && pending === 0) continue;
      candidates.push({ row: latest, job, incoming, journal, pending });
    }
  }

  const workers = rows.filter(row => row.role === 'worker');
  const latestWorkerByTask = new Map();
  for (const row of workers) {
    const key = JSON.stringify([row.project, row.task]);
    const prior = latestWorkerByTask.get(key);
    if (!prior || (row.startedAt ?? 0) >= (prior.startedAt ?? 0)) latestWorkerByTask.set(key, row);
  }
  for (const row of latestWorkerByTask.values()) {
    if (isLive(row)) continue;
    const job = artifacts.job(row.addr);
    if (job?.closed) continue;
    if (workerSettled(row, job, messages)) continue;
    const incoming = incomingByAddr.get(row.addr) ?? [];
    const journal = artifacts.journal(row.addr);
    const pending = pendingCount(row, job, incoming, journal);
    candidates.push({ row, job, incoming, journal, pending });
  }

  candidates.sort((a, b) => (roleOrder[a.row.role] ?? 9) - (roleOrder[b.row.role] ?? 9) ||
    (a.row.startedAt ?? 0) - (b.row.startedAt ?? 0) || a.row.addr.localeCompare(b.row.addr, 'en'));

  const sessions = candidates.map(({ row, job, incoming, journal, pending }) => ({
    addr: row.addr,
    role: row.role,
    backend: row.backend,
    cli: row.cli,
    model: row.model,
    effort: row.effort,
    sessionId: row.sessionId ?? null,
    lastActivityAt: lastActivity(row, journal, incoming),
    exitReason: exitReasonFor(row, job, daemonRunning),
    pendingDeliveries: pending,
    task: row.task ?? null,
    wave: row.wave ?? null,
    worktree: row.cwd ?? directory,
    ...(row.role === 'worker' && {
      workerTier: storedWorkerTier(job),
      hasHostGrant: Boolean(job?.hostGrant),
    }),
    accountDir: job?.accountDir ?? resolveAccountDir(row.cli, env),
    nativeResume: nativeResumeCapability({
      cli: row.cli, backend: row.backend, sessionId: row.sessionId,
      cliVersion: job?.cliVersion, ccpBridge, project: directory, row, job,
    }),
  }));

  return { project: directory, daemonRunning, sessions };
}

export async function recoverAllProjects({ env = process.env, checkDaemon, ccpBridge = createClaudeCcpBridge() } = {}) {
  const registered = listGlobalProjects(env).map(item => item.dir);
  const layoutProjects = herdrProjects(env);
  const dirs = [...new Set([...registered, ...layoutProjects])].sort((a, b) => a.localeCompare(b, 'en'));
  const projects = [];
  for (const dir of dirs) {
    projects.push(await recoverProject(dir, { env, checkDaemon, ccpBridge }));
  }
  const totalUnrecovered = projects.reduce((sum, item) => sum + item.sessions.length, 0);
  return { ok: true, projects, totalUnrecovered };
}

export function formatRecoverText(report) {
  const projects = report.projects ?? [report];
  if (!projects.length) return '无已登记项目。';
  const lines = [];
  for (const project of projects) {
    const status = project.missing ? 'missing' : project.daemonRunning ? 'loomd online' : 'loomd offline';
    lines.push(`${basename(project.project)} (${project.project}) · ${status} · 待恢复 ${project.sessions.length}`);
    if (!project.sessions.length) {
      lines.push('  无应在而不在的会话');
      continue;
    }
    for (const item of project.sessions) {
      const activity = item.lastActivityAt ? new Date(item.lastActivityAt).toISOString() : 'unknown';
      const resumeText = item.nativeResume.supported
        ? `可原生续接 (${item.nativeResume.resumeCommand})`
        : `不可原生续接 (${item.nativeResume.reason}; 新开: ${item.nativeResume.freshCommand})`;
      const card = item.task ? ` task=${item.task}${item.wave ? '/' + item.wave : ''}` : '';
      lines.push(`  [${item.role}] ${item.addr}${card} · ${item.cli}/${item.model ?? '?'} · sid=${item.sessionId ?? 'none'} · last=${activity} · reason=${item.exitReason} · pending=${item.pendingDeliveries} · cwd=${item.worktree} · ${resumeText}`);
    }
  }
  return lines.join('\n');
}
