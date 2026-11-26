import assert from 'node:assert/strict';
import { appendFileSync, cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { mkdtempSync } from '../fixtures/test-process.mjs';
import { roleCore, skillModules, skillRoot } from '../lib/role-skill.mjs';
import { lintSkill } from './skill.mjs';

test('the runtime uses one bounded core and at most two distinct modules per delivery', () => {
  assert.match(roleCore('worker'), /# Loom 共用规则.*# Worker.*worker-check/s);
  assert.doesNotMatch(roleCore('worker'), /# Leader|# Auditor/);
  const { names, text } = skillModules(['rotation', 'rotation', 'gate-pack', 'gate-judgment']);
  assert.deepEqual(names, ['rotation', 'gate-pack']);
  assert.equal(text.match(/\[loom-skill:/g).length, 2);
  assert.throws(() => skillModules(['../roles/leader']), RangeError);
});

test('skill lint finds dangling links, repeated or conflicting rules, oversize and unwired modules', t => {
  const project = mkdtempSync(join(tmpdir(), 'loom-skill-lint-'));
  t.after(() => rmSync(project, { recursive: true, force: true }));
  const root = join(project, 'skills/loom');
  cpSync(skillRoot, root, { recursive: true });
  mkdirSync(join(project, 'daemon'));
  for (const name of ['sessions', 'supervisor', 'self-rotation']) {
    cpSync(new URL('../daemon/' + name + '.mjs', import.meta.url), join(project, 'daemon', name + '.mjs'));
  }
  assert.deepEqual(lintSkill(project), []);
  appendFileSync(join(root, 'roles/worker.md'), '\n70. [缺失](references/missing.md)\n80. 禁止轮询。\n81. 允许轮询。\n');
  rmSync(join(root, 'modules/rotation.md'));
  writeFileSync(join(root, 'modules/unused.md'), '200. ' + '重'.repeat(510));
  const messages = lintSkill(project).map(issue => issue.message).join('\n');
  for (const pattern of [/one-level/, /unique ID/, /conflicting/, /Restore/, /500 estimated tokens/, /daemon event/]) {
    assert.match(messages, pattern);
  }
});
