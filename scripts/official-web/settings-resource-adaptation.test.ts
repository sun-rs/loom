import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { extractSettingsSections } from "./generate-settings-sections.mjs";
const settings = readFileSync(
  "frontends/raft/upstream/raft-web-source/packages/web/src/components/settings/SettingsPanel.tsx",
  "utf8",
);
test("notification surface keeps native card recipes and separately exposes native workspace mute form", () => {
  const result = extractSettingsSections(settings).notification;
  assert.ok(result.includes("settings.notifications.mainTitle"));
  assert.ok(result.includes('<Card className="space-y-3 p-4">'));
  assert.ok(result.includes("text-subhead font-semibold text-foreground"));
  assert.ok(result.includes('appearance="soft"'));
  assert.ok(result.includes("</Card>"));
  assert.ok(!result.includes("shadow-raft-sm"));
  assert.ok(!result.includes("theme-brutal:"));
  for (const action of ["handleEnable", "handleDisable", "handleSendTest"])
    assert.ok(result.includes(`onClick={${action}}`));
  assert.ok(!result.includes("handleSaveServerMute"));
  const mute = extractSettingsSections(settings).workspaceMute;
  assert.ok(mute.includes("handleSaveServerMute"));
  assert.ok(mute.includes("serverPushMuted === savedServerPushMuted"));
  assert.ok(mute.includes('variant="accent" size="sm"'));
  assert.ok(result.includes("loading || busy || testing"));
  assert.throws(() => extractSettingsSections("changed"), /boundary/);
});
