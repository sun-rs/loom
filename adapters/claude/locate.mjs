import { lstat, readdir, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

// Orca b7fd7caa3: src/main/ai-vault/scanners/claude/claude-project-dir-encoding.ts
export const CLAUDE_BUCKET_NAME_MAX_LENGTH = 200;

export function encodeClaudeProjectPaths(pathValue) {
  const raw = encodeClaudeProjectPath(pathValue);
  const composed = encodeClaudeProjectPath(pathValue.normalize('NFC'));
  return raw === composed ? [raw] : [raw, composed];
}

export function encodeClaudeProjectPath(pathValue) {
  const separated = pathValue.replaceAll('\\', '/');
  const trimmed = separated === '/' || /^[A-Za-z]:\/$/.test(separated) ? separated : separated.replace(/\/+$/, '');
  return trimmed.replace(/[^a-zA-Z0-9]/g, '-');
}

export function isClaudeProjectOwnBucketName(projectDirName, encodedPath) {
  return (
    projectDirName === encodedPath ||
    (encodedPath.length > CLAUDE_BUCKET_NAME_MAX_LENGTH &&
      projectDirName.startsWith(`${encodedPath.slice(0, CLAUDE_BUCKET_NAME_MAX_LENGTH)}-`))
  );
}

// Orca b7fd7caa3: src/main/native-chat/transcript-discovery/session-file-resolver-claude-probe.ts
export function isSafeClaudeSessionId(sessionId) {
  return (
    sessionId !== '.' &&
    sessionId !== '..' &&
    !sessionId.includes('/') &&
    !sessionId.includes('\\') &&
    !sessionId.includes('\0')
  );
}

async function isEntry(path, kind) {
  try {
    const info = await lstat(path);
    return kind === 'file' ? info.isFile() : info.isDirectory();
  } catch (error) {
    if (['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM', 'ENAMETOOLONG'].includes(error.code)) return false;
    throw error;
  }
}

export async function locate({
  sessionId,
  cwd,
  configDir = process.env.CLAUDE_CONFIG_DIR,
  projectDirName = configDir ? process.env.CLAUDE_CODE_PROJECT_DIR_NAME : undefined,
} = {}) {
  if (typeof sessionId !== 'string' || !sessionId.trim() || !isSafeClaudeSessionId(sessionId)) return null;
  if (typeof cwd !== 'string' || !cwd.trim()) return null;
  if (projectDirName && !isSafeClaudeSessionId(projectDirName)) return null;

  const root = resolve(configDir || join(homedir(), '.claude'), 'projects');
  if (!await isEntry(root, 'directory')) return null;
  const filename = `${sessionId}.jsonl`;
  const directory = resolve(cwd);
  const physical = projectDirName ? directory : await realpath(directory).catch(() => directory);
  const encoded = projectDirName ? [projectDirName] : new Set([
    ...encodeClaudeProjectPaths(directory), ...encodeClaudeProjectPaths(physical),
  ]);
  for (const bucket of encoded) {
    const bucketDir = join(root, bucket);
    const path = join(bucketDir, filename);
    if (await isEntry(bucketDir, 'directory') && await isEntry(path, 'file')) return path;
  }

  const longNames = projectDirName ? [] : [...encoded].filter((name) => name.length > CLAUDE_BUCKET_NAME_MAX_LENGTH);
  if (!longNames.length) return null;
  const matches = [];
  for (const bucket of await readdir(root, { withFileTypes: true }).catch((error) => {
    if (['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'].includes(error.code)) return [];
    throw error;
  })) {
    if (!bucket.isDirectory() || !longNames.some((name) => isClaudeProjectOwnBucketName(bucket.name, name))) continue;
    const path = join(root, bucket.name, filename);
    if (await isEntry(path, 'file')) matches.push(path);
  }
  return matches.length === 1 ? matches[0] : null;
}
