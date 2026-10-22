import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { extractDeclaration } from "./generate-navigation-leaves.mjs";
const read = (p) => readFileSync(p, "utf8");
test("sidebar toggle and focus transition declarations are unchanged upstream bodies", () => {
  const source = read("frontends/raft/loom/OfficialSidebarToggle.generated.js");
  const manifest = JSON.parse(
    read(
      "frontends/raft/upstream/published-2026-10-22/navigation-manifest.json",
    ),
  );
  for (const name of ["ZTt", "QTt", "$Tt", "lEt"])
    assert.equal(
      createHash("sha256")
        .update(extractDeclaration(source, name))
        .digest("hex"),
      manifest.declarations.find((d) => d.name === name).sha256,
    );
});
test("page shell uses native sidebar transition and child slots, not page-specific collapse CSS", () => {
  const root = read("frontends/raft/loom/SidebarLayout.tsx");
  assert.match(root, /sidebarCollapsible={enabled}/);
  assert.match(root, /inert={layout.collapsed/);
  for (const file of [
    "ChannelApp",
    "RoleWorkspace",
    "ComputersPage",
    "SettingsPage",
  ])
    assert.match(
      read("frontends/raft/loom/" + file + ".tsx"),
      /<LoomSidebarSlot/,
    );
  assert.doesNotMatch(
    read("frontends/raft/loom/AgentPage.tsx"),
    /<AppShellMainSlot/,
  );
});
