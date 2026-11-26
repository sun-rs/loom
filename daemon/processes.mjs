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

export async function processTable(pids, run = exec) {
  const selected = pids && [...new Set(pids.filter(pid => Number.isSafeInteger(pid) && pid > 0))];
  if (selected?.length === 0) return new Map();
  let text;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      ({ stdout: text } = await run(run === exec ? processCommand() : '/bin/ps',
        selected ? ['-p', selected.join(','), '-o', fields] : ['-axo', fields], {
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
  for (const line of text.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\w{3}\s+\w{3}\s+\d+\s+[\d:]+\s+\d{4})\s+(.+)$/.exec(line);
    if (!match) continue;
    const [, pid, ppid, pgid, uid, started, executable] = match;
    rows.set(Number(pid), { pid: Number(pid), ppid: Number(ppid), pgid: Number(pgid), uid: Number(uid), started, executable });
  }
  return rows;
}

export function sameProcess(record, live) {
  return Boolean(live && live.uid === process.getuid() && record.uid === live.uid && record.pid === live.pid &&
    record.started === live.started && record.executable === live.executable);
}

export function processLiveness(identity, observed, signal = process.kill) {
  if (!Number.isSafeInteger(identity?.pid) || identity.pid <= 1 || !identity.started) return 'unknown';
  if (observed?.pid === identity.pid && observed.started) {
    if (identity.started !== observed.started ||
        (identity.uid ?? process.getuid()) !== observed.uid) return 'dead';
    if (!identity.executable || identity.executable === observed.executable) return 'alive';
  }
  try { signal(identity.pid, 0); }
  catch (error) { if (error.code === 'ESRCH') return 'dead'; }
  return 'unknown';
}

export async function inspectProcess(identity) {
  let observed;
  try { observed = (await processTable([identity?.pid])).get(identity?.pid); }
  catch (error) {
    if (!error.code?.startsWith('process-enumeration-')) throw error;
  }
  return processLiveness(identity, observed);
}

export async function rememberOarProcesses(project, before) {
  const path = oarProcessPath(project);
  const previous = readText(path, '[]');
  const live = await processTable();
  const retained = JSON.parse(previous).filter(row => processLiveness(row, live.get(row.pid)) !== 'dead');
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
