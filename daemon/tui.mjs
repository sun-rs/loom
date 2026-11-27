import { execFile } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { projectMessages } from '../adapters/opencode/index.mjs';
import { hc, hcAt } from '../inbox/tui.mjs';
import { absoluteCommand, openNativeTui } from '../runtimes/tui/transport.mjs';
import { codexFastArgs, nativeClaude, nativeWorkerExecutable } from './executables.mjs';
import { recordWorkerExecutable } from './worker-executables.mjs';
import { eventPath, readText, writeState } from './io.mjs';
import { codexEnvironmentArgs, runtimeDirectory } from '../cli/project.mjs';
import { allowNativeQuestions } from '../cli/policy.mjs';
import { controllerFile, managedEnvironment, releaseRoot } from './release.mjs';
import { workerEnvironment, workerProviderEnvironment } from './worker-environment.mjs';
import { seniorToolEnvironment } from './senior-tools.mjs';
import { statuslinePath } from './account-collection.mjs';

const exec = promisify(execFile);
export const paneName = (addr, resumes) => {
  const base = `loom-${addr.replace(/^loom-/, '').replaceAll('-', '').slice(0, 22)}`;
  return resumes ? `${base.slice(0, 19)}-r${resumes}` : base;
};

export async function ownedPane(job, row) {
  const resumeIndex = job.resumeGeneration ?? 0;
  const name = job.herdr?.hcName ?? paneName(row.addr, resumeIndex);
  const call = job.herdr ? hcAt.bind(null, job.herdr.hcCommand) : hc;
  const terminal = await call('get', row.pane ?? name).catch(error => {
    if (error.kind !== 'not_found') throw error;
  });
  if (job.herdr && !row.pane && terminal?.state === 'finished' && terminal.labels?.['loom.session'] !== row.addr) return;
  if (terminal && (terminal.name !== name || realpathSync(terminal.cwd) !== row.cwd ||
      (job.herdr && terminal.labels?.['loom.session'] !== row.addr) ||
      (row.pane && row.pane !== terminal.address) || (job.paneBinding && (
        terminal.created_ms !== job.paneBinding.createdAt || terminal.pid !== job.paneBinding.pid)))) {
    throw new Error(`hc pane identity changed for ${row.addr}`);
  }
  return terminal;
}

export const managedHookPath = (project, cli) => join(runtimeDirectory(project), cli === 'claude' ? 'hook.mjs' : `${cli}-hook.mjs`);

export function hookRunner(project, cli) {
  const path = managedHookPath(project, cli);
  // Existing sessions run this file across upgrades. The committed release
  // pointer selects the implementation, so the shim itself stays in place.
  if (readText(path, null) === null) writeState(path, readFileSync(new URL('../runtimes/tui/hook-shim.mjs', import.meta.url), 'utf8'));
  return path;
}

