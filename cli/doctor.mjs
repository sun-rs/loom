import { execFileSync } from 'node:child_process';
import { lstatSync, readdirSync, realpathSync, rmdirSync, unlinkSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { readArtifacts, projectText } from './artifacts.mjs';
import { inDirectory, projectSessions, runtimeDirectory, socketPath } from './project.mjs';
import { daemonAbsent, request } from '../daemon/rpc.mjs';
import { hc } from '../inbox/tui.mjs';
import { receipt } from '../inbox/engine.mjs';
import { ownedPane } from '../daemon/tui.mjs';
import { processTable, sameProcess } from '../daemon/processes.mjs';
import { claimProject } from '../relay/lock.mjs';

const knownDirs = [['loomd'], ['loomd', 'sessions'], ['relay'], ['relay', 'events'],
  ['inbox'], ['inbox', 'incoming'], ['evidence'], ['replies', '.turns'], ['watch']];
const temporaryFile = /\.(?:\d+|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})\.tmp$/;
const ownerToken = /^(\d+)-\.lock-[A-Za-z0-9]+$/;
const isDir = path => lstatSync(path, { throwIfNoEntry: false })?.isDirectory();
const impliesOwnership = job => job?.row && /^(?:loom|oar)-[a-f0-9-]{36}$/.test(job.row.addr);

function verifyDir(path, optional = false) {
  if (!lstatSync(path, { throwIfNoEntry: false }) && optional) return false;
  if (!isDir(path) || realpathSync(path) !== path) throw new Error(`Unsafe project directory: ${path}`);
  return true;
}

function livePid(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  try { process.kill(pid, 0); return true; }
  catch (error) {
    if (error.code === 'ESRCH') return false;
    if (error.code === 'EPERM') return true;
    throw error;
  }
}

function lockState(project) {
  const path = join(project, '.project', 'relay', 'lock');
  const node = lstatSync(path, { throwIfNoEntry: false });
  if (!node) return null;
  let pid;
  if (node.isDirectory()) {
    const names = readdirSync(path);
    if (!names.length) return { path, pid: null, state: 'stale' };
    if (names.length === 1) pid = Number(ownerToken.exec(names[0])?.[1]);
  } else if (node.isFile()) {
    const text = projectText(project, 'relay', 'lock')?.trim();
    if (/^[1-9]\d*$/.test(text ?? '')) pid = Number(text);
  }
  const live = livePid(pid);
  return { path, pid: Number.isSafeInteger(pid) ? pid : null, state: live === null ? 'unknown' : live ? 'held' : 'stale' };
}

function git(cwd, ...args) {
  return execFileSync('git', ['--no-optional-locks', ...args], {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000, maxBuffer: 4 * 1024 * 1024,
  });
}

function worktrees(project, jobs, sessions) {
  let list;
  try { list = git(project, 'worktree', 'list', '--porcelain', '-z'); }
  catch { return []; }
  return list.split('\0\0').filter(Boolean).flatMap(record => {
    const [name, ...flags] = record.split('\0');
    const path = name.replace(/^worktree /, '');
    if (path === project || !inDirectory(project, path)) return [];
    const related = sessions.filter(row => inDirectory(path, row.cwd));
    if (!jobs.some(job => inDirectory(path, job.row.cwd)) && !related.length) {
      return [{ path, state: 'ownership-unverified', cleanable: false }];
    }
    if (related.some(row => row.endedAt === null)) return [{ path, state: 'in-use', cleanable: false }];
    if (flags.some(flag => /^(?:locked|prunable)\b/.test(flag))) return [{ path, state: 'locked-or-missing', cleanable: false }];
    try {
      verifyDir(path);
      if (git(path, 'status', '--porcelain=v1', '--ignored', '--untracked-files=all', '-z')) {
        return [{ path, state: 'dirty-or-ignored-files', cleanable: false }];
      }
      if (flags.includes('detached')) {
        try { git(project, 'merge-base', '--is-ancestor', flags.find(flag => flag.startsWith('HEAD '))?.slice(5) ?? 'invalid', 'HEAD'); }
        catch { return [{ path, state: 'detached-with-unmerged-commits', cleanable: false }]; }
      }
      return [{ path, state: 'clean', cleanable: true }];
    } catch { return [{ path, state: 'unavailable', cleanable: false }]; }
  });
}

