import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { resolveNativeExecutable } from './executables.mjs';
import { openOar } from './oar.mjs';

function temporary(t) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'loom-native-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test('native resolution requires an executable absolute path outside protected wrappers', t => {
  const root = temporary(t);
  const binary = join(root, 'native-codex');
  const alias = join(root, 'codex');
  const protectedAlias = join(root, 'claude-protected');
  writeFileSync(binary, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  symlinkSync(binary, alias);
  symlinkSync(binary, protectedAlias);
  assert.equal(resolveNativeExecutable(alias), binary);
  assert.throws(() => resolveNativeExecutable('codex'), { code: 'invalid-arguments' });
  assert.throws(() => resolveNativeExecutable(protectedAlias), { code: 'protected-executable' });
  assert.throws(() => resolveNativeExecutable(join(root, 'missing')), { code: 'ENOENT' });
  assert.throws(() => resolveNativeExecutable(root), { code: 'EACCES' });
});

test('OAR rejects a Worker override alias to protected CCP before probing it', async t => {
  const project = temporary(t);
  const ccp = join(project, 'ccp');
  const target = join(ccp, 'codex');
  const alias = join(project, 'codex');
  const probe = join(project, 'probe');
  mkdirSync(ccp);
  writeFileSync(target, `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(probe)}, 'called');\n`,
    { mode: 0o700 });
  symlinkSync(target, alias);
  const previous = process.env.LOOM_CODEX_BIN;
  process.env.LOOM_CODEX_BIN = alias;
  t.after(() => {
    if (previous === undefined) delete process.env.LOOM_CODEX_BIN;
    else process.env.LOOM_CODEX_BIN = previous;
  });
  const row = { addr: `oar-${randomUUID()}`, role: 'worker', cli: 'codex', runtimeId: 'codex', cwd: project };
  await assert.rejects(openOar(row, project), { code: 'protected-executable' });
  assert.equal(existsSync(probe), false);
});
