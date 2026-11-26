import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { platforms } from '../holder/assets.mjs';
import { includeReleaseEntry, releaseDigest } from './release.mjs';

const exec = promisify(execFile);
const root = resolve(import.meta.dirname, '..');
const supported = platforms.includes(`${process.platform}-${process.arch}`);
const read = path => JSON.parse(readFileSync(path, 'utf8'));

test('failed post-lock session verification restores the old writer and its native inbox', { skip: !supported }, async t => {
  const dir = realpathSync(mkdtempSync('/tmp/loom-upgrade-'));
  const project = join(dir, 'project');
  const metadata = join(project, '.project');
  const runtime = join(metadata, 'loomd');
  const candidate = join(dir, 'candidate');
  const cli = join(root, 'bin', 'loom');
  const codex = join(dir, 'codex');
  const env = { HOME: dir, TMPDIR: dir, CODEX_HOME: dir, PATH: process.env.PATH, LOOM_CODEX_BIN: codex,
    OAR_CODEX_BIN: codex, LOOM_DESKTOP_NOTIFY: '0', LOOM_TEST_CODEX_PIPES: '1' };
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
  writeFileSync(join(metadata, 'policy.json'), JSON.stringify({ deny: [], preferred: [], delivery: { coalesceMs: 0 } }));
  const fake = new URL('../tasks/PROTO-HARDEN-0/fixtures/native.mjs', import.meta.url);
  writeFileSync(codex, '#!' + process.execPath + '\nimport ' + JSON.stringify(fake.href) + ';\n', { mode: 0o700 });
  for (const transient of ['.test-aKYwiY', '.evidence-test-scratch', '.build-staging']) {
    assert.equal(includeReleaseEntry(transient), false);
  }
  for (const name of ['adapters', 'bin', 'cli', 'daemon', 'evidence', 'handover', 'holder', 'inbox', 'index', 'lib',
    'memory', 'relay', 'runtimes', 'schema', 'tui', 'watch', 'package.json', 'package-lock.json']) {
    cpSync(join(root, name), join(candidate, name), { recursive: true,
      filter: path => includeReleaseEntry(basename(path)) });
  }
  symlinkSync(join(root, 'node_modules'), join(candidate, 'node_modules'));
  const main = join(candidate, 'daemon', 'main.mjs');
  const candidateCode = readFileSync(main, 'utf8');
  const verify = '      validateReattachment(handoff, { sessions: attached });';
  assert(candidateCode.includes(verify));
  writeFileSync(main, candidateCode.replace(verify,
    "      attached[0] = { ...attached[0], status: 'unavailable', reason: 'fixture attachment failure' };\n" + verify));

  async function until(readResult, condition) {
    const deadline = Date.now() + 10_000;
    let value;
    do {
      value = await readResult();
      if (condition(value)) return value;
      await delay(100);
    } while (Date.now() < deadline);
    assert.fail(JSON.stringify(value));
  }
  const previous = await run('daemon', 'start');
  assert.equal(previous.running, true);
  const opened = await run('spawn', 'super', '--cwd', project, '--cli', 'codex', '--mode', 'headless',
    '--model', 'fixture', '--effort', 'high', 'Startup fixture prompt');
  const { addr } = opened.session;
  const state = () => run('state', addr);
  const answered = id => until(state, result => result.deliveries?.some(d => d.id === id && d.deliveryStatus === 'answered'));
  await answered(opened.deliveryId);
  const generation = read(join(runtime, 'generation.json'));
  const preflight = await run('upgrade', '--to', candidate, '--check');
  assert.equal(preflight.eligible, true, JSON.stringify(preflight));
  assert.equal(preflight.attachmentCheck, 'checked');
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
  const follow = randomUUID();
  assert.equal((await run('send', addr, '--id', follow, 'Delivered by the recovered daemon')).ok, true);
  await answered(follow);
  const native = readFileSync(join(project, 'native-deliveries.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(native.filter(e => e.text.startsWith(`[loom:${follow}]\n`)).length, 1);
});
