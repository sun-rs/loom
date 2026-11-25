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
      authMode: job.authMode, unset: ['CLAUDE_CODE_ENTRYPOINT', 'CLAUDECODE'] }),
    ...(row.cli === 'codex' && { extraArgs: ['--disable', 'memories', ...codexEnvironmentArgs(env), ...codexFastArgs(job.fast)] }),
  });
  try { return { terminal: await host.status(), nativeId: host.sessionId }; }
  catch (error) { await host.close(); throw error; }
}

export async function openCodeExport(row, sessionId, env, command = 'opencode') {
  let data;
  try {
    const executable = await absoluteCommand(command, 'opencode');
    const { stdout } = await exec(executable, ['session', 'export', sessionId, '--standalone'],
      { cwd: row.cwd, env, timeout: 5000, maxBuffer: 32 * 1024 * 1024 });
    data = JSON.parse(stdout);
  } catch (error) {
    const reason = error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' ? 'size-limit' : error.killed ? 'timeout' :
      error.code === 'ENOENT' ? 'executable-unavailable' : error instanceof SyntaxError ? 'invalid-json' : 'command-failed';
    throw Object.assign(new Error(`OpenCode session export failed (${reason})`), { kind: reason });
  }
  const events = data && projectMessages(data, sessionId, row.cwd);
  if (!events) throw Object.assign(new Error('OpenCode session export returned an invalid session'), { kind: 'invalid-session' });
  return { events, empty: data.messages.length === 0 };
}

export async function refreshOpenCode(job, row, project) {
  const { events, empty } = await openCodeExport(row, job.plannedNativeId,
    job.isolatedWorkerHome ? { ...process.env, ...workerEnvironment(row) } : undefined);
  const path = eventPath(project, row.addr);
  if (empty && job.paneBinding) {
    events.push({ cwd: row.cwd, session_id: job.plannedNativeId, receivedAt: job.paneBinding.createdAt,
      hook_event_name: 'SessionStart' });
  }
  const text = events.map(event => JSON.stringify(event) + '\n').join('');
  if (text !== readText(path, null)) writeState(path, text);
  return path;
}
