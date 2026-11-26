import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hookConfig } from './hooks.mjs';

const capture = fileURLToPath(new URL('./capture-hook.mjs', import.meta.url));
const defaultModel = 'Gemini 3.8 Flash';
const effortVariants = /^(Gemini (?:3\.8 Flash|4 (?:Neon|Carbon|Argon|Hydrogen))|Claude (?:Opus|Sonnet) 5\.5)(?: \((?:Low|Medium|High|XHigh|Max)\))?$/i;
const effortLabels = new Map([['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['xhigh', 'XHigh'], ['max', 'Max']]);

// Orca b7fd7caa3: src/shared/shell/launch/shell-argument-quoting.ts:4-7.
/** POSIX sh single-quoting: each `'` closes the quote, is escaped, and reopens it (`'\''`). */
function quotePosixShell(value) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function inside(parent, child) {
  const path = relative(parent, child);
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`));
}

function stageHooks(directory, sink, captureScript, sessionId) {
  mkdirSync(dirname(sink), { recursive: true, mode: 0o700 });
  const parent = realpathSync(dirname(sink));
  const stagingRoot = inside(directory, parent) ? realpathSync(tmpdir()) : parent;
  if (inside(directory, stagingRoot)) throw new Error('agy needs a hook staging directory outside cwd');
  const workspace = mkdtempSync(join(stagingRoot, 'loom-agy-hooks-'));
  const sinkPath = join(parent, basename(sink));
  try {
    const config = hookConfig(event => [process.execPath, captureScript, sinkPath, directory, event, join(workspace, 'session'), sessionId ?? '']
      .map(quotePosixShell).join(' '));
    mkdirSync(join(workspace, '.agents'), { mode: 0o700 });
    writeFileSync(join(workspace, '.agents', 'hooks.json'), `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    return workspace;
  } catch (error) {
    rmSync(workspace, { recursive: true, force: true });
    throw error;
  }
}

export function launch({ model, effort, cwd, prompt, hookSink, captureScript = capture, expectedSessionId, extraArgs = [] }) {
  const directory = realpathSync(cwd);
  const reserved = /^(?:--?(?:p|print|prompt|i|prompt-interactive|settings|model|effort|mode|add-dir|dangerously-skip-permissions|remote-agent|remote-control|help|version))(?:=|$)/;
  if (!Array.isArray(extraArgs) || extraArgs.some(arg => typeof arg !== 'string' || arg === '--' || reserved.test(arg)) ||
      (extraArgs.length && !extraArgs[0].startsWith('-'))) {
    throw new TypeError('extraArgs must be additional agy TUI options');
  }

  // Orca b7fd7caa3: src/shared/agent-launch/permissions/tui-agent-permissions.ts:23.
  const argv = ['agy', '--dangerously-skip-permissions', '--mode', 'accept-edits', ...extraArgs];
  // In 1.5.16 the named reasoning variants work even when the base name plus --effort falls back.
  const selected = model || defaultModel;
  const level = effort || (model ? undefined : 'low');
  const variant = effortVariants.exec(selected);
  const label = effortLabels.get(level);
  argv.push('--model', variant && label ? `${variant[1]} (${label})` : selected);
  if (level && !(variant && label)) argv.push('--effort', level);

  // Orca b7fd7caa3: src/main/agent-launch/trust/agent-trust-presets.ts:94-101, trustedWorkspaces.
  const trustedWorkspaces = [directory];
  const workspace = hookSink ? stageHooks(directory, resolve(directory, hookSink), captureScript, expectedSessionId) : undefined;
  if (workspace) {
    argv.push('--add-dir', workspace);
    trustedWorkspaces.push(workspace);
  }
  argv.push('--settings', JSON.stringify({ trustedWorkspaces, queuedMessages: 'queue' }));
  if (prompt) argv.push('--prompt-interactive', prompt);

  return {
    argv,
    env: {
      // Orca b7fd7caa3: src/shared/agent-launch/startup/tui-agent-launch-command.ts:39.
      AGY_CLI_DISABLE_AUTO_UPDATE: 'true',
      ...(workspace ? { LOOM_AGY_HOOK_WORKSPACE: workspace } : {}),
    },
  };
}
