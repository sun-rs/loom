import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { delimiter, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runtimeDirectory } from '../cli/project.mjs';
import { readText, writeState } from './io.mjs';

export const releaseRoot = realpathSync(fileURLToPath(new URL('..', import.meta.url)));
export function managedEnvironment(project, addr) {
  const bin = join(releaseRoot, 'bin');
  const inherited = (process.env.PATH ?? '').split(delimiter).filter(path => path && path !== bin);
  return { LOOM_PROJECT: project, LOOM_ADDR: addr, LOOM_BIN: join(bin, 'loom'), PATH: [bin, ...inherited].join(delimiter) };
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

export function releaseDigest(root, { legacy = false } = {}) {
  const digest = createHash('sha256');
  function visit(path) {
    const entries = readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'));
    for (const entry of entries) {
      if (/^\.(?:env|test-|build-)|^\.[\w-]+-test-/i.test(entry.name) || /^(?:SKILL\.md|skills|auth\.json|memories.*|provider-homes)$/i.test(entry.name)) continue;
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
  if (!legacy && existsSync(join(root, 'holder'))) visit(join(root, 'holder'));
  return digest.digest('hex');
}
