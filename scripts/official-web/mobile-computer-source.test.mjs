import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (p) => readFileSync("frontends/raft/" + p, "utf8");
test("mobile computer list uses official list recipe instead of a handwritten hit area", () => {
  const page = read("loom/ComputersPage.tsx");
  assert.doesNotMatch(page, /const mobileRow|className=\{mobileRow\}/);
  assert.match(page, /<ListRow[\s\S]*data-testid="computer-mobile-row"/);
  assert.match(page, /<IconTile>/);
});
