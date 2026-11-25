import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { checkFacts } from './facts.mjs';
import { worktreeAt, worktreeDelta } from './worktree.mjs';

test('filters pilot fact misses from commands, counts, model names, and planned result paths', t => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'loom-facts-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, 'project');
  mkdirSync(join(project, 'tasks', 'PILOT-OPENCODE-TUI-1'), { recursive: true });
  const outside = join(root, 'outside evidence.md');
  writeFileSync(outside, 'external');
  const body = [
    '`/Users/sun/Code/loom-pilot/bin/loom status`',
    '`/Users/sun/.loom-cell/current/bin/loom`',
    '`provider/model`, `-m provider/model`, 1/1, 8/8, 37/37, `3/3`.',
    '将创建 `tasks/PILOT-OPENCODE-TUI-1/RESULT.md`。',
    'The next turn will generate tasks/PILOT-OPENCODE-TUI-1/FIX-1.md.',
    '`' + outside + '`',
    'Actual missing paths `tasks/PILOT-OPENCODE-TUI-1/verify-opencode-tui.mjs:12` and tasks/missing-folder.',
  ].join('\n');
  assert.deepEqual(checkFacts(body, project).misses, [
    { kind: 'path', value: 'tasks/PILOT-OPENCODE-TUI-1/verify-opencode-tui.mjs' },
    { kind: 'path', value: 'tasks/missing-folder' },
  ]);
});

test('resolves paths in the captured worktree and current filesystem without opening external files', t => {
  const project = mkdtempSync(join(realpathSync(tmpdir()), 'loom-facts-tree-'));
  t.after(() => rmSync(project, { recursive: true, force: true }));
  const git = (...args) => execFileSync('/usr/bin/git', args, { cwd: project, stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  writeFileSync(join(project, 'committed.md'), 'committed');
  git('add', 'committed.md');
  git('-c', 'user.name=Loom', '-c', 'user.email=loom@example.invalid', 'commit', '-qm', 'base');
  const start = worktreeAt(project);
  writeFileSync(join(project, 'created.md'), 'turn artifact');
  const snapshot = worktreeDelta(project, start, worktreeAt(project));
  assert.equal(snapshot.status, 'ok');
  rmSync(join(project, 'created.md'));
  rmSync(join(project, 'committed.md'));
  writeFileSync(join(project, 'on-disk.md'), 'current artifact');
  assert.deepEqual(checkFacts(
    '`committed.md` `created.md` `on-disk.md` `never-created.md`', project, project, snapshot,
  ), { checked: 4, misses: [{ kind: 'path', value: 'never-created.md' }] });
});
