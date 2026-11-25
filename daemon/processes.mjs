import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { runtimeDirectory } from '../cli/project.mjs';
import { readText, writeState } from './io.mjs';

export const oarProcessPath = project => join(runtimeDirectory(project), 'oar-processes.json');

export function processTable() {
  const text = execFileSync('ps', ['-axo', 'pid=,ppid=,uid=,lstart=,comm='], {
    encoding: 'utf8', timeout: 3000, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C' },
  });
  const rows = new Map();
  for (const line of text.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\w{3}\s+\w{3}\s+\d+\s+[\d:]+\s+\d{4})\s+(.+)$/.exec(line);
    if (!match) continue;
    const [, pid, ppid, uid, started, executable] = match;
    rows.set(Number(pid), { pid: Number(pid), ppid: Number(ppid), uid: Number(uid), started, executable });
  }
  return rows;
}

export function sameProcess(record, live) {
  return Boolean(live && live.uid === process.getuid() && record.uid === live.uid && record.pid === live.pid &&
    record.started === live.started && record.executable === live.executable);
}

export function rememberOarProcesses(project, before) {
  const path = oarProcessPath(project);
  const previous = readText(path, '[]');
  const live = processTable();
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
