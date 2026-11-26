import assert from 'node:assert/strict';
import { execFile, mkdtempSync, spawn } from '../fixtures/test-process.mjs';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { socketPath } from '../cli/project.mjs';
import { connectUnix } from '../lib/unix-socket.mjs';
import { clientCapability, socketCapabilities } from './socket-auth.mjs';
import { preparePeerAuth } from './peer-auth.mjs';
import { createSupervisor } from './supervisor.mjs';

const exec = promisify(execFile);
const cli = fileURLToPath(new URL('../bin/loom', import.meta.url));
const daemon = fileURLToPath(new URL('../bin/loomd', import.meta.url));

function wire(project, command, args, identity = {}) {
  return new Promise((resolve, reject) => {
    const socket = connectUnix(socketPath(project));
    let text = '';
    socket.setEncoding('utf8');
    socket.once('connect', () => socket.write(JSON.stringify({ command, args, ...identity }) + '\n'));
    socket.on('data', chunk => { text += chunk; });
    socket.once('error', reject);
    socket.once('end', () => resolve(JSON.parse(text)));
  });
}

async function until(read) {
  const deadline = Date.now() + 10_000;
  do {
    const result = await read();
    if (result) return result;
    await delay(80);
  } while (Date.now() < deadline);
  assert.fail('Timed out waiting for fixture');
}

