import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const read = (p: string) =>
  readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
test("Human family entry points consume one identity/navigation provider", () => {
  for (const file of [
    "components/message-markdown.tsx",
    "components/conversation-panes.tsx",
    "components/agent-directory-pane.tsx",
    "components/member-relationship-graph.tsx",
  ])
    assert.match(read(file), /HumanIdentity|useHumanIdentity/, file);
  assert.match(read("components/workspace-entity-context.tsx"), /onOpenHuman/);
  assert.match(
    read("App.tsx"),
    /workspace\.human\.list/,
    "the members surface must read the canonical Workspace Human directory",
  );
  assert.match(
    read("workspace-entities.ts"),
    /humans:/,
    "all Human identity consumers must join the shared entity projection",
  );
  assert.doesNotMatch(
    read("components/agent-sidebar.tsx"),
    /currentHuman === undefined \? 0 : 1/,
    "the Human section cannot hard-code the signed-in user as the directory",
  );
});
test("profile and account edits share the authenticated mutation owner", () => {
  assert.match(read("components/human-profile-pane.tsx"), /HumanProfileFields/);
  assert.match(
    read("components/settings-pages.tsx"),
    /useHumanProfileMutation/,
  );
});
test("Human and Agent role help reuse the same modal owner", () => {
  assert.match(
    read("components/human-profile-pane.tsx"),
    /RolePermissionsHelp/,
  );
  assert.match(
    read("components/agent-role-permissions.tsx"),
    /subject.*human/s,
  );
  assert.match(
    read("components/human-profile-pane.tsx"),
    /onChangeRole/,
    "the Human profile must expose the existing canonical control-Room role command",
  );
  assert.match(
    read("App.tsx"),
    /web-workspace-human-role-/,
    "role writes must cross the App causal RoomSession owner",
  );
});
