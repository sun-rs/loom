import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';
import { CommandError } from '../cli/sessions.mjs';
import { providers } from '../cli/policy.mjs';
import { absoluteCommand } from '../runtimes/tui/transport.mjs';
import { createClaudeCcpBridge, defaultCcpClaudeEntry, validateCcpClaudeEntry } from './claude-ccp.mjs';
import {
  markSuperCleanExit, readGlobalRegistry, resolveAccountDir, superConfig,
  superHandoffPath, superHandoffReminder, superLivePath, updateSuperRecord,
} from './global-registry.mjs';
import { ensureSuperSpace, herdrCommands, superLayout } from './herdr-layout.mjs';
import { nativeResumeCapability } from './resume-capabilities.mjs';
import { buildSuperOpeningMessage, generateSuperLive, readSuperHandoff } from './super-live.mjs';

export const defaultSuperReadyTimeoutMs = 120_000;

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return 'unknown';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function sessionStats(record) {
  let sessionBytes = null;
  let lastActivityAt = record.lastOnlineAt ?? null;
  if (record.transcriptPath) {
    const info = statSync(record.transcriptPath, { throwIfNoEntry: false });
    if (info?.isFile()) {
      sessionBytes = info.size;
      const mtime = Math.floor(info.mtimeMs);
      if (Number.isFinite(mtime) && (lastActivityAt == null || mtime > lastActivityAt)) lastActivityAt = mtime;
    }
  }
  return { sessionBytes, lastActivityAt };
}

async function resolveSuperEntry(cli, requestedEntry, env) {
  if (cli === 'claude') return validateCcpClaudeEntry(requestedEntry ?? defaultCcpClaudeEntry(env), env);
  if (requestedEntry) {
    if (!isAbsolute(requestedEntry)) throw new CommandError('invalid-arguments', 'Super entry executable must be absolute');
    return resolve(requestedEntry);
  }
  const envKey = `LOOM_${cli.toUpperCase()}_BIN`;
  if (env[envKey]) return resolve(env[envKey]);
  try { return await absoluteCommand(cli, cli); }
  catch { return null; }
}

function superLaunchEnv(profile, env) {
  const next = {
    LOOM_EXTERNAL_SUPER: '1',
    ...(env.LOOM_GLOBAL_DIR && { LOOM_GLOBAL_DIR: env.LOOM_GLOBAL_DIR }),
    ...(env.XDG_STATE_HOME && { XDG_STATE_HOME: env.XDG_STATE_HOME }),
  };
  if (profile.accountDir) {
    if (profile.cli === 'codex') next.CODEX_HOME = profile.accountDir;
    else if (profile.cli === 'agy') next.ANTIGRAVITY_APP_DATA_DIR = profile.accountDir;
    else if (profile.cli === 'claude') next.CLAUDE_CONFIG_DIR = profile.accountDir;
  }
  return next;
}

export function buildSuperArgv({ mode, profile, openingMessage, resumeSessionId }) {
  const { cli, entry, model, effort, cwd } = profile;
  if (cli === 'codex') {
    const argv = [entry ?? 'codex', '--no-daemon', '--no-alt-screen', '--cd', cwd,
      '-c', 'check_for_update_on_startup=false'];
    if (model) argv.push('--model', model);
    if (effort) argv.push('-c', `model_reasoning_effort=${JSON.stringify(effort)}`);
    if (mode === 'resume') argv.push('resume', resumeSessionId);
    else if (openingMessage) argv.push('--', openingMessage);
    return argv;
  }
  if (cli === 'agy') {
    const argv = [entry ?? 'agy'];
    if (model) argv.push('--model', model);
    if (effort) argv.push('--effort', effort);
    if (mode === 'resume') argv.push('--conversation', resumeSessionId);
    else if (openingMessage) argv.push('--prompt-interactive', openingMessage);
    return argv;
  }
  if (cli === 'opencode') {
    if (mode === 'resume') throw new CommandError('resume-unsupported', '无法原生续接 OpenCode TUI Super；请使用 loom up --fresh');
    const variant = effort && model ? `${model}#${effort}` : model;
    const argv = [entry ?? 'opencode', 'mini', '--standalone', ...(variant ? ['--model', variant] : [])];
    return argv;
  }
  throw new CommandError('invalid-arguments', `Unsupported Super CLI: ${cli}`);
}

async function defaultSuperLauncher(spec, commands) {
  if (!commands) throw new CommandError('herdr-unavailable', 'Herdr commands are required to launch Super');
  const envPairs = Object.entries(spec.env).map(([key, value]) => `${key}=${value}`);
  const argv = envPairs.length ? ['/usr/bin/env', ...envPairs, ...spec.argv] : spec.argv;
  const started = await commands.hc('run', '--bg', '--no-parent', '--no-notify', '--name', 'loom-super', '--cwd', spec.cwd,
    '--label', 'loom.role=super', '--', ...argv);
  const terminal = await commands.hc('get', started.address);
  if (terminal?.state !== 'live') throw new CommandError('not-ready', 'Super terminal exited during startup');
  return { hcAddress: terminal.address, sessionId: spec.resumeSessionId ?? null, ready: true };
}