export async function openTui(job, row, project, recordTemporary, recordBinding, controller, capabilityPath, statusline = {}, memory) {
  const worker = row.role === 'worker';
  const command = worker ? nativeWorkerExecutable(row.cli) : row.cli === 'claude' ? nativeClaude() : undefined;
  const hookSink = eventPath(project, row.addr);
  const runner = !['opencode', 'claude'].includes(row.cli) && hookRunner(project, row.cli);
  const defaultClaudeAccountDir = resolve(process.env.HOME || homedir(), '.claude');
  const accountEnv = job.accountDir ? (
    row.cli === 'codex' ? { CODEX_HOME: job.accountDir } :
    row.cli === 'agy' ? { ANTIGRAVITY_APP_DATA_DIR: job.accountDir } :
    row.cli === 'claude' && (process.env.CLAUDE_CONFIG_DIR || resolve(job.accountDir) !== defaultClaudeAccountDir)
      ? { CLAUDE_CONFIG_DIR: job.accountDir } : {}
  ) : {};
  const env = { ...managedEnvironment(project, row.addr),
    ...(runner && { LOOM_HOOK_RELEASE: releaseRoot }),
    ...seniorToolEnvironment(project, row),
    ...accountEnv,
    ...(job.isolatedWorkerHome && { ...workerEnvironment(row), ...workerProviderEnvironment(row) }) };
  const resumeIndex = job.resumeGeneration ?? 0;
  const name = job.herdr?.hcName ?? paneName(row.addr, resumeIndex);
  const guardUnset = ['LOOM_CAPABILITY', 'LOOM_EXTERNAL_SUPER',
    ...(env.LOOM_SENIOR_TOOL_LOG ? [] : ['LOOM_SENIOR_TOOL_LOG', 'LOOM_SENIOR_TOOL_PROJECT'])];
  const accountStatusline = job.accountStatusline && {
    sinkPath: statuslinePath(project, job.accountStatusline.generation),
    generation: job.accountStatusline.generation,
    sessionId: row.addr,
    cliVersion: statusline.cliVersion,
  };
  const host = await openNativeTui({
    ...row, memory, ...(accountStatusline && { accountStatusline, statusLine: statusline.statusLine }), command, fast: job.fast, hookSink,
    ...(worker && { recordExecutable: path => recordWorkerExecutable(project, row, path, 'launch') }), ...(runner && { hookRunner: runner }), name, env,
    ...(job.herdr && { hcCommand: job.herdr.hcCommand, placementLabels: job.herdr.labels }),
    sessionId: job.plannedNativeId, ...(job.resumeNativeId && { resume: job.resumeNativeId }), recordTemporary, recordBinding, previous: job.tui, unset: guardUnset, capabilityPath,
    allowNativeQuestions: allowNativeQuestions(project, row.role), toolGuard: Boolean(env.LOOM_SENIOR_TOOL_LOG),
    autoTrustWorkspace: job.autoTrustWorkspace, ...(controller && { controllerPath: controllerFile(project) }),
    stateDir: join(project, '.project', 'pty'),
    ...(row.cli === 'claude' && { env: { ...env, DISABLE_AUTOUPDATER: '1' },
      authMode: job.authMode, unset: [...guardUnset, 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDECODE'] }),
    ...(row.cli === 'codex' && { extraArgs: ['--disable', 'memories', ...codexEnvironmentArgs(env), ...codexFastArgs(job.fast)] }),
  });
  try {
    const terminal = await host.status();
    const version = terminal.labels?.['loom-tui-version'];
    if (accountStatusline && terminal.labels?.['loom-tui-provider'] === row.cli &&
        typeof version === 'string' && /^v?\d+\.\d+\.\d+(?:[-+][a-z0-9.-]+)?$/i.test(version)) {
      try { writeState(accountStatusline.sinkPath + '.version', version); }
      catch { /* Version evidence is optional to the managed pane. */ }
    }
    return { terminal, nativeId: host.sessionId };
  }
  catch (error) { await host.close(); throw error; }
}

export async function openCodeExport(project, row, sessionId, env, command = 'opencode') {
  let data;
  try {
    const worker = row.role === 'worker';
    const executable = worker ? nativeWorkerExecutable(row.cli) : await absoluteCommand(command, 'opencode');
    if (worker) recordWorkerExecutable(project, row, executable, 'export');
    const { stdout } = await exec(executable, ['session', 'export', sessionId, '--standalone'],
      { cwd: row.cwd, env, timeout: 5000, maxBuffer: 32 * 1024 * 1024 });
    data = JSON.parse(stdout);
  } catch (error) {
    const reason = error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' ? 'size-limit' : error.killed ? 'timeout' :
      error.code === 'protected-executable' ? error.code : error.code === 'ENOENT' ? 'executable-unavailable' : error instanceof SyntaxError ? 'invalid-json' : 'command-failed';
    throw Object.assign(new Error(`OpenCode session export failed (${reason})`), { kind: reason });
  }
  const events = data && projectMessages(data, sessionId, row.cwd);
  if (!events) throw Object.assign(new Error('OpenCode session export returned an invalid session'), { kind: 'invalid-session' });
  return { events, empty: data.messages.length === 0 };
}

export async function refreshOpenCode(job, row, project) {
  const { events, empty } = await openCodeExport(project, row, job.plannedNativeId,
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