async function inspect(project) {
  const privateDir = join(project, '.project');
  const hasMetadata = verifyDir(privateDir, true);
  if (hasMetadata) {
    verifyDir(join(privateDir, 'relay'), true);
    verifyDir(join(privateDir, 'loomd'), true);
    verifyDir(join(privateDir, 'loomd', 'sessions'), true);
  }
  const artifacts = readArtifacts(project);
  const sessions = projectSessions(project, true);
  const sessionDir = join(runtimeDirectory(project), 'sessions');
  const jobs = !isDir(sessionDir) ? [] : readdirSync(sessionDir)
    .filter(name => /^(?:loom|oar)-[a-f0-9-]{36}\.json$/.test(name))
    .map(name => artifacts.job(name.slice(0, -5)))
    .filter(job => impliesOwnership(job) && inDirectory(project, job.row.cwd));
  const status = await request(project, 'daemon-status').catch(error => {
    if (!daemonAbsent(error)) throw error;
    return { running: false };
  });
  const panes = [];
  for (const job of jobs.filter(job => job.row.backend === 'tui')) {
    const row = sessions.find(item => item.addr === job.row.addr) ?? job.row;
    try {
      const terminal = await ownedPane(job, row);
      if (!terminal) continue;
      const residual = row.endedAt != null || job.stopping;
      panes.push({ addr: row.addr, pane: terminal.address, pid: terminal.pid,
        state: terminal.state, residual: Boolean(residual), cleanable: Boolean(residual && job.paneBinding) });
    } catch (error) {
      panes.push({ addr: row.addr, pane: row.pane ?? null, state: 'unavailable', message: error.message, cleanable: false });
    }
  }

  const ledger = JSON.parse(projectText(project, 'loomd', 'oar-processes.json') ?? '[]');
  const processes = ledger.length ? processTable() : new Map();
  const oarChildren = ledger.filter(row => sameProcess(row, processes.get(row.pid))).map(row =>
    ({ ...row, residual: !status.running || status.pid !== row.daemonPid }));
  const temporary = knownDirs.flatMap(parts => {
    const dir = join(privateDir, ...parts);
    return !verifyDir(dir, true) ? [] : readdirSync(dir, { withFileTypes: true })
      .filter(file => file.isFile() && temporaryFile.test(file.name)).map(file => ({ path: join(dir, file.name) }));
  });
  const staging = join(privateDir, 'relay');
  if (isDir(staging)) for (const item of readdirSync(staging, { withFileTypes: true })) {
    if (!item.isDirectory() || !/^\.lock-[A-Za-z0-9]+$/.test(item.name)) continue;
    const path = join(staging, item.name);
    const [token, extra] = readdirSync(path);
    const pid = Number(ownerToken.exec(token ?? '')?.[1]);
    if (!extra && token?.endsWith(`-${item.name}`) && livePid(pid) === false) temporary.push({ path, token });
  }

  for (const job of jobs) {
    const owned = job.temporary;
    if (!owned || typeof owned.path !== 'string' || !/^loom-agy-hooks-[A-Za-z0-9]+$/.test(basename(owned.path)) ||
        ![join(privateDir, 'relay', 'events'), realpathSync(tmpdir())].includes(dirname(owned.path))) continue;
    const node = lstatSync(owned.path, { throwIfNoEntry: false });
    if (!node?.isDirectory() || node.dev !== owned.dev || node.ino !== owned.ino || realpathSync(owned.path) !== owned.path) continue;
    const row = sessions.find(row => row.addr === job.row.addr);
    temporary.push({ ...owned, kind: 'agy-hook-workspace', addr: job.row.addr,
      retained: !(job.stopping || row?.endedAt != null) || panes.some(item => item.addr === job.row.addr && item.state !== 'finished') });
  }

  const lock = lockState(project);
  const socket = lstatSync(socketPath(project), { throwIfNoEntry: false })?.isSocket() && !status.running ? socketPath(project) : null;
  const uncertain = artifacts.messages().filter(message => receipt(message).deliveryStatus === 'uncertain')
    .map(message => ({ id: message.id, target: message.target?.addr, issue: message.issue }));
  const state = artifacts.relay();
  const unsealedWaves = Object.values(state.waves ?? {}).filter(wave => wave.managed && !wave.closed && wave.deadline == null)
    .map(({ id, parent, sealDeadline, members }) => ({ wave: id, parent, sealDeadline, members }));
  for (const job of jobs.filter(job => job.row.role === 'worker' && job.row.wave)) {
    const row = job.row;
    const key = `wave:${row.parent ?? ''}/${encodeURIComponent(row.project)}/${row.wave}`;
    if (state.waves?.[key]) continue;
    let wave = unsealedWaves.find(item => item.wave === row.wave && item.parent === row.parent);
    if (!wave) unsealedWaves.push(wave = { wave: row.wave, parent: row.parent, members: [] });
    wave.members.push(`${row.task}/${row.addr}`);
  }
  return { report: { daemon: { running: status.running, pid: status.pid ?? null }, lock, socket, panes, oarChildren,
    temporary, worktrees: worktrees(project, jobs, sessions), uncertain, unsealedWaves }, jobs, sessions };
}

