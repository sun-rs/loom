import { closeSync, constants, fstatSync, mkdirSync, openSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runtimeDirectory } from '../cli/project.mjs';
import { syncDirectory } from './io.mjs';

const workerAddress = /^(?:loom|oar)-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

export const workerExecutableLog = (project, addr) => join(runtimeDirectory(project), 'sessions', `${addr}.executables.jsonl`);

export function recordWorkerExecutable(project, row, path, operation) {
  if (!workerAddress.test(row.addr)) throw new Error('Invalid Worker session address');
  const directory = join(runtimeDirectory(project), 'sessions');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (realpathSync(directory) !== directory) throw new Error('Worker executable journal requires a canonical session directory');
  const fd = openSync(workerExecutableLog(project, row.addr), constants.O_WRONLY | constants.O_CREAT |
    constants.O_APPEND | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
  try {
    if (!fstatSync(fd).isFile()) throw new Error('Worker executable journal must be a regular file');
    writeFileSync(fd, JSON.stringify({ cli: row.cli, path, operation, at: Date.now() }) + '\n', { flush: true });
  } finally { closeSync(fd); }
  syncDirectory(directory);
}
