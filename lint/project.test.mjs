import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { execFileSync, mkdtempSync, spawnSync } from '../fixtures/test-process.mjs';
import { lintProject, lintSource } from './project.mjs';

const rules = (source, path = 'module.mjs', options) => lintSource(source, path, options).map(item => item.rule);

test('tests use fixture executables and keep PATH out of command resolution', t => {
  assert.deepEqual(rules("import { spawn as run } from 'node:child_process'; run('codex');", 'src/integration.test.mjs'),
    ['test-executable']);
  assert.deepEqual(rules("const worker = require('child_process'); worker.spawn('codex');", 'tests/integration.cjs'),
    ['test-executable']);
  assert.deepEqual(rules("import { spawn } from 'node:child_process';", 'daemon/processes.mjs'), []);
  const parent = mkdtempSync(join(realpathSync(tmpdir()), 'loom-lint-'));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const checked = join(parent, 'fixture');
  writeFileSync(checked, '#!/bin/sh\nprintf checked\n');
  chmodSync(checked, 0o700);
  assert.equal(execFileSync(checked, { encoding: 'utf8' }), 'checked');
  assert.deepEqual(rules(`import { spawnSync } from '../fixtures/test-process.mjs';
    spawnSync('/bin/sh', ['-c', 'command -v claude']);`, 'src/integration.test.mjs'), ['test-executable']);
  const configuredCommand = ['exec', 'codex', '--version'].join(' ');
  assert.throws(() => spawnSync('/bin/sh', ['-c', configuredCommand]), /absolute fixture executable path/);
  assert.throws(() => spawnSync('codex'), /absolute fixture executable path/);
  assert.throws(() => spawnSync('/usr/bin/true'), /registered fixture directory/);
  const link = join(parent, 'link');
  symlinkSync('/usr/bin/true', link);
  assert.throws(() => spawnSync(link), /registered fixture directory/);
});

test('credential reads resolve imports, home paths and local path aliases', () => {
  assert.deepEqual(rules(`
    import { readFile as load } from 'node:fs/promises';
    import { join } from 'node:path';
    const token = join(process.env.HOME, '.codex', 'auth.json');
    load(token);
  `), ['credential-read']);
  assert.deepEqual(rules(`import { readFileSync } from 'node:fs'; readFileSync('.env.local');`), ['credential-read']);
  assert.deepEqual(rules(`import * as fs from 'node:fs'; fs.promises.readFile('/Users/sample/.ssh/id_ed25519');`),
    ['credential-read']);
  assert.deepEqual(rules("const documentation = 'readFileSync(.env.local)';"), []);
});

test('invariant [egress] only allowlisted modules call network clients and tests can use local servers', () => {
  const source = `
    import { request as call } from 'node:https';
    call('https://example.invalid');
    globalThis.fetch('https://example.invalid');
  `;
  assert.deepEqual(rules(source), ['network-egress', 'network-egress']);
  assert.deepEqual(rules(source, 'network/client.mjs', { egress: ['network/client.mjs'] }), []);
  assert.deepEqual(rules(source, 'network/second.mjs', { egress: ['network/client.mjs'] }), ['network-egress', 'network-egress']);
  assert.deepEqual(rules(`import { createServer } from 'node:http'; createServer(() => {});`), []);
  assert.deepEqual(rules(`import { spawnSync } from 'node:child_process'; spawnSync('/bin/sh', ['-c', 'curl https://example.invalid']);`),
    ['network-egress']);
});

test('global configuration writes fail and a fixture config remains usable', () => {
  const source = `
    import * as fs from 'node:fs';
    import { homedir } from 'node:os';
    import { join } from 'node:path';
    fs.writeFileSync(join(homedir(), '.gitconfig'), 'fixture');
    fs.openSync('/etc/loom.json', fs.constants.O_WRONLY);
    fs.writeFileSync('/tmp/fixture/.gitconfig', 'fixture');
    fs.cpSync('candidate', '/home/fixture/.config/loom');
    fs.readFileSync('/etc/loom.json');
  `;
  assert.deepEqual(rules(source), ['global-config-write', 'global-config-write', 'global-config-write']);
  assert.deepEqual(rules("import { execFileSync } from 'node:child_process'; execFileSync('/usr/bin/git', ['config','--global','key','value']);"),
    ['global-config-write']);
});

test('loom lint scans tracked and new source and returns an actionable nonzero receipt', t => {
  const project = mkdtempSync(join(realpathSync(tmpdir()), 'loom-lint-cli-'));
  t.after(() => rmSync(project, { recursive: true, force: true }));
  execFileSync('/usr/bin/git', ['init', '-q'], { cwd: project });
  writeFileSync(join(project, '.gitignore'), 'ignored.mjs\n');
  mkdirSync(join(project, 'network'));
  writeFileSync(join(project, 'network', 'client.mjs'), "fetch('https://example.invalid');");
  writeFileSync(join(project, 'ignored.mjs'), "fetch('https://example.invalid');");
  const config = join(project, 'loom.lint.json');
  writeFileSync(config, JSON.stringify({ egress: ['network/client.mjs'] }));
  assert.equal(lintProject(project).ok, true);
  writeFileSync(join(project, 'script.mjs'), "import { readFileSync } from 'node:fs';\nreadFileSync('.env');");
  const cmd = new URL('../bin/loom', import.meta.url).pathname;
  const { status, stdout } = spawnSync(process.execPath, [cmd, 'lint', '--project', project, '--json'], { encoding: 'utf8' });
  assert.equal(status, 1);
  assert.deepEqual(JSON.parse(stdout).violations.map(({ file, line, rule }) => [file, line, rule]),
    [['script.mjs', 2, 'credential-read']]);
  assert.equal(readFileSync(config, 'utf8'), JSON.stringify({ egress: ['network/client.mjs'] }));
});
