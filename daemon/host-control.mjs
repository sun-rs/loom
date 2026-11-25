import { createHash } from 'node:crypto';
import { chmodSync, lstatSync, mkdirSync } from 'node:fs';
import { createConnection } from 'node:net';
import { join } from 'node:path';
import { runtimeDirectory } from '../cli/project.mjs';
import { readText } from './io.mjs';

export const hostProtocol = 1;
export const hostProtocols = [1, 2];
export const hostMethods = ['hello', 'claim', 'state', 'receipt', 'control', 'close'];
export const hostAbsent = error => ['ENOENT', 'ECONNREFUSED'].includes(error.code);
export const hostUUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
export const hostLineLimit = 2 * 1024 * 1024;
export const hostDirectory = (project, addr, incarnation) =>
  join(runtimeDirectory(project), 'hosts', addr, incarnation);
export const readJSON = (path, fallback = null) => JSON.parse(readText(path, JSON.stringify(fallback)));

export function hostSocket(project, addr, incarnation) {
  // Unix socket paths have a small platform limit. Keep the journal and
  // ownership record in the project, with only the socket in this private dir.
  const dir = `/tmp/loom-host-${process.getuid()}`;
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const info = lstatSync(dir);
  if (!info.isDirectory() || info.uid !== process.getuid() || (info.mode & 0o077)) {
    throw new Error('Session host socket directory must be private');
  }
  const key = createHash('sha256').update(JSON.stringify([project, addr, incarnation])).digest('hex').slice(0, 32);
  return join(dir, key + '.sock');
}

export function receiveHostLine(socket, callback) {
  let input = '';
  socket.setEncoding('utf8');
  socket.on('data', function receive(chunk) {
    input += chunk;
    if (Buffer.byteLength(input) > hostLineLimit) return socket.destroy();
    const newline = input.indexOf('\n');
    if (newline < 0) return;
    socket.off('data', receive);
    callback(input.slice(0, newline));
  });
}

export function hostRequest(path, owner, method, params, protocol, controller) {
  return new Promise((resolve, reject) => {
    const socket = createConnection(path);
    const fail = error => { socket.destroy(); reject(error); };
    const request = JSON.stringify({ owner, method, params, protocol, controller }) + '\n';
    if (Buffer.byteLength(request) > hostLineLimit) return fail(new Error('Session host request is too large'));
    socket.setTimeout(15_000, () => fail(new Error('Session host request timed out')));
    socket.once('error', fail);
    socket.once('close', () => fail(new Error('Session host closed without a receipt')));
    socket.once('connect', () => socket.write(request));
    receiveHostLine(socket, line => {
      try {
        const reply = JSON.parse(line);
        if (!reply.ok) throw Object.assign(new Error(reply.error), { kind: reply.kind });
        resolve(reply.result);
        socket.end();
      } catch (error) { fail(error); }
    });
  });
}

export async function hostHello(path, incarnation) {
  const hello = await hostRequest(path, incarnation, 'hello');
  if (hello.incarnation !== incarnation) throw new Error('Session host identity changed');
  if (!hostProtocols.includes(hello.protocol) || !hostMethods.every(method => hello.methods?.includes(method))) {
    throw new Error(`Unsupported session host protocol: ${hello.protocol}`);
  }
  return hello;
}

export const privateHostSocket = path => chmodSync(path, 0o600);