async function withReadyTimeout(timeoutMs, run) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      run(controller.signal),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new CommandError('resume-timeout', `Super resume did not become ready within ${timeoutMs}ms`));
        }, timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function formatSuperChooseText(result) {
  const [optResume, optFresh] = result.options;
  const activity = optResume.lastActivityAt ? new Date(optResume.lastActivityAt).toISOString() : 'unknown';
  return [
    '检测到上一个 Super 会话异常结束，请选择启动方式：',
    `  1. 续接原会话：${optResume.command}（CLI=${optResume.cli}，会话=${optResume.sessionId}，大小=${formatBytes(optResume.sessionBytes)}，上次活动=${activity}）`,
    `  2. 新开并注入实况：${optFresh.command}（生成 ~/.loom/super/live.md 并附交接单）`,
  ].join('\n');
}

export async function superUp(options = {}, deps = {}) {
  const env = deps.env ?? process.env;
  const now = deps.now ?? Date.now;
  const ccpBridge = deps.ccpBridge ?? createClaudeCcpBridge();
  const readyTimeoutMs = options.readyTimeoutMs ?? deps.readyTimeoutMs ?? defaultSuperReadyTimeoutMs;
  if (options.resume && options.fresh) {
    throw new CommandError('invalid-arguments', 'Specify at most one of --resume or --fresh');
  }

  const registry = readGlobalRegistry(env);
  const config = superConfig(env);
  const previous = registry.super;
  const cwd = options.cwd ? resolve(options.cwd) : previous?.cwd ?? config.cwd ?? (env.HOME || homedir());

  let commands = deps.commands;
  let layout = null;
  if (!commands && !deps.herdrOptional) {
    try { commands = await herdrCommands({ optional: Boolean(deps.herdrOptional) }); }
    catch (error) {
      if (!deps.herdrOptional && error.code !== 'herdr-disabled') throw error;
    }
  }
  if (commands) {
    const space = await ensureSuperSpace(cwd, commands, env);
    layout = space.state;
    if (previous?.hcAddress) {
      const existing = await space.layout.get(previous.hcAddress).catch(() => undefined);
      if (existing?.state === 'live') {
        if (layout.tabs?.super?.terminal !== existing.address) {
          layout = await superLayout(cwd, existing.address, commands, env);
        }
        return { ok: true, action: 'already-live', super: previous, layout };
      }
    }
  }

  const interrupted = Boolean(previous && !previous.cleanExit && previous.sessionId);
  if (options.resume && !interrupted) {
    throw new CommandError('not-ready', 'No abnormally ended Super session with a native session ID to resume; use loom up --fresh');
  }

  let mode = options.resume ? 'resume' : options.fresh ? 'fresh' : undefined;
  if (!mode) {
    if (interrupted && !config.resumeOnUp) {
      const stats = sessionStats(previous);
      const choice = {
        ok: true,
        action: 'choose',
        layout,
        previous,
        options: [
          {
            key: 'resume',
            label: '续接原会话',
            command: 'loom up --resume',
            cli: previous.cli,
            model: previous.model,
            sessionId: previous.sessionId,
            sessionBytes: stats.sessionBytes,
            sessionSize: formatBytes(stats.sessionBytes),
            lastActivityAt: stats.lastActivityAt,
          },
          {
            key: 'fresh',
            label: '新开并注入实况',
            command: 'loom up --fresh',
            livePath: superLivePath(env),
            handoffPath: previous.handoffPath ?? superHandoffPath(env),
          },
        ],
      };
      if (typeof deps.promptChoice === 'function') {
        const picked = await deps.promptChoice(choice);
        if (picked === 'resume' || picked === 'fresh') mode = picked;
        else return choice;
      } else {
        return choice;
      }
    } else {
      mode = interrupted && config.resumeOnUp ? 'resume' : 'fresh';
    }
  }

  const launchImpl = deps.launcher ?? (spec => defaultSuperLauncher(spec, commands));

  async function launchFresh(extra = {}) {
    const cli = options.cli ?? config.cli ?? previous?.cli ?? 'codex';
    if (!providers.includes(cli)) throw new CommandError('invalid-arguments', `Unknown CLI: ${cli}`);
    const model = options.model ?? config.model ?? previous?.model ?? null;
    const effort = options.effort ?? config.effort ?? previous?.effort ?? null;
    const accountDir = options.accountDir ? resolve(options.accountDir) : config.accountDir ?? resolveAccountDir(cli, env);
    const entry = await resolveSuperEntry(cli, options.entry ?? config.entry, env);
    const live = await generateSuperLive({ env, checkDaemon: deps.checkDaemon, ccpBridge });
    const handoff = readSuperHandoff(env);
    const handoffPath = previous?.handoffPath ?? config.handoffPath ?? superHandoffPath(env);
    const openingMessage = buildSuperOpeningMessage({ live, handoff, livePath: live.path, handoffPath });

    let launched;
    if (cli === 'claude') {
      launched = await ccpBridge.launchSuper({
        cli, model, effort, entry, accountDir, cwd, openingMessage, live, handoff, env,
      });
    } else {
      const profile = { cli, model, effort, entry, accountDir, cwd };
      const argv = buildSuperArgv({ mode: 'fresh', profile, openingMessage });
      launched = await launchImpl({
        mode: 'fresh', cli, model, effort, entry, accountDir, cwd,
        argv, env: superLaunchEnv(profile, env), openingMessage, live, handoff,
      });
    }
    if (commands && launched?.hcAddress) {
      layout = await superLayout(cwd, launched.hcAddress, commands, env);
    }
    const saved = updateSuperRecord({
      cli, model, effort, entry, accountDir, cwd,
      sessionId: launched?.sessionId ?? null,
      transcriptPath: launched?.transcriptPath ?? null,
      hcAddress: launched?.hcAddress ?? null,
      lastOnlineAt: now(),
      handoffPath,
      cleanExit: false,
      exitReason: null,
      ...(options.cliVersion && { cliVersion: options.cliVersion }),
    }, env);
    return { ok: true, action: 'fresh', super: saved, layout, live, handoff, ...extra };
  }

  if (mode === 'resume') {
    const cli = options.cli ?? previous.cli;
    const model = options.model ?? previous.model;
    const effort = options.effort ?? previous.effort;
    const accountDir = options.accountDir ? resolve(options.accountDir) : resolveAccountDir(cli, env);
    const entry = await resolveSuperEntry(cli, options.entry ?? previous.entry, env);
    if (cli !== previous.cli) {
      throw new CommandError('resume-mismatch', `Super CLI mismatch: recorded ${previous.cli}, got ${cli}`);
    }
    if (previous.model && model && model !== previous.model) {
      throw new CommandError('resume-mismatch', `Super model mismatch: recorded ${previous.model}, got ${model}`);
    }
    if (previous.accountDir && accountDir && resolve(accountDir) !== resolve(previous.accountDir)) {
      throw new CommandError('resume-mismatch', `Super account directory mismatch: recorded ${previous.accountDir}, got ${accountDir}`);
    }
    if (previous.entry && entry && resolve(entry) !== resolve(previous.entry)) {
      throw new CommandError('resume-mismatch', `Super launch entry mismatch: recorded ${previous.entry}, got ${entry}`);
    }
    if (!previous.sessionId) {
      throw new CommandError('resume-mismatch', 'Recorded Super has no native session ID');
    }

    const cap = nativeResumeCapability({
      cli, backend: 'tui', sessionId: previous.sessionId,
      cliVersion: options.cliVersion ?? previous.cliVersion, ccpBridge,
      row: { role: 'super', cli, sessionId: previous.sessionId },
    });
    if (cli === 'claude') {
      const launched = await withReadyTimeout(readyTimeoutMs, signal => ccpBridge.resumeSuper({
        cli, model, effort, entry, accountDir, cwd: previous.cwd ?? cwd,
        sessionId: previous.sessionId, env, signal,
      }));
      if (commands && launched?.hcAddress) layout = await superLayout(cwd, launched.hcAddress, commands, env);
      const saved = updateSuperRecord({
        hcAddress: launched?.hcAddress ?? previous.hcAddress,
        lastOnlineAt: now(),
        cleanExit: false,
        exitReason: null,
      }, env);
      return { ok: true, action: 'resumed', super: saved, layout };
    }
    if (!cap.supported) {
      throw Object.assign(
        new CommandError('resume-unsupported', `${cap.reason}。改用交接单新开：${cap.freshCommand}`),
        { freshCommand: cap.freshCommand },
      );
    }
    const profile = { cli, model, effort, entry, accountDir, cwd: previous.cwd ?? cwd };
    const argv = buildSuperArgv({ mode: 'resume', profile, resumeSessionId: previous.sessionId });
    try {
      const launched = await withReadyTimeout(readyTimeoutMs, signal => launchImpl({
        mode: 'resume', cli, model, effort, entry, accountDir, cwd: profile.cwd,
        resumeSessionId: previous.sessionId, argv, env: superLaunchEnv(profile, env), signal,
      }));
      if (commands && launched?.hcAddress) layout = await superLayout(profile.cwd, launched.hcAddress, commands, env);
      const saved = updateSuperRecord({
        hcAddress: launched?.hcAddress ?? previous.hcAddress,
        transcriptPath: launched?.transcriptPath ?? previous.transcriptPath,
        lastOnlineAt: now(),
        cleanExit: false,
        exitReason: null,
      }, env);
      return { ok: true, action: 'resumed', super: saved, layout };
    } catch (error) {
      if (error.code !== 'resume-timeout') throw error;
      return launchFresh({ fallbackFrom: 'resume-timeout', fallbackReason: error.message });
    }
  }

  return launchFresh();
}

export function superClose({ env = process.env, reason = 'normal', now = Date.now } = {}) {
  const updated = markSuperCleanExit(reason, env, now());
  return {
    ok: true,
    cleanExit: true,
    super: updated,
    handoffReminder: superHandoffReminder(env),
  };
}
