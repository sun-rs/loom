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

const testDeclaration = /\b(?:test|it|describe|suite)(?:\.(?:skip|only|todo))*\s*\(|\b(?:test_\w+\s*\(|func\s+Test\w+\s*\()/;
const assertMethod = code => /\bassert\.(\w+)\s*\(/.exec(code)?.[1];
const weakerAssertion = (before, after) => {
  const old = assertMethod(before), next = assertMethod(after);
  return next === 'ok' && ['equal', 'strictEqual', 'deepEqual', 'deepStrictEqual', 'match'].includes(old) ||
    old === 'strictEqual' && next === 'equal' || old === 'deepStrictEqual' && next === 'deepEqual';
};

export function testEditDetails(patch, untracked = false) {
  const assertions = [], directives = [], deletedTests = [];
  let oldLine, newLine = untracked ? 1 : undefined;
  let oldAssertions = [], newAssertions = [];
  const removedTests = [], addedTests = new Set();
  function finish() {
    for (const [i, edit] of oldAssertions.entries()) {
      const replacement = newAssertions[i];
      assertions.push(replacement ? { ...edit, kind: 'modified', replacement,
        weakened: weakerAssertion(edit.text, replacement.text) } : { ...edit, kind: 'deleted' });
    }
    oldAssertions = [];
    newAssertions = [];
  }
  const testKey = text => text.trim().replace(/\.(?:skip|only|todo)\b/g, '');
  for (const line of patch.split('\n')) {
    const hunk = untracked ? null : /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk || !untracked && line.startsWith('diff --git ')) {
      finish();
      oldLine = hunk ? Number(hunk[1]) : undefined;
      newLine = hunk ? Number(hunk[2]) : undefined;
    } else if (oldLine !== undefined && line.startsWith('-')) {
      const text = line.slice(1), code = codeLine(text), location = { line: oldLine++, text };
      if (assertion.test(code)) oldAssertions.push(location);
      if (testDeclaration.test(code)) removedTests.push(location);
    } else if (newLine !== undefined && (untracked || line.startsWith('+'))) {
      const text = untracked ? line : line.slice(1), code = codeLine(text), location = { line: newLine++, text };
      if (assertion.test(code)) newAssertions.push(location);
      if (testDeclaration.test(code)) addedTests.add(testKey(text));
      if (skip.test(code)) directives.push({ ...location, kind: 'skip' });
      if (only.test(code)) directives.push({ ...location, kind: 'only' });
    } else if (oldLine !== undefined && line.startsWith(' ')) {
      oldLine++;
      newLine++;
    }
  }
  finish();
  deletedTests.push(...removedTests.filter(test => !addedTests.has(testKey(test.text))));
  return { assertions, directives, deletedTests };
}

function testCounts({ assertions, directives }) {
  return { removedAssertions: assertions.filter(edit => edit.kind === 'deleted').length,
    rewrittenAssertions: assertions.filter(edit => edit.kind === 'modified').length,
    addedSkip: directives.filter(edit => edit.kind === 'skip').length,
    addedOnly: directives.filter(edit => edit.kind === 'only').length };
}

export const testChanges = (patch, untracked = false) => testCounts(testEditDetails(patch, untracked));
function testEvidence(patch, untracked = false) {
  if (patch === null) return { changes: null };
  const details = testEditDetails(patch, untracked);
  return { changes: testCounts(details), ...details };
}
export const assertionEdits = patch => testEditDetails(patch).assertions;

export function assertionCounts(test) {
  if (Array.isArray(test.assertions)) return {
    removedAssertions: test.assertions.filter(edit => edit.kind === 'deleted').length,
    rewrittenAssertions: test.assertions.filter(edit => edit.kind === 'modified').length,
  };
  if (Object.hasOwn(test.changes ?? {}, 'rewrittenAssertions')) return {
    removedAssertions: test.changes.removedAssertions ?? 0,
    rewrittenAssertions: test.changes.rewrittenAssertions ?? 0,
  };
  return { removedAssertions: 0, rewrittenAssertions: 0 };
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
    tests.push({ ...file, ...testEvidence(patch) });
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
        if (isTest) tests.push({ ...file, ...testEvidence(content, true) });
      } else if (isTest) {
        const patch = file.added === null ? null : await diff(root, base, ['--unified=0', '--output-indicator-new=+',
          '--output-indicator-old=-'], paths.map(literalPath));
        tests.push({ ...file, ...testEvidence(patch) });
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
