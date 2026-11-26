import assert from 'node:assert/strict';
import { execFile, mkdtempSync } from '../fixtures/test-process.mjs';
import { createHash, randomUUID } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { PassThrough } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { platforms } from '../holder/assets.mjs';
import { includeReleaseEntry, installManagedCli, managedEnvironment, releaseDigest } from './release.mjs';
import { waitForUpgrade, upgradePendingExit } from '../cli/upgrade.mjs';
import { request } from './rpc.mjs';
import { clientCapability } from './socket-auth.mjs';
import { projectIndex } from '../cli/project.mjs';
import { preparePeerAuth } from './peer-auth.mjs';
import { statusTui } from '../cli/status-tui.mjs';

const exec = promisify(execFile);
const root = resolve(import.meta.dirname, '..');
const supported = platforms.includes(`${process.platform}-${process.arch}`);
const read = path => JSON.parse(readFileSync(path, 'utf8'));

function copyRelease(destination, source = root) {
  for (const name of ['adapters', 'bin', 'cli', 'daemon', 'evidence', 'handover', 'holder', 'inbox', 'index', 'lib',
    'memory', 'relay', 'runtimes', 'schema', 'tui', 'watch', 'package.json', 'package-lock.json']) {
    cpSync(join(source, name), join(destination, name), { recursive: true, filter: path => includeReleaseEntry(basename(path)) });
  }
  symlinkSync(join(root, 'node_modules'), join(destination, 'node_modules'));
}

test('upgrade observes a late commit and reports a distinct pending outcome at its deadline', async () => {
  const result = { upgradeId: 'this-upgrade', phase: 'switching' };
  let at = 0;
  const timing = { now: () => at, pause: async ms => { at += ms; }, waitMs: 300 };
  const state = () => ({ id: result.upgradeId, phase: at >= 300 ? 'committed' : 'switching' });
  assert.deepEqual(await waitForUpgrade(result, state, async () => {}, timing),
    { id: result.upgradeId, phase: 'committed', ok: true });
  at = 0;
  const pending = await waitForUpgrade(result, () => ({ ...state(), phase: 'switching' }), async () => {}, timing);
  assert.equal(pending.phase, 'switching');
  assert.equal(pending.pending, true);
  assert.match(pending.error, /upgrade --status/);
  assert.equal(upgradePendingExit, 4);
});

test('one managed CLI path follows the serving release and preserves flags across a switch', async t => {
  const project = realpathSync(mkdtempSync(join(tmpdir(), 'lshim-')));
  t.after(() => rmSync(project, { recursive: true, force: true }));
  const first = join(project, 'first');
  const second = join(project, 'second');
  for (const [root, name] of [[first, 'first'], [second, 'second']]) {
    mkdirSync(join(root, 'cli'), { recursive: true });
    writeFileSync(join(root, 'cli', 'loom.mjs'), `export function main(args) {
      console.log(JSON.stringify({ name: ${JSON.stringify(name)}, args })); return 0;
    }`);
  }
  installManagedCli(project);
  const env = { ...process.env, ...managedEnvironment(project, 'fixture') };
  const args = ['send', 'leader', '--expect-red', '--kind', 'decision', 'a "quoted" message\nsecond line'];
  const invoke = async name => {
    const result = await exec(env.LOOM_BIN, args, { env, cwd: project });
    assert.deepEqual(JSON.parse(result.stdout), { name, args });
  };
  const pointer = join(project, '.project', 'loomd', 'release.json');
  const upgrade = join(project, '.project', 'loomd', 'upgrade.json');
  writeFileSync(pointer, JSON.stringify({ current: { root: first } }));
  await invoke('first');
  writeFileSync(upgrade, JSON.stringify({ id: 'switch', phase: 'switching', current: { root: first } }));
  writeFileSync(pointer, JSON.stringify({ upgradeId: 'switch', current: { root: second } }));
  await invoke('first');
  writeFileSync(upgrade, JSON.stringify({ id: 'switch', phase: 'committed' }));
  await invoke('second');
  writeFileSync(pointer, JSON.stringify({ current: { root } }));
  for (const command of ['gate', 'escalate']) {
    assert.match((await exec(env.LOOM_BIN, [command, '--help'], { env, cwd: project })).stdout, new RegExp(`loom ${command} `));
  }
});

