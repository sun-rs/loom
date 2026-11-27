import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertSocketPathLimit, resolveIntegrationBinDir } from './integration-bin.mjs';
import { enterPinnedNode, nodeRuntimeRoot } from '../lib/node-runtime.mjs';

function allocateShortRoot(parent) {
  const offset = Math.floor(Math.random() * 36);
  for (let i = 0; i < 36; i++) {
    const candidate = join(parent, ((offset + i) % 36).toString(36));
    try {
      mkdirSync(candidate, { mode: 0o700 });
      return candidate;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
  return mkdtempSync(join(parent, 't'));
}

export function createTestRoot(env = process.env, fallbackTmpdir = tmpdir()) {
  const sandboxed = Boolean(env.LOOM_TEST_PS || env.LOOM_WORKER_TMP);
  const parent = realpathSync(sandboxed ? fallbackTmpdir : '/tmp');
  // Socket and tempfile paths must fit inside the macOS 103-byte Unix socket limit.
  const root = sandboxed ? allocateShortRoot(parent) : mkdtempSync(join(parent, 'lt-'));
  try {
    assertSocketPathLimit(join(root, 's', '0'.repeat(32) + '.sock'), 'Session host socket path');
    assertSocketPathLimit(join(root, 'loom-acct-cli-XXXXXX', '.project', 'loomd.sock'), 'Project daemon socket path');
    assertSocketPathLimit(join(root, 'w-' + '0'.repeat(24), 't', 'ps-00000000.sock'), 'Integration ps socket path');
  } catch (error) {
    rmSync(root, { force: true, recursive: true });
    throw error;
  }
  return root;
}

function main() {
  const outerTmp = realpathSync(tmpdir());
  const integrationBin = resolveIntegrationBinDir(process.env, [outerTmp]);
  const root = createTestRoot(process.env, outerTmp);
  const home = join(root, 'h');
  const bin = join(root, 'bin');
  try {
    mkdirSync(home, { mode: 0o700 });
    mkdirSync(bin, { mode: 0o700 });
    symlinkSync(process.execPath, join(bin, 'node'));
    const guard = fileURLToPath(new URL('./spawn-guard.mjs', import.meta.url));
    const env = {
      HOME: home, TMPDIR: root, TMP: root, TEMP: root, XDG_CONFIG_HOME: home, XDG_DATA_HOME: home, XDG_STATE_HOME: home,
      PATH: [bin, ...(integrationBin ? [integrationBin] : []), '/usr/bin', '/bin'].join(':'),
      GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
      LOOM_DESKTOP_NOTIFY: '0', LOOM_HERDR_LAYOUT: '0', LOOM_TEST_FIXTURE_ROOT: root,
      LOOM_WORKER_TMP: root, LOOM_NODE_ROOT: nodeRuntimeRoot(),
      NODE_OPTIONS: `--import=${JSON.stringify(guard)}`,
      ...(process.env.LOOM_TEST_PS && { LOOM_TEST_PS: process.env.LOOM_TEST_PS, LOOM_TEST_PS_BACKEND: process.env.LOOM_TEST_PS }),
      ...(integrationBin && { LOOM_TEST_INTEGRATION_BIN: integrationBin }),
    };
    const child = spawnSync(process.execPath, ['--test', ...process.argv.slice(2)], { env, stdio: 'inherit' });
    const violations = join(root, 'spawn-violations');
    if (existsSync(violations)) {
      process.stderr.write(readFileSync(violations, 'utf8'));
      process.exitCode = 1;
    } else {
      if (child.error) throw child.error;
      process.exitCode = child.status ?? 1;
    }
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  enterPinnedNode();
  main();
}
