import { execFileSync } from 'node:child_process';
import { closeSync, constants, fstatSync, lstatSync, mkdtempSync, openSync, readFileSync, readlinkSync,
  realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { diffFiles, diffArgs, exclusions, isCredentialPath, inspectFiles } from './git.mjs';

const run = (cwd, args, options = {}) => execFileSync('git', ['--no-optional-locks', ...args], {
  cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], maxBuffer: 16 * 1024 * 1024,
  timeout: 10_000, ...options,
});
const literalPath = path => `:(top,literal)${path}`;

function snapshotPath(root, path, indexOptions) {
  if (isCredentialPath(path)) return null;
  const absolute = join(root, path);
  try {
    // Check ancestors before opening a file. A symlink is recorded as a link, never followed.
    if (realpathSync(join(absolute, '..')) !== join(absolute, '..')) return { path, hash: null };
    const stat = lstatSync(absolute);
    if (stat.isDirectory()) {
      const entry = /^160000 ([0-9a-f]+) 0\t/.exec(run(root, ['ls-files', '--stage', '-z', '--', literalPath(path)], indexOptions));
      return entry ? { path, hash: entry[1], mode: '160000' } : { path, hash: null };
    }
    let data, mode;
    if (stat.isSymbolicLink()) {
      data = readlinkSync(absolute, { encoding: 'buffer' });
      mode = '120000';
    } else if (stat.isFile()) {
      const fd = openSync(absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        if (!fstatSync(fd).isFile()) throw new Error('Path changed during Git snapshot');
        data = readFileSync(fd);
      } finally { closeSync(fd); }
      mode = stat.mode & 0o100 ? '100755' : '100644';
    } else throw new Error('Unsupported worktree file type');
    const hash = run(root, ['hash-object', '-w', '--no-filters', '--stdin'], { input: data }).trim();
    return { path, mode, hash };
  } catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes(error.code)) return { path, hash: null };
    throw error;
  }
}

export function worktreeAt(cwd) {
  const observedAt = Date.now();
  let head = null;
  let scratch;
  try {
    const root = realpathSync(run(cwd, ['rev-parse', '--show-toplevel']).replace(/\n$/, ''));
    try { head = run(root, ['rev-parse', '--verify', '--quiet', 'HEAD']).trim(); }
    catch (error) { if (error.status !== 1) throw error; }
    const base = head ?? run(root, ['mktree'], { input: '' }).trim();
    const status = run(root, ['status', '--porcelain=v1', '-z', '--no-renames',
      '--untracked-files=all', '--ignore-submodules=dirty', '--', ...exclusions]);
    const paths = [...new Set(status.split('\0').filter(Boolean).map(entry => entry.slice(3)))];
    const dirty = paths.map(path => snapshotPath(root, path)).filter(Boolean);
    if (!dirty.length) return { head, tree: base, dirty, observedAt };

    // Seed a private index from HEAD and overlay actual worktree bytes.
    scratch = mkdtempSync(join(tmpdir(), 'loom-turn-git-'));
    const options = { env: { ...process.env, GIT_INDEX_FILE: join(scratch, 'index') } };
    run(root, ['read-tree', base], options);
    const zeros = '0'.repeat(base.length);
    // Remove paths first so file-to-directory transitions cannot collide with the base index.
    const input = [...dirty.map(({ path }) => `0 ${zeros}\t${path}\0`),
      ...dirty.filter(entry => entry.hash).map(({ path, mode, hash }) => `${mode} ${hash}\t${path}\0`)].join('');
    run(root, ['update-index', '-z', '--index-info'], { ...options, input });
    const tree = run(root, ['write-tree'], options).trim();
    return { head, tree, dirty, observedAt };
  } catch (error) {
    return { head, observedAt, status: 'unavailable', error: String(error.code ?? error.name) };
  } finally {
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  }
}

const oid = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
function mergeStatus(cwd, ref, start, end) {
  if (typeof ref !== 'string' || !ref || ref.startsWith('-') || /\s/.test(ref)) return null;
  let target;
  try { target = run(cwd, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]).trim(); }
  catch { return { ref, target: null, integrated: null }; }
  if (!end.head || start.head === end.head || end.dirty.length) return { ref, target, integrated: false };
  try {
    run(cwd, ['merge-base', '--is-ancestor', end.head, target]);
    return { ref, target, integrated: true };
  } catch (error) { return { ref, target, integrated: error.status === 1 ? false : null }; }
}

export function worktreeDelta(cwd, start, end, settings = {}) {
  if (start?.status === 'unavailable' || end?.status === 'unavailable') return { status: 'unavailable' };
  if (!oid.test(start?.tree ?? '') || !oid.test(end?.tree ?? '')) return { status: 'missing-boundary' };
  try {
    const gitDiff = (args, paths = []) => run(cwd,
      [...diffArgs, ...args, start.tree, end.tree, '--', ...paths, ...exclusions]);
    const files = diffFiles(gitDiff(['--raw', '--numstat', '-z']));
    const facts = inspectFiles(files, settings, file => gitDiff(['--unified=0', '--output-indicator-new=+',
      '--output-indicator-old=-'], [file.previousPath, file.path].filter(Boolean).map(literalPath)));
    const added = files.reduce((total, file) => total + (file.added ?? 0), 0);
    const deleted = files.reduce((total, file) => total + (file.deleted ?? 0), 0);
    return { status: 'ok', source: 'git-worktree', baseCommit: start.head, head: end.head, tree: end.tree,
      uncommitted: end.dirty.length > 0, files, ...facts, numstat: { added, deleted, net: added - deleted },
      merge: mergeStatus(cwd, settings.mergeRef, start, end),
      testAssertions: facts.tests.flatMap(file => file.assertions.map(assertion => ({
        path: file.previousPath ?? file.path, ...assertion,
      }))) };
  } catch (error) {
    return { status: 'unavailable', error: String(error.code ?? error.name) };
  }
}
