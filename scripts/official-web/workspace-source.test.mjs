import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (p) => readFileSync(p, "utf8");
test("workspace presentation is generated from locked source while authority stays local", async () => {
  const { generateWorkspace } = await import("./generate-workspace.mjs");
  for (const [name, source] of Object.entries(generateWorkspace()))
    assert.equal(read("frontends/raft/loom/" + name), source);
  assert.match(
    read("frontends/raft/loom/WorkspaceNativeParts.tsx"),
    /export .*OfficialWorkspace.generated/s,
  );
  const generated = generateWorkspace()["OfficialWorkspace.generated.tsx"];
  assert.match(generated, /aria-expanded=\{isExpanded\}/);
  assert.match(generated, /bg-info-soft/);
  assert.match(generated, /import \{[^}]*Separator[^}]*\} from "raft-ui"/);
  assert.doesNotMatch(generated, /api\.get|useAgentStore|localStorage/);
  assert.match(read("frontends/raft/loom/WorkspaceFileContent.tsx"), /65536/);
  assert.match(
    read("frontends/raft/loom/WorkspaceFileTree.tsx"),
    /channel.workspace.read/,
  );
  assert.match(
    read("frontends/raft/loom/DiffSummary.tsx"),
    /OfficialDiffStats.generated/,
  );
});
test("workspace shell, split panes and mobile file header come from official source", async () => {
  const { generateWorkspace } = await import("./generate-workspace.mjs");
  const generated = generateWorkspace()["OfficialWorkspace.generated.tsx"];
  for (const name of [
    "WorkspaceFrame",
    "WorkspacePathBar",
    "WorkspaceSplit",
    "WorkspaceTreePane",
    "WorkspaceDetailPane",
    "WorkspaceFileHeader",
    "WorkspaceResizeHandle",
  ])
    assert.ok(generated.includes(`export function ${name}(`), name);
  const host = read("frontends/raft/loom/ChannelWorkspacePanel.tsx");
  assert.doesNotMatch(
    host,
    /border-line-muted|bg-layer-panel|bg-layer-canvas-muted|<ArrowLeft/,
  );
  assert.match(host, /<WorkspaceFileHeader/);
});
