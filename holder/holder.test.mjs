import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { copyFileSync, chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import pty from 'node-pty';
import { releaseDigest } from '../daemon/release.mjs';
import { checkHolder, holderAsset, holderName, holderAssets, manifestHeader, platforms, sha256 } from './assets.mjs';
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
