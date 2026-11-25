import { execFile } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { projectMessages } from '../adapters/opencode/index.mjs';
import { hc } from '../inbox/tui.mjs';
import { absoluteCommand, openNativeTui } from '../runtimes/tui/transport.mjs';
import { codexFastArgs, nativeClaude } from './executables.mjs';
import { eventPath, readText, writeState } from './io.mjs';
import { codexEnvironmentArgs } from '../cli/project.mjs';
import { controllerFile, managedEnvironment } from './release.mjs';
import { workerEnvironment, workerProviderEnvironment } from './worker-environment.mjs';

const exec = promisify(execFile);
export const paneName = addr => `loom-${addr.replace(/^loom-/, '').replaceAll('-', '').slice(0, 22)}`;

export async function ownedPane(job, row) {
  const terminal = await hc('get', row.pane ?? paneName(row.addr)).catch(error => {
    if (error.kind !== 'not_found') throw error;
  });
  if (terminal && (terminal.name !== paneName(row.addr) || realpathSync(terminal.cwd) !== row.cwd ||
      (row.pane && row.pane !== terminal.address) || (job.paneBinding && (
        terminal.created_ms !== job.paneBinding.createdAt || terminal.pid !== job.paneBinding.pid)))) {
    throw new Error(`hc pane identity changed for ${row.addr}`);
  }
  return terminal;
}

export async function openTui(job, row, project, recordTemporary, recordBinding, controller) {
  const hookSink = eventPath(project, row.addr);
  const env = { ...managedEnvironment(project, row.addr),
    ...(job.isolatedWorkerHome && { ...workerEnvironment(row), ...workerProviderEnvironment(row) }) };
  const name = paneName(row.addr);
  const host = await openNativeTui({
    ...row, fast: job.fast, hookSink, name, env, sessionId: job.plannedNativeId, recordTemporary, recordBinding, previous: job.tui,
    autoTrustWorkspace: job.autoTrustWorkspace, ...(controller && { controllerPath: controllerFile(project) }),
    stateDir: join(project, '.project', 'pty'),
    ...(row.cli === 'claude' && { command: nativeClaude(), env: { ...env, DISABLE_AUTOUPDATER: '1' },
      unset: ['CLAUDE_CODE_ENTRYPOINT', 'CLAUDECODE'] }),
    ...(row.cli === 'codex' && { extraArgs: ['--disable', 'memories', ...codexEnvironmentArgs(env), ...codexFastArgs(job.fast)] }),
  });
  try { return { terminal: await host.status(), nativeId: host.sessionId }; }
  catch (error) { await host.close(); throw error; }
}

export async function refreshOpenCode(job, row, project) {
  let data;
  try {
    const executable = await absoluteCommand('opencode', 'opencode');
    const { stdout } = await exec(executable, ['session', 'export', job.plannedNativeId, '--standalone'],
      { cwd: row.cwd, ...(job.isolatedWorkerHome && { env: { ...process.env, ...workerEnvironment(row) } }),
        timeout: 5000, maxBuffer: 8 * 1024 * 1024 });
    data = JSON.parse(stdout);
  } catch (error) {
    if (error.code === 'ENOENT') throw error;
    return null;
  }
  const path = eventPath(project, row.addr);
  const events = projectMessages(data, job.plannedNativeId, row.cwd);
  if (!events) return null;
  if (data.messages.length === 0 && job.paneBinding) {
    events.push({ cwd: row.cwd, session_id: job.plannedNativeId, receivedAt: job.paneBinding.createdAt,
      hook_event_name: 'SessionStart' });
  }
  const text = events.map(event => JSON.stringify(event) + '\n').join('');
  if (text !== readText(path, null)) writeState(path, text);
  return path;
}
