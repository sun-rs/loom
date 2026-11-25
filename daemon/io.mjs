import { constants, closeSync, fstatSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, truncateSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';

export function readText(path, fallback = '') {
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    if (!fstatSync(fd).isFile()) throw new Error('Expected a regular file');
    return readFileSync(fd, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return fallback;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export const jsonRows = text => text.slice(0, text.lastIndexOf('\n') + 1).split('\n').filter(Boolean).map(line => JSON.parse(line));
export const eventPath = (project, addr) => join(project, '.project', 'relay', 'events', `${addr}.jsonl`);

export function prepareJournal(path) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const text = readText(path, null);
  if (text === null) {
    writeFileSync(path, '', { mode: 0o600, flag: 'wx', flush: true });
    syncDirectory(dirname(path));
    return '';
  }
  const last = text.lastIndexOf('\n') + 1;
  if (last === text.length) return text;
  const complete = text.slice(0, last);
  truncateSync(path, Buffer.byteLength(complete));
  return complete;
}

export function syncDirectory(path) {
  const dir = openSync(path, 'r');
  try { fsyncSync(dir); } finally { closeSync(dir); }
}

export function writeState(path, text) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, text, { flag: 'wx', mode: 0o600, flush: true });
  renameSync(temporary, path);
  syncDirectory(dirname(path));
}
