import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  exposeNotificationStatus,
  exposeReleaseNotes,
} from "../../frontends/raft/loom/settings-resource-adaptation.ts";
const settings = readFileSync(
  "frontends/raft/packages/web/src/components/settings/SettingsPanel.tsx",
  "utf8",
);
const release = readFileSync(
  "frontends/raft/packages/web/src/components/settings/ReleaseNotesPanel.tsx",
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
test("release content retains official card/category rendering without duplicate header or upstream fetch", () => {
  const result = exposeReleaseNotes(release).split(
    "export function LoomReleaseNotes",
  )[1];
  assert.ok(result.includes('data-testid="release-entry"'));
  assert.ok(result.includes("RELEASE_CATEGORY_ORDER"));
  assert.ok(!result.includes("<PanelHeader"));
  assert.ok(!result.includes("api.get"));
  assert.throws(() => exposeReleaseNotes("changed"), /boundary/);
});
