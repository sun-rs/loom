import child from 'node:child_process';
import { mkdtemp as makeDirectory } from 'node:fs/promises';
import { mkdtempSync as makeDirectorySync, realpathSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { isAbsolute, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import pty from 'node-pty';
import { providerShellCommands, shellExecutable } from './command-policy.mjs';
import { resolveIntegrationBinDir, validateIntegrationBinDir } from '../test-support/integration-bin.mjs';

const directories = new Set();
const projectHolder = fileURLToPath(new URL(`../holder/bin/loom-holder-${process.platform}-${process.arch}`, import.meta.url));
const integrationDir = resolveIntegrationBinDir(process.env);
if (integrationDir) directories.add(integrationDir);
// Node, the shell hook harness, temporary Git repositories, process accounting and the holder C fixture.
const system = new Set([process.execPath, '/bin/sh', '/bin/bash', '/bin/zsh', '/bin/ps', '/usr/bin/ps',
  '/usr/bin/git', '/usr/bin/cc', '/usr/bin/clang', projectHolder, process.env.LOOM_TEST_PS]);

function inside(root, file) {
  const path = relative(root, file);
  return path && !isAbsolute(path) && path !== '..' && !path.startsWith('../');
}

function register(path) {
  directories.add(realpathSync(path));
  return path;
}

export function registerIntegrationDirectory(path) {
  const validated = validateIntegrationBinDir(path);
  if (!validated) throw new Error('Expected a private integration-bin directory: ' + path);
  directories.add(validated);
  return validated;
}

export const mkdtemp = async (...args) => register(await makeDirectory(...args));
export const mkdtempSync = (...args) => register(makeDirectorySync(...args));

function checked(file, args, options) {
  if (typeof file !== 'string' || !isAbsolute(file)) {
    throw new TypeError('Use an absolute fixture executable path. Test processes may not resolve CLIs through PATH.');
  }
  if (options?.shell || !Array.isArray(args) && args?.shell) throw new Error('Pass literal argv to the fixture runner. Use an explicit pinned shell for shell fixtures.');
  if (shellExecutable(file) && Array.isArray(args) && /^-[a-z]*c[a-z]*$/i.test(args[0] ?? '')) {
    for (const command of providerShellCommands(args[1])) checked(command);
  }
  if (system.has(file)) return file;
  const real = realpathSync(file);
  if (![...directories].some(root => inside(root, real))) {
    throw new Error('Copy the executable into a registered fixture directory before launching it: ' + file);
  }
  return real;
}

export function execFile(file, ...args) {
  return child.execFile(checked(file, ...args), ...args);
}
execFile[promisify.custom] = (file, ...args) => promisify(child.execFile)(checked(file, ...args), ...args);

export const execFileSync = (file, ...args) => child.execFileSync(checked(file, ...args), ...args);
export const spawn = (file, ...args) => child.spawn(checked(file, ...args), ...args);
export const spawnSync = (file, ...args) => child.spawnSync(checked(file, ...args), ...args);
export const { ChildProcess } = child;
export function interceptSpawn(handler) {
  const original = child.spawn;
  child.spawn = (...args) => handler(original, ...args);
  syncBuiltinESMExports();
}
export const spawnPty = (file, ...args) => pty.spawn(checked(file, ...args), ...args);
