import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';
import { tuiVersionLabels, verifiedTuiVersions, versionWarnings } from '../../adapters/tui-version.mjs';
import { claudeApiEnvKeys, claudeNetworkEnvKeys } from '../../adapters/claude/launch.mjs';

export const exec = promisify(execFile);

export async function startPane(command, cwd, argv, {
  name = `loom-tui-${randomUUID().replaceAll('-', '').slice(0, 20)}`, env = {}, unset = [], provider = argv[0],
  nativeCommand = argv[0], placementLabels = {},
} = {}) {
  if (provider === 'claude') {
    unset = unset.filter(key => !claudeNetworkEnvKeys.includes(key));
    env = Object.fromEntries(Object.entries(env).filter(([key]) => !claudeNetworkEnvKeys.includes(key)));
  }
  // A task's inherited HC_TERMINAL_ID would wrap submitted text in a sender tag.
  const call = async (args, timeout = 5_000) => {
    let stdout;
    try {
      ({ stdout } = await exec('/usr/bin/env', ['-u', 'HC_TERMINAL_ID', command, ...args], {
        timeout, maxBuffer: 4 * 1024 * 1024,
      }));
    } catch (error) {
      let kind;
      try { kind = JSON.parse(error.stderr).error.kind; } catch { /* No structured hc refusal. */ }
      throw Object.assign(new Error(`hc ${args[0]} failed (${kind ?? error.code ?? error.signal ?? 'transport error'})`), { kind });
    }
    return JSON.parse(stdout);
  };

  const launchEnv = Object.hasOwn(verifiedTuiVersions, provider) && process.env.PATH && !unset.includes('PATH')
    ? { PATH: process.env.PATH, ...env } : env;
  const processArgs = [
    ...unset.flatMap(key => ['-u', key]), ...Object.entries(launchEnv).filter(([, value]) => value != null)
      .map(([key, value]) => `${key}=${value}`),
  ];
  const omitted = new Set(provider === 'claude' ? [...unset, ...claudeApiEnvKeys] : unset);
  const probeEnv = Object.fromEntries([process.env, launchEnv].flatMap(source => Object.keys(source)
    .filter(key => !omitted.has(key) && source[key] != null).map(key => [key, source[key]])));
  const labels = { ...await tuiVersionLabels(provider, nativeCommand, { cwd, env: probeEnv }), ...placementLabels };
  const launchId = randomUUID();
  let started;
  try {
    started = await call([
      'run', '--bg', '--json', '--no-parent', '--no-notify', '--name', name, '--cwd', cwd,
      ...Object.entries({ ...labels, 'loom.launch': launchId }).flatMap(([key, value]) => ['--label', `${key}=${value}`]), '--',
      '/usr/bin/env', ...processArgs, ...argv,
    ]);
    if (started.name !== name || !/^t[0-9a-z]+$/.test(started.address)) {
      throw new Error('hc did not report the newly created local pane');
    }
  } catch (error) {
    // A spawn can reach hc even if the CLI misses its reply. A colliding name
    // alone does not prove that the running terminal belongs to this launch.
    try {
      const found = await call(['get', '--json', name]);
      if (found.name === name && found.state === 'live' && found.labels?.['loom.launch'] === launchId) {
        await call(['kill', '--json', found.address]);
      }
    } catch (cleanup) {
      error.cause = cleanup;
    }
    throw error;
  }

  const { address } = started;
  function checkOwner(state) {
    if (state.address !== address || state.name !== name || state.cwd && state.cwd !== (started.cwd ?? cwd) ||
        started.created_ms != null && state.created_ms !== started.created_ms ||
        state.state === 'live' && started.pid != null && state.pid !== started.pid) {
      throw Object.assign(new Error(`hc pane identity changed for ${address}`), { code: 'PANE_CHANGED' });
    }
    return state;
  }
  const status = async () => checkOwner(await call(['get', '--json', address]));
  return {
    address,
    status,
    warnings: versionWarnings(labels),
    async screen() {
      const frame = await call(['read', '--json', '--lines', '0', address]);
      if (typeof frame.text !== 'string') throw new Error('hc read did not return screen text');
      return frame;
    },
    async kill() {
      let state = await status();
      if (state.state !== 'finished') state = checkOwner(await call(['kill', '--json', address]));
      const deadline = performance.now() + 5_000;
      while (state.state !== 'finished' && performance.now() < deadline) {
        await sleep(100);
        state = await status();
      }
      if (state.state !== 'finished') throw new Error(`hc did not finish pane ${address}`);
      return state;
    },
  };
}
