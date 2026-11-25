import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join } from 'node:path';
import agy from '../adapters/agy/index.mjs';
import claude from '../adapters/claude/index.mjs';
import codex from '../adapters/codex/index.mjs';

export const roles = Object.freeze(['super', 'leader', 'auditor']);
const adapters = new Map([agy, claude, codex].map(adapter => [adapter.id, adapter]));
const runtimeIds = new Map([['claude-tui', 'claude'], ['antigravity', 'agy']]);
const protectedPath = /(?:^|[/\\])(?:provider-homes|memories[^/\\]*|\.env[^/\\]*|(?:auth|\.?credentials|tokens?)\.json|keychains?)(?:[/\\]|$)/i;
const missing = new Set(['ENOENT', 'ENOTDIR', 'ELOOP']);

export function adapterFor({ cli, runtimeId }) {
  const id = cli ?? runtimeId;
  return adapters.get(runtimeIds.get(id) ?? id);
}

export async function regularPath(path) {
  if (typeof path !== 'string' || !isAbsolute(path) || protectedPath.test(path)) return null;
  try {
    if (!(await lstat(path)).isFile()) return null;
    const physical = await realpath(path);
    return protectedPath.test(physical) ? null : physical;
  } catch (error) {
    if (missing.has(error.code)) return null;
    throw error;
  }
}

export async function openTranscript(path) {
  if (!/\.jsonl$/i.test(path ?? '')) return null;
  const physical = await regularPath(path);
  if (!physical || !/\.jsonl$/i.test(physical)) return null;
  try {
    const file = await open(physical, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      if ((await file.stat()).isFile()) return { file, path: physical };
    } catch (error) {
      await file.close();
      throw error;
    }
    await file.close();
    return null;
  } catch (error) {
    if (missing.has(error.code)) return null;
    throw error;
  }
}

async function allowLookup({ id }) {
  const root = id === 'codex' ? process.env.CODEX_HOME || join(homedir(), '.codex') :
    id === 'claude' ? process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude') : join(homedir(), '.gemini');
  if (protectedPath.test(root)) return false;
  const physical = await realpath(root).catch(error => {
    if (missing.has(error.code)) return null;
    throw error;
  });
  return !physical || !protectedPath.test(physical);
}

export async function openNative(session, { locate = true } = {}) {
  const adapter = adapterFor(session);
  const path = session.transcriptPath;
  // agy may advertise the short log even when it has also written the full one.
  if (adapter?.id === 'agy' && path && basename(path) === 'transcript.jsonl') {
    const full = await openTranscript(join(dirname(path), 'transcript_full.jsonl'));
    if (full) return full;
  }
  const bound = await openTranscript(path);
  if (bound || !locate || !adapter || !session.sessionId || !session.cwd || protectedPath.test(session.cwd)) return bound;
  if (!(await allowLookup(adapter))) return null;
  return openTranscript(await adapter.transcript.locate(session));
}
