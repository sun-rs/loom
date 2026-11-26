import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { copyFileSync, chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import pty from 'node-pty';
import { releaseDigest } from '../daemon/release.mjs';
import { checkHolder, holderAsset, holderName, holderAssets, manifestHeader, pipeManifestHeader, platforms, sha256 } from './assets.mjs';
import { decodeEvents, frame, frameDecoder, u32, holderClient, events } from './protocol.mjs';

const root = resolve(import.meta.dirname, '..');
const host = `${process.platform}-${process.arch}`;
const supported = platforms.includes(host);
const quiet = 800_000_000n;
const guard = (snapshot, minHumanQuietNs = quiet) => ({ ...snapshot, minHumanQuietNs });

function fixture(t) {
  const dir = realpathSync(mkdtempSync('/tmp/lh3-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

async function until(read, predicate = Boolean, ms = 5000) {
  const until = performance.now() + ms;
  let last;
  do {
    try { last = await read(); }
    catch (error) { last = error; }
    if (predicate(last)) return last;
    await delay(15);
  } while (performance.now() < until);
  assert.fail(`Fixture deadline: ${String(last)}`);
}

function spawnHolder(t) {
  const dir = fixture(t);
  const socket = join(dir, 's');
  const controllerFile = join(dir, 'controller.json');
  const controller = { generation: 1, id: randomUUID() };
  const asset = holderAsset(root);
  const binding = { socket, incarnation: randomUUID() };
  const peer = holderClient(binding, controller);
  const register = value => writeFileSync(controllerFile, JSON.stringify(value));
  register(controller);
  const outer = pty.spawn(asset.path, ['--launch', socket, dir, controllerFile, binding.incarnation.replaceAll('-', ''),
    asset.digest, '/bin/sh', '-c', 'stty raw -echo; printf READY; exec /bin/cat'],
  { cols: 86, rows: 28, cwd: dir, env: { PATH: '/usr/bin:/bin', TERM: 'xterm-256color', HOME: dir } });
  let output = '';
  outer.onData(text => { output += text; });
  const gone = new Promise(resolve => outer.onExit(resolve));
  t.after(async () => {
    try { outer.kill(); } catch { /* Already reaped. */ }
    await Promise.race([gone, delay(300)]);
  });
  async function ready() {
    await until(() => peer.hello(), x => x?.pid === outer.pid);
    await until(() => output.includes('READY'));
    return peer.claim();
  }
  return { dir, binding, peer, register, ready, gone, outer, output: () => output };
}

function candidate(t, bytes) {
  const dir = fixture(t);
  const path = join(dir, holderName(host));
  writeFileSync(path, bytes, { mode: 0o700 });
  const digest = sha256(bytes);
  writeFileSync(join(dir, 'manifest'), `${manifestHeader}\n${holderName(host)} ${digest}\n`);
  return { path, digest };
}

test('holder frame codec is bounded and accepts a header and body split at any byte', () => {
  const bytes = Buffer.of(0, 2, 0, 255, 5);
  const encoded = frame(bytes);
  for (let i = 0; i <= encoded.length; i++) {
    const decode = frameDecoder();
    const result = decode(encoded.subarray(0, i)) ?? decode(encoded.subarray(i));
    assert.deepEqual(result, bytes);
  }
  assert.throws(() => frameDecoder()(u32(65537)), RangeError);
  assert.throws(() => frameDecoder()(u32(0)), RangeError);
  assert.throws(() => frameDecoder()(Buffer.concat([encoded, bytes])), RangeError);
  assert.throws(() => decodeEvents(Buffer.alloc(22)), { code: 'HOLDER_FRAME' });
});

test('holder guard exercises a human race, epoch, short write and EAGAIN at the syscall', { skip: !supported }, t => {
  const dir = fixture(t);
  const executable = join(dir, 'guard');
  const cc = process.platform === 'darwin' ? '/usr/bin/clang' : '/usr/bin/cc';
  execFileSync(cc, ['-Werror', '-Wall', '-Wextra', join(import.meta.dirname, 'guard.test.c'), '-o', executable]);
  execFileSync(executable);
});

test('release verification authenticates native bytes, mode and the shipped manifest', { skip: !supported }, async t => {
  assert.equal((await checkHolder(root)).name, holderName(host));
  const dir = fixture(t);
  const bin = join(dir, 'holder', 'bin');
  mkdirSync(bin, { recursive: true });
  for (const name of ['adapters', 'bin', 'cli', 'daemon', 'evidence', 'handover', 'inbox', 'index', 'lib', 'memory', 'relay', 'runtimes',
    'schema', 'tui', 'watch']) mkdirSync(join(dir, name));
  for (const name of ['package.json', 'package-lock.json']) writeFileSync(join(dir, name), '{}');
  for (const name of [...platforms.map(holderName), 'manifest']) copyFileSync(join(root, 'holder', 'bin', name), join(bin, name));
  assert.equal(Object.keys(holderAssets(dir)).length, platforms.length);
  const full = releaseDigest(dir);
  const legacy = releaseDigest(dir, { legacy: true });
  const path = join(bin, holderName(host));
  const bytes = readFileSync(path);
  writeFileSync(path, Buffer.concat([bytes, Buffer.of(0)]));
  assert.throws(() => holderAssets(dir), /digest or mode/);
  assert.notEqual(releaseDigest(dir), full);
  assert.equal(releaseDigest(dir, { legacy: true }), legacy);
  writeFileSync(path, bytes);
  chmodSync(path, 0o600);
  assert.throws(() => holderAssets(dir), /digest or mode/);
});

test('native holder fences old owners, mirrors input, preserves resize and human quiet across exec, and reports exit', { skip: !supported }, async t => {
  const f = spawnHolder(t);
  const old = await f.ready();
  assert.equal(old.mirroredOffset, old.outputOffset);
  const userBytes = 'typing-🐙';
  f.outer.write(userBytes);
  await until(() => f.peer.snapshot(), x => x?.humanInputOffset > old.humanInputOffset);
  assert.equal((await f.peer.write(guard(old), 'invalid', randomUUID())).status, 'stale');
  // The child may echo the keystroke after the human counter moves. Take the
  // quiet check's frame after that output so it exercises the time guard.
  await until(() => f.output().includes(userBytes));
  const first = await f.peer.snapshot();
  assert.equal((await f.peer.write(guard(first, 10_000_000_000n), 'invalid', randomUUID())).status, 'busy-human');
  const controller = { generation: 2, id: randomUUID() };
  const newer = holderClient(f.binding, controller);
  await assert.rejects(newer.claim(), { code: 'HOLDER_STALE' });
  f.register(controller);
  assert.equal((await newer.claim()).epoch, 2n);
  await assert.rejects(f.peer.claim(), { code: 'HOLDER_STALE' });
  assert.equal((await f.peer.write(guard(first), 'invalid', randomUUID())).status, 'stale');

  const tx = randomUUID();
  const asset = candidate(t, readFileSync(holderAsset(root).path));
  await assert.rejects(newer.handoff(first.generation, tx, asset), { code: 'HOLDER_EOF' });
  const after = await until(() => newer.hello(), x => x?.generation === old.generation + 1n);
  assert.equal(after.pid, old.pid);
  assert.equal(after.childPid, old.childPid);
  assert.equal(after.transaction, tx.replaceAll('-', ''));
  assert.equal(after.lastHumanNs, first.lastHumanNs);
  // Quiet remains enforced across exec even if CI scheduling makes this test late.
  assert.equal((await newer.write(guard(after, 10_000_000_000n), 'invalid', randomUUID())).status, 'busy-human');
  await until(() => newer.snapshot(), x => x?.nowNs - x?.lastHumanNs >= quiet);
  const before = await newer.resize(99, 33);
  const id = randomUUID();
  const message = 'once-only';
  const accepted = await newer.write(guard(before), message, id);
  assert.equal(accepted.status, 'applied');
  assert.equal(accepted.written, message.length);
  const repeated = await newer.write(guard(await newer.snapshot()), message, id);
  assert.deepEqual(repeated, accepted);
  await until(() => f.output().includes(message));
  assert.equal(f.output().split(message).length - 1, 1);
  assert(f.output().includes(userBytes));
  const batch = await newer.read(0n);
  assert.deepEqual(batch.find(x => x.type === events.resize)?.data, u32(99, 33));
  assert.equal(batch.filter(x => x.type === events.write).length, 1);
  await newer.signal('SIGTERM');
  assert.equal((await f.gone).exitCode, 143);
});

test('exec failure preserves the old holder, a missing journal is explicit, and a crashing candidate exits', { skip: !supported }, async t => {
  const f = spawnHolder(t);
  const first = await f.ready();
  const invalid = candidate(t, Buffer.from('ENOEXEC'));
  await assert.rejects(f.peer.handoff(first.generation, randomUUID(), invalid), { code: 'HOLDER_FAILED' });
  assert.equal((await f.peer.hello()).generation, first.generation);
  const asset = candidate(t, readFileSync(holderAsset(root).path));
  await assert.rejects(f.peer.handoff(first.generation, randomUUID(), asset), { code: 'HOLDER_EOF' });
  const second = await until(() => f.peer.hello(), x => x?.generation === first.generation + 1n);
  rmSync(join(f.dir, 'events-0000000000000000'));
  await assert.rejects(f.peer.read(0n), { code: 'HOLDER_GAP' });
  const crash = candidate(t, Buffer.from('#!/bin/sh\nexit 99\n'));
  await assert.rejects(f.peer.handoff(second.generation, randomUUID(), crash), { code: 'HOLDER_EOF' });
  assert.equal((await f.gone).exitCode, 99);
});

test('pipe holder isolates stderr and inherits both output fds and stdin across same-PID exec', { skip: !supported }, async t => {
  const dir = fixture(t);
  const binding = { socket: join(dir, 's'), incarnation: randomUUID() };
  const controller = { generation: 1, id: randomUUID() };
  const path = join(dir, 'controller');
  writeFileSync(path, JSON.stringify(controller));
  const asset = await checkHolder(root, { pipes: true });
  const peer = holderClient(binding, controller);
  const child = spawn(asset.path, ['--pipes', binding.socket, dir, path, binding.incarnation.replaceAll('-', ''), asset.digest,
    '/bin/sh', '-c', 'printf out; printf err >&2; read -r line; printf "%s" "$line"; printf done >&2; exit 42'],
  { cwd: dir, stdio: 'ignore' });
  const gone = new Promise(resolve => child.once('exit', resolve));
  t.after(async () => { if (child.exitCode === null) child.kill(); await gone; });
  await until(() => peer.hello(), x => x?.outputOffset === 3n && x.stderrOffset === 3n);
  const start = await peer.claim();
  assert.equal(start.pipes, true);
  const target = candidate(t, readFileSync(asset.path));
  await assert.rejects(peer.handoff(start.generation, randomUUID(), target), { code: 'HOLDER_INVALID' });
  writeFileSync(join(resolve(target.path, '..'), 'pipes'), `${pipeManifestHeader}\n${holderName(host)} ${target.digest}\n`);
  await assert.rejects(peer.handoff(start.generation, randomUUID(), target), { code: 'HOLDER_EOF' });
  const after = await until(() => peer.hello(), x => x?.generation === 2n);
  assert.deepEqual([after.pid, after.childPid, after.outputOffset, after.stderrOffset],
    [child.pid, start.childPid, 3n, 3n]);
  const receipt = await peer.write(guard(after, 0n), 'after\n', randomUUID());
  assert.equal(receipt.status, 'applied');
  assert.equal(await gone, 42);
  const records = decodeEvents(readFileSync(join(dir, 'events-0000000000000000')));
  const readStream = type => records.filter(e => e.type === type).map(e => [e.offset, e.data.toString()]);
  assert.deepEqual(readStream(events.output), [[0n, 'out'], [3n, 'after']]);
  assert.deepEqual(readStream(events.stderr), [[0n, 'err'], [3n, 'done']]);
  assert.equal(records.at(-1).data.readUInt32BE(4), 42);
});

test('only an owning pipe controller can escalate to SIGKILL for the native group', { skip: !supported }, async t => {
  const dir = fixture(t);
  const binding = { socket: join(dir, 's'), incarnation: randomUUID() };
  const controller = { generation: 1, id: randomUUID() };
  const controllerPath = join(dir, 'controller');
  writeFileSync(controllerPath, JSON.stringify(controller));
  const asset = await checkHolder(root, { pipes: true });
  const holder = spawn(asset.path, ['--pipes', binding.socket, dir, controllerPath, binding.incarnation.replaceAll('-', ''), asset.digest,
    '/bin/sh', '-c', 'trap "" TERM; sleep 30 & printf READY; wait'], { cwd: dir, stdio: 'ignore' });
  const gone = new Promise(resolve => holder.once('exit', resolve));
  const peer = holderClient(binding, controller);
  t.after(async () => {
    if (holder.exitCode === null) await peer.signal('SIGKILL').catch(() => {});
    await gone;
  });
  await until(() => peer.hello(), snapshot => snapshot?.outputOffset === 5n);
  await peer.claim();
  const stranger = holderClient(binding, { ...controller, id: randomUUID() });
  await assert.rejects(stranger.signal('SIGKILL'), { code: 'HOLDER_STALE' });
  await peer.signal('SIGTERM');
  await delay(100);
  assert.equal((await peer.snapshot()).ended, false);
  await peer.signal('SIGKILL');
  assert.equal(await gone, 137);
  const native = decodeEvents(readFileSync(join(dir, 'events-0000000000000000'))).at(-1);
  assert.equal(native.type, events.exit);
  assert.equal(native.data.readUInt32BE(), 9);
});

test('journals terminal input classes without bytes and reserves quiet time for edits', { skip: !supported }, async t => {
  const f = spawnHolder(t);
  let before = await f.ready();
  for (const report of ['\x1b[I', '\x1b[O', '\x1b[?1c', '\x1b[10;20R', '\x1b[0n', '\x1b[200~', '\x1b[201~', '\x1b[<0;2;3M']) {
    f.outer.write(report);
    const after = await until(() => f.peer.snapshot(), value => value?.humanInputOffset > before.humanInputOffset);
    assert.equal(after.lastHumanNs, before.lastHumanNs);
    const [input] = (await f.peer.read(before.eventSeq)).filter(event => event.type === events.human);
    assert.equal(input.inputClass, 'terminal-report');
    assert.equal(input.data.length, 16);
    before = after;
  }
  for (const editing of ['\x1b[Ia', '\x1b[A', '\x1b[1;2P', 'a']) {
    f.outer.write(editing);
    const after = await until(() => f.peer.snapshot(), value => value?.humanInputOffset > before.humanInputOffset);
    assert(after.lastHumanNs > before.lastHumanNs);
    const [input] = (await f.peer.read(before.eventSeq)).filter(event => event.type === events.human);
    assert.equal(input.inputClass, 'editing');
    before = after;
  }
  await f.peer.signal('SIGTERM');
  await f.gone;
});

test('holder grid replay keeps a UTF-8 code point divided by snapshots', { skip: !supported }, async t => {
  const f = spawnHolder(t);
  const { holderTerminal } = await import('../tui/holder-terminal.mjs');
  const initial = await f.ready();
  const terminal = await holderTerminal(f.binding, undefined, 'agy');
  t.after(() => terminal.dispose());
  const cjk = Buffer.from('。');
  assert.equal((await f.peer.write(guard(initial, 0n), cjk.subarray(0, 2), randomUUID())).status, 'applied');
  const split = await until(() => f.peer.snapshot(), value => value?.outputOffset === initial.outputOffset + 2n);
  assert(!((await terminal.read()).text.includes('\uFFFD')));
  assert.equal((await f.peer.write(guard(split, 0n), cjk.subarray(2), randomUUID())).status, 'applied');
  await until(() => f.peer.snapshot(), value => value?.outputOffset === initial.outputOffset + 3n);
  assert.match((await terminal.read()).text, /READY。/);
  await f.peer.signal('SIGTERM');
  await f.gone;
});
