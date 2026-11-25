import { execFile } from 'node:child_process';
import { join, matchesGlob } from 'node:path';
import { promisify } from 'node:util';
import { diffFiles, isCredentialPath, testChanges } from '../evidence/git.mjs';
import { readText } from '../daemon/io.mjs';

const exec = promisify(execFile);
const sha = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const defaultTests = ['**/{test,tests,__tests__,spec,specs}/**', '**/*.{test,spec}.*',
  '**/{test_*,*_test,*_spec}.*', '**/Test*.java', '**/*Test.java'];
const exclusions = ['**/.env*', '**/.env*/**', '**/provider-homes/**', '**/memories*', '**/memories*/**',
  '**/auth.json', '**/credentials.json', '**/.credentials.json',
  '**/.project/evidence/**', '**/.project/relay/**', '**/.project/replies/**', '**/.project/inbox/**']
  .map(glob => `:(exclude,glob)${glob}`);

export function changeReader(project) {
  const cached = new Map();
  const counts = new Map();
  let tests;
  function testFile(file) {
    tests ??= [...defaultTests, ...(JSON.parse(readText(join(project, '.project', 'evidence.json'), '{}')).testPaths ?? [])];
    return [file.path, file.previousPath].some(path => path && tests.some(glob => matchesGlob(path, glob)));
  }
  async function diff(cwd, base, candidate) {
    if (!cwd || !sha.test(base ?? '') || !sha.test(candidate ?? '')) {
      return { status: 'missing-boundary', base: base ?? null, candidate: candidate ?? null };
    }
    const result = { status: 'ok', base, candidate, files: [], numstat: {
      src: { added: 0, deleted: 0, net: 0, binary: 0 },
      test: { added: 0, deleted: 0, net: 0, binary: 0 },
      docs: { added: 0, deleted: 0, net: 0, binary: 0 },
    }, testAssertions: [] };
    if (base === candidate) return result;
    const run = async (options, paths = []) => (await exec('git', [
      '--no-optional-locks', 'diff', '--no-color', '--no-ext-diff', '--no-textconv', '--no-relative', '--find-renames',
      ...options, `${base}..${candidate}`, '--', ...paths, ...exclusions,
    ], { cwd, encoding: 'utf8', timeout: 10000, maxBuffer: 16 * 1024 * 1024 })).stdout;

    try {
      const files = diffFiles(await run(['--raw', '--numstat', '-z']));
      for (const file of files) {
        if ([file.path, file.previousPath].some(path => path && isCredentialPath(path))) continue;
        const category = testFile(file) ? 'test' : matchesGlob(file.path, '**/{docs,doc}/**') ||
          /\.(?:md|mdx|rst|adoc|txt)$/i.test(file.path) ? 'docs' : 'src';
        result.files.push({ ...file, category });
        const stat = result.numstat[category];
        stat.added += file.added ?? 0;
        stat.deleted += file.deleted ?? 0;
        stat.net = stat.added - stat.deleted;
        if (file.added === null) stat.binary++;
        if (category !== 'test' || !file.deleted) continue;
        const paths = [file.previousPath, file.path].filter(Boolean).map(path => `:(literal)${path}`);
        const patch = await run(['--unified=0'], paths);
        let oldLine = null;
        for (const line of patch.split('\n')) {
          const hunk = /^@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@/.exec(line);
          if (line.startsWith('diff --git ')) oldLine = null;
          if (hunk) oldLine = Number(hunk[1]);
          if (oldLine === null || !line.startsWith('-')) continue;
          if (testChanges(`@@ -1 +1 @@\n${line}`).removedAssertions) {
            result.testAssertions.push({ path: file.previousPath ?? file.path, line: oldLine, text: line.slice(1) });
          }
          oldLine++;
        }
      }
      return result;
    } catch (error) {
      return { status: 'unavailable', base, candidate, message: error.stderr?.trim() || error.message };
    }
  }

  function read(cwd, base, candidate) {
    const key = JSON.stringify([cwd, base, candidate]);
    if (!cached.has(key)) cached.set(key, diff(cwd, base, candidate));
    return cached.get(key);
  }
  async function count(cwd, base, candidate) {
    if (!cwd || !sha.test(base ?? '') || !sha.test(candidate ?? '')) return null;
    if (base === candidate) return 0;
    try {
      const { stdout } = await exec('git', ['--no-optional-locks', 'diff', '--name-only', '--no-ext-diff',
        '--no-textconv', '--no-relative', '-z', `${base}..${candidate}`, '--', ...exclusions],
      { cwd, encoding: 'utf8', timeout: 5000, maxBuffer: 4 * 1024 * 1024 });
      return stdout.split('\0').filter(path => path && !isCredentialPath(path)).length;
    } catch { return null; }
  }
  return { diff: read, count(cwd, base, candidate) {
    const key = JSON.stringify([cwd, base, candidate]);
    if (!counts.has(key)) counts.set(key, count(cwd, base, candidate));
    return counts.get(key);
  } };
}