test('failed verification restores the old writer and a successful upgrade preserves both capabilities', { skip: !supported }, async t => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'lu-')));
  const project = join(dir, 'project');
  const metadata = join(project, '.project');
  const runtime = join(metadata, 'loomd');
  const candidate = join(dir, 'candidate');
  const cli = join(root, 'bin', 'loom');
  const codex = join(dir, 'codex');
  const ps = join(dir, 'ps');
  const denyLookup = join(dir, 'deny-holder-lookup');
  const denied = join(dir, 'denied-holder-lookups');
  writeFileSync(ps, '#!' + process.execPath + '\n' + `
    import { execFileSync } from 'node:child_process';
    import { appendFileSync, existsSync, readFileSync } from 'node:fs';
    const [option, pids] = process.argv.slice(2);
    if (option === '-p' && existsSync(${JSON.stringify(denyLookup)}) &&
        pids.split(',').includes(readFileSync(${JSON.stringify(denyLookup)}, 'utf8'))) {
      appendFileSync(${JSON.stringify(denied)}, 'blocked lookup\\n');
      console.error('Fixture could not enumerate the existing holder');
      process.exit(1);
    }
    execFileSync('/bin/ps', process.argv.slice(2), { stdio: 'inherit' });
  `, { mode: 0o700 });
  const env = { HOME: dir, TMPDIR: dir, CODEX_HOME: dir, XDG_STATE_HOME: join(dir, 'state'), PATH: process.env.PATH, LOOM_CODEX_BIN: codex,
    OAR_CODEX_BIN: codex, LOOM_CLAUDE_BIN: codex, LOOM_AGY_BIN: codex, LOOM_OPENCODE_BIN: codex,
    LOOM_DESKTOP_NOTIFY: '0', LOOM_TEST_PS: ps, LOOM_TEST_CODEX_PIPES: '1', LOOM_EXTERNAL_SUPER: '1',
    ...(process.env.LOOM_WORKER_TMP && { LOOM_WORKER_TMP: process.env.LOOM_WORKER_TMP }) };
  const run = async (...args) => {
    const result = await exec(process.execPath, [cli, ...args, '--project', project], { cwd: project, env, timeout: 25_000 })
      .catch(error => {
        if (error.code === 1 && error.stdout) return error;
        throw error;
      });
    return JSON.parse(result.stdout);
  };
  t.after(async () => {
    const status = await run('daemon', 'status').catch(() => null);
    if (status?.running && status.project === project) {
      const rows = await run('upgrade', '--status').catch(() => null);
      for (const session of rows?.sessions ?? []) await run('stop', session.addr).catch(() => {});
      await run('daemon', 'stop').catch(() => {});
    }
    rmSync(dir, { recursive: true, force: true });
  });

  mkdirSync(runtime, { recursive: true });
  const initial = { current: { root, id: root, digest: releaseDigest(root) } };
  writeFileSync(join(runtime, 'release.json'), JSON.stringify(initial));
  writeFileSync(join(runtime, 'prompt-smoke.json'),
    JSON.stringify({ codex: { cli: 'codex', version: '0.171.0', binary: codex, status: 'passed' } }));
  writeFileSync(join(metadata, 'policy.json'), JSON.stringify({ deny: [], preferred: [], delivery: { coalesceMs: 0 } }));
  const fake = new URL('../tasks/PROTO-HARDEN-0/fixtures/native.mjs', import.meta.url);
  writeFileSync(codex, '#!' + process.execPath + '\nimport ' + JSON.stringify(fake.href) + ';\n', { mode: 0o700 });
  for (const transient of ['.test-aKYwiY', '.evidence-test-scratch', '.build-staging']) {
    assert.equal(includeReleaseEntry(transient), false);
  }
  copyRelease(candidate);
  const main = join(candidate, 'daemon', 'main.mjs');
  const candidateCode = readFileSync(main, 'utf8');
  const verify = '      validateReattachment(handoff, { sessions: attached });';
  assert(candidateCode.includes(verify));
  writeFileSync(main, candidateCode.replace(verify,
    `      await import('node:fs').then(fs => fs.writeFileSync(${JSON.stringify(denyLookup)}, String(attached[0].pid)));\n` +
    "      attached[0] = { ...attached[0], status: 'unavailable', reason: 'fixture attachment failure' };\n" + verify));

  async function until(readResult, condition) {
    const deadline = Date.now() + 25_000;
    let value;
    do {
      value = await readResult();
      if (condition(value)) return value;
      await delay(100);
    } while (Date.now() < deadline);
    const log = join(metadata, 'loomd.log');
    assert.fail(JSON.stringify(value) + (existsSync(log) ? '\n' + readFileSync(log, 'utf8').slice(-2400) : ''));
  }
  const previous = await run('daemon', 'start');
  assert.equal(previous.running, true);
  const opened = await run('spawn', 'super', '--cwd', project, '--cli', 'codex', '--mode', 'headless',
    '--model', 'fixture', '--effort', 'high', 'Startup fixture prompt');
  const { addr } = opened.session;
  const authDir = join(env.XDG_STATE_HOME, 'loom', 'socket-auth', createHash('sha256').update(project).digest('hex'));
  const external = clientCapability(project, env);
  const managed = readFileSync(join(authDir, addr), 'utf8').trim();
  const checkCapabilities = async () => {
    for (const capability of [external, managed]) {
      assert.equal((await request(project, 'notifications', { take: true }, { capability })).ok, true);
    }
    await assert.rejects(request(project, 'notifications', { take: true }, { capability: 'invalid' }), { code: 'forbidden' });
  };
  await checkCapabilities();
  const state = () => run('state', addr);
  const answered = id => until(state, result => result.deliveries?.some(d => d.id === id && d.deliveryStatus === 'answered'));
  await answered(opened.deliveryId);
  const generation = read(join(runtime, 'generation.json'));
  const candidateUpgrade = join(candidate, 'daemon', 'upgrade.mjs');
  const candidateUpgradeCode = readFileSync(candidateUpgrade, 'utf8');
  const marker = 'daemonProtocol, socketAuthVersion, hostProtocol';
  assert.ok(candidateUpgradeCode.includes(marker));
  writeFileSync(candidateUpgrade, candidateUpgradeCode.replace(marker, 'daemonProtocol, hostProtocol'));
  const oldBuild = await run('upgrade', '--to', candidate, '--check');
  assert.match(oldBuild.error.message, /does not support Loom socket capabilities/);
  writeFileSync(candidateUpgrade, candidateUpgradeCode);
  const preflight = await run('upgrade', '--to', candidate, '--check');
  assert.equal(preflight.eligible, true, JSON.stringify(preflight));
  assert.equal(preflight.attachmentCheck, 'checked');
  assert.equal(preflight.promptSmoke.providers.find(item => item.cli === 'codex').cached, true);
  const original = preflight.sessions[0];
  assert.equal(original.protocol, 3);
  assert.deepEqual(read(join(runtime, 'generation.json')), generation);
  assert.equal((await run('daemon', 'status')).pid, previous.pid);

  const failed = await run('upgrade', '--to', candidate);
  assert.equal(failed.phase, 'failed', JSON.stringify(failed));
  assert.equal(failed.recovered, true);
  assert.equal(failed.error, `Session ${addr} could not reattach: fixture attachment failure`);
  assert.notEqual(failed.pid, previous.pid);
  const restored = await run('daemon', 'status');
  assert.equal(restored.pid, failed.pid);
  assert.equal(restored.release.root, root);
  assert.deepEqual(read(join(runtime, 'release.json')), initial);
  assert.equal(read(join(runtime, 'upgrade.json')).error, failed.error);
  assert.equal(read(join(runtime, 'generation.json')).generation, generation.generation + 2);
  const live = await until(() => run('upgrade', '--status'),
    result => result.sessions?.some(session => session.addr === addr && session.status === 'attached'));
  assert.deepEqual(live.sessions[0], original);
  assert.match(readFileSync(denied, 'utf8'), /blocked lookup/);
  rmSync(denyLookup);
  const follow = randomUUID();
  assert.equal((await run('send', addr, '--id', follow, 'Delivered by the recovered daemon')).ok, true);
  await answered(follow);
  const native = readFileSync(join(project, 'native-deliveries.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(native.filter(e => e.text.startsWith(`[loom:${follow}]\n`)).length, 1);
  await checkCapabilities();

  writeFileSync(main, candidateCode);
  const committed = await run('upgrade', '--to', candidate);
  assert.equal(committed.phase, 'committed', JSON.stringify(committed));
  assert.notEqual((await run('daemon', 'status')).pid, failed.pid);
  const current = await run('upgrade', '--status');
  assert.deepEqual(current.sessions[0], original);
  await checkCapabilities();
});

