import { createHash, randomUUID } from 'node:crypto';
import { readdirSync, realpathSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runtimeDirectory } from '../cli/project.mjs';
import { readText, writeState } from './io.mjs';

export const releaseRoot = realpathSync(fileURLToPath(new URL('..', import.meta.url)));
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

export function releaseDigest(root) {
  const digest = createHash('sha256');
  function visit(path) {
    const entries = readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'));
    for (const entry of entries) {
      if (/^\.(?:env|test-)/i.test(entry.name) || /^(?:SKILL\.md|skills|auth\.json|memories.*|provider-homes)$/i.test(entry.name)) continue;
      const child = join(path, entry.name);
      if (entry.isDirectory()) visit(child);
      else file(child);
    }
  }
  function file(path) {
    const text = readText(path, null);
    if (text === null) throw new Error(`Release file missing: ${relative(root, path)}`);
    digest.update(JSON.stringify([relative(root, path), text]));
  }
  for (const name of source) {
    const path = join(root, name);
    if (name.endsWith('.json')) file(path);
    else visit(path);
  }
  return digest.digest('hex');
}
