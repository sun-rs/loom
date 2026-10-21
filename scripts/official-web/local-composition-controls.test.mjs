import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (p) => readFileSync("frontends/raft/loom/" + p, "utf8");
test("Loom-only detail dismissal uses native CloseButton glyph and recipe", () => {
  for (const file of ["MemoryPage.tsx", "SideWorkspace.tsx"]) {
    const source = read(file);
    assert.match(source, /<CloseButton/);
    assert.doesNotMatch(source, /<X size=\{14\}/);
    assert.doesNotMatch(
      source,
      /className="flex size-8 shrink-0 items-center justify-center"/,
    );
  }
});
test("memory master detail uses the same seam token as retained split surfaces", () => {
  assert.match(read("MemoryPage.tsx"), /border-r border-line-seam/);
});