test('live legacy rights, Worker TTL and Status TUI survive an authenticated hot upgrade', { skip: !supported }, async t => {
  const peers = preparePeerAuth();
  if (!peers.available && process.platform === 'linux') return t.skip(peers.reason);
  assert.equal(peers.available, true, peers.reason);
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'lup-')));
  const project = join(dir, 'p');
  const runtime = join(project, '.project', 'loomd');
  const legacy = join(dir, 'legacy');
  const codex = join(dir, 'codex');
  const cli = join(root, 'bin', 'loom');
  const env = { HOME: dir, TMPDIR: dir, CODEX_HOME: join(dir, 'cx'), XDG_STATE_HOME: join(dir, 'state'), PATH: process.env.PATH,
    LOOM_CODEX_BIN: codex, OAR_CODEX_BIN: codex, LOOM_CLAUDE_BIN: codex, LOOM_AGY_BIN: codex, LOOM_OPENCODE_BIN: codex,
    LOOM_DESKTOP_NOTIFY: '0', LOOM_HERDR_LAYOUT: '0', LOOM_EXTERNAL_SUPER: '1',
    ...(process.env.LOOM_WORKER_TMP && { LOOM_WORKER_TMP: process.env.LOOM_WORKER_TMP }) };
  const run = async (args, overrides = {}) => {
    const result = await exec(process.execPath, [cli, ...args, '--project', project],
      { cwd: project, env: { ...env, ...overrides }, timeout: 25_000 }).catch(error => {
      if (error.stdout) return error;
      throw error;
    });
    return JSON.parse(result.stdout);
  };
  t.after(async () => {
    const status = await run(['daemon', 'status']).catch(() => null);
    if (status?.running) {
      for (const row of projectIndex(project).query({ endedAt: null })) await run(['stop', row.addr]).catch(() => {});
      await run(['daemon', 'stop']).catch(() => {});
    }
    rmSync(dir, { recursive: true, force: true });
  });

  mkdirSync(runtime, { recursive: true });
  mkdirSync(env.CODEX_HOME);
  await exec('/usr/bin/git', ['init', '-q'], { cwd: project, env });
  await exec('/usr/bin/git', ['-c', 'user.name=Loom Fixture', '-c', 'user.email=loom@invalid', 'commit', '--allow-empty', '-qm', 'Fixture candidate'],
    { cwd: project, env });
  // Keep enough time for the upgrade and peer-auth probes under parallel test load.
  const ttl = 45_000;
  writeFileSync(join(project, '.git/info/exclude'), '/.native/\n/runtime-pids.jsonl\n/native-deliveries.jsonl\n/*.operation*\n/*.result*\n');
  writeFileSync(join(project, '.project', 'policy.json'),
    JSON.stringify({ deny: [], preferred: [], delivery: { coalesceMs: 0 }, workers: { warmMs: { codex: ttl } } }));
  copyRelease(legacy, process.env.LOOM_TEST_LEGACY_RELEASE);
  if (!process.env.LOOM_TEST_LEGACY_RELEASE) {
    const oldMain = join(legacy, 'daemon', 'main.mjs');
    const code = readFileSync(oldMain, 'utf8');
    const support = 'controller, capabilities },';
    assert.ok(code.includes(support));
    // Reproduce the stored state and launch environment of a pre-capability
    // build, with an external operator available to drive the fixture.
    writeFileSync(oldMain, code.replace(support, 'controller },'));
  }
  writeFileSync(join(runtime, 'release.json'), JSON.stringify({ current: { root: legacy, id: legacy, digest: releaseDigest(legacy) } }));

  const native = new URL('../tasks/PROTO-HARDEN-0/fixtures/native.mjs', import.meta.url);
  writeFileSync(codex, '#!' + process.execPath + '\n' + `
    import { execFile } from 'node:child_process';
    import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
    const { LOOM_ADDR, LOOM_BIN, LOOM_CAPABILITY } = process.env;
    if (LOOM_ADDR && process.argv.includes('app-server')) {
      const inbox = LOOM_ADDR + '.operation';
      setInterval(() => {
        if (!existsSync(inbox)) return;
        const { args, overrides } = JSON.parse(readFileSync(inbox, 'utf8'));
        unlinkSync(inbox);
        execFile(overrides?.LOOM_BIN ?? LOOM_BIN, args, { env: { ...process.env, ...overrides } }, (error, stdout) => {
          const value = stdout ? JSON.parse(stdout) : { ok: false, launcher: error?.code };
          const path = LOOM_ADDR + '.result';
          writeFileSync(path + '.tmp', JSON.stringify({ pid: process.pid, issued: Boolean(LOOM_CAPABILITY), value }));
          renameSync(path + '.tmp', path);
        });
      }, 40).unref();
    }
    await import(${JSON.stringify(native.href)});
  `, { mode: 0o700 });

  const started = await run(['daemon', 'start']);
  assert.equal(started.release.root, legacy);
  const start = async (role, options = [], prompt = 'Fixture startup') => {
    const result = await run(['spawn', role, '--cwd', project, '--cli', 'codex', '--mode', 'headless',
      '--model', 'fixture', '--effort', 'high', ...options, prompt]);
    assert.equal(result.ok, true, JSON.stringify(result));
    return result.session.addr;
  };
  const leader = await start('leader');
  const auditor = await start('auditor');
  const worker = await start('worker', ['--parent', leader, '--task', 'fixture', '--wave', 'G1'], 'RETURN DONE fixture');
  async function nativeCall(addr, args, overrides) {
    const operation = join(project, addr + '.operation');
    const result = join(project, addr + '.result');
    rmSync(result, { force: true });
    writeFileSync(operation + '.tmp', JSON.stringify({ args, overrides }));
    renameSync(operation + '.tmp', operation);
    const deadline = Date.now() + 10_000;
    do {
      if (existsSync(result)) return read(result);
      await delay(80);
    } while (Date.now() < deadline);
    assert.fail(`The fixture did not answer the legacy session call ${args[0]}`);
  }
  const initial = new Map();
  for (const addr of [leader, auditor, worker]) {
    const probe = await nativeCall(addr, ['daemon', 'status']);
    assert.equal(probe.issued, false);
    assert.equal(probe.value.running, true);
    initial.set(addr, probe.pid);
  }
  async function until(probe, ready, timeout = 10_000) {
    const start = Date.now();
    do {
      const value = await probe();
      if (ready(value)) return value;
      await delay(60);
    } while (Date.now() - start < timeout);
    assert.fail('Timed out waiting for the live upgrade fixture');
  }
  const workerState = () => run(['state', worker]);
  const ready = await until(workerState, state => state.state === 'idle-warm' && state.retention?.remainingMs > 0);
  const input = new PassThrough();
  const output = new PassThrough();
  Object.assign(input, { isTTY: true, isRaw: false, setRawMode(value) { this.isRaw = value; } });
  Object.assign(output, { isTTY: true, columns: 100, rows: 32 });
  let rendered = '';
  output.on('data', bytes => { rendered += bytes; });
  let boardReads = 0;
  let disconnects = 0;
  let connectedRoles = [];
  const tui = statusTui({ project }, { input, output, interval: 50, env: { NO_COLOR: '' },
    async rpc(directory, command, args, options) {
      try {
        const board = await request(directory, command, args, options);
        connectedRoles = board.roles.map(row => row.addr);
        boardReads++;
        return board;
      } catch (error) {
        if (['ENOENT', 'ECONNREFUSED', 'ECONNRESET', 'not-ready'].includes(error.code)) disconnects++;
        throw error;
      }
    } });
  t.after(async () => { input.write('q'); await tui; });
  await until(() => boardReads, count => count >= 1);
  assert.match(rendered, /online/);
  assert.ok(connectedRoles.includes(leader));
  const before = (await run(['upgrade', '--status'])).sessions;
  const upgraded = await run(['upgrade', '--to', root]);
  assert.equal(upgraded.phase, 'committed', JSON.stringify(upgraded));
  assert.notEqual((await run(['daemon', 'status'])).pid, started.pid);
  assert.deepEqual((await run(['upgrade', '--status'])).sessions, before);
  const afterUpgrade = boardReads;
  await until(() => boardReads, count => count > afterUpgrade);
  assert.ok(connectedRoles.includes(leader));
  assert.ok(connectedRoles.includes(auditor));
  assert.ok(disconnects > 0, 'The same TUI must recover after observing the actual upgrade interruption');
  assert.match(rendered, /Waiting for loomd to reconnect/);
  const attached = await workerState();
  assert.equal(attached.retention.idleSince, ready.retention.idleSince);
  assert.ok(attached.retention.remainingMs < ready.retention.remainingMs);
  const operations = [
    [worker, ['worker-check']],
    [worker, ['send', leader, 'Worker proof']],
    [leader, ['gate', 'pack', 'G1']],
    [leader, ['escalate', 'G1', '--reason', 'protected-file', '--evidence', 'fixture evidence']],
    [auditor, ['notifications', '--needs-decision', 'Auditor proof', '--kind', 'decision']],
  ];
  for (const [addr, args] of operations) {
    const proof = await nativeCall(addr, args);
    assert.equal(proof.value.ok, true, JSON.stringify(proof.value));
    assert.deepEqual([proof.pid, proof.issued], [initial.get(addr), false]);
    assert.ok(read(join(runtime, 'sessions', addr + '.json')).legacyPeer?.birth);
  }
  const spoof = await run(['gate', 'pack', 'G1', '--reuse'], { LOOM_ADDR: leader, HC_TERMINAL_ID: leader });
  assert.equal(spoof.error.code, 'forbidden');
  const lesser = await nativeCall(worker, ['gate', 'pack', 'G1', '--reuse'], { LOOM_ADDR: leader });
  assert.equal(lesser.value.error.code, 'forbidden');
  const invalid = await nativeCall(leader, ['gate', 'pack', 'G1', '--reuse'], { LOOM_CAPABILITY: 'invalid' });
  assert.equal(invalid.value.error.code, 'forbidden');
  const pinned = await nativeCall(leader, ['gate', 'pack', 'G1', '--reuse'], { LOOM_BIN: join(legacy, 'bin', 'loom') });
  assert.equal(pinned.value.ok, true, JSON.stringify(pinned.value));
  assert.deepEqual([pinned.pid, pinned.issued], [initial.get(leader), false]);
  const offline = await until(workerState, state => state.state === 'offline', ttl + 5000);
  assert.ok(offline.retention.releasedAt >= ready.retention.idleSince + ttl);
  t.diagnostic(`native PIDs unchanged, Status TUI recovered (${disconnects} transient board failures), idleSince ${ready.retention.idleSince}, remaining ${ready.retention.remainingMs} → ${attached.retention.remainingMs} ms, expiry ${offline.retention.releasedAt}`);
  assert.deepEqual(projectIndex(project).rotations(), []);
});
