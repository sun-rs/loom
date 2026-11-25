import {
  closeSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync,
  renameSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

function flushDirectory(directory) {
  const fd = openSync(directory, 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

function makeDirectory(directory, project) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const root = resolve(project);
  for (let parent = dirname(resolve(directory)); ; parent = dirname(parent)) {
    flushDirectory(parent);
    if (parent === root) break;
  }
}

function atomicJson(file, value) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify(value) + '\n', { mode: 0o600, flag: 'wx', flush: true });
  renameSync(temporary, file);
  flushDirectory(dirname(file));
}

function readJson(file, fallback) {
  try { return JSON.parse(readFileSync(file, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; return fallback; }
}

const directory = project => join(project, '.project/inbox');
const pathToState = project => join(directory(project), 'state.json');

export function publish(project, message) {
  const incoming = join(directory(project), 'incoming');
  makeDirectory(incoming, project);
  // Concurrent callers publish immutable requests. Only relay mutates the queue.
  const order = Math.trunc((performance.timeOrigin + performance.now()) * 1000)
    .toString().padStart(16, '0');
  atomicJson(join(incoming, `${order}-${message.id}.json`), message);
}

export function lookup(project, id) {
  return readJson(pathToState(project), { messages: [] }).messages.find(message => message.id === id);
}

export function openStore(project) {
  const incoming = join(directory(project), 'incoming');
  makeDirectory(incoming, project);
  const file = pathToState(project);
  const state = readJson(file, { messages: [] });
  const save = () => atomicJson(file, state);

  function ingest() {
    const requests = readdirSync(incoming).filter(name => /^\d+-[0-9a-f-]{36}\.json$/.test(name)).sort();
    if (!requests.length) return;
    const known = new Set(state.messages.map(message => message.id));
    for (const name of requests) {
      const request = readJson(join(incoming, name));
      if (!known.has(request.id)) {
        state.messages.push(request);
        known.add(request.id);
      }
    }
    save();
    for (const name of requests) unlinkSync(join(incoming, name));
    flushDirectory(incoming);
  }

  return { messages: state.messages, save, ingest };
}
