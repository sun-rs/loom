import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, open, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { controlTui, openNativeTui } from '../../runtimes/tui/transport.mjs';
import { mockProvider } from '../TUI-HOST-0/mock-provider.mjs';

const exec = promisify(execFile);
const repo = fileURLToPath(new URL('../../', import.meta.url));
const root = '/Users/sun/Code/exp-relay/tui-orca-1';
const commands = {
  claude: '/Users/sun/.local/share/claude/versions/2.1.331',
  codex: '/opt/homebrew/Caskroom/codex/0.171.0/bin/codex',
  agy: '/Users/sun/.local/bin/agy',
};
const failureFlag = process.argv.slice(2).find(value => value.startsWith('--failure='));
const failure = failureFlag?.slice('--failure='.length);
const testController = process.argv.includes('--controller-restart');
assert(failure === undefined || ['rate', 'error'].includes(failure));
const cases = process.argv.slice(2).filter(value => value !== failureFlag && value !== '--controller-restart');
assert(cases.every(cli => Object.hasOwn(commands, cli)));
await mkdir(root, { recursive: true, mode: 0o700 });
const run = await mkdtemp(join(root, 'i-'));
const suffix = run.slice(-6).toLowerCase();

async function awaitState(host, accept, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  do {
    const state = await host.readState();
    if (accept(state) || state.exit) return state;
    await sleep(150);
  } while (Date.now() < deadline);
  return host.readState();
}

async function verifyController({ cli, cwd, parent, env, extraArgs, model }) {
  const shim = join(parent, 'native');
  const meta = join(parent, '.project');
  const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
  const overrides = Object.entries(env).map(([key, value]) => quote(`${key}=${value}`));
  await writeFile(shim, '#!/bin/sh\nexec /usr/bin/env -u CLAUDE_CODE_SKIP_PROMPT_HISTORY -u OPENAI_API_KEY -u ANTHROPIC_API_KEY ' +
    [...overrides, quote(commands[cli]), ...extraArgs.map(quote)].join(' ') + ' "$@"\n', { mode: 0o700 });
  await mkdir(meta, { mode: 0o700 });
  await writeFile(join(meta, 'policy.json'), '{"preferred":[],"deny":[]}\n', { mode: 0o600 });
  const cliEnv = { ...process.env, LOOM_INDEX_PATH: join(parent, 'scratch.sqlite'),
    LOOM_PROJECT: parent, [`LOOM_${cli.toUpperCase()}_BIN`]: shim };
  for (const key of ['LOOM_ADDR', 'HC_TERMINAL_ID']) delete cliEnv[key];
  const runLoom = async (...args) => JSON.parse((await exec(process.execPath,
    [join(repo, 'bin/loom'), ...args, '--project', parent], { cwd, env: cliEnv, timeout: 45_000 })).stdout);
  const hc = async (...args) => JSON.parse((await exec('/Users/sun/.local/bin/hc', [...args, '--json'], {
    cwd, env: cliEnv, timeout: 8_000,
  })).stdout);
  const jobs = join(meta, 'loomd', 'sessions');
  let daemon;
  let completion;
  async function start(generation) {
    const log = await open(join(parent, `loomd-${generation}.log`), 'w', 0o600);
    daemon = spawn(process.execPath, [join(repo, 'bin/loomd'), '--project', parent], {
      cwd: parent, env: cliEnv, stdio: ['ignore', log.fd, log.fd],
    });
    completion = once(daemon, 'exit');
    await log.close();
    const status = await awaitState({ readState: () => runLoom('daemon', 'status').catch(() => ({})) }, value => value.running, 15_000);
    assert(status.running, 'Own loomd did not start');
    assert.equal(status.pid, daemon.pid);
  }
  try {
    await start(1);
    const opened = await runLoom('spawn', 'leader', '--cwd', cwd, '--cli', cli, '--mode', 'tui',
      '--model', model, '--effort', 'low', 'Reply with only ISOLATED. Use no tools.');
    const addr = opened.session.addr;
    const pane = opened.session.pane;
    const filename = join(jobs, addr + '.json');
    const job = JSON.parse(await readFile(filename, 'utf8'));
    const before = await hc('get', pane);
    assert.equal(before.cwd, cwd);
    const direct = { readState: () => controlTui(job.tui, 'state') };
    const startup = await awaitState(direct, state => state.ready || state.screen?.kind === 'trust-dialog' &&
      !state.host?.humanActive && state.host?.quietForMs >= 120);
    if (startup.screen?.kind === 'trust-dialog') {
      assert.equal((await controlTui(job.tui, 'dialog', { trust: true })).kind, 'advanced');
    }
    const waitFor = id => awaitState({ readState: () => runLoom('state', addr) },
      result => result.deliveries?.some(value => value.id === id && value.deliveryStatus === 'answered'), 25_000);
    const answered = (result, id) => assert(result.deliveries?.some(value => value.id === id && value.deliveryStatus === 'answered'),
      `${cli} delivery state is ${result.deliveries?.find(value => value.id === id)?.deliveryStatus ?? 'missing'}`);
    answered(await waitFor(opened.deliveryId), opened.deliveryId);
    assert.equal((await controlTui(job.tui, 'confirmations', { id: opened.deliveryId })).count, 1);
    daemon.kill('SIGKILL');
    await completion;
    await start(2);
    const after = await hc('get', pane);
    assert.deepEqual([after.pid, after.created_ms, after.name], [before.pid, before.created_ms, before.name]);
    const restored = JSON.parse(await readFile(filename, 'utf8'));
    assert.equal(restored.tui.incarnation, job.tui.incarnation);
    const id = randomUUID();
    await runLoom('send', addr, '--id', id, 'Reply with only RESTORED. Use no tools.');
    answered(await waitFor(id), id);
    assert.equal((await controlTui(job.tui, 'confirmations', { id })).count, 1);
    assert.equal((await controlTui(job.tui, 'confirmations', { id: opened.deliveryId })).count, 1);
    console.log(JSON.stringify({ cli, test: 'controller-restart', samePid: true, sameIncarnation: true, confirmed: 2, dir: parent }));
  } finally {
    if (daemon?.exitCode === null && daemon.signalCode === null) {
      await runLoom('daemon', 'stop').catch(() => daemon.kill());
      await completion;
    }
    for (const file of await readdir(jobs).catch(error => { if (error.code === 'ENOENT') return []; throw error; })) {
      if (!/^loom-[0-9a-f-]+\.json$/.test(file)) continue;
      const job = JSON.parse(await readFile(join(jobs, file), 'utf8'));
      assert.equal(job.row.cwd, cwd);
      const name = 'loom-' + job.row.addr.slice(5).replaceAll('-', '').slice(0, 22);
      const pane = await hc('get', name);
      assert.equal(pane.name, name);
      assert.equal(pane.cwd, cwd);
      if (pane.state !== 'finished') await hc('kill', name);
      assert.equal((await hc('get', name)).state, 'finished');
      console.log(JSON.stringify({ cli, cleanup: pane.address, state: 'finished' }));
    }
  }
}

