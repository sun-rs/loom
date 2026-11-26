import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Socket and tempfile paths must fit inside the macOS Unix socket limit.
const root = mkdtempSync(join(realpathSync(process.env.LOOM_TEST_PS ? tmpdir() : '/tmp'), 'lt-'));
const home = join(root, 'h');
const bin = join(root, 'bin');
try {
  mkdirSync(home, { mode: 0o700 });
  mkdirSync(bin, { mode: 0o700 });
  symlinkSync(process.execPath, join(bin, 'node'));
  const guard = fileURLToPath(new URL('./spawn-guard.mjs', import.meta.url));
  const env = {
    HOME: home, TMPDIR: root, TMP: root, TEMP: root, XDG_CONFIG_HOME: home, XDG_DATA_HOME: home, XDG_STATE_HOME: home,
    PATH: [bin, '/usr/bin', '/bin'].join(':'), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
    LOOM_DESKTOP_NOTIFY: '0', LOOM_HERDR_LAYOUT: '0', LOOM_TEST_FIXTURE_ROOT: root,
    LOOM_WORKER_TMP: root,
    NODE_OPTIONS: `--import=${JSON.stringify(guard)}`,
    ...(process.env.LOOM_TEST_PS && { LOOM_TEST_PS: process.env.LOOM_TEST_PS, LOOM_TEST_PS_BACKEND: process.env.LOOM_TEST_PS }),
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
