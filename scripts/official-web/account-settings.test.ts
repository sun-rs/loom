import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { exposeAccountProfile } from "../../frontends/raft/loom/account-settings-adaptation.ts";
const source = readFileSync(
  new URL(
    "../../frontends/raft/packages/web/src/components/settings/SettingsPanel.tsx",
    import.meta.url,
  ),
  "utf8",
);
test("Local account adopts official profile card and omits unsupported account sections", () => {
  const result = exposeAccountProfile(source).split(
    "export function LoomAccountSection()",
  )[1];
  assert.ok(result.includes('testId="account-profile-card"'));
  assert.ok(result.includes('context="profile-tile"'));
  assert.ok(result.includes('data-testid="account-profile-username-input"'));
  assert.ok(result.includes("disabled={editingDisabled}"));
  assert.ok(!result.includes("settings.account.emailLabel"));
  assert.ok(!result.includes("AccountSignOutSection"));
  assert.ok(!result.includes("ProviderAccountRow"));
  assert.ok(
    result.includes(
      'className="flex items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-50"',
    ),
  );
  assert.throws(() =>
    exposeAccountProfile(
      source.replace('testId="account-profile-card"', 'testId="changed"'),
    ),
  );
});
