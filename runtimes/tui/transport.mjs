import { randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { lstat, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';
import { prepareJournal, readText, syncDirectory } from '../../daemon/io.mjs';
import { releaseRoot } from '../../daemon/release.mjs';
import { missingExecutable, resolveNativeExecutable } from '../../daemon/executables.mjs';
import { holderAsset } from '../../holder/assets.mjs';
import { hcWrappedBackend } from '../../tui/backends.mjs';
import { holderClient } from '../../holder/protocol.mjs';
import { requestControl } from '../../tui/pty-control.mjs';
import { providers } from '../../tui/providers.mjs';
import { startPane } from './hc.mjs';
import { claudeApiEnvKeys } from '../../adapters/claude/launch.mjs';
import { codexDeveloperArgs, memoryLaunch } from '../../memory/launch-config.mjs';

export async function absoluteCommand(command, provider = basename(command)) {
  const variable = `LOOM_${provider.toUpperCase()}_BIN`;
  const override = command === provider ? process.env[variable] : undefined;
  const candidates = isAbsolute(command) ? [command] : override ? [override] :
    basename(command) === command ? [join(homedir(), '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin']
      .map(path => join(path, command)) : [];
  for (const candidate of candidates) {
    try { return resolveNativeExecutable(candidate); }
    catch (error) {
      if (isAbsolute(command) || override || !missingExecutable(error) && error.code !== 'protected-executable') throw error;
    }
  }
  throw Object.assign(new Error(`Native executable not found: ${command}. Set ${variable} to its absolute path.`), { code: 'ENOENT' });
}

export function controlTui(binding, method, params) {
  return requestControl(binding.socket, method, params, binding.incarnation);
}

export function wrapperFailedStart(binding) {
  if (binding?.transport !== 'loom-pty') return false;
  const startup = readText(binding.startPath, '');
  return startup === '' || startup === 'failed\n';
}

export async function openNativeTui({
  cli, cwd, command, hcCommand = 'hc', env = {}, unset = [], name, authMode,
  stateDir, hookSink, recordBinding = () => {}, previous, recordTemporary = () => {}, boundTranscript = true,
  controllerPath, placementLabels, capabilityPath, recordExecutable, memory, ...options
}) {
  const provider = Object.hasOwn(providers, cli) && providers[cli];
  if (!provider) throw new RangeError(`Unsupported TUI: ${cli}`);
  const executable = await absoluteCommand(command ?? cli, cli);
  cwd = await realpath(cwd);
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  stateDir = await realpath(stateDir);
  const sessionDir = await mkdtemp(join(stateDir, 'pty-'));
  hookSink ??= join(sessionDir, 'hooks.jsonl');
  await mkdir(dirname(hookSink), { recursive: true, mode: 0o700 });
  prepareJournal(hookSink);
  const accountStatusline = options.accountStatusline;
  const versionedClaude = cli === 'claude' && /\/claude\/versions\/(\d+\.\d+\.\d+)$/.exec(executable)?.[1];
  const { argv, env: launchEnv, sessionId, promptSink } = await provider.start({
    ...options, cwd, hookSink, boundTranscript, captureCompaction: Boolean(memory),
    ...(accountStatusline && { accountStatusline: { ...accountStatusline,
      cliVersion: accountStatusline.cliVersion ?? (versionedClaude || undefined) } }),
  });
  if (memory) {
    const settings = cli === 'claude' ? argv.indexOf('--settings') : -1;
    const config = memoryLaunch(cli, { ...memory, openCodeNative: true, openCodeConfig: launchEnv.OPENCODE_CONFIG_CONTENT,
      claudeSettings: settings < 0 ? undefined : JSON.parse(argv[settings + 1]) });
    if (settings >= 0) argv[settings + 1] = JSON.stringify(config.claudeSettings);
    const separator = argv.indexOf('--');
    argv.splice(cli === 'codex' ? 1 : separator < 0 ? argv.length : separator, 0, ...config.argv,
      ...(cli === 'codex' ? codexDeveloperArgs(memory.indexText) : []));
    Object.assign(launchEnv, config.env);
  }
  argv[0] = executable;
  // hc retains its command arguments. Read the capability inside the native
  // process wrapper so the bearer value appears only in the session env.
  if (capabilityPath) argv.unshift('/bin/sh', '-c',
    'IFS= read -r LOOM_CAPABILITY < "$1" && [ -n "$LOOM_CAPABILITY" ] || exit 126; shift; export LOOM_CAPABILITY; exec "$@"',
    'loom-session', capabilityPath);
  if (cli === 'claude') {
    if (authMode !== 'api-key') unset = [...new Set([...unset, ...claudeApiEnvKeys])];
    // Opt in through inherited credentials, never via hc's command arguments.
    env = Object.fromEntries([env, launchEnv].flatMap(source => Object.keys(source).filter(key => !claudeApiEnvKeys.includes(key))
      .map(key => [key, source[key]])));
  } else env = { ...env, ...launchEnv };
  const workspace = launchEnv.LOOM_AGY_HOOK_WORKSPACE;
  let staging;
  if (workspace) {
    const { dev, ino } = await lstat(workspace);
    staging = { path: workspace, dev, ino };
    recordTemporary(staging);
  }
  const socketDir = Buffer.byteLength(join(sessionDir, 's')) < 104 ? sessionDir :
    await mkdtemp(join(realpathSync(tmpdir()), 'lp-'));
  async function cleanup() {
    if (socketDir !== sessionDir) await rm(socketDir, { recursive: true, force: true });
    if (staging) {
      const current = await lstat(staging.path).catch(error => { if (error.code !== 'ENOENT') throw error; });
      if (current?.dev === staging.dev && current.ino === staging.ino) {
        await rm(staging.path, { recursive: true, force: true });
      }
    }
  }
  syncDirectory(dirname(sessionDir));
  const binding = {
    socket: join(socketDir, 's'), incarnation: randomUUID(), bookPath: join(sessionDir, 'requests.jsonl'),
    startPath: join(sessionDir, 'startup'), exitPath: join(sessionDir, 'exit.json'), transport: 'loom-pty',
  };
  const evidence = {
    cwd, evidenceRoot: stateDir, hookSink, sessionId, ...(promptSink && { promptSink }), boundTranscript, requireNative: true,
    autoTrustWorkspace: options.autoTrustWorkspace === true,
    bookPath: binding.bookPath, startPath: binding.startPath, exitPath: binding.exitPath, incarnation: binding.incarnation,
    ...(options.resume && { resumedAt: Date.now() }),
  };
  if (controllerPath && (!previous || previous.transport === 'holder-v3')) {
    Object.assign(binding, { transport: 'holder-v3', evidence });
  }
  const plain = async () => {
    recordBinding({ transport: 'plain-hc', reason: 'loom-pty-start-failed' });
    recordExecutable?.(executable);
    const pane = await startPane(hcCommand, cwd, argv, { name, env, unset, provider: cli, nativeCommand: executable, placementLabels });
    return {
      id: pane.address, sessionId, hookSink, status: pane.status, warnings: pane.warnings,
      async close() {
        const result = await pane.kill();
        await cleanup();
        return result;
      },
      transport: 'plain-hc', binding: { transport: 'plain-hc', reason: 'loom-pty-start-failed' },
      readState: async () => {
        const status = await pane.status();
        return status.state === 'finished' ? { exit: { code: status.exit_code, reason: status.reason } } :
          { ready: false, screen: { kind: 'plain-hc-fallback' } };
      },
    };
  };
  let wrapped;
  try {
    if (previous?.transport === 'plain-hc') return await plain();
    if (binding.transport === 'holder-v3') {
      const asset = holderAsset(releaseRoot);
      binding.holderRelease = { root: releaseRoot, digest: asset.digest };
      recordBinding(binding);
      recordExecutable?.(executable);
      const pane = await startPane(hcCommand, cwd, [asset.path, '--launch', binding.socket, sessionDir,
        controllerPath, binding.incarnation.replaceAll('-', ''), asset.digest, ...argv], {
        env, unset, name, provider: cli, nativeCommand: executable, placementLabels,
      });
      wrapped = { close: pane.kill };
      const deadline = performance.now() + 5_000;
      do {
        const status = await pane.status();
        if (status.state === 'finished') throw new Error('Holder v3 exited during TUI startup');
        try {
          const initial = await holderClient(binding).hello();
          if (initial.pid !== status.pid || initial.ended || initial.gap || initial.build !== asset.digest) {
            throw new Error('Holder v3 launch identity changed');
          }
          binding.childPid = initial.childPid;
          recordBinding(binding);
          return { id: pane.address, sessionId, hookSink, status: pane.status, warnings: pane.warnings,
            transport: binding.transport, binding,
            async close() {
              const result = await pane.kill();
              await cleanup();
              return result;
            },
          };
        } catch (error) {
          if (!['ENOENT', 'ECONNREFUSED', 'ECONNRESET', 'HOLDER_EOF'].includes(error.code)) throw error;
          await sleep(50);
        }
      } while (performance.now() < deadline);
      throw new Error('Holder v3 socket did not become ready');
    }
    recordBinding(binding);
    recordExecutable?.(executable);
    wrapped = await hcWrappedBackend({ command: hcCommand }).launch({
      cwd, argv, env, unset: ['LOOM_PTY_MODULES', ...unset], name, provider: cli, nativeCommand: executable,
      evidence, sessionDir, socket: binding.socket, placementLabels,
    });
    const deadline = performance.now() + 5_000;
    do {
      try {
        const initial = await controlTui(binding, 'state');
        if (initial.exit) throw new Error('loom-pty exited after starting the native CLI');
        let restarting;
        let restartSession;
        return {
          id: wrapped.id, sessionId, hookSink, status: wrapped.status,
          transport: 'loom-pty', binding, ...wrapped.remote,
          async close() {
            const result = await wrapped.close();
            await cleanup();
            return result;
          },
          // A confirmed exit ends this incarnation. Only an explicit caller can
          // replace it, and ownership records for the old PTY remain readable.
          restart({ name, resume, recordBinding, recordTemporary } = {}) {
            if (restarting && resume !== restartSession) {
              return Promise.reject(Object.assign(new Error('A different TUI replacement is already reserved'), { code: 'RESTART_CONFLICT' }));
            }
            restartSession = resume;
            restarting ??= (async () => {
              if ((await wrapped.status()).state !== 'finished') {
                throw Object.assign(new Error('The previous TUI is still live'), { code: 'PANE_LIVE' });
              }
              const requestedEnv = { ...env };
              delete requestedEnv.LOOM_AGY_HOOK_WORKSPACE;
              const { accountStatusline, ...restartOptions } = options;
              return openNativeTui({ ...restartOptions, cli, cwd, stateDir, hcCommand, env: requestedEnv, unset, authMode,
                command: executable, name, resume, recordBinding, recordTemporary, recordExecutable, boundTranscript, capabilityPath });
            })().catch(error => { restarting = undefined; throw error; });
            return restarting;
          },
        };
      } catch (error) {
        if (!['ENOENT', 'ECONNREFUSED', 'ECONNRESET', 'EPIPE', 'CONTROL_EOF'].includes(error.code)) throw error;
      }
      const status = await wrapped.status();
      if (status.state === 'finished') {
        if (wrapperFailedStart(binding)) {
          // Preserve the stable ownership name for the replacement pane.
          await rm(binding.socket, { force: true });
          return await plain();
        }
        throw new Error('loom-pty exited after starting the native CLI');
      }
      await sleep(75);
    } while (performance.now() < deadline);
    throw new Error('loom-pty control socket did not become available');
  } catch (error) {
    await wrapped?.close();
    await cleanup();
    throw error;
  }
}
