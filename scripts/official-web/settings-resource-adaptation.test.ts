import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { exposeNotificationStatus } from "../../frontends/raft/loom/settings-resource-adaptation.ts";
const settings = readFileSync(
  "frontends/raft/packages/web/src/components/settings/SettingsPanel.tsx",
  "utf8",
);
test("notification surface keeps native card and action recipes, omitting upstream server mute", () => {
  const result = exposeNotificationStatus(settings).split(
    "export function LoomNotificationStatus",
  )[1];
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
  assert.ok(result.includes("loading || busy || testing"));
  assert.throws(() => exposeNotificationStatus("changed"), /boundary/);
});
