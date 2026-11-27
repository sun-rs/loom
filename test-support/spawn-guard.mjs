import children from 'node:child_process';
import { appendFileSync, realpathSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import net from 'node:net';
import { basename, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveIntegrationBinDir, UNIX_SOCKET_PATH_LIMIT } from './integration-bin.mjs';

const repo = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '');
const root = process.env.LOOM_TEST_FIXTURE_ROOT;
const integrationDir = resolveIntegrationBinDir(process.env);
const fixtureDirs = [root, integrationDir].filter(Boolean);
const trusted = new Set([process.execPath, join(repo, 'bin/loom'), join(repo, 'bin/loomd'),
  ...['darwin-arm64', 'linux-arm64', 'linux-x64'].map(name => join(repo, 'holder/bin/loom-holder-' + name)),
  ...['/bin/ps', '/bin/sh', '/bin/bash', '/bin/zsh', '/bin/echo', '/bin/kill', '/usr/bin/git', '/usr/bin/env',
    '/usr/bin/cc', '/usr/bin/clang', '/usr/bin/true', '/usr/bin/script', '/usr/bin/sandbox-exec', '/usr/bin/codesign'],
].filter(Boolean).flatMap(path => {
  try { return [realpathSync(path)]; } catch { return []; }
}));

function socketPathFromArgs(args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  if (typeof first === 'string' && first.length > 0 && Number.isNaN(Number(first))) return first;
  if (first && typeof first === 'object' && typeof first.path === 'string') return first.path;
  return undefined;
}

export function checkSocketPath(path, record = true) {
  if (typeof path !== 'string' || !path) return;
  const bytes = Buffer.byteLength(path);
  if (bytes <= UNIX_SOCKET_PATH_LIMIT) return;
  const message = `Test Unix socket path exceeds ${UNIX_SOCKET_PATH_LIMIT} bytes (${bytes}): ${path}`;
  if (root && record) appendFileSync(join(root, 'spawn-violations'), message + '\n', { mode: 0o600 });
  throw Object.assign(new Error(message), { code: 'loom-test-socket-path' });
}

export function checkExecutable(file, options = {}, record = true) {
  if (!root || typeof file !== 'string') return;
  const cwd = options?.cwd ?? process.cwd();
  const paths = isAbsolute(file) ? [file] : file.includes(sep) ? [resolve(cwd, file)] :
    ['git', 'ps', 'node', 'sh', 'bash', 'cc', 'clang', 'env', 'true', 'echo'].includes(file) ?
      (options?.env?.PATH ?? process.env.PATH).split(':').filter(isAbsolute).map(dir => join(dir, file)) : [];
  let executable;
  for (const path of paths) {
    try { executable = realpathSync(path); break; } catch { /* Probe the next PATH entry. */ }
  }
  if (executable && (trusted.has(executable) || fixtureDirs.some(dir => executable.startsWith(dir + sep)))) return;
  const message = `Test subprocess ${basename(file)} must use an absolute executable in its fixture directory or an allowlisted runtime tool`;
  if (record) appendFileSync(join(root, 'spawn-violations'), message + '\n', { mode: 0o600 });
  throw Object.assign(new Error(message), { code: 'loom-test-executable' });
}

if (root) {
  const listen = net.Server.prototype.listen;
  net.Server.prototype.listen = function (...args) {
    checkSocketPath(socketPathFromArgs(args));
    return listen.apply(this, args);
  };
  const connect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (...args) {
    checkSocketPath(socketPathFromArgs(args));
    return connect.apply(this, args);
  };
  const spawn = children.ChildProcess.prototype.spawn;
  children.ChildProcess.prototype.spawn = function (options) {
    const path = options.envPairs?.find(pair => pair.startsWith('PATH='))?.slice(5);
    checkExecutable(options.file, { cwd: options.cwd, env: { PATH: path } });
    return spawn.call(this, options);
  };
  for (const method of ['spawn', 'spawnSync', 'execFile', 'execFileSync']) {
    const original = children[method];
    const wrapped = (file, args, options, ...rest) => {
      checkExecutable(file, Array.isArray(args) ? options : args);
      return original(file, args, options, ...rest);
    };
    Object.defineProperties(wrapped, Object.fromEntries(Object.getOwnPropertySymbols(original)
      .filter(symbol => typeof original[symbol] === 'function')
      .map(symbol => [symbol, { value(file, args, options) {
        checkExecutable(file, Array.isArray(args) ? options : args);
        return original[symbol](file, args, options);
      } }])));
    children[method] = wrapped;
  }
  syncBuiltinESMExports();
}
