import { createHash } from 'node:crypto';
import { realpathSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import { index, openIndex } from '../index/index.mjs';

const exists = path => statSync(path, { throwIfNoEntry: false });
export const projectOption = '--project DIR selects the absolute project root directory.';
export const callerAddress = () => process.env.LOOM_ADDR || process.env.HC_TERMINAL_ID || undefined;
const invalid = message => Object.assign(new Error(message), { code: 'invalid-arguments' });

function canonicalDirectory(path) {
  if (!isAbsolute(path)) throw invalid(projectOption);
  try {
    const directory = realpathSync(path);
    if (exists(directory)?.isDirectory()) return directory;
  } catch (error) {
    if (!['ENOENT', 'ENOTDIR', 'EINVAL'].includes(error.code)) throw error;
  }
  throw invalid(`Project directory does not exist: ${path}`);
}

export function projectDirectory(project, cwd = process.cwd()) {
  if (project !== undefined) return canonicalDirectory(project);
  if (process.env.LOOM_PROJECT) return canonicalDirectory(process.env.LOOM_PROJECT);
  const start = realpathSync(cwd);
  let gitRoot;
  for (let dir = start; ; dir = dirname(dir)) {
    if (exists(join(dir, '.project'))?.isDirectory()) return dir;
    if (!gitRoot && exists(join(dir, '.git'))) gitRoot = dir;
    if (dir === dirname(dir)) return gitRoot ?? start;
  }
}

export function inDirectory(parent, child) {
  if (typeof child !== 'string' || !isAbsolute(child)) return false;
  const part = relative(parent, child);
  return !isAbsolute(part) && part !== '..' && !part.startsWith(`..${sep}`);
}

export function projectReceipt(project) {
  const digest = createHash('sha256').update(project).digest('hex').slice(0, 12);
  return { project, projectId: `${basename(project) || 'root'}-${digest}` };
}

export function codexEnvironmentArgs(project, addr) {
  return Object.entries({ LOOM_ADDR: addr, LOOM_PROJECT: project }).flatMap(([key, value]) =>
    ['-c', `shell_environment_policy.set.${key}=${JSON.stringify(value).replaceAll('\x7f', '\\u007f')}`]);
}

export const runtimeDirectory = project => join(project, '.project', 'loomd');
export const managedProject = project => exists(runtimeDirectory(project))?.isDirectory() ?? false;
export const socketPath = project => join(project, '.project', 'loomd.sock');
export const projectIndex = project => openIndex(join(project, '.project', 'index.sqlite'));
export const queryIndex = project => managedProject(project) ? projectIndex(project) : index;

export function projectSessions(directory, scoped = true, db = queryIndex(directory)) {
  const rows = db.query();
  if (!scoped || managedProject(directory)) return rows;
  return rows.filter(row => {
    if (row.project === directory) return true;
    if (!isAbsolute(row.project)) return inDirectory(directory, row.cwd);
    try { return realpathSync(row.project) === directory; }
    catch { return false; }
  });
}
