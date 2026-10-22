import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
test("computer instance disclosure belongs to the bordered instance group", () => {
  const source = readFileSync("frontends/raft/loom/ComputersPage.tsx", "utf8");
  const group = source.slice(
    source.indexOf("<OfficialListRowGroup>"),
    source.indexOf("</OfficialListRowGroup>"),
  );
  assert.match(group, /<ShowMoreToggle/);
  assert.match(group, /border-line-hairline/);
  assert.match(group, /aria-expanded=\{expanded\}/);
});
