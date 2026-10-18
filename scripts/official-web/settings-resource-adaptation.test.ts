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
test("notification read-only surface keeps native card and omits unavailable actions", () => {
  const result = exposeNotificationStatus(settings).split(
    "export function LoomNotificationStatus",
  )[1];
  assert.ok(result.includes("settings.notifications.mainTitle"));
  assert.ok(result.includes("bg-layer-panel"));
  assert.ok(!result.includes("theme-brutal:"));
  assert.ok(!result.includes("handleEnable"));
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
