import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const base = '0ca39c54b8eed922a7127fd022b99b1ffb84be0a';
const source = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');
const scope = ['cli', 'daemon', 'docs', 'skills', 'examples', 'README.md'];
const historyTest = 'lists the index and reads the newest requested turns';
const original = 'Number.isSafeInteger(number) && number > 0';
const injected = 'Number.isSafeInteger(number) && number > 1';
const run = (file, args, options) => execFileSync(file, args, {
  ...options, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
});
const git = (cwd, ...args) => run('/usr/bin/git', args, {
  cwd, env: { PATH: '/usr/bin:/bin', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
});
const head = (cwd, file) => git(cwd, 'show', 'HEAD:' + file);

export function prepare(directory, task) {
  const parent = realpathSync(dirname(directory));
  directory = join(parent, directory.split(sep).at(-1));
  assert.ok(!directory.startsWith(source + sep) && directory !== source);
  assert.ok(!existsSync(directory), 'Each run requires a new copy');
  mkdirSync(directory, { mode: 0o700 });
  git(directory, 'init', '--quiet');
  git(directory, 'fetch', '--quiet', '--depth=1', source, base);
  git(directory, 'checkout', '--quiet', '--detach', base);
  run('/bin/cp', ['-cR', join(source, 'node_modules'), join(directory, 'node_modules')]);
  if (task === 'diagnosis') {
    const path = join(directory, 'cli/loom.mjs');
    const text = readFileSync(path, 'utf8');
    assert.equal(text.split(original).length, 2);
    writeFileSync(path, text.replace(original, injected));
  }
  return directory;
}

export function surveyTable(cwd) {
  const help = run(process.execPath, ['bin/loom', '--help'], { cwd });
  const commands = [...new Set([...help.matchAll(/^loom ([\w-]+)(?= |$)/gm)].map(match => match[1]))].sort();
  const dispatch = head(cwd, 'cli/loom.mjs');
  const delegates = [
    [['send'], 'send(rest)', 'cli/send.mjs'], [['spawn', 'daemon'], 'control(command, rest)', 'cli/control.mjs'],
    [['upgrade'], 'upgrade(rest)', 'cli/upgrade.mjs'], [['handover'], 'handover(rest, {', 'handover/cli.mjs'],
    [['senior-tool'], 'runSeniorTool(rest)', 'cli/senior-tool.mjs'],
  ];
  const modules = new Map();
  for (const [names, call, module] of delegates) {
    assert.ok(dispatch.includes(call));
    assert.ok(dispatch.includes(module.startsWith('cli/') ? './' + module.slice(4) : '../' + module));
    for (const name of names) modules.set(name, module);
  }
  const tests = head(cwd, 'cli/loom.test.mjs');
  const direct = new Set([...tests.matchAll(/\b(?:f\.run\(\d+,\s*|f\.cli\(|call\()['"]([\w-]+)['"]/g)].map(match => match[1]));
  return commands.map(command => [command, modules.get(command) ?? 'cli/loom.mjs', direct.has(command) ? 'yes' : 'no']);
}

export function expectedRename(cwd) {
  const paths = git(cwd, 'grep', '-l', '-e', '--needs-decision', 'HEAD', '--', ...scope)
    .trim().split('\n').map(line => line.slice('HEAD:'.length));
  return new Map(paths.map(file => {
    const before = head(cwd, file);
    const after = before.replaceAll('--needs-decision', '--request-decision')
      .replace("strings('needs-decision'", "strings('request-decision'")
      .replace("values['needs-decision']", "values['request-decision']");
    return [file, after];
  }));
}

export function testTask(cwd, task) {
  const args = ['--test', ...(task === 'diagnosis' ? ['--test-name-pattern=' + historyTest] : []), 'cli/loom.test.mjs'];
  const scratch = mkdtempSync(join(dirname(cwd), 'check-'));
  try {
    const result = spawnSync(process.execPath, args, {
      cwd, encoding: 'utf8', timeout: 90_000, env: {
        PATH: dirname(process.execPath) + ':/usr/bin:/bin', HOME: scratch, TMPDIR: scratch,
        LOOM_DESKTOP_NOTIFY: '0', LOOM_HERDR_LAYOUT: '0',
      },
    });
    return { exit: result.status, passed: Number(result.stdout?.match(/(?:ℹ|#) pass (\d+)/)?.[1] ?? 0),
      failed: Number(result.stdout?.match(/(?:ℹ|#) fail (\d+)/)?.[1] ?? 0) };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

export function check(cwd, task, response) {
  assert.equal(git(cwd, 'rev-parse', 'HEAD').trim(), base);
  const changed = git(cwd, 'status', '--porcelain', '--untracked-files=all')
    .trimEnd().split('\n').filter(Boolean).map(line => line.slice(3)).sort();
  if (task === 'survey') {
    const actual = response.split('\n').filter(line => line.trim().startsWith('|'))
      .map(line => line.trim().slice(1, -1).split('|').map(cell => cell.trim().replaceAll('`', '')))
      .filter(row => !/^(command|[- :]+)$/i.test(row[0]));
    assert.deepEqual(changed, []);
    assert.deepEqual(actual, surveyTable(cwd));
    return { passed: true, rows: actual.length };
  }
  if (task === 'rename') {
    const expected = expectedRename(cwd);
    assert.deepEqual(changed, [...expected.keys()].sort());
    for (const [file, text] of expected) assert.equal(readFileSync(join(cwd, file), 'utf8'), text, file);
  } else {
    assert.equal(task, 'diagnosis');
    assert.deepEqual(changed, [], 'Remove only the injected change');
  }
  const tests = testTask(cwd, task);
  assert.equal(tests.exit, 0);
  assert.ok(tests.passed > 0);
  return { passed: true, changedFiles: changed.length, tests };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [action, task, cwd, response] = process.argv.slice(2);
  assert.ok(['survey', 'rename', 'diagnosis'].includes(task));
  if (action === 'prepare') console.log(prepare(resolve(cwd), task));
  else if (action === 'check') console.log(JSON.stringify(check(cwd, task, response && readFileSync(response, 'utf8'))));
  else assert.fail('Use prepare or check');
}
