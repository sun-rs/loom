import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
test("settings sections use checked generated boundaries rather than Vite runtime rewrites", async () => {
  const { generateSettingsSections } =
    await import("./generate-settings-sections.mjs");
  assert.equal(
    readFileSync(
      "frontends/raft/loom/OfficialSettingsSections.generated.tsx",
      "utf8",
    ),
    generateSettingsSections(),
  );
  const vite = readFileSync("frontends/raft/loom/vite.config.ts", "utf8");
  assert.doesNotMatch(
    vite,
    /exposeAccountProfile|exposeAboutVersion|exposeNotificationStatus|adaptSystemSettings|loom-native-appearance/,
  );
});
test("settings shared card and input wrappers are dependency bridges, not duplicated JSX", () => {
  for (const [path, name] of [
    ["settings/SettingsProfileCard", "SettingsProfileCard"],
    ["ui/SurfaceListItem", "SurfaceListItem"],
    ["ui/SlugInput", "SlugInput"],
  ]) {
    const bridge = readFileSync(
      `frontends/raft/packages/web/src/components/${path}.tsx`,
      "utf8",
    );
    assert.ok(bridge.includes(`@loom/raft-web-source/${name}`));
    assert.doesNotMatch(bridge, /className=|<Card|<InputGroup/);
  }
});
