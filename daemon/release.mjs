import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { delimiter, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runtimeDirectory } from '../cli/project.mjs';
import { readText, writeState } from './io.mjs';
import { skillRoot } from '../lib/role-skill.mjs';

export const releaseRoot = realpathSync(fileURLToPath(new URL('..', import.meta.url)));
export const managedCliPath = project => join(runtimeDirectory(project), 'bin', 'loom');
const shellWord = value => "'" + value.replaceAll("'", "'\\''") + "'";
export function installManagedCli(project) {
  const dir = runtimeDirectory(project);
  const bin = join(dir, 'bin');
  mkdirSync(bin, { recursive: true, mode: 0o700 });
  if (realpathSync(bin) !== bin) throw new Error('Managed CLI directory must be project-local');
  const program = join(bin, 'dispatch.mjs');
  const code = readFileSync(new URL('./cli-shim.mjs', import.meta.url), 'utf8');
  if (readText(program, null) !== code) writeState(program, code);
  const executable = managedCliPath(project);
  const script = `#!/bin/sh\nexec ${[process.execPath, program, dir, releaseRoot].map(shellWord).join(' ')} "$@"\n`;
  if (readText(executable, null) === null) writeState(executable, script);
  chmodSync(executable, 0o700);
}

export function managedEnvironment(project, addr) {
  const executable = managedCliPath(project);
  const bin = join(runtimeDirectory(project), 'bin');
  const inherited = (process.env.PATH ?? '').split(delimiter).filter(path => path && path !== bin);
  return { LOOM_PROJECT: project, LOOM_ADDR: addr, LOOM_BIN: executable, LOOM_SKILL_ROOT: skillRoot,
    PATH: [bin, ...inherited].join(delimiter) };
}
export const activeReleaseFile = project => join(runtimeDirectory(project), 'release.json');
export const activeRelease = project => JSON.parse(readText(activeReleaseFile(project), 'null'));
export const releaseId = () => process.env.LOOM_RELEASE_ID ?? releaseRoot;
export const upgradeFile = project => join(runtimeDirectory(project), 'upgrade.json');
export const upgradeState = project => JSON.parse(readText(upgradeFile(project), 'null'));
export const controllerFile = project => join(runtimeDirectory(project), 'generation.json');

export function nextController(project) {
  const path = controllerFile(project);
  const previous = JSON.parse(readText(path, '0'));
  const last = previous?.generation ?? previous;
  if (!Number.isSafeInteger(last) || last < 0 || !Number.isSafeInteger(last + 1)) throw new Error('Invalid loomd generation');
  const controller = { generation: last + 1, id: randomUUID() };
  writeState(path, JSON.stringify(controller));
  return controller;
}

const source = ['adapters', 'bin', 'cli', 'daemon', 'evidence', 'handover', 'inbox', 'index', 'lib', 'memory', 'relay', 'runtimes',
  'schema', 'tui', 'watch', 'package.json', 'package-lock.json'];

export const includeReleaseEntry = name => !/^\.(?:env|test-|build-)|^\.[\w-]+-test-/i.test(name) &&
  !/^(?:SKILL\.md|skills|auth\.json|memories.*|provider-homes)$/i.test(name);

export function releaseDigest(root, { legacy = false } = {}) {
  const digest = createHash('sha256');
  function visit(path) {
    const entries = readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'));
    for (const entry of entries) {
      if (!includeReleaseEntry(entry.name)) continue;
      const child = join(path, entry.name);
      if (entry.isDirectory()) visit(child);
      else file(child);
    }
  }
  function file(path) {
    const name = relative(root, path);
    if (name.startsWith('holder/bin/')) {
      digest.update(JSON.stringify([name, createHash('sha256').update(readFileSync(path)).digest('hex')]));
      return;
    }
    const text = readText(path, null);
    if (text === null) throw new Error(`Release file missing: ${name}`);
    digest.update(JSON.stringify([name, text]));
  }
  for (const name of source) {
    const path = join(root, name);
    if (name.endsWith('.json')) file(path);
    else visit(path);
  }
  const skill = join(root, 'skills', 'loom');
  // Releases from before managed role cores have no role assets.
  if (!legacy && existsSync(join(skill, 'roles'))) {
    file(join(skill, 'SKILL.md'));
    for (const dir of ['roles', 'modules', 'references']) visit(join(skill, dir));
  }
  if (!legacy && existsSync(join(root, 'holder'))) visit(join(root, 'holder'));
  return digest.digest('hex');
}
