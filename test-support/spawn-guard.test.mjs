import assert from 'node:assert/strict';
import { symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { checkExecutable } from './spawn-guard.mjs';

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
