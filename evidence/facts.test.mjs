import assert from 'node:assert/strict';
import { execFileSync, mkdtempSync } from '../fixtures/test-process.mjs';
import { mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { checkFacts, plannedCardPaths } from './facts.mjs';
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
    '`./committed.md` `./created.md` `./on-disk.md` `./never-created.md`', project, project, snapshot,
  ), { checked: 4, misses: [{ kind: 'path', value: './never-created.md' }] });
});

test('replays pilot-2 notice, delivery and planned-module references without hiding a new fact miss', () => {
  const body = [
    'Loom drift and fact checks',
    'fact-miss T6-UNIFY-TESTS · path memory/CONTRACT.md',
    '这两条 `memory/CONTRACT.md` 查无此物是误报。后面会复核。',
    '`2a4b6633` 是投递 ID，`c95092d6` 是历史通知。待决项 3fcb0515。',
    '[loom:db8b48bc-69f6-4823-9c62-ff6bd387556e] SHA db8b48bc-69f6-4823-9c62-ff6bd387556e',
    '`handover-leader.md` 在 .project 下，`prompts.mjs` 和 `store.mjs` 是待实现模块。',
    'The card will create `memory/planned.mjs`, `memory/later.mjs`.',
    '`memory/future.mjs` 尚未实现。',
    '按 T6 复核 `./memory/CONTRACT-v2.md`。',
  ].join('\n');
  const quotedMisses = [{ kind: 'path', value: 'memory/CONTRACT.md' }];
  const plannedPaths = plannedCardPaths('## 交付\n- 新写 `memory/CONTRACT-v2.md`。');
  assert.deepEqual(checkFacts(body, import.meta.dirname, import.meta.dirname, null, { quotedMisses, plannedPaths }).misses, []);
  assert.deepEqual(checkFacts(body + '\nCurrent SHA deadbee. See `./missing.mjs`.', import.meta.dirname,
    import.meta.dirname, null, { quotedMisses, plannedPaths }).misses,
  [{ kind: 'path', value: './missing.mjs' }, { kind: 'sha', value: 'deadbee' }]);
});
