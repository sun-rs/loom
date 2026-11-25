import { randomUUID } from 'node:crypto';
import { constants, realpathSync } from 'node:fs';
import { access, lstat, mkdir, mkdtemp, realpath, rm, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';
import { prepareJournal, readText, syncDirectory } from '../../daemon/io.mjs';
import { hcWrappedBackend } from '../../tui/backends.mjs';
import { requestControl } from '../../tui/pty-control.mjs';
import { providers } from '../../tui/providers.mjs';
import { startPane } from './hc.mjs';

export async function absoluteCommand(command, provider = basename(command)) {
  const variable = `LOOM_${provider.toUpperCase()}_BIN`;
  const override = command === provider ? process.env[variable] : undefined;
  const candidates = isAbsolute(command) ? [command] : override ? [override] :
    basename(command) === command ? [join(homedir(), '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin']
      .map(path => join(path, command)) : [];
  for (const candidate of candidates) {
    if (!isAbsolute(candidate)) continue;
    try {
      const native = await realpath(candidate);
      if (/(?:^|[/\\])ccp(?:[/\\]|$)|claude-protected/i.test(native)) continue;
      await access(native, constants.X_OK);
      if ((await stat(native)).isFile()) return native;
    } catch (error) {
      if (!['ENOENT', 'EACCES', 'ENOTDIR'].includes(error.code)) throw error;
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
  cli, cwd, command, hcCommand = 'hc', env = {}, unset = [], name,
  stateDir, hookSink, recordBinding = () => {}, previous, recordTemporary = () => {}, boundTranscript = true, ...options
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
  const { argv, env: launchEnv, sessionId } = await provider.start({ ...options, cwd, hookSink, boundTranscript });
  argv[0] = executable;
  env = { ...env, ...launchEnv };
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
    cwd, evidenceRoot: stateDir, hookSink, sessionId, boundTranscript, requireNative: true,
    autoTrustWorkspace: options.autoTrustWorkspace === true,
    bookPath: binding.bookPath, startPath: binding.startPath, exitPath: binding.exitPath, incarnation: binding.incarnation,
    ...(options.resume && { resumedAt: Date.now() }),
  };
  const plain = async () => {
    recordBinding({ transport: 'plain-hc', reason: 'loom-pty-start-failed' });
    const pane = await startPane(hcCommand, cwd, argv, { name, env, unset, provider: cli });
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
    recordBinding(binding);
    wrapped = await hcWrappedBackend({ command: hcCommand }).launch({
      cwd, argv, env, unset: ['LOOM_PTY_MODULES', ...unset], name, provider: cli, evidence, sessionDir, socket: binding.socket,
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
              return openNativeTui({ ...options, cli, cwd, stateDir, hcCommand, env: requestedEnv, unset,
                command: executable, name, resume, recordBinding, recordTemporary, boundTranscript });
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
