import { execFile, execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { runtimeDirectory } from '../cli/project.mjs';
import { readText, writeState } from './io.mjs';

export const oarProcessPath = project => join(runtimeDirectory(project), 'oar-processes.json');

const exec = promisify(execFile);
const fields = 'pid=,ppid=,pgid=,uid=,lstart=,comm=';
let macPs;

export function processCommand() {
  if (process.env.LOOM_TEST_PS) return process.env.LOOM_TEST_PS;
  if (process.platform !== 'darwin') return '/bin/ps';
  if (macPs) return macPs;
  const probe = spawnSync('/bin/ps', ['-p', String(process.pid), '-o', 'pid='], { timeout: 2000 });
  if (probe.error?.code !== 'EPERM') return macPs = '/bin/ps';
  // Seatbelt prevents exec of the system setuid binary. Run the same
  // executable signed locally, with ordinary privileges and no entitlements.
  const dir = mkdtempSync(join(tmpdir(), 'loom-ps-'));
  const cleanup = () => rmSync(dir, { recursive: true, force: true });
  try {
    const copy = join(dir, 'ps');
    copyFileSync('/bin/ps', copy);
    chmodSync(copy, 0o500);
    execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', copy], { stdio: 'pipe', timeout: 3000 });
    process.once('exit', cleanup);
    return macPs = copy;
  } catch (error) {
    cleanup();
    throw Object.assign(new Error('Unprivileged process enumeration unavailable in this sandbox', { cause: error }),
      { code: 'process-enumeration-sandbox-limited' });
  }
}

export async function processTable(pids, run = exec, { rss = false } = {}) {
  const selected = pids && [...new Set(pids.filter(pid => Number.isSafeInteger(pid) && pid > 0))];
  if (selected?.length === 0) return new Map();
  let text;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const format = rss ? 'rss=,' + fields : fields;
      ({ stdout: text } = await run(run === exec ? processCommand() : '/bin/ps',
        selected ? ['-p', selected.join(','), '-o', format] : ['-axo', format], {
        encoding: 'utf8', timeout: 2000, killSignal: 'SIGKILL',
        maxBuffer: 4 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C' },
      }));
      break;
    } catch (error) {
      if (error.code === 'process-enumeration-sandbox-limited') throw error;
      if (selected && error.code === 1 && !error.stdout?.trim() && !error.stderr?.trim()) return new Map();
      const transient = error.killed || ['ETIMEDOUT', 'EAGAIN', 'EINTR', 'ENOMEM'].includes(error.code);
      if (!transient || attempt === 2) {
        throw Object.assign(new Error(`Process enumeration ${transient ? 'temporarily unavailable; retry the operation' :
          'failed'} (${error.code ?? error.signal ?? 'ps'})`, { cause: error }),
        { code: transient ? 'process-enumeration-retry' : 'process-enumeration-failed' });
      }
      await delay(50 * (attempt + 1));
    }
  }
  const rows = new Map();
  for (let line of text.split('\n')) {
    const resident = rss && /^\s*(\d+)\s+/.exec(line);
    if (rss && !resident) continue;
    if (resident) line = line.slice(resident[0].length);
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\w{3}\s+\w{3}\s+\d+\s+[\d:]+\s+\d{4})\s+(.+)$/.exec(line);
    if (!match) continue;
    const [, pid, ppid, pgid, uid, started, executable] = match;
    rows.set(Number(pid), { pid: Number(pid), ppid: Number(ppid), pgid: Number(pgid), uid: Number(uid), started, executable,
      ...(resident && { rssKiB: Number(resident[1]) }) });
  }
  return rows;
}

export function sameProcess(record, live) {
  return Boolean(live && live.uid === process.getuid() && record.uid === live.uid && record.pid === live.pid &&
    record.started === live.started && record.executable === live.executable);
}

export async function projectSessionMemory(project, sessions, read = () => processTable(undefined, undefined, { rss: true })) {
  const scopes = Map.groupBy(sessions, session => session.project);
  if (!scopes.size) scopes.set(project, []);
  const table = sessions.some(session => session.root) ? await read().catch(() => new Map()) : new Map();
  const children = Map.groupBy(table.values(), row => row.ppid);
  const groups = Map.groupBy(table.values(), row => row.pgid);
  return [...scopes].map(([project, entries]) => {
    const seen = new Set();
    let rssKiB = 0;
    let measuredSessions = 0;
    let unavailableSessions = 0;
    for (const { root, dormant } of entries) {
      if (dormant) continue;
      const live = table.get(root?.pid);
      const identity = root?.identity;
      if (!live || live.uid !== process.getuid() || identity &&
          (identity.executable ? !sameProcess(identity, live) : live.started !== identity.started)) {
        unavailableSessions++;
        continue;
      }
      measuredSessions++;
      const pending = root.detached && live.pgid === live.pid ? [...groups.get(live.pgid)] : [live];
      for (const row of pending) {
        if (seen.has(row.pid) || row.uid !== live.uid) continue;
        seen.add(row.pid);
        rssKiB += row.rssKiB;
        pending.push(...children.get(row.pid) ?? []);
      }
    }
    return { project, rssKiB: unavailableSessions && !measuredSessions ? null : rssKiB, measuredSessions, unavailableSessions };
  });
}

export async function rememberOarProcesses(project, before) {
  const path = oarProcessPath(project);
  const previous = readText(path, '[]');
  const live = await processTable();
  const retained = JSON.parse(previous).filter(row => sameProcess(row, live.get(row.pid)));
  const candidates = new Map(retained.map(row => [row.pid, row]));
  if (before) {
    for (const row of live.values()) {
      if (row.uid === process.getuid() && row.ppid === process.pid && !before.has(row.pid) &&
          !/(?:^|[\\/])(?:ps|hc|herdr(?:-core)?)$/.test(row.executable)) {
        candidates.set(row.pid, { ...row, daemonPid: process.pid });
      }
    }
  }
  for (const parent of candidates.values()) {
    if (parent.daemonPid !== process.pid) continue;
    for (const row of live.values()) {
      if (row.ppid === parent.pid && row.uid === parent.uid && !candidates.has(row.pid)) {
        candidates.set(row.pid, { ...row, daemonPid: process.pid });
      }
    }
  }
  const updated = JSON.stringify([...candidates.values()]) + '\n';
  if (updated !== previous && (retained.length || candidates.size || previous !== '[]')) writeState(path, updated);
}
