import { spawnSync } from 'node:child_process';

export const nestedSeatbeltLimited = process.platform === 'darwin' && (() => {
  const probe = spawnSync('/usr/bin/sandbox-exec', ['-p', '(version 1)(allow default)', '/usr/bin/true'],
    { encoding: 'utf8', timeout: 5000 });
  return probe.status === 71 && /sandbox_apply: Operation not permitted/.test(probe.stderr) &&
    'sandbox-limited: macOS rejects a nested Seatbelt profile';
})();
