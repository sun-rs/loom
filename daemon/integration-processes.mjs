import { chmodSync, mkdirSync } from 'node:fs';
import { createConnection, createServer } from 'node:net';
import { delimiter, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { processTable } from './processes.mjs';
import { writeState } from './io.mjs';

const columns = new Map([['pid', 'pid'], ['ppid', 'ppid'], ['pgid', 'pgid'], ['uid', 'uid'], ['lstart', 'started'],
  ['comm', 'executable'], ['command', 'executable'], ['args', 'executable']]);
const shellWord = text => "'" + text.replaceAll("'", "'\\''") + "'";

export function integrationProcessRows(table, root, uid) {
  const children = Map.groupBy([...table.values()].filter(row => row.uid === uid), row => row.ppid);
  const owned = new Map();
  const parents = [root];
  for (const pid of parents) for (const row of children.get(pid) ?? []) {
    if (row.pid === root || owned.has(row.pid)) continue;
    owned.set(row.pid, row);
    parents.push(row.pid);
  }
  return [...owned.values()].sort((a, b) => a.pid - b.pid);
}

function parse(args) {
  if (!Array.isArray(args) || args.some(arg => typeof arg !== 'string')) throw new Error('Invalid integration ps arguments');
  const fields = [];
  const pids = new Set();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '-p') {
      if (!/^\d+(?:,\d+)*$/.test(args[++i] ?? '')) throw new Error('Expected numeric ps -p selection');
      for (const pid of args[i].split(',')) pids.add(Number(pid));
    } else if (/^-[aAxXwef]*o$/.test(flag)) {
      for (const field of (args[++i] ?? '').split(',')) {
        const name = field.replace(/=$/, '');
        if (!columns.has(name)) throw new Error(`Unsupported integration ps column ${name}`);
        fields.push({ name, header: name === field });
      }
    } else if (!/^-[aAxXwef]+$/.test(flag)) throw new Error(`Unsupported integration ps option ${flag}`);
  }
  return { fields: fields.length ? fields : ['pid', 'ppid', 'comm'].map(name => ({ name, header: true })), pids };
}

export async function integrationPs(row, env, managedPath) {
  if (row.role !== 'worker' || !row.integration) return;
  const socketPath = join(env.TMPDIR, `ps-${randomUUID().slice(0, 8)}.sock`);
  const bin = join(env.TMPDIR, 'integration-bin');
  mkdirSync(bin, { recursive: true, mode: 0o700 });
  const ps = join(bin, 'ps');
  writeState(ps, `#!/bin/sh\nexec ${[process.execPath, fileURLToPath(import.meta.url), socketPath].map(shellWord).join(' ')} "$@"\n`);
  chmodSync(ps, 0o700);
  const server = createServer(socket => {
    socket.setEncoding('utf8');
    socket.setTimeout(10_000, () => socket.destroy());
    socket.on('error', () => {});
    let data = '';
    socket.on('data', function receive(chunk) {
      data += chunk;
      if (Buffer.byteLength(data) > 4096) return socket.destroy();
      if (!data.includes('\n')) return;
      socket.off('data', receive);
      void (async () => {
        const { fields, pids } = parse(JSON.parse(data));
        const rows = integrationProcessRows(await processTable(), process.pid, process.getuid());
        const selected = pids.size ? rows.filter(row => pids.has(row.pid)) : rows;
        const header = fields.some(field => field.header) ? [fields.map(({ name, header }) => header ? name.toUpperCase() : '').join(' ')] : [];
        const lines = selected.map(row => fields.map(({ name }) => row[columns.get(name)]).join(' '));
        socket.end(JSON.stringify({ output: [...header, ...lines].join('\n'), code: selected.length ? 0 : 1 }) + '\n');
      })().catch(error => socket.end(JSON.stringify({ error: error.message, code: 2 }) + '\n'));
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve); });
  try { chmodSync(socketPath, 0o600); }
  catch (error) { server.close(); throw error; }
  server.unref();
  return { env: { PATH: [bin, managedPath].filter(Boolean).join(delimiter), LOOM_TEST_PS: ps }, close: () => server.close() };
}

async function client(path, argv) {
  const result = await new Promise((resolve, reject) => {
    const socket = createConnection(path);
    let body = '';
    socket.setEncoding('utf8');
    socket.setTimeout(10_000, () => socket.destroy(new Error('Integration ps timed out')));
    socket.once('error', reject);
    socket.once('connect', () => socket.write(JSON.stringify(argv) + '\n'));
    socket.on('data', chunk => { body += chunk; });
    socket.once('end', () => {
      try { resolve(JSON.parse(body)); }
      catch (error) { reject(error); }
    });
  });
  if (result.error) console.error(result.error);
  else if (result.output) console.log(result.output);
  return result.code;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try { process.exitCode = await client(process.argv[2], process.argv.slice(3)); }
  catch (error) { console.error(error.message); process.exitCode = 2; }
}
