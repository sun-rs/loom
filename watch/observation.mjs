import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, relative } from 'node:path';
import agy from '../adapters/agy/index.mjs';
import { stripAnsiAndControl } from '../adapters/agy/lib/classify-screen.mjs';
import claude from '../adapters/claude/index.mjs';
import codex from '../adapters/codex/index.mjs';
import opencode from '../adapters/opencode/index.mjs';

export const adapters = new Map([agy, claude, codex, opencode].map(adapter => [adapter.id, adapter]));

const hookTypes = new Set(['turn-start', 'turn-end', 'tool', 'stop-failure']);

export function hookTiming(session, rows, now) {
  const events = [];
  for (const row of rows) {
    if (!row || (row.addr != null && row.addr !== session.addr)) continue;
    const payload = row.payload ?? row;
    const native = hookTypes.has(row.type) ? row : adapters.get(session.cli).hooks.normalize(payload);
    const rawAt = row.receivedAt ?? row.at;
    const at = typeof rawAt === 'string' ? Date.parse(rawAt) : rawAt;
    const sessionId = native?.sessionId ?? row.sessionId;
    if (!native || !Number.isFinite(at) || at < (session.startedAt ?? 0) || at > now ||
        (session.sessionId && sessionId && session.sessionId !== sessionId)) continue;
    const turn = row.turn ?? row.turnId ?? payload.turn_id ?? payload.turnId ?? payload.prompt_id ?? null;
    events.push({ type: native.type, at, sessionId, turn });
  }

  let open = null;
  const closed = [];
  let startedAt = -Infinity;
  let activityAt = -Infinity;
  for (const event of events.sort((a, b) => a.at - b.at)) {
    if (event.type === 'turn-start') {
      startedAt = event.at;
      activityAt = event.at;
      if (event.turn == null || event.turn !== open?.turn || event.sessionId !== open?.sessionId) open = event;
    } else if ((!open?.sessionId || !event.sessionId || event.sessionId === open.sessionId) &&
        (open?.turn == null || event.turn == null || event.turn === open.turn)) {
      activityAt = event.at;
      if (event.type !== 'tool') {
        open = null;
        closed.push(event);
      }
    }
  }
  return { open, closed, startedAt, activityAt };
}

export function hasClosingHook(evidence, hooks) {
  const [[sessionId, turn, startedAt]] = JSON.parse(evidence);
  return hooks.closed.some(event => event.at >= startedAt &&
    (!sessionId || !event.sessionId || event.sessionId === sessionId) &&
    (turn == null || event.turn == null || event.turn === turn));
}

export function screenProgress(text) {
  const stable = stripAnsiAndControl(text)
    .replace(/^(\s*[•◦○]\s+(?:Working|Reconnecting\.{3}\s+\d+\/\d+)\s*\()(?:(?:\d+h|\d+m)\s*)*\d+(?:\.\d+)?s\b/gmi, '$1…')
    .replace(/^(\s*)[✻✳✶✢✽✺✹✸✷✴✵⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏⣾⣽⣻⣟⡿⢿⣷](?=\s)/gm, '$1◌')
    .replace(/^(\s*◌[^\n]*?\()(?:(?:\d+h|\d+m)\s*)*\d+(?:\.\d+)?s\b/gm, '$1…');
  return createHash('sha256').update(stable).digest('hex');
}

function canonical(path) {
  if (typeof path !== 'string' || !isAbsolute(path)) return null;
  try { return realpathSync(path); } catch { return null; }
}

export function trustKeys(session, terminal, text, trustedCwds) {
  if (!trustedCwds.size) return [];
  const cwd = canonical(session.cwd);
  const foregroundCwd = terminal.foreground?.cwd ?? terminal.cwd;
  if (!trustedCwds.has(cwd) || canonical(foregroundCwd) !== cwd) return [];
  const rows = stripAnsiAndControl(text).split('\n')
    .map(row => row.trim().replace(/^[│┃║]\s*|\s*[│┃║]$/g, '').trim())
    .filter(Boolean);
  const heading = session.cli === 'codex' ? 'Folder access' : 'Accessing workspace:';
  const index = rows.lastIndexOf(heading);
  const homeRelative = relative(homedir(), cwd);
  const displayedPaths = [cwd, session.cwd, foregroundCwd];
  if (homeRelative && homeRelative !== '..' && !homeRelative.startsWith('../')) displayedPaths.push(`~/${homeRelative}`);
  if (index < 0 || !displayedPaths.includes(rows[index + 1])) return [];

  // Codex and agy adapters assume the default selection. Check the actual cursor.
  if (session.cli === 'codex' && (!/^enter(?: to)? continue\s*·\s*esc (?:back|cancel)$/i.test(rows.at(-1)) ||
      !rows.slice(-5).some(row => /^[❯›]\s*1\.\s*Trust and continue$/i.test(row)))) return [];
  if (session.cli === 'agy' && (!rows.slice(-2).some(row => /^↑\/↓\s+Navigate\s*·\s*enter Confirm$/i.test(row)) ||
      !rows.slice(-5).some(row => /^[>❯›]\s*Yes, I trust this folder$/i.test(row)))) return [];
  return adapters.get(session.cli).screen.dialogKeys('trust-dialog', text);
}
