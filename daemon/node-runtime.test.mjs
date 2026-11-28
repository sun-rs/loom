import assert from 'node:assert/strict';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { execFileSync } from '../fixtures/test-process.mjs';

const root = resolve(import.meta.dirname, '..');
const env = { ...process.env, PATH: '/usr/bin:/bin', LOOM_NODE_ROOT: dirname(dirname(dirname(process.execPath))) };

test('release CLI and daemon find Loom Node with no Node on PATH', () => {
  const entries = [
    ['bin/loom', [], /loom/], ['bin/loomd', [], /loomd/],
    ['handover/loom', ['handover'], /loom handover/], ['watch/cli.mjs', [], /watch\/cli\.mjs/],
  ];
  for (const [entry, args, help] of entries) {
    const output = execFileSync('/bin/sh', [join(root, entry), ...args, '--help'], { env, encoding: 'utf8' });
    assert.match(output, help);
  }
});

test('release self-check identifies the actual Node executable and native ABI', () => {
  const output = execFileSync(process.execPath, [join(root, 'bin', 'loomd'), '--self-check'], { env, encoding: 'utf8' });
  assert.deepEqual(JSON.parse(output).nodeRuntime,
    { path: process.execPath, version: process.versions.node, abi: process.versions.modules });
});
