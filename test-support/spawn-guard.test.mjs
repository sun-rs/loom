import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { execFileSync, mkdtempSync, registerIntegrationDirectory, spawnSync } from '../fixtures/test-process.mjs';
import { assertSocketPathLimit, resolveIntegrationBinDir, UNIX_SOCKET_PATH_LIMIT, validateIntegrationBinDir } from './integration-bin.mjs';
import { createTestRoot } from './run.mjs';
import { checkExecutable, checkSocketPath } from './spawn-guard.mjs';

test('test launch guard requires fixture paths and rejects executable symlinks out of the fixture', t => {
  const root = process.env.LOOM_TEST_FIXTURE_ROOT;
  if (!root) return t.skip('Run through npm test to exercise the guarded environment');
  const fixture = join(root, 'guard-fixture-opencode');
  writeFileSync(fixture, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  checkExecutable(fixture, {}, false);
  for (const cli of ['opencode', 'claude', 'codex', 'agy', 'hc', 'herdr-app']) {
    assert.throws(() => checkExecutable(cli, { env: { PATH: root } }, false), { code: 'loom-test-executable' });
  }
  assert.throws(() => checkExecutable('/usr/bin/id', {}, false), { code: 'loom-test-executable' });
  const alias = join(root, 'guard-alias');
  symlinkSync('/usr/bin/id', alias);
  assert.throws(() => checkExecutable(alias, {}, false), { code: 'loom-test-executable' });
});

test('unix socket path guard enforces the 103-byte macOS limit', t => {
  const exact = '/' + 'a'.repeat(UNIX_SOCKET_PATH_LIMIT - 1);
  const tooLong = '/' + 'a'.repeat(UNIX_SOCKET_PATH_LIMIT);
  assert.equal(Buffer.byteLength(exact), 103);
  assert.equal(Buffer.byteLength(tooLong), 104);
  checkSocketPath(exact, false);
  assert.equal(assertSocketPathLimit(exact), exact);
  assert.throws(() => checkSocketPath(tooLong, false), { code: 'loom-test-socket-path' });
  assert.throws(() => assertSocketPathLimit(tooLong), { code: 'loom-test-socket-path' });

  const scratch = realpathSync(mkdtempSync(join(process.env.LOOM_TEST_FIXTURE_ROOT ?? '/tmp', 'sg-sock-')));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const guard = fileURLToPath(new URL('./spawn-guard.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [
    '--import', guard,
    '-e', `import { createServer } from 'node:net'; createServer().listen(${JSON.stringify(tooLong)});`,
  ], {
    env: { PATH: process.env.PATH, LOOM_TEST_FIXTURE_ROOT: scratch },
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /loom-test-socket-path|exceeds 103 bytes/);
});

test('createTestRoot keeps generated socket paths at or below 103 bytes inside an integration worker tmpdir', t => {
  const outer = process.env.LOOM_TEST_FIXTURE_ROOT;
  let workerTmp;
  if (outer && Buffer.byteLength(dirname(outer)) <= 54) {
    workerTmp = dirname(outer);
  } else {
    const scratch = realpathSync(mkdtempSync(join(outer ?? '/tmp', 'sg-')));
    t.after(() => rmSync(scratch, { recursive: true, force: true }));
    const pad = Math.max(1, 54 - Buffer.byteLength(scratch) - 3);
    workerTmp = join(scratch, 'w'.repeat(pad), 't');
    mkdirSync(workerTmp, { recursive: true, mode: 0o700 });
  }
  assert.ok(Buffer.byteLength(workerTmp) <= 54);
  const allocated = createTestRoot({ LOOM_TEST_PS: join(workerTmp, 'integration-bin', 'ps') }, workerTmp);
  t.after(() => rmSync(allocated, { recursive: true, force: true }));
  const samples = [
    join(allocated, 's', '0'.repeat(32) + '.sock'),
    join(allocated, 'loom-acct-cli-XXXXXX', '.project', 'loomd.sock'),
    join(allocated, 'w-' + '0'.repeat(24), 't', 'ps-00000000.sock'),
  ];
  for (const socket of samples) {
    assert.ok(Buffer.byteLength(socket) <= UNIX_SOCKET_PATH_LIMIT, `expected <= 103 bytes: ${socket}`);
  }

  const tooLongBase = realpathSync(mkdtempSync(join(outer ?? '/tmp', 'sg-long-parent-exceeding-unix-socket-limit-')) );
  t.after(() => rmSync(tooLongBase, { recursive: true, force: true }));
  const deeper = join(tooLongBase, 'nested-worker-tmp-directory-name');
  mkdirSync(deeper, { recursive: true, mode: 0o700 });
  assert.throws(() => createTestRoot({ LOOM_TEST_PS: join(deeper, 'integration-bin', 'ps') }, deeper), { code: 'loom-test-socket-path' });
});

test('integration-bin registration accepts only a private integration-bin directory and rejects escapes', t => {
  const base = realpathSync(mkdtempSync(join(process.env.LOOM_TEST_FIXTURE_ROOT ?? '/tmp', 'sg-ibin-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const other = join(base, 'other');
  const integrationBin = join(base, 'integration-bin');
  const wideBin = join(other, 'integration-bin');
  const symlinkBin = join(other, 'alias');
  mkdirSync(other, { mode: 0o700 });
  mkdirSync(integrationBin, { mode: 0o700 });
  mkdirSync(wideBin, { mode: 0o755 });
  chmodSync(wideBin, 0o755);
  symlinkSync(integrationBin, symlinkBin);

  assert.equal(validateIntegrationBinDir(integrationBin, [base]), integrationBin);
  assert.equal(validateIntegrationBinDir(other, [base]), undefined);
  assert.equal(validateIntegrationBinDir('/usr/bin', ['/usr']), undefined);
  assert.equal(validateIntegrationBinDir(wideBin, [other]), undefined);
  assert.equal(validateIntegrationBinDir(integrationBin, [other]), undefined);
  assert.equal(validateIntegrationBinDir(symlinkBin, [other]), undefined);
  assert.equal(resolveIntegrationBinDir({ LOOM_TEST_INTEGRATION_BIN: integrationBin, TMPDIR: base }), integrationBin);
  assert.equal(resolveIntegrationBinDir({ LOOM_TEST_INTEGRATION_BIN: '/usr/bin', TMPDIR: '/usr' }), undefined);
  assert.equal(resolveIntegrationBinDir({ LOOM_TEST_PS: join(integrationBin, 'ps'), TMPDIR: base }), integrationBin);
  assert.equal(resolveIntegrationBinDir({ LOOM_TEST_PS: '/usr/bin/id', TMPDIR: '/usr' }), undefined);

  const ps = join(integrationBin, 'ps');
  writeFileSync(ps, '#!/bin/sh\nprintf ok\n', { mode: 0o700 });
  const escape = join(integrationBin, 'escape');
  symlinkSync('/usr/bin/id', escape);

  assert.throws(() => registerIntegrationDirectory('/usr/bin'), /private integration-bin/);
  assert.throws(() => registerIntegrationDirectory(other), /private integration-bin/);
  assert.throws(() => registerIntegrationDirectory(wideBin), /private integration-bin/);
  assert.equal(registerIntegrationDirectory(integrationBin), integrationBin);
  assert.equal(execFileSync(ps, [], { encoding: 'utf8' }), 'ok');
  assert.throws(() => execFileSync(escape, []), /registered fixture directory/);

  const fixtureRoot = join(base, '0');
  mkdirSync(fixtureRoot, { mode: 0o700 });
  const guard = fileURLToPath(new URL('./spawn-guard.mjs', import.meta.url));
  const check = (target, extraEnv = {}) => spawnSync(process.execPath, [
    '--import', guard,
    '-e', `import { spawnSync } from 'node:child_process'; const r = spawnSync(${JSON.stringify(target)}, [], { encoding: 'utf8' }); if (r.error) throw r.error; process.stdout.write(r.stdout ?? '');`,
  ], {
    env: {
      PATH: process.env.PATH,
      LOOM_TEST_FIXTURE_ROOT: fixtureRoot,
      LOOM_TEST_INTEGRATION_BIN: integrationBin,
      LOOM_TEST_PS: ps,
      ...extraEnv,
    },
    encoding: 'utf8',
  });
  const allowed = check(ps);
  assert.equal(allowed.status, 0, allowed.stderr);
  assert.equal(allowed.stdout, 'ok');
  assert.notEqual(check(escape).status, 0);
  assert.notEqual(check('/usr/bin/id', { LOOM_TEST_INTEGRATION_BIN: '/usr/bin' }).status, 0);
  assert.equal(existsSync(join(fixtureRoot, 'spawn-violations')), true);
});
