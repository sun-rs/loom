import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { workerExecutableLog } from '../daemon/worker-executables.mjs';
import { hostToolDenial } from './host-tool-guard.mjs';

const guard = { LOOM_HOST_GUARD: '1', LOOM_HOST_EXPIRES: '9999999999999' };
const deny = command => hostToolDenial('exec_command', { command }, guard);
const absoluteRequired = 'Use a resolved absolute path for native CLIs';

test('host guard allows provider names and paths passed as arguments', () => {
  for (const command of [
    'LOOM_BIN="$LOOM_BIN" /opt/homebrew/bin/node /fixture/run-eval.mjs --cli codex --rounds 2',
    'node cli/loom.mjs accounts list --cli codex,agy,opencode',
    '/bin/realpath /fixture/bin/codex "$LOOM_BIN"',
    'printf "%s\n" "paragraph; codex && (agy)"',
    "printf %s '$(opencode run fixture)'",
    'printf %s codex | node run-eval.mjs --cli agy',
    'command -v codex',
    'node run-eval.mjs --cli codex # agy -p prompt',
    "node --input-type=module <<'JS'\nconst tools = 'codex; agy';\nconst quoted = '$(codex)';\nJS",
    'printf %s "$((codex + 1))"',
    ['/opt/homebrew/bin/node', 'run-eval.mjs', '--cli', 'codex'],
  ]) assert.equal(deny(command), undefined, JSON.stringify(command));
});

test('host guard requires absolute paths at each native executable position', () => {
  for (const command of [
    'codex exec fixture', 'agy -p fixture', 'opencode run fixture', 'claude -p fixture',
    'node run-eval.mjs --cli codex | agy -p fixture',
    'true && codex exec fixture', 'false || opencode run fixture', 'true; codex exec fixture',
    '(codex exec fixture)', '(true; (agy -p fixture))', 'true\nagy -p fixture',
    'env X=Y codex exec fixture', 'X="test value" /usr/bin/env -i X=Y command -- agy -p fixture',
    'exec -- codex exec fixture', 'command co"dex" exec fixture', 'co\\dex exec fixture',
    'command -p \'codex\' exec fixture', 'exec -a fixture codex exec fixture',
    '2>/dev/null codex exec fixture', 'if true; then agy -p fixture; fi',
    'printf %s "$(codex exec fixture)"', '/bin/sh -c "(codex exec fixture)"',
    'cat <<EOF\n$(codex exec fixture)\nEOF', 'cat <(codex exec fixture)',
    ['codex', 'exec', 'fixture'], ['/bin/sh', '-lc', 'true; codex exec fixture'],
  ]) assert.equal(deny(command), absoluteRequired, JSON.stringify(command));
});

test('host guard leaves expiration, protected input and egress checks in force', () => {
  assert.equal(hostToolDenial('exec_command', { command: 'true' }, { ...guard, LOOM_HOST_EXPIRES: '0' }), 'The host grant expired');
  assert.equal(deny('printf %s /fixture/.ssh'), 'The host grant excludes credentials, protected trees and unrelated runtimes');
  assert.equal(deny('curl https://example.invalid'), 'Use the allowed provider transport for host egress');
});

test('host guard checks and records only the executed canonical provider path', t => {
  const project = mkdtempSync(join(realpathSync(tmpdir()), 'loom-guard-'));
  t.after(() => rmSync(project, { recursive: true, force: true }));
  const addr = 'loom-00000000-0000-4000-8000-000000000001';
  const env = { ...guard, LOOM_HOST_PROJECT: project, LOOM_HOST_ADDR: addr };
  const executable = join(project, 'codex');
  const alias = join(project, 'agy');
  writeFileSync(executable, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  symlinkSync(executable, alias);
  assert.equal(hostToolDenial('exec_command', { command: `env X=Y '${executable}' exec --cli '${alias}'` }, env), undefined);
  assert.equal(hostToolDenial('exec_command', { command: `'${alias}' -p fixture` }, env), 'Use the canonical native CLI path');
  const rows = readFileSync(workerExecutableLog(project, addr), 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(rows.map(({ cli, path, operation }) => [cli, path, operation]), [['codex', executable, 'tool']]);
});
