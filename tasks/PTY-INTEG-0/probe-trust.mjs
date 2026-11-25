import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { openNativeTui } from '../../runtimes/tui/transport.mjs';
import { mockProvider } from '../TUI-HOST-0/mock-provider.mjs';
import { nativeClaude } from '../../daemon/executables.mjs';

const [cli, mode = 'isolated'] = process.argv.slice(2);
const root = '/Users/sun/Code/exp-relay/pty-integ-0';
const parent = await mkdtemp(join(root, `trust-${cli}-`));
const cwd = join(parent, 'work');
const home = join(parent, 'home');
const stateDir = join(parent, 'state');
await mkdir(cwd);
const git = spawnSync('/usr/bin/git', ['init', '-q', cwd], {
  env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
});
if (git.status !== 0) throw new Error('Could not create the test-only Git workspace');

let mock;
let env;
let extraArgs;
if (mode === 'isolated') {
  mock = await mockProvider();
  const agy = join(home, '.gemini', 'antigravity-cli');
  const claude = join(home, '.claude');
  const codex = join(home, '.codex');
  for (const path of [agy, claude, codex, join(agy, 'cache')]) await mkdir(path, { recursive: true, mode: 0o700 });
  const onboarding = JSON.stringify({ hasCompletedOnboarding: true, theme: 'dark' });
  await writeFile(join(home, '.claude.json'), onboarding);
  await writeFile(join(claude, '.claude.json'), onboarding);
  await writeFile(join(agy, 'cache', 'onboarding.json'), JSON.stringify({
    consumerOnboardingComplete: true, enterpriseOnboardingComplete: true, onboardingComplete: true,
  }));
  env = { HOME: home, TMPDIR: parent, CLAUDE_CONFIG_DIR: claude, CODEX_HOME: codex,
    ANTIGRAVITY_APP_DATA_DIR: agy, DISABLE_AUTOUPDATER: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    ...(cli === 'claude' && { ANTHROPIC_BASE_URL: mock.url, ANTHROPIC_AUTH_TOKEN: 'loopback-test-value' }),
    ...(cli === 'agy' && { AGY_LLM_GATEWAY_URL: mock.url + '/v1', AGY_LLM_GATEWAY_API_KEY: 'loopback-test-value',
      AGY_LLM_GATEWAY_WIRE_PROTOCOL: 'openai', AGY_LLM_GATEWAY_MODELS: 'loopback',
      AGY_LLM_GATEWAY_TIER_FLASH: 'loopback', AGY_LLM_GATEWAY_TIER_PRO: 'loopback' }),
  };
  if (cli === 'codex') extraArgs = ['--disable', 'memories', '-c', 'model_provider="loopback"',
    '-c', 'model_providers.loopback.name="Loopback"', '-c', `model_providers.loopback.base_url="${mock.url}/v1"`,
    '-c', 'model_providers.loopback.wire_api="responses"', '-c', 'model_providers.loopback.requires_openai_auth=false'];
} else if (cli === 'codex') extraArgs = ['--disable', 'memories'];

const summarize = value => ({ ready: value.ready, phase: value.phase, kind: value.screen?.kind, exit: value.exit });
let session;
try {
  session = await openNativeTui({ cli, cwd, stateDir, trustWorkspace: false, env, extraArgs,
    ...(cli === 'claude' && { command: nativeClaude(), unset: ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT'] }) });
  let seen;
  const deadline = Date.now() + 10_000;
  do {
    seen = await session.readState();
    if (seen.screen?.kind === 'trust-dialog' || seen.ready || seen.exit) break;
    await sleep(100);
  } while (Date.now() < deadline);
  const result = { cli, mode, pane: session.id, cold: summarize(seen) };
  if (seen.screen?.kind === 'trust-dialog' && mode === 'isolated') {
    await sleep(800);
    const action = await session.dialog({ trust: true, timeoutMs: 4000 });
    result.action = { kind: action.kind, code: action.code, state: action.state && summarize(action.state) };
    const readyDeadline = Date.now() + 4000;
    do { seen = await session.readState(); if (seen.ready || seen.exit) break; await sleep(100); } while (Date.now() < readyDeadline);
    result.after = summarize(seen);
  }
  console.log(JSON.stringify(result));
} finally {
  try {
    if (session) {
      await session.close();
      console.log(JSON.stringify({ cleanup: session.id, state: (await session.status()).state }));
    }
  } finally { await mock?.close(); }
}