export async function doctor(project, fix) {
  const { report, jobs, sessions } = await inspect(project);
  const output = { ok: true, report, fixed: [], skipped: [] };
  if (!fix) return output;
  if (report.daemon.running || report.lock && report.lock.state !== 'stale') {
    output.skipped.push({ reason: 'Project writer may still be active' });
    return output;
  }
  const needed = report.lock || report.socket || report.temporary.some(item => !item.retained) || report.oarChildren.length ||
    report.panes.some(item => item.cleanable) || report.worktrees.some(item => item.cleanable);
  if (!needed) return output;
  let release;
  try { release = claimProject(project); }
  catch (error) {
    output.skipped.push({ reason: error.message });
    return output;
  }
  async function clean(kind, resource, action) {
    try {
      await action();
      output.fixed.push({ kind, resource });
    } catch (error) {
      output.skipped.push({ kind, resource, reason: error.message });
    }
  }
  try {
    if (report.lock) output.fixed.push({ kind: 'stale-lock', resource: report.lock.path });
    if (report.socket) await clean('socket', report.socket, () => {
      if (lstatSync(report.socket).isSocket()) unlinkSync(report.socket);
    });
    for (const item of report.temporary.filter(item => !item.retained)) await clean('temporary', item.path, () => {
      if (item.kind === 'agy-hook-workspace') {
        verifyDir(item.path);
        const { dev, ino } = lstatSync(item.path);
        if (dev !== item.dev || ino !== item.ino) throw new Error('Temporary workspace identity changed');
        const agents = join(item.path, '.agents');
        const hooks = join(agents, 'hooks.json');
        verifyDir(agents);
        if (readdirSync(item.path).some(name => name !== '.agents') ||
            readdirSync(agents).some(name => name !== 'hooks.json') || !lstatSync(hooks).isFile()) {
          throw new Error('Temporary workspace has unexpected files');
        }
        unlinkSync(hooks);
        rmdirSync(agents);
        rmdirSync(item.path);
      } else if (item.token) { unlinkSync(join(item.path, item.token)); rmdirSync(item.path); }
      else unlinkSync(item.path);
    });
    for (const item of report.panes.filter(item => item.cleanable)) {
      await clean('hc-pane', item.pane, async () => {
        const row = sessions.find(row => row.addr === item.addr) ?? jobs.find(job => job.row.addr === item.addr).row;
        const job = jobs.find(job => job.row.addr === item.addr);
        let live = await ownedPane(job, row);
        if (!live) return;
        if (live.state !== 'finished') {
          await hc('kill', live.address);
          live = await ownedPane(job, row);
        }
        if (live?.state === 'finished') await hc('rm', live.address);
        else if (live) throw new Error('hc has yet to confirm exit');
      });
    }
    for (const row of [...report.oarChildren].reverse()) {
      await clean('oar-child-sigterm', row.pid, () => {
        if (sameProcess(row, processTable().get(row.pid))) process.kill(row.pid, 'SIGTERM');
      });
    }
    if (report.oarChildren.length) {
      for (let attempt = 0; attempt < 5; attempt++) {
        const processes = processTable();
        if (!report.oarChildren.some(row => sameProcess(row, processes.get(row.pid)))) break;
        await delay(100);
      }
    }
    const hasWorktrees = report.worktrees.some(item => item.cleanable);
    const after = hasWorktrees ? (await inspect(project)).report : null;
    if (after && !after.oarChildren.length &&
        !after.panes.some(item => item.state === 'unavailable' || item.state !== 'finished')) {
      for (const { path } of after.worktrees.filter(item => item.cleanable)) {
        await clean('worktree', path, () => {
          if (!worktrees(project, jobs, sessions).some(item => item.path === path && item.cleanable)) {
            throw new Error('Worktree is no longer clean and idle');
          }
          git(project, 'worktree', 'remove', '--', path);
        });
      }
    } else if (report.worktrees.some(item => item.cleanable)) {
      output.skipped.push({ reason: 'Worktree cleanup requires confirmed process exit' });
    }
  } finally {
    release();
    try { rmdirSync(join(project, '.project', 'relay', 'lock')); }
    catch (error) { if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error; }
  }
  output.remaining = (await inspect(project)).report;
  return output;
}
