import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hookLabels } from './hooks.mjs';

const capture = fileURLToPath(new URL('./hook-capture.mjs', import.meta.url));

// Orca b7fd7caa3 src/shared/shell/launch/shell-argument-quoting.ts, quotePosixShell.
function quotePosixShell(value) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

// Codex parses -c values as TOML. TOML basic strings also require DEL to be escaped.
const tomlString = value => JSON.stringify(value).replaceAll('\x7f', '\\u007f');

// Orca b7fd7caa3 src/main/codex/trust/identity/codex-trust-identity.ts,
// canonicalize and computeCodexTrustedHash for command hooks without a matcher or status message.
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const sorted = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = canonicalize(value[key]);
    }
    return sorted;
  }
  return value;
}

function computeCodexTrustedHash(eventLabel, command, timeout) {
  const handler = { type: 'command', command, timeout, async: false };
  const identity = { event_name: eventLabel, hooks: [handler] };
  const serialized = JSON.stringify(canonicalize(identity));
  return `sha256:${createHash('sha256').update(serialized).digest('hex')}`;
}

export function launch({ model, effort, cwd, prompt, hookSink, extraArgs = [] }) {
  const directory = realpathSync(cwd);
  if (!Array.isArray(extraArgs) || extraArgs.some(arg => typeof arg !== 'string' || arg === '--')) {
    throw new TypeError('extraArgs must be an array of Codex options');
  }

  // Orca b7fd7caa3 src/shared/agent-launch/startup/tui-agent-launch-command.ts,
  // STARTUP_UPDATE_PROMPT_SUPPRESSION_ARGS and agentTerminalInputArgs.
  const argv = ['codex', '--no-daemon', '--no-alt-screen', ...extraArgs,
    '--cd', directory, '--ask-for-approval', 'never', '--sandbox', 'workspace-write',
    '-c', 'check_for_update_on_startup=false'];
  if (process.platform !== 'win32') argv.push('-c', 'disable_paste_burst=true');
  // Orca b7fd7caa3 src/main/codex/trust/toml/config-toml-project-trust.ts uses trust_level.
  // Scope the same setting to this invocation.
  // The inline table also handles paths containing dots or equals signs.
  argv.push('-c', `projects={${tomlString(directory)}={trust_level="trusted"}}`);
  if (model) argv.push('--model', model);
  if (effort) argv.push('-c', `model_reasoning_effort=${tomlString(effort)}`);

  if (hookSink !== undefined) {
    if (typeof hookSink !== 'string' || !hookSink.trim()) throw new TypeError('hookSink must be a JSONL file path');
    const command = [process.execPath, capture, resolve(directory, hookSink)]
      .map(quotePosixShell).join(' ');
    const timeout = 3;
    const states = [];
    for (const [event, label] of Object.entries(hookLabels)) {
      argv.push('-c', `hooks.${event}=[{hooks=[{type="command",command=${tomlString(command)},timeout=${timeout}}]}]`);
      // Codex 0.171.0 discovery.rs gives command-line hooks this synthetic path.
      const key = `/<session-flags>/config.toml:${label}:0:0`;
      const hash = computeCodexTrustedHash(label, command, timeout);
      states.push(`${tomlString(key)}={enabled=true,trusted_hash=${tomlString(hash)}}`);
    }
    argv.push('-c', `hooks.state={${states.join(',')}}`);
  }
  if (prompt !== undefined && prompt !== '') argv.push('--', prompt);
  return { argv, env: {} };
}
