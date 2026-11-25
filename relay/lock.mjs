import { lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

export function claimProject(project) {
  const dir = join(project, '.project/relay');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const lock = join(dir, 'lock');
  const staging = mkdtempSync(join(dir, '.lock-'));
  const token = `${process.pid}-${basename(staging)}`;
  const acquire = () => renameSync(staging, lock);
  function requireExited(pid) {
    if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('invalid relay lock');
    try { process.kill(pid, 0); } catch (error) {
      if (error.code === 'ESRCH') return;
      throw error;
    }
    throw new Error(`relay already running: ${pid}`);
  }
  try {
    writeFileSync(join(staging, token), '', { mode: 0o600 });
    try { acquire(); } catch (error) {
      if (!['EEXIST', 'ENOTEMPTY', 'ENOTDIR'].includes(error.code)) throw error;
      const previous = lstatSync(lock, { throwIfNoEntry: false });
      if (previous?.isDirectory()) {
        const [owner, extra] = readdirSync(lock);
        if (owner) {
          if (extra || !/^\d+-\.lock-[A-Za-z0-9]+$/.test(owner)) throw new Error('invalid relay lock');
          requireExited(Number(owner.split('-', 1)[0]));
          // The token is unique to the dead writer. A competing takeover
          // can install another directory without its owner being unlinked.
          rmSync(join(lock, owner), { force: true });
        }
      } else if (previous?.isFile()) {
        requireExited(Number(readFileSync(lock, 'utf8')));
        try { unlinkSync(lock); } catch (failure) { if (failure.code !== 'ENOENT') throw failure; }
      } else if (previous) {
        throw new Error('invalid relay lock');
      }
      acquire();
    }
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
  return () => rmSync(join(lock, token), { force: true });
}