async function verify(cli) {
  const parent = join(run, cli === 'codex' ? 'x' : cli[0]);
  const cwd = join(parent, 'w');
  const stateDir = join(parent, 'p');
  const home = join(parent, 'h');
  const claude = join(home, '.claude');
  const codex = join(home, '.codex');
  const agy = join(home, '.gemini', 'antigravity-cli');
  for (const path of [cwd, stateDir, claude, codex, join(agy, 'cache')]) {
    await mkdir(path, { recursive: true, mode: 0o700 });
  }
  await exec('/usr/bin/git', ['init', '-q', cwd], { env: {
    HOME: home, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
  } });
  const onboarding = JSON.stringify({ hasCompletedOnboarding: true, theme: 'dark' });
  await writeFile(join(home, '.claude.json'), onboarding, { mode: 0o600 });
  await writeFile(join(claude, '.claude.json'), onboarding, { mode: 0o600 });
  await writeFile(join(agy, 'cache', 'onboarding.json'), JSON.stringify({
    onboardingComplete: true, consumerOnboardingComplete: true, enterpriseOnboardingComplete: true,
  }), { mode: 0o600 });
  const mock = await mockProvider();
  const env = {
    HOME: home, TMPDIR: parent, CLAUDE_CONFIG_DIR: claude, CODEX_HOME: codex, ANTIGRAVITY_APP_DATA_DIR: agy,
    XDG_CONFIG_HOME: join(home, '.config'), XDG_DATA_HOME: join(home, '.local', 'share'),
    DISABLE_AUTOUPDATER: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost',
    ...(cli === 'claude' && { ANTHROPIC_BASE_URL: mock.url, ANTHROPIC_AUTH_TOKEN: 'loopback-test-value' }),
    ...(cli === 'agy' && { AGY_LLM_GATEWAY_URL: mock.url + '/v1', AGY_LLM_GATEWAY_API_KEY: 'loopback-test-value',
      AGY_LLM_GATEWAY_WIRE_PROTOCOL: 'openai', AGY_LLM_GATEWAY_MODELS: 'loopback',
      AGY_LLM_GATEWAY_TIER_FLASH: 'loopback', AGY_LLM_GATEWAY_TIER_PRO: 'loopback' }),
  };
  const extraArgs = cli === 'codex' ? ['--disable', 'memories', '-c', 'model_provider="loopback"',
    '-c', 'model_providers.loopback.name="Loopback"', '-c', `model_providers.loopback.base_url="${mock.url}/v1"`,
    '-c', 'model_providers.loopback.wire_api="responses"', '-c', 'model_providers.loopback.requires_openai_auth=false',
    '-c', 'model_providers.loopback.request_max_retries=0', '-c', 'model_providers.loopback.stream_max_retries=0',
    '-c', 'analytics.enabled=false'] : [];
  const model = { claude: 'sonnet', codex: 'gpt-5.4', agy: 'loopback' }[cli];
  if (testController) {
    try { return await verifyController({ cli, cwd, parent, env, extraArgs, model }); }
    finally { await mock.close(); }
  }
  const describe = state => ({ ready: state.ready, phase: state.phase, screen: state.screen?.kind, exit: state.exit });
  const panes = [];
  try {
    const host = await openNativeTui({ cli, cwd, stateDir, command: commands[cli], hcCommand: '/Users/sun/.local/bin/hc',
      name: `tui-orca-1-iso-${cli}-${suffix}`, trustWorkspace: false, env, extraArgs, boundTranscript: false,
      model,
      unset: ['HC_TERMINAL_ID', 'LOOM_ADDR', 'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SKIP_PROMPT_HISTORY',
        'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'OPENAI_BASE_URL'],
    });
    panes.push(host);
    const startup = await awaitState(host, state => state.ready || state.screen?.kind === 'trust-dialog' &&
      !state.host?.humanActive && state.host?.quietForMs >= 120);
    assert.equal(startup.screen?.kind, 'trust-dialog', JSON.stringify(describe(startup)));
    const dialog = await host.dialog({ trust: true });
    assert.equal(dialog.kind, 'advanced', JSON.stringify({ kind: dialog.kind, code: dialog.code }));
    const ready = await awaitState(host, state => state.ready);
    assert(ready.ready, JSON.stringify(describe(ready)));
    if (failure) mock.mode(failure);
    const first = await host.submit({ text: 'Reply with only ISOLATED. Use no tools.', timeoutMs: 12_000 });
    assert.equal(first.kind, 'confirmed', JSON.stringify(first.hostReceipt));
    if (failure) {
      const expected = failure === 'rate' ? 'rate-limit' : 'error';
      const blocked = await awaitState(host, state => state.phase === expected || state.screen?.kind === expected, 195_000);
      assert(blocked.phase === expected || blocked.screen?.kind === expected, JSON.stringify(describe(blocked)));
      const id = randomUUID();
      const retry = await host.submit({ id, text: 'This must stay blocked.', timeoutMs: 1000 });
      assert.equal(retry.kind, 'refused');
      assert.equal((await host.confirmations(id)).count, 0);
      console.log(JSON.stringify({ cli, test: failure, blocked: describe(blocked), refused: retry.code,
        backendRequests: mock.requests.length, dir: parent }));
      return;
    }
    assert((await awaitState(host, state => state.ready)).ready);
    const id = first.confirmation.sessionId;
    await assert.rejects(host.restart(), { code: 'PANE_LIVE' });
    await host.close();
    const resumed = await host.restart({ name: `tui-orca-1-resume-${cli}-${suffix}`, resume: id });
    panes.push(resumed);
    assert.notEqual(resumed.binding.incarnation, host.binding.incarnation);
    assert.equal(resumed.sessionId, id);
    const needsTrust = state => state.screen?.kind === 'trust-dialog' && !state.host?.humanActive && state.host?.quietForMs >= 120;
    let restored = await awaitState(resumed, state => state.ready || needsTrust(state));
    if (needsTrust(restored)) {
      assert.equal((await resumed.dialog({ trust: true })).kind, 'advanced');
      restored = await awaitState(resumed, state => state.ready);
    }
    assert(restored.ready, JSON.stringify(describe(restored)));
    const next = await resumed.submit({ text: 'Reply only RESUMED. Use no tools.', timeoutMs: 12_000 });
    assert.equal(next.kind, 'confirmed', JSON.stringify(next.hostReceipt));
    assert.equal(next.confirmation.sessionId, id);
    assert((await awaitState(resumed, state => state.ready)).ready);
    assert.equal((await resumed.confirmations(first.id)).count, 0);
    console.log(JSON.stringify({ cli, test: 'exact-resume', trust: dialog.kind, sameNativeSession: true,
      newIncarnation: true, backendRequests: mock.requests.length, dir: parent }));
  } finally {
    try {
      for (const pane of panes) {
        assert.equal((await pane.close()).state, 'finished');
        console.log(JSON.stringify({ cli, cleanup: pane.id, state: 'finished' }));
      }
    } finally {
      await mock.close();
    }
  }
}

const outcomes = await Promise.allSettled((cases.length ? cases : Object.keys(commands)).map(verify));
for (const [index, outcome] of outcomes.entries()) {
  if (outcome.status === 'rejected') {
    console.error(JSON.stringify({ cli: (cases.length ? cases : Object.keys(commands))[index], failure: outcome.reason.message }));
    process.exitCode = 1;
  }
}
