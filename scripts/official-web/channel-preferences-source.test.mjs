import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { generateChannelPreferences } from "./generate-channel-preferences.mjs";
test("native preference composition replaces upstream store with explicit pinned callback", () => {
  const result = generateChannelPreferences();
  assert.equal(
    readFileSync(
      "frontends/raft/loom/OfficialChannelPreferences.generated.tsx",
      "utf8",
    ),
    result,
  );
  assert.ok(!result.includes("useServerStore"));
  assert.ok(result.includes("disabled={pin.busy}"));
  for (const id of [
    "channel-settings-pin-switch",
    "channel-overflow-mute-switch",
    "channel-settings-collapse-switch",
  ])
    assert.ok(result.includes(id));
  const host = readFileSync(
    "frontends/raft/loom/ChannelSettingsContent.tsx",
    "utf8",
  );
  assert.ok(host.includes("<ChannelPreferencesSection"));
  assert.ok(host.includes("preferences.version"));
});