test('loomd trusts launch capabilities over caller, sender, and role hints', { timeout: 40_000 }, async t => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'lsa-'));
  const project = join(root, 'p');
  const metadata = join(project, '.project');
  const state = join(root, 'state');
  const codex = join(root, 'codex');
  const authDir = join(state, 'loom', 'socket-auth', createHash('sha256').update(project).digest('hex'));
  const env = { HOME: root, TMPDIR: root, PATH: process.env.PATH, XDG_STATE_HOME: state, CODEX_HOME: join(root, 'cx'),
    LOOM_CODEX_BIN: codex, OAR_CODEX_BIN: codex, LOOM_DESKTOP_NOTIFY: '0', LOOM_HERDR_LAYOUT: '0' };
  mkdirSync(metadata, { recursive: true });
  mkdirSync(env.CODEX_HOME);
  const git = (...args) => exec('/usr/bin/git', args, { cwd: project, env });
  await git('init', '-q');
  await git('-c', 'user.name=Loom Fixture', '-c', 'user.email=loom@invalid', 'commit', '--allow-empty', '-qm', 'Fixture candidate');
  writeFileSync(join(metadata, 'policy.json'), JSON.stringify({ deny: [], preferred: [], delivery: { coalesceMs: 0 } }));
  const native = new URL('../tasks/PROTO-HARDEN-0/fixtures/native.mjs', import.meta.url);
  // The mock's own process calls the CLI with its inherited launch env. The
  // attestation records only booleans and the result code.
  writeFileSync(codex, '#!' + process.execPath + '\n' + `
    import { execFile } from 'node:child_process';
    import { renameSync, writeFileSync } from 'node:fs';
    const { LOOM_ADDR, LOOM_BIN, LOOM_CAPABILITY } = process.env;
    if (LOOM_ADDR && process.argv.includes('app-server')) {
      execFile(LOOM_BIN, ['notifications', '--needs-decision', 'Launch probe', '--kind', 'decision'], (_error, stdout) => {
        const result = JSON.parse(stdout);
        const path = LOOM_ADDR + '.probe';
        writeFileSync(path + '.tmp', JSON.stringify({ launched: Boolean(LOOM_CAPABILITY),
          inArguments: Boolean(LOOM_CAPABILITY && process.argv.some(arg => arg.includes(LOOM_CAPABILITY))),
          outcome: result.ok ? 'ok' : result.error.code }));
        renameSync(path + '.tmp', path);
      });
    }
    await import(${JSON.stringify(native.href)});
  `, { mode: 0o700 });
  const child = spawn(process.execPath, [daemon, '--project', project], { cwd: project, env, stdio: 'ignore' });
  const exited = once(child, 'exit');
  let external;
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const roster = await wire(project, 'status', {}).catch(() => ({}));
      for (const { addr } of roster.sessions ?? []) await wire(project, 'stop', { target: addr }, { capability: external }).catch(() => {});
      child.kill('SIGTERM');
    }
    await exited;
    rmSync(root, { recursive: true, force: true });
  });
  await until(() => wire(project, 'daemon-status', {}).catch(() => undefined));
  const superEnv = { ...env, LOOM_EXTERNAL_SUPER: '1' };
  external = clientCapability(project, superEnv);
  assert.ok(external);
  assert.equal(lstatSync(join(authDir, 'external-super')).mode & 0o777, 0o600);
  assert.equal(lstatSync(authDir).mode & 0o777, 0o700);
  const spawnArgs = role => ({ role, cwd: project, cli: 'codex', mode: 'headless', model: 'fixture', effort: 'high',
    prompt: 'start', ...(role === 'worker' && { task: 'CARD', wave: 'G1' }) });
  const spawnRole = async (role, capability) => {
    const response = await wire(project, 'spawn', spawnArgs(role), { capability });
    assert.equal(response.ok, true, JSON.stringify(response));
    const { addr } = response.session;
    const path = join(authDir, addr);
    assert.equal(lstatSync(path).mode & 0o777, 0o600);
    return { addr, token: readFileSync(path, 'utf8').trim() };
  };
  const leader = await spawnRole('leader', external);
  const auditor = await spawnRole('auditor', external);
  const worker = await spawnRole('worker', leader.token);
  const probes = await Promise.all([leader, auditor, worker].map(({ addr }) => until(() => {
    const path = join(project, addr + '.probe');
    if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf8'));
  })));
  assert.deepEqual(probes, ['ok', 'ok', 'forbidden'].map(outcome => ({ launched: true, inArguments: false, outcome })));

  const denied = async (command, args, identity, code = 'forbidden') => {
    const result = await wire(project, command, args, identity);
    assert.equal(result.ok, false, JSON.stringify(result));
    assert.equal(result.error.code, code);
  };
  for (const identity of [{ caller: leader.addr }, { caller: leader.addr, capability: worker.token },
    { caller: leader.addr, capability: `${leader.addr}.${'0'.repeat(64)}` }]) {
    await denied('gate-pack', { gate: 'G1' }, identity);
    await denied('escalate', { gate: 'G1', reason: 'protected-file', evidence: 'fixture' }, identity);
    await denied('notifications', { gateComplete: 'G1' }, identity);
    await denied('spawn', spawnArgs('super'), identity);
    await denied('send', { from: auditor.addr, target: leader.addr, mode: 'queue', text: 'APPROVE G1' }, identity);
    for (const command of ['approve', 'memory-approve', 'memory-write']) {
      await denied(command, { role: 'auditor', binding: { role: 'auditor' } }, { ...identity, caller: auditor.addr }, 'invalid-arguments');
    }
  }
  for (const command of ['daemon-stop', 'upgrade-plan', 'upgrade-apply', 'upgrade-holder', 'layout-up', 'layout-adopt', 'switch']) {
    await denied(command, {}, { caller: 'super' });
  }
  const hostGrant = { target: 'HOST-CARD', tier: 'host', reason: 'Read-only fixture' };
  await denied('grant', hostGrant, { caller: 'super' });
  await denied('grant', hostGrant, { caller: 'super', capability: leader.token });
  await denied('grant', { ...hostGrant, request: true }, { caller: leader.addr, capability: worker.token });
  const requested = await wire(project, 'grant', { ...hostGrant, request: true }, { capability: leader.token });
  assert.equal(requested.requested.uses, 1);
  const issued = await wire(project, 'grant', hostGrant, { capability: external });
  assert.equal(issued.grant.remaining, 1);
  assert.match(issued.warning, /not fail-closed for Codex tool paths/);
  await denied('notifications', { take: true }, { caller: 'super' });
  await denied('send', { from: 'super', target: auditor.addr, mode: 'queue', text: 'spoof' }, { caller: 'super' });
  const anon = await wire(project, 'send', { target: auditor.addr, mode: 'queue', id: randomUUID(), text: 'unattributed' });
  assert.equal(anon.deliveryStatus, 'refused');
  const accepted = await wire(project, 'send', { target: leader.addr, mode: 'queue', text: 'unattributed' });
  assert.equal(accepted.ok, true);
  const privileged = await wire(project, 'gate-pack', { gate: 'G1', candidate: 'HEAD' }, { capability: leader.token, caller: worker.addr });
  assert.equal(privileged.ok, true, JSON.stringify(privileged));
  assert.equal((await wire(project, 'escalate', { gate: 'G1', reason: 'protected-file', evidence: 'fixture' },
    { capability: leader.token })).ok, true);
  assert.equal((await wire(project, 'send', { from: 'super', target: auditor.addr, mode: 'queue', text: 'Super message' },
    { capability: external })).ok, true);
  await assert.rejects(exec(process.execPath, [cli, 'gate', 'pack', 'G1', '--reuse', '--project', project], {
    cwd: project, env: { ...superEnv, LOOM_ADDR: leader.addr, HC_TERMINAL_ID: auditor.addr },
  }), error => JSON.parse(error.stdout).error.code === 'forbidden');
  assert.equal((await wire(project, 'stop', { target: auditor.addr }, { capability: external })).ok, true);
  assert.equal(existsSync(join(authDir, auditor.addr)), false);
  await denied('notifications', { decision: 'stale', kind: 'decision' }, { capability: auditor.token });
});

