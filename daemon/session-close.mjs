import { setTimeout as delay } from 'node:timers/promises';
import { processTable, sameProcess } from './processes.mjs';

export async function withDeadline(operation, timeoutMs, message, code) {
  let timer;
  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error(message), { code })), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function disposeSession(session, timeoutMs = 8_000) {
  return withDeadline(Promise.resolve().then(() => session.dispose()), timeoutMs, 'OAR session disposal timed out', 'close-timeout');
}

export async function ownedHostChildren(owner, previous = new Map()) {
  const table = await processTable();
  if (owner.pid <= 1 || owner.pgid !== owner.pid || !sameProcess(owner, table.get(owner.pid))) {
    throw new Error('OAR host process group identity changed');
  }
  const owned = new Map();
  for (const row of table.values()) {
    if (row.pid !== owner.pid && row.uid === owner.uid &&
        (row.pgid === owner.pgid || sameProcess(previous.get(row.pid) ?? {}, row))) owned.set(row.pid, row);
  }
  // ACP terminal handles can have their own process groups.
  const byParent = Map.groupBy(table.values(), row => row.ppid);
  const pending = [owner.pid, ...owned.keys()];
  for (const pid of pending) {
    for (const row of byParent.get(pid) ?? []) {
      if (row.uid !== owner.uid || owned.has(row.pid)) continue;
      owned.set(row.pid, row);
      pending.push(row.pid);
    }
  }
  return owned;
}

export async function closeHostChildren(owner, previous) {
  const signal = (children, name) => {
    for (const { pid } of children.values()) {
      try { process.kill(pid, name); }
      catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
  };
  const children = await ownedHostChildren(owner, previous);
  if (!children.size) return;
  signal(children, 'SIGTERM');
  await delay(800);
  signal(await ownedHostChildren(owner, children), 'SIGKILL');
}
