import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import xterm from '@xterm/headless';
import { draftExpectation, verifyDraft } from './composer-draft.mjs';
import { readGrid } from './pty-grid.mjs';

test('Claude v3 verifies the captured marker followed by stale right-side spaces', async () => {
  const { cols, rows, wire, seed, records } = JSON.parse(
    readFileSync(new URL('../tasks/PILOT2-FIX-1/claude-draft.json', import.meta.url)));
  const grid = new xterm.Terminal({ cols, rows, scrollback: 500, allowProposedApi: true });
  const write = bytes => new Promise(resolve => grid.write(Buffer.from(bytes), resolve));
  try {
    await write(seed);
    for (const { paint } of records) {
      await write(paint);
      const row = grid.buffer.active.getLine(115);
      assert.equal(row.isWrapped, false);
      assert.equal(row.getCell(75).getChars(), ' ');
      const frame = readGrid(grid, 'claude');
      assert.equal(frame.draft, wire);
      const expected = draftExpectation(wire);
      assert(verifyDraft(frame, expected));
      assert.equal(verifyDraft({ ...frame, draft: frame.draft.replace('path store', 'path stale') }, expected), undefined);
    }
  } finally { grid.dispose(); }
});