test('project capabilities are distinct and state inside a worktree is refused', t => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'lsa-state-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const first = join(root, 'first');
  const second = join(root, 'second');
  mkdirSync(first);
  mkdirSync(second);
  mkdirSync(join(second, '.git'));
  const env = { XDG_STATE_HOME: join(root, 'state'), LOOM_EXTERNAL_SUPER: '1' };
  socketCapabilities(first, env);
  const other = socketCapabilities(second, env);
  const firstToken = clientCapability(first, env);
  assert.ok(firstToken && firstToken !== clientCapability(second, env));
  assert.equal(other.identify(firstToken, () => undefined), undefined);
  assert.equal(clientCapability(second, { LOOM_PROJECT: first, LOOM_CAPABILITY: firstToken }), undefined);
  assert.throws(() => socketCapabilities(second, { XDG_STATE_HOME: join(second, 'state') }), /outside the project/);
  assert.throws(() => socketCapabilities(first, { XDG_STATE_HOME: join(second, 'state') }), /outside Git worktrees/);
});

test('kernel ancestry binds a legacy TUI descendant to its recorded pane birth', async t => {
  const peers = preparePeerAuth();
  if (!peers.available) return t.skip('Kernel peer identity is unavailable');
  const project = mkdtempSync(join(realpathSync(tmpdir()), 'lsa-pane-'));
  mkdirSync(join(project, '.project'));
  writeFileSync(join(project, '.project', 'policy.json'), JSON.stringify({ preferred: [], deny: [] }));
  const rootSource = join(project, 'pane.mjs');
  const submitter = join(project, 'submitter.mjs');
  writeFileSync(submitter, `
    import { createConnection } from 'node:net';
    const socket = createConnection(process.argv[2]);
    socket.on('connect', () => socket.write('{}\\n'));
    socket.on('data', chunk => process.stdout.write(chunk));
  `);
  writeFileSync(rootSource, `
    import { execFile } from 'node:child_process';
    process.on('message', () => execFile(process.execPath, [${JSON.stringify(submitter)}, ${JSON.stringify(socketPath(project))}],
      (error, stdout) => process.send(error ? null : JSON.parse(stdout))));
  `);
  const created = Date.now();
  const pane = spawn(process.execPath, [rootSource], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  const exited = once(pane, 'exit');
  let terminal;
  let server;
  const supervisor = createSupervisor(project, { report: () => {}, sessionOptions: {
    async openPane() {
      terminal = { address: 't1', cwd: project, state: 'live', pid: pane.pid, created_ms: created, status_ms: created };
      return { terminal, nativeId: randomUUID() };
    },
    async getPane() { return terminal; },
    async callHc(command) {
      if (command === 'kill') terminal = { ...terminal, state: 'finished', finished_ms: Date.now() };
      return terminal;
    },
  } });
  t.after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    await supervisor.shutdown();
    pane.kill('SIGTERM');
    await exited;
    rmSync(project, { recursive: true, force: true });
  });
  const { session } = await supervisor.handle('spawn', { role: 'leader', cwd: project, cli: 'codex', mode: 'tui',
    model: 'fixture', effort: 'high', prompt: 'Fixture startup' });
  const eligible = new Set(supervisor.legacySessions().map(row => row.addr));
  let changedBirth = false;
  server = createServer(socket => socket.once('data', async () => {
    const ancestors = peers.ancestors(socket);
    const proof = changedBirth ? ancestors.map(row => row.pid === pane.pid ? { ...row, birth: row.birth + 1 } : row) : ancestors;
    const actor = await supervisor.legacyPeerCaller(proof, eligible);
    socket.end(JSON.stringify({ addr: actor?.addr ?? null }));
  })).listen(socketPath(project));
  await once(server, 'listening');
  const fromPane = async () => {
    const reply = once(pane, 'message');
    pane.send(true);
    return (await reply)[0];
  };
  assert.deepEqual(await fromPane(), { addr: session.addr });
  assert.deepEqual(await wire(project, 'state', {}, { caller: session.addr }), { addr: null });
  changedBirth = true;
  assert.deepEqual(await fromPane(), { addr: null });
  changedBirth = false;
  await supervisor.handle('stop', { target: session.addr });
  assert.deepEqual(await fromPane(), { addr: null });
});
