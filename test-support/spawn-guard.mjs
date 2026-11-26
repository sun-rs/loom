import children from 'node:child_process';
import { appendFileSync, realpathSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { basename, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '');
const root = process.env.LOOM_TEST_FIXTURE_ROOT;
const trusted = new Set([process.execPath, process.env.LOOM_TEST_PS_BACKEND, join(repo, 'bin/loom'), join(repo, 'bin/loomd'),
  ...['darwin-arm64', 'linux-arm64', 'linux-x64'].map(name => join(repo, 'holder/bin/loom-holder-' + name)),
  ...['/bin/ps', '/bin/sh', '/bin/bash', '/bin/zsh', '/bin/echo', '/bin/kill', '/usr/bin/git', '/usr/bin/env',
    '/usr/bin/cc', '/usr/bin/clang', '/usr/bin/true', '/usr/bin/script', '/usr/bin/sandbox-exec', '/usr/bin/codesign'],
].filter(Boolean).flatMap(path => {
  try { return [realpathSync(path)]; } catch { return []; }
}));

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
  if (executable && (trusted.has(executable) || executable.startsWith(root + sep))) return;
  const message = `Test subprocess ${basename(file)} must use an absolute executable in its fixture directory or an allowlisted runtime tool`;
  if (record) appendFileSync(join(root, 'spawn-violations'), message + '\n', { mode: 0o600 });
  throw Object.assign(new Error(message), { code: 'loom-test-executable' });
}

if (root) {
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
