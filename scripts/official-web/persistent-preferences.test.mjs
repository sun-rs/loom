import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
test("long message preference is bound to existing persistent sidebar data, not upstream channel store", () => {
  const host = readFileSync(
    "frontends/raft/loom/ChannelSettingsContent.tsx",
    "utf8",
  );
  assert.ok(host.includes("expandedLongMessages:"));
  const message = readFileSync(
    "frontends/raft/loom/OfficialMessageItem.generated.tsx",
    "utf8",
  );
  assert.ok(
    message.includes("useLoomCollapseLongMessages(referenceSurfaceChannelId)"),
  );
});
test("workspace mute reuses native form and existing versioned mutation", () => {
  const view = readFileSync(
    "frontends/raft/loom/OfficialSettingsSections.generated.tsx",
    "utf8",
  );
  assert.ok(view.includes("handleSaveServerMute"));
  const host = readFileSync("frontends/raft/loom/WorkspaceMute.tsx", "utf8");
  assert.ok(host.includes("mutedWorkspace:"));
  assert.ok(host.includes("preferences.version"));
});
