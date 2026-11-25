import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { estimateTokens } from '../lib/token-budget.mjs';
import { projectMemoryPrompt, searchMemory, syncMemoryIndex, writeMemory } from './project.mjs';

function fixture(t) {
  const project = mkdtempSync(join(tmpdir(), 'loom-memory-'));
  t.after(() => rmSync(project, { recursive: true, force: true }));
  writeFileSync(join(project, 'evidence.txt'), 'evidence');
  const put = (id, fields = {}) => writeMemory(project, {
    id, scope: 'project', owner: 'leader', source: 'evidence.txt', verified: '2025-01-01',
    title: 'Retry limits', keywords: 'quota', body: 'Retry once after confirmation.', ...fields,
  });
  return { project, put, index: join(project, '.project/memory/INDEX.md') };
}

test('writes bounded Markdown items and rebuilds a one-line-per-item index', t => {
  const { project, put, index } = fixture(t);
  const path = '.project/memory/items/retry.md';
  put('retry');
  const note = readFileSync(join(project, path), 'utf8');
  assert.match(note, /"owner":"leader".*?"source":"evidence.txt".*?"verified":"2025-01-01"/);
  assert.match(note, /# Retry limits\n\nRetry once/);
  assert.ok(estimateTokens(note) <= 200);
  assert.throws(() => put('retry', { body: '长'.repeat(201) }), /200 tokens/);
  assert.equal(readFileSync(join(project, path), 'utf8'), note);
  const line = `- ${path} — Retry limits`;
  assert.equal(readFileSync(index, 'utf8'), line + '\n');
  writeFileSync(index, 'stale\n');
  assert.deepEqual(searchMemory(project, 'QUOTA'), [{ id: 'retry', title: 'Retry limits', path }]);
  assert.deepEqual(syncMemoryIndex(project), [line]);
  assert.equal(readFileSync(index, 'utf8'), line + '\n');
});

test('checks paths and SHAs at write and filters failed, expired and replaced items', async t => {
  const { project, put, index } = fixture(t);
  const git = (...args) => execFileSync('git', args, { cwd: project, encoding: 'utf8' }).trim();
  git('init', '-q');
  const sha = git('hash-object', '-w', 'evidence.txt');
  assert.throws(() => put('missing', { source: 'missing' }), /could not be verified/);
  assert.throws(() => put('fake-sha', { source: '0'.repeat(40) }), /could not be verified/);
  assert.throws(() => put('missing-body', { body: 'See missing.txt' }), /could not be verified/);
  put('valid-sha', { source: sha, expires: new Date().toISOString().slice(0, 10) });
  put('expired', { source: sha, expires: '2025-01-01' });
  put('old', { source: sha, supersededBy: 'valid-sha' });
  put('lost-path');
  unlinkSync(join(project, 'evidence.txt'));
  assert.match(readFileSync(index, 'utf8'), /lost-path/);
  assert.deepEqual(searchMemory(project, 'Retry').map(item => item.id), ['valid-sha']);
  const prompt = await projectMemoryPrompt(project);
  assert.match(prompt, /valid-sha/);
  assert.doesNotMatch(prompt, /expired|old\.md|lost-path/);
});
