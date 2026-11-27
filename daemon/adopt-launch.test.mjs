import assert from 'node:assert/strict';
import { execFile, spawn, mkdtemp } from '../fixtures/test-process.mjs';
import { once } from 'node:events';
import { mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { nestedSeatbeltLimited } from './sandbox-test-capability.mjs';
import { disposeSession } from './session-close.mjs';

const exec = promisify(execFile);

async function writeClaudeCcpStub(home, body) {
  const { symlink } = await import('node:fs/promises');
  const ccpDir = join(home, 'ccp', 'bin');
  const binDir = join(home, '.local', 'bin');
  await mkdir(ccpDir, { recursive: true });
  await mkdir(binDir, { recursive: true });
  const target = join(ccpDir, 'claude-protected');
  const entry = join(binDir, 'claude');
  await writeFile(target, body, { mode: 0o700 });
  await symlink(target, entry);
  return entry;
}

test('Claude native TUI and OAR children inherit API credentials only for opted-in roles and preserve proxy env', async t => {
  const project = await mkdtemp(join(tmpdir(), 'loom-auth-test-'));
  t.after(() => rm(project, { recursive: true, force: true }));
  await mkdir(join(project, '.project'), { recursive: true });
  const hc = join(project, 'hc');
  const seen = join(project, 'seen.jsonl');
  const pane = join(project, 'pane.json');
  const claude = await writeClaudeCcpStub(project, `#!${process.execPath}
import { appendFileSync } from 'node:fs';
if (process.argv.includes('--version')) { console.log('2.1.331 (Claude Code)'); process.exit(0); }
const input = process.argv.slice(2);
appendFileSync(${JSON.stringify(seen)}, JSON.stringify({ headless: input.includes('--print') || input.includes('-p'),
  hasKey: Object.hasOwn(process.env, 'ANTHROPIC_API_KEY'), hasToken: Object.hasOwn(process.env, 'ANTHROPIC_AUTH_TOKEN'),
  httpsProxy: process.env.HTTPS_PROXY, noProxy: process.env.NO_PROXY, bare: input.includes('--bare') }) + '\\n');
process.exit(23);
`);
  await writeFile(hc, `#!${process.execPath}
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const [verb, ...args] = process.argv.slice(2);
const file = ${JSON.stringify(pane)};
if (verb === 'run') {
  const argv = args.slice(args.indexOf('--') + 1);
  const wrapped = argv.some(arg => arg.endsWith('/tui/loom-pty'));
  if (!wrapped) spawnSync(argv[0], argv.slice(1), { stdio: 'ignore' });
  writeFileSync(file, JSON.stringify({ address: wrapped ? 't1' : 't2', state: wrapped ? 'finished' : 'live',
    name: args[args.indexOf('--name') + 1] }));
}
if (!['run', 'get'].includes(verb)) process.exit(2);
console.log(readFileSync(file, 'utf8'));
`, { mode: 0o700 });
  const tuis = new URL('../runtimes/tui/transport.mjs', import.meta.url).href;
  const policy = new URL('../cli/policy.mjs', import.meta.url).href;
  const oar = new URL('./oar.mjs', import.meta.url).href;
  const script = `import { openNativeTui } from ${JSON.stringify(tuis)};
import { claudeAuthMode } from ${JSON.stringify(policy)};
import { openOar } from ${JSON.stringify(oar)};
const [project, claude, hc] = process.argv.slice(1);
const role = 'leader';
const authMode = claudeAuthMode(project, role);
await openNativeTui({ cli: 'claude', cwd: project, command: claude, hcCommand: hc, stateDir: project, authMode,
  env: { HTTPS_PROXY: 'http://override-ignored:9999' }, unset: ['HTTPS_PROXY', 'NO_PROXY'] });
try {
  const session = await openOar({ addr: 'oar-00000000-0000-4000-8000-000000000001', cli: 'claude',
    runtimeId: 'claude', cwd: project, role, authMode, effort: 'low' }, project);
  await session.dispose();
} catch (error) {
  if (!/exited|closed/i.test(error.message)) throw error;
}`;
  for (const enabled of [false, true]) {
    await writeFile(join(project, '.project', 'policy.json'), JSON.stringify(enabled ? { roles: { leader: { auth: 'api-key' } } } : {}));
    await exec(process.execPath, ['--input-type=module', '-e', script, project, claude, hc], {
      cwd: project, timeout: 15_000, env: { HOME: project, TMPDIR: project, PATH: '/usr/bin:/bin',
        HTTPS_PROXY: 'http://127.0.0.1:17891', NO_PROXY: 'localhost,127.0.0.1',
        ANTHROPIC_API_KEY: 'fixture-only', ANTHROPIC_AUTH_TOKEN: 'fixture-only' },
    });
  }
  assert.deepEqual((await readFile(seen, 'utf8')).trim().split('\n').map(JSON.parse), [
    { headless: false, hasKey: false, hasToken: false, httpsProxy: 'http://127.0.0.1:17891', noProxy: 'localhost,127.0.0.1', bare: false },
    { headless: true, hasKey: false, hasToken: false, httpsProxy: 'http://127.0.0.1:17891', noProxy: 'localhost,127.0.0.1', bare: false },
    { headless: false, hasKey: true, hasToken: true, httpsProxy: 'http://127.0.0.1:17891', noProxy: 'localhost,127.0.0.1', bare: false },
    { headless: true, hasKey: true, hasToken: true, httpsProxy: 'http://127.0.0.1:17891', noProxy: 'localhost,127.0.0.1', bare: false },
  ]);
});

test('Claude headless host keeps the native login namespace', { skip: nestedSeatbeltLimited }, async t => {
  const project = await mkdtemp(join(await realpath(tmpdir()), 'loom-claude-host-'));
  t.after(() => rm(project, { recursive: true, force: true }));
  const seen = join(project, 'seen.json');
  await writeClaudeCcpStub(project, `#!${process.execPath}
import { writeFileSync } from 'node:fs';
if (process.argv.includes('--version')) { console.log('2.1.331 (Claude Code)'); process.exit(0); }
const { HOME, CLAUDE_CONFIG_DIR, CLAUDE_SECURESTORAGE_CONFIG_DIR } = process.env;
writeFileSync(${JSON.stringify(seen)}, JSON.stringify({ nativeHome: HOME === ${JSON.stringify(project)},
  config: CLAUDE_CONFIG_DIR === undefined ? 'unset' : CLAUDE_CONFIG_DIR === ${JSON.stringify(join(project, 'custom'))} ? 'custom' : 'other',
  storage: CLAUDE_SECURESTORAGE_CONFIG_DIR !== undefined, headless: process.argv.includes('-p') }));
process.exit(23);
`);
  const script = `import { openOar } from ${JSON.stringify(new URL('./oar.mjs', import.meta.url).href)};
const [cwd] = process.argv.slice(1);
try {
  const session = await openOar({ addr: 'oar-00000000-0000-4000-8000-000000000002', cli: 'claude', role: 'worker',
    runtimeId: 'claude', cwd, hostGrant: { expiresAt: Date.now() + 30000, write: [] } }, cwd);
  await session.dispose();
} catch (error) { if (!/exited|closed/i.test(error.message)) throw error; }`;
  for (const custom of [false, true]) {
    await exec(process.execPath, ['--input-type=module', '-e', script, project], { cwd: project, timeout: 10_000,
      env: { HOME: project, TMPDIR: project, PATH: '/usr/bin:/bin', LOOM_WORKER_TMP: project,
        ...(custom && { CLAUDE_CONFIG_DIR: join(project, 'custom'), CLAUDE_SECURESTORAGE_CONFIG_DIR: join(project, 'storage') }) } });
    assert.deepEqual(JSON.parse(await readFile(seen, 'utf8')),
      { nativeHome: true, config: custom ? 'custom' : 'unset', storage: custom, headless: true });
  }
});

test('Claude headless host uses Seatbelt by default and bypasses sandbox-exec under unconfined grant',
  { skip: process.platform !== 'darwin' || nestedSeatbeltLimited }, async t => {
  const project = await mkdtemp(join(await realpath(tmpdir()), 'loom-claude-unconfined-'));
  t.after(() => rm(project, { recursive: true, force: true }));
  const seen = join(project, 'seen.json');
  await writeClaudeCcpStub(project, `#!${process.execPath}
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
if (process.argv.includes('--version')) { console.log('2.1.331 (Claude Code)'); process.exit(0); }
const launcher = join(dirname(process.env.TMPDIR), 'host-native');
const wrapped = existsSync(launcher);
const probe = spawnSync('/usr/bin/sandbox-exec', ['-p', '(version 1)(allow default)', '/usr/bin/true'], { stdio: 'ignore' });
writeFileSync(${JSON.stringify(seen)}, JSON.stringify({
  wrapped,
  sandboxExecInWrapper: wrapped && readFileSync(launcher, 'utf8').includes('/usr/bin/sandbox-exec'),
  sandboxExecStatus: probe.status,
  unconfinedEnv: process.env.LOOM_HOST_UNCONFINED === '1',
  guard: process.env.LOOM_HOST_GUARD === '1',
}));
process.exit(23);
`);
  const script = `import { openOar } from ${JSON.stringify(new URL('./oar.mjs', import.meta.url).href)};
const [cwd, addr, mode] = process.argv.slice(1);
const hostGrant = { expiresAt: Date.now() + 30000, write: [], ...(mode === 'unconfined' && { unconfined: true }) };
try {
  const session = await openOar({ addr, cli: 'claude', role: 'worker', runtimeId: 'claude', cwd, hostGrant }, cwd);
  await session.dispose();
} catch (error) { if (!/exited|closed/i.test(error.message)) throw error; }`;
  for (const [mode, addr, expected] of [
    ['default', 'oar-11111111-0000-4000-8000-000000000011',
      { wrapped: true, sandboxExecInWrapper: true, sandboxExecStatus: 71, unconfinedEnv: false, guard: true }],
    ['unconfined', 'oar-22222222-0000-4000-8000-000000000012',
      { wrapped: false, sandboxExecInWrapper: false, sandboxExecStatus: 0, unconfinedEnv: true, guard: true }],
  ]) {
    await exec(process.execPath, ['--input-type=module', '-e', script, project, addr, mode], {
      cwd: project, timeout: 10_000,
      env: { HOME: project, TMPDIR: project, PATH: '/usr/bin:/bin', LOOM_WORKER_TMP: project },
    });
    assert.deepEqual(JSON.parse(await readFile(seen, 'utf8')), expected, mode);
  }
});

test('a stuck OAR dispose is bounded and preserves late settlement', async () => {
  const pending = Promise.withResolvers();
  await assert.rejects(disposeSession({ dispose: () => pending.promise }, 15), { code: 'close-timeout' });
  pending.reject(new Error('late ACP cleanup failure'));
  await disposeSession({ dispose: async () => {} });
});

test('host close terminates a detached child that ignores SIGTERM', { skip: process.platform === 'win32' }, async () => {
  const close = new URL('./session-close.mjs', import.meta.url).href;
  const processes = new URL('./processes.mjs', import.meta.url).href;
  const script = `import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { processTable } from ${JSON.stringify(processes)};
import { closeHostChildren } from ${JSON.stringify(close)};
const child = spawn(process.execPath, ['-e',
  "process.on('SIGTERM', () => console.log('TERM')); console.log('ready'); setInterval(() => {}, 1000)"],
  { detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
let output = '';
child.stdout.on('data', bytes => { output += bytes.toString(); });
const exited = once(child, 'exit');
try {
  await once(child.stdout, 'data');
  await closeHostChildren((await processTable([process.pid])).get(process.pid));
  assert.deepEqual(await exited, [null, 'SIGKILL']);
  assert.match(output, /TERM/);
} finally { child.kill('SIGKILL'); }`;
  const host = spawn(process.execPath, ['--input-type=module', '-e', script],
    { detached: true, stdio: ['ignore', 'ignore', 'pipe'], timeout: 12_000 });
  let stderr = '';
  host.stderr.on('data', chunk => { stderr += chunk; });
  assert.deepEqual(await once(host, 'exit'), [0, null], stderr);
});
