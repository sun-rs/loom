import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { disposeSession } from './session-close.mjs';

const exec = promisify(execFile);

test('Claude native TUI and OAR children inherit API credentials only for opted-in roles', async t => {
  const project = await mkdtemp(join(tmpdir(), 'loom-auth-test-'));
  t.after(() => rm(project, { recursive: true, force: true }));
  await mkdir(join(project, '.project'), { recursive: true });
  const claude = join(project, 'claude');
  const hc = join(project, 'hc');
  const seen = join(project, 'seen.jsonl');
  const pane = join(project, 'pane.json');
  await writeFile(claude, `#!${process.execPath}
import { appendFileSync } from 'node:fs';
if (process.argv.includes('--version')) { console.log('2.1.331 (Claude Code)'); process.exit(0); }
const input = process.argv.slice(2);
appendFileSync(${JSON.stringify(seen)}, JSON.stringify({ headless: input.includes('--print') || input.includes('-p'),
  hasKey: Object.hasOwn(process.env, 'ANTHROPIC_API_KEY'), hasToken: Object.hasOwn(process.env, 'ANTHROPIC_AUTH_TOKEN'),
  bare: input.includes('--bare') }) + '\\n');
process.exit(23);
`, { mode: 0o700 });
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
await openNativeTui({ cli: 'claude', cwd: project, command: claude, hcCommand: hc, stateDir: project, authMode });
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
        LOOM_CLAUDE_BIN: claude, ANTHROPIC_API_KEY: 'fixture-only', ANTHROPIC_AUTH_TOKEN: 'fixture-only' },
    });
  }
  assert.deepEqual((await readFile(seen, 'utf8')).trim().split('\n').map(JSON.parse), [
    { headless: false, hasKey: false, hasToken: false, bare: false },
    { headless: true, hasKey: false, hasToken: false, bare: false },
    { headless: false, hasKey: true, hasToken: true, bare: false },
    { headless: true, hasKey: true, hasToken: true, bare: false },
  ]);
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
  await closeHostChildren(processTable().get(process.pid));
  assert.deepEqual(await exited, [null, 'SIGKILL']);
  assert.match(output, /TERM/);
} finally { child.kill('SIGKILL'); }`;
  const host = spawn(process.execPath, ['--input-type=module', '-e', script],
    { detached: true, stdio: ['ignore', 'ignore', 'pipe'], timeout: 12_000 });
  let stderr = '';
  host.stderr.on('data', chunk => { stderr += chunk; });
  assert.deepEqual(await once(host, 'exit'), [0, null], stderr);
});
