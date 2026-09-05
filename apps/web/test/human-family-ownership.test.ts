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
});
