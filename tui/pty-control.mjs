import net from 'node:net';
import { chmod, lstat, unlink } from 'node:fs/promises';
import { dirname, isAbsolute } from 'node:path';

const maximumRequest = 64 * 1024;
export const controlProtocol = 1;
const supportedProtocols = [0, 1, 2];
const methods = new Set(['hello', 'state', 'submit', 'interrupt', 'dialog', 'confirmations']);

function receive(socket, limit, callback) {
  let input = '';
  let answered = false;
  socket.setEncoding('utf8');
  socket.on('data', chunk => {
    if (answered) return;
    input += chunk;
    if (Buffer.byteLength(input) > limit) {
      answered = true;
      socket.destroy();
    } else if (input.includes('\n')) {
      answered = true;
      callback(input.slice(0, input.indexOf('\n')));
    }
  });
}

export async function listenControl(path, session, incarnation) {
  if (!isAbsolute(path)) throw new Error('Control socket path must be absolute');
  const parent = await lstat(dirname(path));
  if (!parent.isDirectory() || parent.uid !== process.getuid() || (parent.mode & 0o077)) {
    throw new Error('Control socket requires a private directory owned by the caller');
  }
  const clients = new Set();
  const server = net.createServer(socket => {
    clients.add(socket);
    socket.on('close', () => clients.delete(socket));
    socket.on('error', () => {});
    socket.setTimeout(45_000, () => socket.destroy());
    receive(socket, maximumRequest, async line => {
      let response;
      try {
        const { method, params = {}, owner, protocol } = JSON.parse(line);
        if (incarnation && owner !== incarnation) throw new Error('Control socket identity changed');
        if (protocol !== undefined && protocol !== 1 && protocol !== controlProtocol) throw new Error('Unsupported control protocol');
        if (!methods.has(method) || typeof params !== 'object' || params === null) throw new Error('Invalid control request');
        for (const key of ['deferMs', 'timeoutMs']) {
          if (params[key] !== undefined && (!Number.isSafeInteger(params[key]) || params[key] < 0 || params[key] > 20_000)) {
            throw new Error('Control wait must be 0–20000 ms');
          }
        }
        const result = method === 'hello' ? { protocol: controlProtocol, incarnation, methods: [...methods] } :
          method === 'state' ? await session.readState() :
          method === 'confirmations' ? await session.confirmations(params.id) : await session[method](params);
        response = { ok: true, result };
      } catch (error) {
        response = { ok: false, error: error.message, code: error.code };
      }
      socket.end(JSON.stringify(response) + '\n');
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(path, resolve);
  });
  await chmod(path, 0o600);
  return async () => {
    for (const client of clients) client.destroy();
    await new Promise(resolve => server.close(resolve));
    await unlink(path).catch(error => { if (error.code !== 'ENOENT') throw error; });
  };
}

// A wrapper can outlive the Loom client that spawned it. Older wrappers are
// still usable with the original control methods and incarnation check.
export async function controlHello(path, owner) {
  let hello;
  try {
    hello = await requestControl(path, 'hello', undefined, owner);
  } catch (error) {
    if (error.message === 'Invalid control request') return { protocol: 0, incarnation: owner,
      methods: [...methods].filter(method => method !== 'hello') };
    throw error;
  }
  if (hello.incarnation !== owner) throw new Error('Control socket identity changed');
  if (!supportedProtocols.includes(hello.protocol) || ![...methods].every(method => hello.methods?.includes(method))) {
    throw new Error(`Unsupported loom-pty protocol: ${hello.protocol}`);
  }
  return hello;
}

export function requestControl(path, method, params, owner, protocol) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(path);
    const fail = error => { socket.destroy(); reject(error); };
    socket.setTimeout(45_000, () => fail(Object.assign(new Error('Control request timed out'), { code: 'ETIMEDOUT' })));
    socket.once('error', fail);
    socket.once('close', () => fail(Object.assign(new Error('Control socket closed without a receipt'), { code: 'CONTROL_EOF' })));
    const request = JSON.stringify({ method, params, owner, protocol }) + '\n';
    if (Buffer.byteLength(request) > maximumRequest) {
      fail(Object.assign(new Error('Control request is too large'), { code: 'INPUT_SIZE' }));
      return;
    }
    socket.once('connect', () => socket.write(request));
    receive(socket, 2 * 1024 * 1024, line => {
      try {
        const message = JSON.parse(line);
        if (!message.ok) throw Object.assign(new Error(message.error), { code: message.code });
        resolve(message.result);
        socket.end();
      } catch (error) {
        fail(error);
      }
    });
  });
}
