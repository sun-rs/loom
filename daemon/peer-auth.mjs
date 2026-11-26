import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

let helper;

export function preparePeerAuth() {
  if (helper) return helper;
  const directory = mkdtempSync(join(realpathSync(tmpdir()), 'loom-peer-'));
  const executable = join(directory, 'peer');
  const source = fileURLToPath(new URL('./peer-auth.c', import.meta.url));
  const cleanup = () => rmSync(directory, { recursive: true, force: true });
  const build = spawnSync('/usr/bin/cc', ['-std=c11', '-Os', '-Wall', '-Wextra', '-Werror', source, '-o', executable],
    { encoding: 'utf8', timeout: 10_000 });
  if (build.status !== 0) {
    cleanup();
    return helper = { available: false,
      reason: `Cannot build the Loom Unix peer helper: ${build.error?.message ?? build.stderr?.trim() ?? 'compiler failed'}` };
  }
  process.once('exit', cleanup);
  const check = spawnSync(executable, ['--self-check'], { encoding: 'utf8', timeout: 2000 });
  const available = check.status === 0 && /^[0-9]+ [0-9]+ [0-9]+ [0-9]+\n/.test(check.stdout);
  return helper = {
    available,
    ...(!available && { reason: 'The kernel did not verify a Unix socket peer' }),
    ancestors(socket) {
      const fd = socket._handle?.fd;
      if (!available || !Number.isSafeInteger(fd) || fd < 0) return [];
      const result = spawnSync(executable, [], { stdio: ['ignore', 'pipe', 'ignore', fd], timeout: 2000,
        encoding: 'utf8', maxBuffer: 8192 });
      if (result.status !== 0) return [];
      const matches = result.stdout.trimEnd().split('\n').map(line => /^(\d+) (\d+) (\d+) (\d+)$/.exec(line));
      if (matches.some(match => !match)) return [];
      return matches.map(match => {
        const [, pid, parent, birth, startedAt] = match.map(Number);
        return { pid, parent, birth, startedAt };
      });
    },
  };
}
