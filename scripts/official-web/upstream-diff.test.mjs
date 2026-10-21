import test from "node:test";
import assert from "node:assert/strict";
import { classify } from "./upstream-diff.mjs";
test("upstream comparison separates shared bytes, one-sided edits and overlapping edits", () => {
  assert.equal(classify("base", "base", "base"), "identical");
  assert.equal(classify("base", "new", "new"), "identical");
  assert.equal(classify("base", "base", "new"), "upstream-only");
  assert.equal(classify("base", "local", "base"), "loom-only");
  assert.equal(classify("base", "local", "new"), "both-changed-review");
  assert.equal(classify("base", "local", null), "missing-upstream");
  assert.equal(classify("base", null, "new"), "missing-loom");
});

import { inventoryDependency } from './upstream-diff.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
test('dependency audit compares upstream directly and separately detects forbidden local edits', () => {
 const root=mkdtempSync(join(tmpdir(),'loom-source-diff-'));
 try {
  const local=join(root,'local'),upstream=join(root,'upstream');mkdirSync(local);mkdirSync(upstream);
  const digest=createHash('sha256').update('original').digest('hex');
  writeFileSync(join(local,'source-lock.json'),JSON.stringify({revision:'pinned',files:{'component.tsx':digest}}));
  writeFileSync(join(local,'component.tsx'),'original');writeFileSync(join(upstream,'component.tsx'),'updated');
  let report=inventoryDependency(local,upstream);
  assert.equal(report.rows[0].status,'upstream-only');assert.equal(report.rows[0].unexpectedLocalDrift,false);
  writeFileSync(join(local,'component.tsx'),'local edit');report=inventoryDependency(local,upstream);
  assert.equal(report.rows[0].status,'both-changed-review');assert.equal(report.rows[0].unexpectedLocalDrift,true);
 }finally{rmSync(root,{recursive:true,force:true});}
});
