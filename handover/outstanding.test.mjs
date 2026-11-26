import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractOutstanding, startedOutstanding } from './outstanding.mjs';

test('keeps handover actions separate from ordinary in-flight background', () => {
  const note = '## Background\n- Wait for an open worker.\n\n## 接任后的首个动作\n1. File `goal5`.\n- Reconcile `.project/gate.md`.\n\n## Prior evidence\nResult accepted.';
  const { items, background } = extractOutstanding(note);
  assert.deepEqual(items, ['File `goal5`.', 'Reconcile `.project/gate.md`.']);
  assert.match(background, /Wait for an open worker[\s\S]*Result accepted/);
  assert.doesNotMatch(background, /goal5|gate\.md/);
});

test('recognizes the same project path in relative and absolute work evidence', () => {
  const item = 'Reconcile `.project/gate.md` with the accepted evidence.';
  assert.equal(startedOutstanding(item, ['cat ./.project/gate.md']), true);
  assert.equal(startedOutstanding(item, ['cat /fixture/project/.project/gate.md']), true);
  assert.equal(startedOutstanding(item, ['cat /fixture/project/old.project/gate.md']), false);
  assert.equal(startedOutstanding('Register phase `goal5`.', ['registered goal50.', 'git rev-parse HEAD']), false);
  assert.equal(startedOutstanding('Register phase `goal5`.', ['registered goal5.']), true);
});
