import { spawn } from 'node:child_process';
import { lstatSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, sep } from 'node:path';
import { once } from 'node:events';

export async function openClaudeShell({ directory, cwd }, temporary, home) {
  const socketPath = join(directory, 'shell.sock');
  const executable = join(directory, 'bash');
  const privateHome = join(directory, 'shell-home');
  mkdirSync(privateHome, { mode: 0o700 });
  const scoped = [cwd, temporary, privateHome].map(path => `(subpath ${JSON.stringify(path)})`).join(' ');
  const profile = `(version 1)
(allow default)
(deny network*)
(allow network* (local unix-socket (subpath ${JSON.stringify(temporary)})))
(deny file-read* (subpath ${JSON.stringify(home)}) (subpath "/private/tmp") (subpath "/private/var/folders"))
(allow file-read-metadata (literal "/private/tmp") (literal ${JSON.stringify(directory)}))
(allow file-read* ${scoped})
(deny file-write*)
(allow file-write* ${scoped} (literal "/dev/null"))`;
  const children = new Set();
  const server = createServer({ allowHalfOpen: true }, peer => {
    peer.setEncoding('utf8');
    let input = '';
    peer.on('error', () => peer.destroy());
    peer.once('end', () => {
      let request;
      let working;
      try {
        request = JSON.parse(input);
        if (typeof request.cwd === 'string') working = realpathSync(request.cwd);
      }
      catch { peer.end(JSON.stringify({ exit: 126 }) + '\n'); return; }
      if (!(working === cwd || working?.startsWith(cwd + sep)) || !Array.isArray(request.args) ||
          request.args.some(arg => typeof arg !== 'string')) {
        peer.end(JSON.stringify({ exit: 126 }) + '\n');
        return;
      }
      const tracker = request.args.map(arg => /\bpwd(?:\s+-P)?\s*>\|?\s*["']?(\/tmp\/claude-[a-f0-9]{4,12}-cwd)\b/i.exec(arg)?.[1])
        .find(Boolean);
      const file = tracker && '/private' + tracker;
      const info = file && lstatSync(file, { throwIfNoEntry: false });
      const tracking = file && (!info || info.isFile() && info.uid === process.getuid()) ?
        `\n(allow file-write* file-read-metadata (literal ${JSON.stringify(file)}))` : '';
      const child = spawn('/usr/bin/sandbox-exec', ['-p', profile + tracking, '/bin/bash', ...request.args], {
        cwd: working, env: { HOME: privateHome, TMPDIR: temporary, PATH: '/opt/homebrew/bin:/usr/bin:/bin',
          TERM: 'dumb', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      children.add(child);
      for (const channel of ['stdout', 'stderr']) child[channel].on('data', bytes => {
        if (!peer.destroyed) peer.write(JSON.stringify({ channel, bytes: bytes.toString('base64') }) + '\n');
      });
      child.once('error', () => peer.end(JSON.stringify({ exit: 126 }) + '\n'));
      child.once('close', (code, signal) => {
        children.delete(child);
        if (!peer.destroyed) peer.end(JSON.stringify({ exit: code ?? (signal === 'SIGTERM' ? 143 : 1) }) + '\n');
      });
      peer.once('close', () => { if (children.has(child)) child.kill('SIGTERM'); });
    });
    peer.on('data', chunk => {
      input += chunk;
      if (Buffer.byteLength(input) > 1024 * 1024) peer.destroy();
    });
  });
  server.listen({ path: socketPath, readableAll: false, writableAll: false });
  await once(server, 'listening');
  writeFileSync(executable, `#!${process.execPath}
const { createConnection } = require('node:net');
const { createInterface } = require('node:readline');
const peer = createConnection(${JSON.stringify(socketPath)});
peer.once('connect', () => peer.end(JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2) })));
peer.once('error', () => { process.exitCode = 126; });
process.exitCode = 126;
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => peer.destroy());
createInterface({ input: peer }).on('line', line => {
  const row = JSON.parse(line);
  if (row.channel) process[row.channel].write(Buffer.from(row.bytes, 'base64'));
  else process.exitCode = row.exit;
});
`, { mode: 0o700 });
  return { executable, close() {
    for (const child of children) child.kill('SIGTERM');
    server.close();
  } };
}
