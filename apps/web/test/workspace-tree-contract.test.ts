import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
test("refresh invalidates directory requests without remounting the expanded tree", () => {
  const source = readFileSync(
    new URL("../src/components/agent-workspace-browser.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /key=\{`\$\{agentDefinitionId\}:\$\{hidden\}:\$\{revision\}`\}/,
  );
  assert.match(source, /revision=\{revision\}/);
  assert.match(source, /clearTimeout\(copyTimer\.current\)/);
  assert.match(source, /1500/);
});
test("selected file and compact pane use the frozen Raft contract", () => {
  const css = readFileSync(
    new URL("../src/agent-workspace.css", import.meta.url),
    "utf8",
  );
  assert.match(css, /var\(--pink\) 20%/);
  assert.match(css, /border-right: 2px solid var\(--pink\)/);
  assert.match(css, /@container/);
  assert.match(css, /rah-workspace-resizer/);
});

test("workspace roots keep server-selected paths separate from relative file requests", () => {
  const source = readFileSync(
    new URL("../src/components/agent-workspace-browser.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /"agent\.workspace\.roots"/);
  assert.match(source, /"agent\.workspace\.list"/);
  assert.match(source, /"agent\.workspace\.read"/);
  assert.match(source, /rootId/);
  assert.match(source, /来自 daemon 冻结的 workspace cwd/);
});
