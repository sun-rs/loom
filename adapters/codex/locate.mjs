import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, readdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

// Orca b7fd7caa3 src/main/codex/history/rollouts/codex-rollout-thread-id.ts.
// A reverted thread's rollout adds `_<rollout id>` after the thread id.
const CODEX_ROLLOUT_THREAD_ID_PATTERN =
  /^rollout-(.+)-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:_[0-9a-f-]{36})?\.jsonl$/i;

function parseCodexRolloutThreadId(filePath) {
  const match = CODEX_ROLLOUT_THREAD_ID_PATTERN.exec(lastPathSegment(filePath));
  return match ? { threadId: match[2].toLowerCase(), rolloutStamp: match[1] } : null;
}

function lastPathSegment(filePath) {
  return filePath.split(/[\\/]/).at(-1) ?? '';
}

// Orca b7fd7caa3 src/main/codex/history/rollouts/codex-session-file-listing.ts,
// listCodexSessionJsonlFiles and appendSessionFilePaths.
function listCodexSessionJsonlFiles(root) {
  const files = [];
  try {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      const childPath = join(root, entry.name);
      if (entry.isDirectory()) {
        for (const filePath of listCodexSessionJsonlFiles(childPath)) files.push(filePath);
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        files.push(childPath);
      }
    }
  } catch (error) {
    if (!isInaccessible(error)) throw error;
  }
  return files.sort();
}

function isInaccessible(error) {
  return ['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM', 'ELOOP'].includes(error.code);
}

function canonicalPath(path) {
  try {
    return realpathSync(path);
  } catch (error) {
    if (!isInaccessible(error)) throw error;
    return null;
  }
}

// Orca b7fd7caa3 src/main/codex/history/rollouts/codex-rollout-session-meta.ts,
// readCodexRolloutSessionMetaId. Read only the session_meta header of a candidate.
const ROLLOUT_READ_LIMIT = 64 * 1024;

function readSessionMeta(filePath) {
  if (canonicalPath(filePath) !== filePath) return null;
  try {
    const fd = openSync(filePath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      if (!fstatSync(fd).isFile()) return null;
      const head = Buffer.alloc(ROLLOUT_READ_LIMIT);
      const size = readSync(fd, head, 0, head.length, 0);
      const firstLine = head.toString('utf8', 0, size).split(/\r?\n/, 1)[0]?.trim();
      return firstLine ? JSON.parse(firstLine) : null;
    } finally {
      closeSync(fd);
    }
  } catch (error) {
    if (error instanceof SyntaxError || isInaccessible(error)) return null;
    throw error;
  }
}

export function locate({ sessionId, cwd, codexHome = process.env.CODEX_HOME || join(homedir(), '.codex') } = {}) {
  if (typeof sessionId !== 'string' || !/^[a-z0-9-]+$/i.test(sessionId)) return null;
  const id = sessionId.toLowerCase();
  const home = canonicalPath(codexHome);
  if (!home) return null;
  const directory = cwd ? canonicalPath(cwd) ?? resolve(cwd) : null;

  for (const store of ['sessions', 'archived_sessions']) {
    const root = join(home, store);
    if (!lstatSync(root, { throwIfNoEntry: false })?.isDirectory()) continue;
    for (const filePath of listCodexSessionJsonlFiles(root).reverse()) {
      if (parseCodexRolloutThreadId(filePath)?.threadId !== id) continue;
      const record = readSessionMeta(filePath);
      if (record?.type !== 'session_meta') continue;
      const meta = record.payload ?? record;
      const metaId = meta.id ?? meta.session_id ?? meta.thread_id;
      if (typeof metaId !== 'string' || metaId.toLowerCase() !== id) continue;
      if (directory && (typeof meta.cwd !== 'string' ||
        (canonicalPath(meta.cwd) ?? resolve(meta.cwd)) !== directory)) continue;
      return filePath;
    }
  }
  return null;
}
