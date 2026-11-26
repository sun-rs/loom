import { withTuiVersionWarnings } from './tui-version.mjs';
import { spawn } from 'node:child_process';
import { closeSync, constants, mkdirSync, openSync, realpathSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { CommandError } from './sessions.mjs';
import { projectDirectory, projectReceipt } from './project.mjs';
import { providers } from './policy.mjs';
import { daemonAbsent, request } from '../daemon/rpc.mjs';
import { activeRelease } from '../daemon/release.mjs';
import { roles } from '../index/index.mjs';

const executable = fileURLToPath(new URL('../bin/loomd', import.meta.url));
const invalid = message => new CommandError('invalid-arguments', message);
const named = entries => Object.fromEntries(entries.map(key => [key, { type: 'string' }]));
export const spawnUsage = 'loom spawn <role> --cwd DIR [--project DIR] [--task T --wave W] [--keep-warm] [--reason TEXT] [--expect-red] [--integration] [--deliver stream | --deliver barrier --barrier SET] [--cli CLI] [--mode tui|headless] [--model MODEL] [--effort EFFORT] [--parent ADDR] [--handover-from OLD_ADDR] [--trust-workspace] "<prompt>"';
export const spawnHelp = 'Roles: super, leader, auditor, worker, reviewer. Workers require --task and --wave. Worker results stream by default with delivery.coalesceMs (45 seconds). Use --deliver barrier --barrier SET for a set that must arrive together. --parent defaults to LOOM_ADDR in managed sessions. The required .project/policy.json supplies per-role runtime defaults, roles.leader.maxActiveWorkers (default 3, maximum 4) and roles.reviewer.maxDurationMs (default 30 minutes). Only the live Auditor can start one temporary read-only reviewer per gate, with --wave set to the gate ID. --handover-from includes the brief on startup. A Leader or Auditor successor must acknowledge the brief in its first native turn before the predecessor retires.';
export const daemonUsage = 'loom daemon start|stop|status [--project DIR] [--foreground]';

async function status(project) {
  try { return await request(project, 'daemon-status'); }
  catch (error) { if (!daemonAbsent(error)) throw error; return { ok: true, running: false }; }
}

function sawExit(pid) {
  try { process.kill(pid, 0); return false; }
  catch (error) { if (error.code === 'ESRCH') return true; throw error; }
}

export async function startDaemon(project, fallback) {
  const current = await status(project);
  if (current.running) return current;
  const metadata = join(project, '.project');
  mkdirSync(metadata, { mode: 0o700, recursive: true });
  if (realpathSync(metadata) !== metadata) throw new Error('loomd metadata directory must be project-local');
  const logFile = join(metadata, 'loomd.log');
  const log = openSync(logFile, constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | constants.O_NOFOLLOW, 0o600);
  let child;
  try {
    const active = activeRelease(project)?.current ?? fallback;
    child = spawn(process.execPath, [active ? join(active.root, 'bin', 'loomd') : executable, '--project', project], {
      cwd: project, detached: true, stdio: ['ignore', log, log],
      ...(active && { env: { ...process.env, LOOM_RELEASE_ID: active.id } }),
    });
  } finally { closeSync(log); }
  let spawnError;
  child.on('error', error => { spawnError = error; });
  child.unref();
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    await delay(100);
    const result = await status(project);
    if (result.running) return { ...result, log: logFile };
    if (spawnError) throw spawnError;
    if (child.exitCode !== null) {
      // A concurrent start may still be binding the socket under the project lock.
      await delay(350);
      const other = await status(project);
      if (other.running) return { ...other, log: logFile };
      break;
    }
  }
  throw new Error(`loomd failed to start. See ${logFile}`);
}

export async function control(command, args) {
  let values;
  let positionals;
  const spawnOptions = ['cli', 'mode', 'model', 'effort', 'cwd', 'project', 'task', 'wave', 'handover-from', 'deliver', 'barrier'];
  try {
    ({ values, positionals } = parseArgs({ args, allowPositionals: true, options: command === 'spawn' ?
      { ...named([...spawnOptions, 'parent', 'reason']), 'trust-workspace': { type: 'boolean' }, 'expect-red': { type: 'boolean' },
        integration: { type: 'boolean' }, 'keep-warm': { type: 'boolean' } } :
      { ...named(['project']), foreground: { type: 'boolean' } } }));
  } catch (error) { throw invalid(error.message); }

  if (command === 'spawn') {
    const [role, prompt] = positionals;
    if (positionals.length !== 2 || !roles.includes(role) || !prompt.trim() || !isAbsolute(values.cwd ?? '') ||
        ['cli', 'mode', 'model', 'effort', 'task', 'wave', 'parent', 'handover-from'].some(key => values[key] !== undefined && !values[key].trim()) ||
        (role === 'worker' ? !values.task || !values.wave : values['expect-red'] !== undefined || values.integration !== undefined ||
          values['keep-warm'] !== undefined || values.reason !== undefined) ||
        values.integration && values.mode === 'tui' ||
        role === 'reviewer' && !values.wave ||
        (values.deliver !== undefined || values.barrier !== undefined) && (role !== 'worker' ||
          !['stream', 'barrier'].includes(values.deliver) || (values.deliver === 'barrier') !== Boolean(values.barrier?.trim())) ||
        values.cli && !providers.includes(values.cli) || values.mode && !['tui', 'headless'].includes(values.mode)) {
      throw invalid(spawnUsage);
    }
    const project = projectDirectory(values.project);
    try {
      const result = await request(project, 'spawn', { ...values, project, cwd: realpathSync(values.cwd), role, prompt });
      return withTuiVersionWarnings({ ...result, ...projectReceipt(project) }, result.session);
    } catch (error) {
      if (daemonAbsent(error)) throw new CommandError('not-ready', 'loomd is not running for this project');
      throw error;
    }
  }

  const [action] = positionals;
  if (positionals.length !== 1 || !['start', 'stop', 'status'].includes(action) ||
      values.foreground && action !== 'start') throw invalid(daemonUsage);
  const project = projectDirectory(values.project);
  if (action === 'status') return { ...await status(project), ...projectReceipt(project) };
  if (action === 'start' && values.foreground) {
    const active = activeRelease(project)?.current;
    if (active) process.env.LOOM_RELEASE_ID = active.id;
    const entry = active ? pathToFileURL(join(active.root, 'daemon', 'main.mjs')) : new URL('../daemon/main.mjs', import.meta.url);
    await (await import(entry)).main(['--project', project]);
    return;
  }
  if (action === 'start') return { ...await startDaemon(project), ...projectReceipt(project) };
  let result;
  try { result = await request(project, 'daemon-stop'); }
  catch (error) { if (!daemonAbsent(error)) throw error; return { ok: true, running: false, ...projectReceipt(project) }; }
  const deadline = Date.now() + 30_000;
  while (!sawExit(result.pid) && Date.now() < deadline) await delay(100);
  if (!sawExit(result.pid)) throw new CommandError('uncertain', 'loomd shutdown is still pending');
  return { ...result, ...projectReceipt(project) };
}
