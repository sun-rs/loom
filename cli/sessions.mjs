import { execFile } from 'node:child_process';
import { closeSync, constants, fstatSync, openSync, readFileSync, realpathSync } from 'node:fs';
import { promisify } from 'node:util';
import agy from '../adapters/agy/index.mjs';
import claude from '../adapters/claude/index.mjs';
import codex from '../adapters/codex/index.mjs';
import opencode from '../adapters/opencode/index.mjs';
import { protectedPath } from './artifacts.mjs';

const adapters = new Map([agy, claude, codex, opencode].map(adapter => [adapter.id, adapter]));
const run = promisify(execFile);
const blocked = new Map([['trust-dialog', 'trust'], ['picker', 'picker'], ['rate-limit', 'rate-limit'], ['auth-fail', 'auth']]);

export class CommandError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function sameRole(first, second) {
  return second && first.project === second.project && first.role !== null && first.role === second.role &&
    (first.role !== 'worker' || first.task === second.task);
}

function lineage(session, byAddr, ordered = new Set()) {
  const chain = [];
  const seen = new Set();
  for (let row = session; row && !ordered.has(row.addr);) {
    if (seen.has(row.addr)) throw new CommandError('unavailable', `Cycle in session parents at ${row.addr}`);
    seen.add(row.addr);
    chain.push(row);
    const parent = byAddr.get(row.parent);
    row = sameRole(session, parent) ? parent : undefined;
  }
  return chain.reverse();
}

export function predecessors(session, sessions) {
  return lineage(session, new Map(sessions.map(row => [row.addr, row])));
}

export function parentOrder(sessions) {
  const byAddr = new Map(sessions.map(row => [row.addr, row]));
  const ordered = new Set();
  for (const session of sessions) {
    for (const row of lineage(session, byAddr, ordered)) ordered.add(row.addr);
  }
  return Array.from(ordered, addr => byAddr.get(addr));
}

export function resolveTarget(sessions, target, callerAddr) {
  const exact = sessions.find(row => row.addr === target);
  if (exact) return exact;
  const pane = sessions.find(row => row.pane === target);
  if (pane) return pane;
  const caller = sessions.find(row => row.addr === callerAddr || row.pane === callerAddr);
  const matches = sessions.filter(row => (!caller || row.project === caller.project) &&
    (target === row.role || target === row.task));
  if (!matches.length) throw new CommandError('not-found', `No session matches ${target}`);
  if (matches.length === 1) return matches[0];

  const byAddr = new Map(matches.map(row => [row.addr, row]));
  const parents = new Set(matches.filter(row => sameRole(row, byAddr.get(row.parent))).map(row => row.parent));
  const tips = matches.filter(row => !parents.has(row.addr));
  if (tips.length === 1) {
    const chain = new Set(predecessors(tips[0], sessions).map(row => row.addr));
    if (matches.every(row => chain.has(row.addr))) return tips[0];
  }
  throw new CommandError('ambiguous-target', `Multiple sessions match ${target}: ${matches.map(row => row.addr).join(', ')}`);
}

export function adapterFor(session) {
  const adapter = adapters.get(session.cli);
  if (!adapter) throw new CommandError('unsupported', `No adapter for ${session.cli ?? 'unknown CLI'} at ${session.addr}`);
  return adapter;
}

export function transcriptFor(session) {
  if (!session.transcriptPath) throw new CommandError('not-ready', `No transcript is bound to ${session.addr}`);
  if (protectedPath.test(session.transcriptPath)) throw new CommandError('unavailable', `Invalid transcript path for ${session.addr}`);
  const path = realpathSync(session.transcriptPath);
  if (!/\.jsonl$/i.test(path) || protectedPath.test(path) || protectedPath.test(session.transcriptPath)) {
    throw new CommandError('unavailable', `Invalid transcript path for ${session.addr}`);
  }
  return path;
}

export function readTranscript(path) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    if (!fstatSync(fd).isFile()) throw new Error('Transcript is not a regular file');
    return readFileSync(fd, 'utf8');
  } finally {
    closeSync(fd);
  }
}

export async function readState(session) {
  if (session.endedAt !== null) return { state: 'exited', deliveries: [] };
  if (session.backend === 'headless') throw new CommandError('unsupported', 'Headless state is not connected to the runtime');
  const adapter = adapterFor(session);
  const { stdout } = await run(process.env.LOOM_HC_BIN ?? 'hc', ['read', '--json', '--', session.addr], { timeout: 5000 });
  const { text } = JSON.parse(stdout);
  if (typeof text !== 'string') throw new Error(`No screen returned for ${session.addr}`);
  const screen = adapter.screen.classify(text);
  const reason = blocked.get(screen);
  return { state: reason ? 'stuck' : screen, ...(reason ? { reason } : {}), deliveries: [] };
}

export { activitySummary, turnActivityFacts } from '../lib/activity-digest.mjs';
