import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const root = "frontends/raft/";
const read = (p) => readFileSync(root + p, "utf8");
test("detail rows use the complete pinned official components rather than local recipes", () => {
  const pkg = JSON.parse(read("upstream/raft-web-source/package.json"));
  for (const name of ["AvatarListRow", "KeyValueRow"]) {
    assert.equal(
      pkg.exports["./" + name],
      `./packages/web/src/components/ui/${name}.tsx`,
    );
  }
  const row = read("loom/OfficialListRows.tsx");
  assert.match(row, /@loom\/raft-web-source\/AvatarListRow/);
  assert.doesNotMatch(row, /<ListRow|className=/);
  const computer = read("loom/ComputersPage.tsx");
  assert.match(computer, /@loom\/raft-web-source\/KeyValueRow/);
  assert.doesNotMatch(computer, /function Fact|<Fact /);
  assert.match(
    computer.replace(/\s+/g, " "),
    /<KeyValueRow label="操作系统" value=\{computer\?\.os \|\| "未知"\} mono breakAll/,
  );
});
