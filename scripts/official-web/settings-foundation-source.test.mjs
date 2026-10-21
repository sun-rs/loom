import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
test("settings sidebar, archive and form field are generated from locked official boundaries", async () => {
  const { generateSettingsFoundation } =
    await import("./generate-settings-foundation.mjs");
  for (const [name, content] of Object.entries(generateSettingsFoundation()))
    assert.equal(
      readFileSync(`frontends/raft/loom/${name}.generated.tsx`, "utf8"),
      content,
    );
  const vite = readFileSync("frontends/raft/loom/vite.config.ts", "utf8");
  assert.doesNotMatch(
    vite,
    /adaptArchivedChannels|loom-native-archived-channels|loom-archived-settings/,
  );
  assert.match(
    readFileSync(
      "frontends/raft/packages/web/src/components/ui/FormField.tsx",
      "utf8",
    ),
    /OfficialFormField.generated/,
  );
  assert.match(
    readFileSync(
      "frontends/raft/packages/web/src/components/settings/SettingsSidebarList.tsx",
      "utf8",
    ),
    /OfficialSettingsSidebar.generated/,
  );
});
test("panel bounds resolve to pinned official dependency rather than a local copy", () => {
  const bridge = readFileSync(
    "frontends/raft/packages/web/src/lib/panelBounds.ts",
    "utf8",
  );
  assert.match(bridge, /@loom\/raft-web-source\/panelBounds/);
  assert.doesNotMatch(bridge, /min:|max:|defaultWidth:/);
});
