import { execFile, spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import { createTuiHost, hcBackend, hcWrappedBackend } from '../../tui/index.mjs';
import { mockProvider } from './mock-provider.mjs';

export const root = '/Users/sun/Code/exp-relay/tui-host-0';
const shell = value => "'" + value.replaceAll("'", "'\\''") + "'";
const providerCommands = {
  claude: '/Users/sun/.local/bin/claude',
  codex: '/opt/homebrew/bin/codex',
  agy: '/Users/sun/.local/bin/agy',
};

export async function setup(host, cli) {
  const dir = await mkdtemp(join(root, `${host}-${cli}-`));
  const cwd = join(dir, 'work');
  const home = join(dir, 'home');
  const codexHome = join(home, '.codex');
  const config = join(home, '.claude');
  const temporary = join(dir, 'tmp');
  for (const directory of [cwd, codexHome, config, temporary]) await mkdir(directory, { recursive: true, mode: 0o700 });
  if (cli === 'codex') await promisify(execFile)('/usr/bin/git', ['init', '--quiet', cwd], {
    env: { ...process.env, HOME: home, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
  });
  const mock = await mockProvider();
  const env = {
    PATH: process.env.PATH, HOME: home, TERM: 'xterm-256color', TMPDIR: temporary,
    NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost',
    CLAUDE_CONFIG_DIR: config, CODEX_HOME: codexHome, DISABLE_AUTOUPDATER: '1',
    DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1', DISABLE_NON_ESSENTIAL_MODEL_CALLS: '1',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    ...(cli === 'claude' ? { ANTHROPIC_BASE_URL: mock.url, ANTHROPIC_AUTH_TOKEN: 'loopback-test-value' } : {}),
    ...(cli === 'agy' ? { AGY_CLI_DISABLE_AUTO_UPDATE: 'true',
      ANTIGRAVITY_APP_DATA_DIR: join(home, '.gemini', 'antigravity-cli'),
      AGY_LLM_GATEWAY_URL: mock.url + '/v1', AGY_LLM_GATEWAY_API_KEY: 'loopback-test-value',
      AGY_LLM_GATEWAY_WIRE_PROTOCOL: 'openai', AGY_LLM_GATEWAY_MODELS: 'loopback',
      AGY_LLM_GATEWAY_TIER_FLASH: 'loopback', AGY_LLM_GATEWAY_TIER_PRO: 'loopback' } : {}),
  };
  if (cli === 'claude') {
    const onboarding = JSON.stringify({ hasCompletedOnboarding: true, theme: 'dark' });
    await writeFile(join(home, '.claude.json'), onboarding);
    await writeFile(join(config, '.claude.json'), onboarding);
  }
  if (cli === 'agy') {
    const cache = join(home, '.gemini', 'antigravity-cli', 'cache');
    await mkdir(cache, { recursive: true, mode: 0o700 });
    // A local onboarding-state fixture for the mock gateway. No account is used.
    await writeFile(join(cache, 'onboarding.json'), JSON.stringify({
      consumerOnboardingComplete: true, enterpriseOnboardingComplete: true, onboardingComplete: true,
    }));
  }
  const executable = join(dir, cli);
  await writeFile(executable, '#!/bin/sh\nexec /usr/bin/env -i ' +
    Object.entries(env).map(([key, value]) => shell(`${key}=${value}`)).join(' ') +
    ` ${shell(providerCommands[cli])} "$@"\n`, { mode: 0o700 });
  const extraArgs = cli === 'codex' ? [
    '-c', 'model_provider="loopback"',
    '-c', 'model_providers.loopback.name="Loopback"',
    '-c', `model_providers.loopback.base_url="${mock.url}/v1"`,
    '-c', 'model_providers.loopback.wire_api="responses"',
    '-c', 'model_providers.loopback.requires_openai_auth=false',
    '-c', 'model_providers.loopback.request_max_retries=0',
    '-c', 'model_providers.loopback.stream_max_retries=0',
    '-c', 'analytics.enabled=false',
  ] : [];
  const backend = host === 'wrapped' ? hcWrappedBackend({ modules: join(root, 'thin-deps') }) : hcBackend();
  const tui = createTuiHost(backend);
  return { dir, mock, input, launch: (options = {}) => tui.launch({ cli, cwd, evidenceRoot: dir, executable,
    model: cli === 'codex' ? 'gpt-5.4' : cli === 'claude' ? 'claude-sonnet-4-6' : 'loopback',
    extraArgs, ...options }) };
}

export async function input(id, keys) {
  const env = { ...process.env };
  delete env.HC_TERMINAL_ID;
  const proc = spawn('hc', ['keys', '--json', id, ...keys], { env, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  proc.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
  const [code] = await once(proc, 'exit');
  if (code !== 0) throw new Error(`hc keys failed: ${stderr}`);
}

const run = promisify(execFile);
export async function inspectHc(id, label = false) {
  const env = { ...process.env };
  delete env.HC_TERMINAL_ID;
  const key = `tui-host-0=${id}`;
  if (label) await run('hc', ['label', '--json', id, key], { env });
  const { stdout } = await run('hc', ['ls', '--json', '--label', key], { env });
  const value = JSON.parse(stdout);
  const entry = (Array.isArray(value) ? value : value.terminals)?.find(item => item.address === id);
  return entry ? { agent: entry.agent, status: entry.status, turn: entry.turn } : null;
}

async function probe(host, cli) {
  const experiment = await setup(host, cli);
  let session;
  try {
    session = await experiment.launch({ trustWorkspace: false });
    console.log(JSON.stringify({ dir: experiment.dir, id: session.id }));
    let previous;
    for (let i = 0; i < 30; i++) {
      const state = await session.readState();
      const key = JSON.stringify([state.ready, state.phase, state.screen?.text]);
      if (previous !== key) console.log(JSON.stringify(state));
      previous = key;
      if (state.screen?.kind === 'trust-dialog') console.log(JSON.stringify(await session.dialog({ trust: true })));
      if (state.screen?.kind === 'onboarding') console.log(JSON.stringify(await session.dialog({ onboarding: true })));
      if (state.ready) {
        console.log(JSON.stringify(await session.submit({ text: 'Reply with OK. Do not use tools.', timeoutMs: 3_000 })));
        await sleep(600);
        console.log(JSON.stringify(await session.readState()));
        break;
      }
      if (state.exit) break;
      await sleep(200);
    }
    console.log(JSON.stringify({ requests: experiment.mock.requests, endpoints: experiment.mock.endpoints }));
  } finally {
    try { if (session) console.log(JSON.stringify(await session.close())); }
    finally { await experiment.mock.close(); }
  }
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) await probe(...process.argv.slice(2));
