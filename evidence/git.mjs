import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { join, matchesGlob } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const protectedFiles = [
  '**/.env*', '**/.env*/**', '**/provider-homes/**',
  '**/memories*', '**/memories*/**', '**/auth.json', '**/credentials.json', '**/.credentials.json',
];
const generated = ['**/.project/evidence/**', '**/.project/relay/**', '**/.project/replies/**', '**/.project/inbox/**',
  '**/.project/loomd/**', '**/.project/index.sqlite*', '**/.project/workers.md', '**/.project/watch/**', '**/.project/pty/**',
  '**/.project/loomd.log', '**/.project/loomd.sock', '**/.project/loomd.lock'];
export const exclusions = [...protectedFiles, ...generated].map(glob => `:(exclude,glob)${glob}`);
export const diffArgs = ['diff', '--no-ext-diff', '--no-textconv', '--no-color', '--no-relative', '--find-renames'];
const testPaths = ['**/{test,tests,__tests__,spec,specs}/**', '**/*.{test,spec}.*',
  '**/{test_*,*_test,*_spec}.*', '**/Test*.java', '**/*Test.java'];
const assertion = /(?:^|[^\w.])(?:assert(?:[A-Z]\w*|\.\w+)?\s*(?:[(!]|\s)|expect\s*\(|self\.assert\w+\s*\(|(?:expect|require|Assert|Assertions)\.\w+\s*\(|t\.(?:Errorf?|Fatalf?|Fail(?:Now)?)\s*\(|(?:ASSERT|EXPECT)_\w+\s*\()/;
const skip = /\b(?:test|it|describe|suite)(?:\.\w+)*\.skip(?:If)?\b|\b(?:xit|xtest|xdescribe|pytest\.skip|t\.Skip(?:f|Now)?)\s*\(|@(?:pytest\.mark\.skip(?:if)?|unittest\.skip(?:If|Unless)?)\b|\bskip\s*:\s*true\b/;
const only = /\b(?:test|it|describe|suite)(?:\.\w+)*\.only\b|\b(?:fit|fdescribe)\s*\(|\bonly\s*:\s*true\b/;
const maxUntrackedBytes = 8 * 1024 * 1024;

const git = async (cwd, ...args) => (await exec('git', ['--no-optional-locks', ...args], {
  cwd, encoding: 'utf8', timeout: 10_000, maxBuffer: 16 * 1024 * 1024,
})).stdout;

export const isCredentialPath = path => protectedFiles.some(glob => matchesGlob(path.toLowerCase(), glob));

function refsOnly(value) {
  return typeof value === 'string' && value.length > 0 && !value.startsWith('-') && !/\s/.test(value);
}

const diff = (cwd, base, opts, paths = []) => git(cwd, ...diffArgs, ...opts, base, '--', ...paths, ...exclusions);
const literalPath = path => `:(literal)${path}`;
const nullOrCount = value => value === '-' ? null : Number(value);

// --raw and --numstat share one snapshot. -z also preserves tabs and newlines in names.
export function diffFiles(text) {
  const fields = text.split('\0');
  const files = new Map();
  let i = 0;
  while (fields[i]?.startsWith(':')) {
    const status = fields[i++].split(' ').at(-1);
    const firstPath = fields[i++];
    const moved = /^[RC]/.test(status);
    const path = moved ? fields[i++] : firstPath;
    files.set(path, { path, status: status[0], previousPath: moved ? firstPath : null, added: null, deleted: null });
  }
  while (fields[i]) {
    const [, added, deleted, name] = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/.exec(fields[i++]);
    if (!name) i++; // Skip the original pathname in a rename's numstat entry.
    const path = name || fields[i++];
    Object.assign(files.get(path), { added: nullOrCount(added), deleted: nullOrCount(deleted) });
  }
  return [...files.values()];
}

function codeLine(line) {
  const code = line.trimStart();
  if (/^(?:\/\/|\/\*|\*|#|['"`])/.test(code)) return '';
  return code.replace(/'[^'\n]*'|"[^"\n]*"|`[^`\n]*`/g, '').split(/\s(?:\/\/|#)/, 1)[0];
}

export function testChanges(lines, untracked = false) {
  const counts = { removedAssertions: 0, addedSkip: 0, addedOnly: 0 };
  let hunk = untracked;
  for (const line of lines.split('\n')) {
    if (!untracked && line.startsWith('diff --git ')) hunk = false;
    if (!untracked && line.startsWith('@@ ')) hunk = true;
    if (!hunk) continue;
    if (!untracked && line.startsWith('-')) counts.removedAssertions += Number(assertion.test(codeLine(line.slice(1))));
    if (untracked || line.startsWith('+')) {
      const code = codeLine(untracked ? line : line.slice(1));
      counts.addedSkip += Number(skip.test(code));
      counts.addedOnly += Number(only.test(code));
    }
  }
  return counts;
}

// An assertion removed and replaced within the same hunk also appears here.
export function assertionEdits(patch) {
  const edits = [];
  let oldLine, removed, added;
  const finish = () => {
    for (const [i, edit] of (removed ?? []).entries()) {
      edits.push({ ...edit, kind: i < added ? 'modified' : 'deleted' });
    }
  };
  for (const line of patch.split('\n')) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@/.exec(line);
    if (hunk || line.startsWith('diff --git ')) {
      finish();
      oldLine = hunk ? Number(hunk[1]) : undefined;
      removed = [];
      added = 0;
    } else if (oldLine !== undefined && line.startsWith('-')) {
      if (assertion.test(codeLine(line.slice(1)))) removed.push({ line: oldLine, text: line.slice(1) });
      oldLine++;
    } else if (oldLine !== undefined && line.startsWith('+')) {
      added += Number(assertion.test(codeLine(line.slice(1))));
    }
  }
  finish();
  return edits;
}

export function inspectFiles(files, { protectedPaths = [], testPaths: extra = [], allowedPaths = [] }, patchFor) {
  const protectedHits = [], scopeHits = [], tests = [];
  for (const file of files) {
    const paths = [file.previousPath, file.path].filter(Boolean);
    const globs = protectedPaths.filter(glob => paths.some(path => matchesGlob(path, glob)));
    if (globs.length) protectedHits.push({ path: file.path, previousPath: file.previousPath, globs });
    if (allowedPaths.length) scopeHits.push(...paths.filter(path => !allowedPaths.some(glob => matchesGlob(path, glob))));
    if (!paths.some(path => [...testPaths, ...extra].some(glob => matchesGlob(path, glob)))) continue;
    const patch = file.added === null ? null : patchFor(file);
    tests.push({ ...file, changes: patch === null ? null : testChanges(patch),
      assertions: patch === null ? [] : assertionEdits(patch) });
  }
  return { protectedHits, scopeHits: [...new Set(scopeHits)], scopeConfigured: allowedPaths.length > 0, tests };
}

async function untrackedContent(root, path) {
  const absolute = join(root, path);
  try {
    if (await realpath(absolute) !== absolute) return null;
    const file = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > maxUntrackedBytes) return null;
      const data = await file.readFile();
      return data.includes(0) ? null : data.toString('utf8');
    } finally {
      await file.close();
    }
  } catch (error) {
    if (['ENOENT', 'ELOOP', 'EACCES'].includes(error.code)) return null;
    throw error;
  }
}

async function mergeEvidence(root, ref, base, head, files) {
  if (!refsOnly(ref)) return null;
  let target;
  try { target = (await git(root, 'rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`)).trim(); }
  catch { return { ref, target: null, integrated: null }; }
  const pending = await diff(root, head, ['--name-only', '-z']);
  if (base === head || pending || files.some(file => file.status === '?')) return { ref, target, integrated: false };
  try {
    await git(root, 'merge-base', '--is-ancestor', head, target);
    return { ref, target, integrated: true };
  } catch (error) {
    return { ref, target, integrated: error.code === 1 ? false : null };
  }
}

export async function collectGit(cwd, { baseCommit, protectedPaths = [], extraTestPaths = [], mergeRef }) {
  if (!baseCommit) return { status: 'missing-base' };
  if (!refsOnly(baseCommit)) return { status: 'invalid-base' };
  try {
    const root = await realpath((await git(cwd, 'rev-parse', '--show-toplevel')).replace(/\n$/, ''));
    let base;
    try { base = (await git(root, 'rev-parse', '--verify', '--end-of-options', `${baseCommit}^{commit}`)).trim(); }
    catch { return { status: 'invalid-base' }; }
    const [raw, untracked, head] = await Promise.all([
      diff(root, base, ['--raw', '--numstat', '-z']),
      git(root, 'ls-files', '--others', '--exclude-standard', '-z', '--', ...exclusions),
      git(root, 'rev-parse', '--verify', 'HEAD').then(value => value.trim()),
    ]);
    const tracked = diffFiles(raw);
    const files = [...tracked, ...untracked.split('\0').filter(Boolean)
      .map(path => ({ path, status: '?', previousPath: null, added: null, deleted: 0 }))];
    const protectedHits = [];
    const tests = [];
    const checks = [...testPaths, ...extraTestPaths];
    for (const file of files) {
      const paths = [file.previousPath, file.path].filter(Boolean);
      const hits = protectedPaths.filter(glob => paths.some(path => matchesGlob(path, glob)));
      if (hits.length) protectedHits.push({ path: file.path, previousPath: file.previousPath, globs: hits });
      const isTest = checks.some(glob => paths.some(path => matchesGlob(path, glob)));
      if (file.status === '?') {
        const content = await untrackedContent(root, file.path);
        if (content !== null) {
          file.added = Number(content.length > 0 && !content.endsWith('\n'));
          for (let line = content.indexOf('\n'); line >= 0; line = content.indexOf('\n', line + 1)) file.added++;
        }
        if (isTest) tests.push({ ...file, changes: content === null ? null : testChanges(content, true) });
      } else if (isTest) {
        const patch = file.added === null ? null : await diff(root, base, ['--unified=0', '--output-indicator-new=+',
          '--output-indicator-old=-'], paths.map(literalPath));
        tests.push({ ...file, changes: patch === null ? null : testChanges(patch) });
      }
    }
    const totals = files.reduce((sum, file) => ({
      added: sum.added + (file.added ?? 0), deleted: sum.deleted + (file.deleted ?? 0),
    }), { added: 0, deleted: 0 });
    const merge = await mergeEvidence(root, mergeRef, base, head, files);
    return { status: 'ok', baseCommit: base, head, numstat: totals, files, protectedHits, tests, merge };
  } catch (error) {
    // Avoid copying Git's stderr, which can contain worktree content or configuration.
    return { status: 'unavailable', error: String(error.code ?? error.name) };
  }
}
