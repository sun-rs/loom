import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { extractSettingsSections } from "./generate-settings-sections.mjs";
const source = readFileSync(
  new URL(
    "../../frontends/raft/upstream/raft-web-source/packages/web/src/components/settings/SettingsPanel.tsx",
    import.meta.url,
  ),
  "utf8",
);
test("Local account adopts official profile card and omits unsupported account sections", () => {
  const result = extractSettingsSections(source).account;
  assert.ok(result.includes('testId="account-profile-card"'));
  assert.ok(result.includes('context="profile-tile"'));
  assert.ok(result.includes('data-testid="account-profile-username-input"'));
  assert.ok(result.includes("disabled={editingDisabled}"));
  assert.ok(!result.includes("settings.account.emailLabel"));
  assert.ok(!result.includes("AccountSignOutSection"));
  assert.ok(!result.includes("ProviderAccountRow"));
  assert.ok(result.includes("disabled={!profileDirty || saving}"));
  assert.ok(result.includes("maxLength={120}"));
  assert.throws(() =>
    extractSettingsSections(
      source.replace("onSubmit={handleSaveProfile}", "onSubmit={changed}"),
    ),
  );
});
